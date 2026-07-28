import { describe, it, expect } from 'vitest';
import { segmentWords, segmentSentences, containsHan } from './chinese/segment';
import { hskLevel } from './chinese/hsk';
import { scaleFor, scaledSize, dataUrlBytes, orientationTransform } from './camera/imagePrep';
import { ScanResultSchema, tokensMatch, KIND_LABEL_ZH } from './vision/schema';
import { buildSystemPrompt, buildUserPrompt, buildMessages } from './vision/prompts';
import { schedule, wordsToAnkiCsv, wordsToPleco, buildSearchBlob, type WordEntry } from './store/db';

// --- segmentation ---------------------------------------------------------

describe('segmentation', () => {
  it('splits Chinese into words', () => {
    const words = segmentWords('我昨天读了一本小说');
    expect(words.join('')).toBe('我昨天读了一本小说');
    expect(words.length).toBeGreaterThan(3);
  });

  it('splits on Chinese sentence terminators, which Intl.Segmenter does not', () => {
    const s = segmentSentences('他走了。她留下来。为什么？');
    expect(s).toEqual(['他走了。', '她留下来。', '为什么？']);
  });

  it('keeps text with no terminator as one sentence', () => {
    expect(segmentSentences('没有句号')).toEqual(['没有句号']);
  });

  it('round-trips: sentences always reconstruct the source', () => {
    const text = '一个老人在田里，讲起他这一生失去的人。他没有哭。';
    expect(segmentSentences(text).join('')).toBe(text);
  });

  it('detects Han characters', () => {
    expect(containsHan('活着')).toBe(true);
    expect(containsHan('hello')).toBe(false);
  });
});

// --- HSK ------------------------------------------------------------------

describe('hskLevel', () => {
  it('bands common words', () => {
    expect(hskLevel('人')).toBe(1);
    expect(hskLevel('老人')).toBe(1);
  });

  it('bands a word by its hardest character', () => {
    // 影 is HSK3, 人 is HSK1 → the word is only readable at 3.
    expect(hskLevel('影响')).toBe(3);
  });

  it('returns undefined rather than guessing for anything beyond the core', () => {
    expect(hskLevel('饥荒')).toBeUndefined();
    expect(hskLevel('')).toBeUndefined();
  });
});

// --- image prep -----------------------------------------------------------

describe('image preparation', () => {
  it('scales a large photo down to the long-edge cap', () => {
    expect(scaledSize(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(scaledSize(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });

  it('never upscales a small photo', () => {
    expect(scaleFor(800, 600)).toBe(1);
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('measures decoded bytes of a data URL, allowing for padding', () => {
    // "hi" → aGk= : 3 base64 chars + 1 pad = 2 bytes
    expect(dataUrlBytes('data:image/jpeg;base64,aGk=')).toBe(2);
    expect(dataUrlBytes('data:image/jpeg;base64,YWJj')).toBe(3);
  });

  it('swaps width and height for the rotating EXIF orientations', () => {
    expect(orientationTransform(1, 100, 50)).toMatchObject({ width: 100, height: 50 });
    // 6 and 8 are the quarter turns a phone records when held upright.
    expect(orientationTransform(6, 100, 50)).toMatchObject({ width: 50, height: 100 });
    expect(orientationTransform(8, 100, 50)).toMatchObject({ width: 50, height: 100 });
    // 3 is upside down — same dimensions, flipped both ways.
    expect(orientationTransform(3, 100, 50)).toMatchObject({ width: 100, height: 50 });
  });
});

// --- schema ---------------------------------------------------------------

describe('ScanResult schema', () => {
  const minimal = {
    detected: 'cover',
    confidence: 0.8,
    book: null,
    summaries: [{ kind: 'hook', zh: '这是一本好书。' }],
  };

  it('fills in every optional field so the UI never sees undefined', () => {
    const parsed = ScanResultSchema.parse(minimal);
    expect(parsed.key_terms).toEqual([]);
    expect(parsed.talking_points).toEqual([]);
    expect(parsed.extracted_text).toBe('');
    expect(parsed.caveats).toBe('');
    expect(parsed.summaries[0].tokens).toEqual([]);
  });

  it('coerces an unknown card kind instead of rejecting the whole scan', () => {
    const parsed = ScanResultSchema.parse({
      ...minimal,
      summaries: [{ kind: 'something-else', zh: '内容' }],
    });
    expect(parsed.summaries[0].kind).toBe('theme');
  });

  it('clamps a confidence the model invented', () => {
    expect(ScanResultSchema.parse({ ...minimal, confidence: 42 }).confidence).toBe(0.5);
  });

  it('rejects a scan with no summaries at all — there is nothing to show', () => {
    expect(ScanResultSchema.safeParse({ ...minimal, summaries: [] }).success).toBe(false);
  });

  it('has a Chinese label for every card kind', () => {
    for (const kind of Object.keys(KIND_LABEL_ZH)) {
      expect(KIND_LABEL_ZH[kind as keyof typeof KIND_LABEL_ZH]).toMatch(/\p{Script=Han}/u);
    }
  });
});

describe('tokensMatch', () => {
  it('accepts tokens that rebuild the sentence exactly', () => {
    expect(
      tokensMatch({
        zh: '老人在田里。',
        tokens: [
          { w: '老人', py: '', en: '' },
          { w: '在', py: '', en: '' },
          { w: '田', py: '', en: '' },
          { w: '里', py: '', en: '' },
          { w: '。', py: '', en: '' },
        ],
      }),
    ).toBe(true);
  });

  it('rejects tokens that dropped the punctuation', () => {
    // This is the common small-model failure, and it silently breaks
    // tap-to-define alignment if it isn't caught.
    expect(
      tokensMatch({
        zh: '老人在田里。',
        tokens: [
          { w: '老人', py: '', en: '' },
          { w: '在田里', py: '', en: '' },
        ],
      }),
    ).toBe(false);
  });

  it('rejects an empty token list', () => {
    expect(tokensMatch({ zh: '老人', tokens: [] })).toBe(false);
  });
});

// --- prompts --------------------------------------------------------------

describe('prompts', () => {
  it('asks for JSON-only when the mode has no schema enforcement', () => {
    expect(buildSystemPrompt({ intent: 'cover', level: 4 }, 'json_object')).toMatch(
      /single JSON object/i,
    );
    expect(buildSystemPrompt({ intent: 'cover', level: 4 }, 'prompt')).toMatch(/JSON/);
  });

  it('omits the JSON nudge when a strict schema is doing the work', () => {
    expect(buildSystemPrompt({ intent: 'cover', level: 4 }, 'json_schema')).not.toMatch(
      /single JSON object/i,
    );
  });

  it('sets the register from the HSK level', () => {
    expect(buildSystemPrompt({ intent: 'cover', level: 2 }, 'json_schema')).toMatch(/HSK 2/);
    expect(buildSystemPrompt({ intent: 'cover', level: 7 }, 'json_schema')).toMatch(/native-level/);
  });

  it('switches script for traditional', () => {
    expect(buildSystemPrompt({ intent: 'cover', level: 4, traditional: true }, 'json_schema')).toMatch(
      /traditional Chinese/,
    );
  });

  it('always states the one-or-two-sentence limit', () => {
    expect(buildSystemPrompt({ intent: 'pages', level: 4 }, 'json_schema')).toMatch(
      /ONE OR TWO SENTENCES/,
    );
  });

  it('tells the pages path to transcribe before summarising', () => {
    const pages = buildUserPrompt({ intent: 'pages', level: 4 });
    expect(pages).toMatch(/FIRST transcribe/);
    expect(pages.indexOf('FIRST transcribe')).toBeLessThan(pages.indexOf('THEN write'));
  });

  it('tells the cover path not to invent a plot it does not know', () => {
    expect(buildUserPrompt({ intent: 'cover', level: 4 })).toMatch(/do NOT recognise/i);
  });

  it('puts the images before the instruction in the user turn', () => {
    const msgs = buildMessages({ intent: 'cover', level: 4 }, ['data:image/jpeg;base64,AA'], 'json_object');
    const content = msgs[1].content as Array<{ type: string }>;
    expect(content[0].type).toBe('image_url');
    expect(content[content.length - 1].type).toBe('text');
  });

  it('sends every page of a multi-shot batch in one message', () => {
    const msgs = buildMessages(
      { intent: 'pages', level: 4 },
      ['data:image/jpeg;base64,AA', 'data:image/jpeg;base64,BB'],
      'json_object',
    );
    const content = msgs[1].content as unknown[];
    expect(content).toHaveLength(3); // two images + one instruction
  });
});

// --- storage --------------------------------------------------------------

describe('SM-2 scheduling', () => {
  const base: WordEntry = {
    zh: '活着',
    py: 'huó zhe',
    en: 'to be alive',
    sentence: '',
    bookTitle: '',
    addedAt: 0,
    repetitions: 0,
    easeFactor: 2.5,
    intervalDays: 0,
    dueAt: 0,
  };

  it('steps 1 day, then 6, then by ease factor', () => {
    const first = schedule(base, 5);
    expect(first.intervalDays).toBe(1);
    const second = schedule(first, 5);
    expect(second.intervalDays).toBe(6);
    const third = schedule(second, 5);
    expect(third.intervalDays).toBeGreaterThan(6);
  });

  it('restarts the interval on a lapse', () => {
    const learned = schedule(schedule(schedule(base, 5), 5), 5);
    const lapsed = schedule(learned, 1);
    expect(lapsed.repetitions).toBe(0);
    expect(lapsed.intervalDays).toBe(1);
  });

  it('never lets the ease factor fall below 1.3', () => {
    let w = base;
    for (let i = 0; i < 20; i++) w = schedule(w, 0);
    expect(w.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it('sets a due date in the future', () => {
    const now = 1_700_000_000_000;
    expect(schedule(base, 5, now).dueAt).toBe(now + 24 * 60 * 60 * 1000);
  });
});

describe('exports', () => {
  const words: WordEntry[] = [
    {
      zh: '活着',
      py: 'huó zhe',
      en: 'to be alive; to "live"',
      sentence: '他还活着。',
      bookTitle: '活着',
      addedAt: 0,
      repetitions: 0,
      easeFactor: 2.5,
      intervalDays: 0,
      dueAt: 0,
    },
  ];

  it('escapes embedded quotes so Anki import does not break', () => {
    const csv = wordsToAnkiCsv(words);
    expect(csv.split('\n')).toHaveLength(2);
    expect(csv).toContain('""live""');
  });

  it('writes Pleco rows as tab-separated hanzi/pinyin/definition', () => {
    expect(wordsToPleco(words)).toBe('活着\thuó zhe\tto be alive; to "live"');
  });
});

describe('buildSearchBlob', () => {
  it('indexes Chinese and English together, lowercased', () => {
    const blob = buildSearchBlob(
      ScanResultSchema.parse({
        detected: 'cover',
        confidence: 0.9,
        book: { title_zh: '活着', title_en: 'To Live', author_en: 'Yu Hua' },
        summaries: [{ kind: 'hook', zh: '一个老人', en: 'An old man' }],
      }),
    );
    expect(blob).toContain('活着');
    expect(blob).toContain('to live');
    expect(blob).toContain('an old man');
  });
});

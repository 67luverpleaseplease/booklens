/**
 * Prompts.
 *
 * Two things matter more than anything else here:
 *   1. Length discipline. Free models love to write five sentences when asked
 *      for one, so the constraint is repeated in the system message, the schema
 *      description, and the user turn.
 *   2. Not inventing. A photo of an unfamiliar cover is exactly the situation
 *      where a model will confidently describe a book that doesn't exist, so
 *      there's an explicit escape hatch (`caveats`) and permission to return
 *      fewer cards.
 */

import type { JsonMode } from '../openrouter/jsonMode';
import { needsPromptNudge } from '../openrouter/jsonMode';

export type CaptureIntent = 'cover' | 'pages';

export type PromptOptions = {
  intent: CaptureIntent;
  /** HSK band the Chinese should sit at. 7 means "native, don't simplify". */
  level: number;
  /** Traditional characters instead of simplified. */
  traditional?: boolean;
};

function registerFor(level: number, traditional: boolean): string {
  const script = traditional ? 'traditional Chinese characters' : 'simplified Chinese characters';
  if (level >= 7) {
    return `Write in natural, native-level ${script}. Do not simplify the language.`;
  }
  const caps: Record<number, string> = {
    1: 'HSK 1 — only the most basic words, sentences under 10 characters',
    2: 'HSK 2 — very common words, sentences under 12 characters',
    3: 'HSK 3 — everyday words, sentences under 16 characters',
    4: 'HSK 4 — common vocabulary, sentences under 25 characters',
    5: 'HSK 5 — common vocabulary with some abstract words, sentences under 28 characters',
    6: 'HSK 6 — richer vocabulary, sentences under 32 characters',
  };
  return `Write in ${script} at ${caps[level] ?? caps[4]}. Avoid chengyu unless the book is about them.`;
}

const CORE_RULES = `
You are helping someone understand a Chinese book from a photograph.

HARD RULES — these matter more than being thorough:
- Each summary card is ONE OR TWO SENTENCES. Never three. Never a paragraph.
- Write like you are telling a friend about the book out loud. Plain spoken
  register. Not back-cover marketing copy, not an academic abstract.
- The "hook" card must contain NO SPOILERS. The "plot" card may.
- NEVER INVENT. If you do not recognise the book, or the photo is unreadable,
  say so in "caveats" and return fewer cards. A short honest answer is worth
  far more than a long invented one. A wrong plot summary is the worst possible
  outcome.
- "en" must carry the same meaning as "zh". It is not a literal gloss and it is
  not extra information — it is the same thought in English.
- "tokens" must split "zh" word by word. Concatenating every "w" in order has
  to reproduce "zh" character for character, including punctuation. Give each
  punctuation mark its own token with empty "py" and "en".
- "talking_points" are English sentences the reader could actually say out loud
  to describe this book to another person.
`.trim();

const COVER_TASK = `
This photo shows a BOOK COVER.

1. Read the title, author, and publisher from the cover.
2. Identify which book this is.
3. If you recognise it, use what you know about this specific book to write the
   summaries — its story, its themes, why people read it.
4. If you do NOT recognise it, set "book" from what is printed on the cover,
   write summaries based only on what the cover itself tells you (title meaning,
   genre signals, cover copy), and state plainly in "caveats" that you are
   working from the cover alone.

Set "detected" to "cover".
`.trim();

const PAGES_TASK = `
This photo shows PAGES from inside a book.

1. FIRST transcribe the Chinese text you can read into "extracted_text", as
   faithfully as you can. Keep the reading order. If part is cut off or blurry,
   transcribe what is legible and note the gap in "caveats".
2. THEN write the summaries from that transcription and nothing else. Do not
   describe the book in general. Do not use outside knowledge about the book.
   Summarise what is actually on these pages.
3. Use the "passage" card kind for what the text literally says, and "theme" or
   "takeaway" for what it means.

Transcribe before you summarise — reading it properly first produces a far
better summary than skimming the image.

Set "detected" to "pages".
`.trim();

export function buildSystemPrompt(opts: PromptOptions, mode: JsonMode): string {
  const parts = [CORE_RULES, '', registerFor(opts.level, opts.traditional ?? false)];

  if (needsPromptNudge(mode)) {
    parts.push(
      '',
      'Reply with a single JSON object and nothing else. No markdown fence, no',
      'commentary before or after. Every field in the schema must be present.',
    );
  }
  return parts.join('\n');
}

export function buildUserPrompt(opts: PromptOptions): string {
  const task = opts.intent === 'cover' ? COVER_TASK : PAGES_TASK;
  return [
    task,
    '',
    'Produce 4 to 6 summary cards covering, where they apply: hook, plot, theme,',
    'takeaway, context, passage. Remember: one or two sentences each.',
    '',
    'Also give 3 to 8 key terms worth learning, and 3 to 4 English talking points.',
  ].join('\n');
}

/** The instruction sent alongside the images. */
export function buildMessages(
  opts: PromptOptions,
  images: string[],
  mode: JsonMode,
): Array<{ role: 'system' | 'user'; content: string | unknown[] }> {
  const content: unknown[] = images.map((dataUrl) => ({
    type: 'image_url',
    image_url: { url: dataUrl },
  }));
  // Text after the images: several vision models attend better this way, and it
  // keeps the instruction as the most recent thing in the context.
  content.push({ type: 'text', text: buildUserPrompt(opts) });

  return [
    { role: 'system', content: buildSystemPrompt(opts, mode) },
    { role: 'user', content },
  ];
}

/** Follow-up turn used when the first reply failed validation. */
export function buildRepairMessage(error: string): string {
  return [
    'That response could not be parsed against the required schema.',
    `Problem: ${error}`,
    '',
    'Send the corrected JSON object only. No fence, no explanation.',
  ].join('\n');
}

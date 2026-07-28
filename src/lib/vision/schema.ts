/**
 * The one contract every scan produces.
 *
 * Two representations of the same shape: a Zod schema for validating what comes
 * back, and a JSON Schema for telling the model what to produce. They're kept
 * adjacent deliberately — if one changes the other has to.
 */

import { z } from 'zod';

export const SUMMARY_KINDS = ['hook', 'plot', 'theme', 'takeaway', 'context', 'passage'] as const;
export type SummaryKind = (typeof SUMMARY_KINDS)[number];

/** Chinese labels for each card, so the model doesn't have to invent them. */
export const KIND_LABEL_ZH: Record<SummaryKind, string> = {
  hook: '钩子',
  plot: '情节',
  theme: '主题',
  takeaway: '收获',
  context: '背景',
  passage: '段落',
};

export const KIND_LABEL_EN: Record<SummaryKind, string> = {
  hook: 'Hook',
  plot: 'Plot',
  theme: 'Theme',
  takeaway: 'Takeaway',
  context: 'Context',
  passage: 'Passage',
};

export const TokenSchema = z.object({
  w: z.string().min(1),
  py: z.string().default(''),
  en: z.string().default(''),
  hsk: z.number().int().min(1).max(9).optional(),
});

export const SummaryCardSchema = z.object({
  kind: z.enum(SUMMARY_KINDS).catch('theme'),
  label_zh: z.string().default(''),
  zh: z.string().min(1),
  pinyin: z.string().default(''),
  en: z.string().default(''),
  tokens: z.array(TokenSchema).default([]),
});

export const BookSchema = z.object({
  title_zh: z.string().default(''),
  title_pinyin: z.string().default(''),
  title_en: z.string().default(''),
  author_zh: z.string().default(''),
  author_en: z.string().default(''),
  publisher: z.string().default(''),
  year: z.string().default(''),
  isbn: z.string().default(''),
  genre: z.array(z.string()).default([]),
});

export const KeyTermSchema = z.object({
  zh: z.string().min(1),
  py: z.string().default(''),
  en: z.string().default(''),
  note: z.string().default(''),
});

export const ScanResultSchema = z.object({
  detected: z.enum(['cover', 'pages', 'mixed', 'unclear']).catch('unclear'),
  confidence: z.number().min(0).max(1).catch(0.5),
  book: BookSchema.nullable().default(null),
  summaries: z.array(SummaryCardSchema).min(1),
  key_terms: z.array(KeyTermSchema).default([]),
  talking_points: z.array(z.string()).default([]),
  extracted_text: z.string().default(''),
  caveats: z.string().default(''),
});

export type Token = z.infer<typeof TokenSchema>;
export type SummaryCard = z.infer<typeof SummaryCardSchema>;
export type Book = z.infer<typeof BookSchema>;
export type KeyTerm = z.infer<typeof KeyTermSchema>;
export type ScanResult = z.infer<typeof ScanResultSchema>;

/**
 * JSON Schema handed to the model. Deliberately flat and heavily described —
 * on small free models the field descriptions do more work than the prompt.
 */
export const SCAN_RESULT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['detected', 'confidence', 'book', 'summaries', 'key_terms', 'talking_points'],
  properties: {
    detected: {
      type: 'string',
      enum: ['cover', 'pages', 'mixed', 'unclear'],
      description: 'What the photo actually shows.',
    },
    confidence: {
      type: 'number',
      description: '0 to 1. How sure you are the summaries are correct. Be honest.',
    },
    book: {
      type: ['object', 'null'],
      description: 'Book identity. null if you genuinely cannot tell what book this is.',
      properties: {
        title_zh: { type: 'string', description: 'Title in Chinese characters.' },
        title_pinyin: { type: 'string', description: 'Title in pinyin with tone marks.' },
        title_en: { type: 'string', description: 'English title, translated if unpublished in English.' },
        author_zh: { type: 'string' },
        author_en: { type: 'string' },
        publisher: { type: 'string' },
        year: { type: 'string' },
        isbn: { type: 'string' },
        genre: { type: 'array', items: { type: 'string' } },
      },
    },
    summaries: {
      type: 'array',
      minItems: 4,
      maxItems: 6,
      description: 'Four to six cards. Each is ONE OR TWO sentences. Never longer.',
      items: {
        type: 'object',
        required: ['kind', 'label_zh', 'zh', 'pinyin', 'en', 'tokens'],
        properties: {
          kind: { type: 'string', enum: SUMMARY_KINDS as unknown as string[] },
          label_zh: { type: 'string', description: '钩子 / 情节 / 主题 / 收获 / 背景 / 段落' },
          zh: {
            type: 'string',
            description:
              'One or two sentences of simplified Chinese at HSK 4-5. Under 25 characters per sentence.',
          },
          pinyin: { type: 'string', description: 'Pinyin for the whole zh line, with tone marks.' },
          en: { type: 'string', description: 'One or two sentences of natural English. Same meaning.' },
          tokens: {
            type: 'array',
            description:
              'Word-by-word split of zh. Concatenating every w MUST reproduce zh exactly, punctuation included.',
            items: {
              type: 'object',
              required: ['w', 'py', 'en'],
              properties: {
                w: { type: 'string', description: 'One Chinese word, or one punctuation mark.' },
                py: { type: 'string', description: 'Pinyin with tone marks. Empty for punctuation.' },
                en: { type: 'string', description: 'Short gloss. Empty for punctuation.' },
                hsk: { type: 'number', description: 'HSK level 1-6 if you know it.' },
              },
            },
          },
        },
      },
    },
    key_terms: {
      type: 'array',
      minItems: 3,
      maxItems: 8,
      description: 'Words from this book worth learning.',
      items: {
        type: 'object',
        required: ['zh', 'py', 'en'],
        properties: {
          zh: { type: 'string' },
          py: { type: 'string' },
          en: { type: 'string' },
          note: { type: 'string', description: 'Why it matters to this book. Optional.' },
        },
      },
    },
    talking_points: {
      type: 'array',
      minItems: 3,
      maxItems: 4,
      description: 'English bullets you could say out loud to describe this book to a friend.',
      items: { type: 'string' },
    },
    extracted_text: {
      type: 'string',
      description: 'For page photos: a faithful transcription of the Chinese text you can read.',
    },
    caveats: {
      type: 'string',
      description:
        'Anything uncertain: blurry photo, partial page, unrecognised book. Empty if all is well.',
    },
  },
};

/**
 * The model is asked to return tokens that rebuild `zh` exactly. Small models
 * sometimes drop punctuation or merge a clause, which would silently break
 * tap-to-define, so callers check this and fall back to local segmentation.
 */
export function tokensMatch(card: Pick<SummaryCard, 'zh' | 'tokens'>): boolean {
  if (card.tokens.length === 0) return false;
  return card.tokens.map((t) => t.w).join('') === card.zh;
}

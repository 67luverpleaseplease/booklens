/**
 * The scan overlay shows the model's payload arriving live, so a 30–90 second
 * wait reads as "it's reading the page" instead of a dead spinner. Raw JSON is
 * unreadable, so this digests it: field names and structural punctuation out,
 * the words themselves in. It is deliberately lossy — the real parse happens
 * later on the complete payload; this is only the heartbeat.
 */

/** Keys from the scan contract (and common aliases) to strip from view. */
const FIELD_NAMES = new Set([
  'detected',
  'confidence',
  'book',
  'summaries',
  'kind',
  'label_zh',
  'zh',
  'pinyin',
  'en',
  'tokens',
  'w',
  'py',
  'hsk',
  'key_terms',
  'note',
  'talking_points',
  'extracted_text',
  'caveats',
  'title_zh',
  'title_pinyin',
  'title_en',
  'author_zh',
  'author_en',
  'publisher',
  'year',
  'isbn',
  'genre',
]);

export function liveDigest(raw: string): string {
  if (!raw) return '';
  let s = raw;
  // Some models stream Chinese as \uXXXX escapes inside the JSON strings.
  // Decode for display first — the real parse handles them natively later.
  s = s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  // "field": — the scaffolding around every value.
  s = s.replace(/"([a-z_]+)"\s*:/gi, (m, name: string) =>
    FIELD_NAMES.has(name.toLowerCase()) ? ' ' : m,
  );
  // Braces, brackets and quotes are JSON noise, never book content.
  s = s.replace(/[{}[\]"]/g, ' ');
  // Escaped newlines and leftover backslash-quote pairs.
  s = s.replace(/\\n/g, ' ').replace(/\\"/g, ' ');
  // Stray commas between what used to be fields.
  s = s.replace(/\s*,\s*/g, '　');
  return s.replace(/\s+/g, ' ').trim();
}

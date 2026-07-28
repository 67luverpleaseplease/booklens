/**
 * Chinese word segmentation, locally.
 *
 * `Intl.Segmenter` handles this natively in every browser we care about, with
 * no bundle cost. It is good but not perfect — verified: 图书馆 comes back as
 * 图书|馆 and 人工智能 as 人工|智能 — which is exactly why the model is asked
 * to return its own tokens. This is the fallback for text the model didn't
 * tokenize, and the repair path when its tokens don't reconstruct the source.
 */

const HAN = /\p{Script=Han}/u;

let segmenter: Intl.Segmenter | null | undefined;

function getSegmenter(): Intl.Segmenter | null {
  if (segmenter !== undefined) return segmenter;
  try {
    segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  } catch {
    segmenter = null; // Very old browser — fall back to per-character.
  }
  return segmenter;
}

export function containsHan(text: string): boolean {
  return HAN.test(text);
}

/** Split into words, keeping punctuation and spacing as their own pieces. */
export function segmentWords(text: string): string[] {
  if (!text) return [];
  const seg = getSegmenter();
  if (!seg) return [...text];
  const out: string[] = [];
  for (const piece of seg.segment(text)) {
    if (piece.segment) out.push(piece.segment);
  }
  return out;
}

/**
 * Split into sentences for the karaoke reader.
 *
 * `Intl.Segmenter`'s sentence granularity does not break on Chinese full stops
 * (verified: it returned one whole sentence for a string containing 。), so
 * this splits on CJK terminators directly and keeps the terminator attached.
 */
export function segmentSentences(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  let current = '';
  for (const ch of text) {
    current += ch;
    if ('。！？!?；;…'.includes(ch)) {
      // Absorb a trailing closing quote so it doesn't start the next sentence.
      out.push(current);
      current = '';
    }
  }
  if (current.trim()) out.push(current);
  return out.length ? out : [text];
}

/** Character offset of each sentence, for mapping TTS boundaries back to text. */
export function sentenceOffsets(text: string): Array<{ start: number; end: number; text: string }> {
  const sentences = segmentSentences(text);
  const spans: Array<{ start: number; end: number; text: string }> = [];
  let cursor = 0;
  for (const s of sentences) {
    spans.push({ start: cursor, end: cursor + s.length, text: s });
    cursor += s.length;
  }
  return spans;
}

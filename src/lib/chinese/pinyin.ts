/**
 * Pinyin, lazily.
 *
 * `pinyin-pro` carries a large reading dictionary, so it is imported on first
 * use rather than bundled into the initial load. Most of the time the model has
 * already supplied pinyin and this never loads at all.
 */

type PinyinFn = (text: string, options?: Record<string, unknown>) => string;

let loader: Promise<PinyinFn | null> | null = null;

async function loadPinyin(): Promise<PinyinFn | null> {
  if (!loader) {
    loader = import('pinyin-pro')
      .then((m) => m.pinyin as unknown as PinyinFn)
      .catch(() => null);
  }
  return loader;
}

/** Warm the module ahead of a burst of lookups. Safe to call repeatedly. */
export function preloadPinyin(): void {
  void loadPinyin();
}

/** Tone-marked pinyin for a run of text, e.g. 图书馆 → "tú shū guǎn". */
export async function toPinyin(text: string): Promise<string> {
  if (!text.trim()) return '';
  const pinyin = await loadPinyin();
  if (!pinyin) return '';
  try {
    return pinyin(text, { toneType: 'symbol', type: 'string' });
  } catch {
    return '';
  }
}

/** Per-character readings, for the word popover. */
export async function toPinyinArray(text: string): Promise<string[]> {
  if (!text.trim()) return [];
  const pinyin = await loadPinyin();
  if (!pinyin) return [];
  try {
    const joined = pinyin(text, { toneType: 'symbol', type: 'string' });
    return joined.split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

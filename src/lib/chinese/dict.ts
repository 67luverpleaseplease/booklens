/**
 * CC-CEDICT lookup.
 *
 * The dictionary is ~1MB even trimmed, so it is fetched on the first word tap
 * rather than bundled, and the service worker caches it permanently after that.
 * If the fetch fails the popover still works — the model's own gloss and a
 * pinyin reading cover the common case.
 */

import { hskLevel } from './hsk';

export type DictEntry = {
  simplified: string;
  traditional?: string;
  pinyin: string;
  definitions: string[];
  hsk?: number;
};

/** `{ "图书馆": ["tú shū guǎn", "library"] }` — compact on purpose. */
type PackedDict = Record<string, [string, string, string?]>;

let dictPromise: Promise<PackedDict | null> | null = null;

function dictUrl(): string {
  // Relative so it resolves under any base path (Pages, Cloudflare, file://).
  return new URL('cedict.min.json', document.baseURI).toString();
}

async function loadDict(): Promise<PackedDict | null> {
  if (!dictPromise) {
    dictPromise = fetch(dictUrl())
      .then((res) => (res.ok ? (res.json() as Promise<PackedDict>) : null))
      .catch(() => null);
  }
  return dictPromise;
}

/** Warm the dictionary before the user taps anything. */
export function preloadDict(): void {
  void loadDict();
}

export async function lookup(word: string): Promise<DictEntry | null> {
  const key = word.trim();
  if (!key) return null;

  const dict = await loadDict();
  const packed = dict?.[key];
  if (!packed) return null;

  const [pinyin, glosses, traditional] = packed;
  return {
    simplified: key,
    traditional,
    pinyin,
    definitions: glosses.split('/').filter(Boolean),
    hsk: hskLevel(key),
  };
}

/**
 * Longest-match lookup for a run of text — handles the case where segmentation
 * split a word the dictionary knows as one unit (图书 + 馆 → 图书馆).
 */
export async function lookupLongest(
  text: string,
  start = 0,
  maxLen = 6,
): Promise<{ entry: DictEntry; length: number } | null> {
  const dict = await loadDict();
  if (!dict) return null;

  for (let len = Math.min(maxLen, text.length - start); len > 0; len--) {
    const candidate = text.slice(start, start + len);
    const packed = dict[candidate];
    if (packed) {
      const [pinyin, glosses, traditional] = packed;
      return {
        entry: {
          simplified: candidate,
          traditional,
          pinyin,
          definitions: glosses.split('/').filter(Boolean),
          hsk: hskLevel(candidate),
        },
        length: len,
      };
    }
  }
  return null;
}

export async function isDictReady(): Promise<boolean> {
  return (await loadDict()) !== null;
}

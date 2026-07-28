/**
 * Local storage for scans and vocabulary.
 *
 * Everything lives in IndexedDB so the shelf works with no network, no account,
 * and no quota. Scans hold their own thumbnail, so a saved book is fully
 * readable offline.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ScanResult } from '../vision/schema';

export type ShelfEntry = {
  id: string;
  createdAt: number;
  /** Small JPEG data URL. */
  thumbnail: string;
  intent: 'cover' | 'pages';
  model: string;
  modelLabel: string;
  result: ScanResult;
  /** Lowercased zh + en, so search is one indexOf rather than a deep walk. */
  searchBlob: string;
};

export type WordEntry = {
  /** The word itself — one row per word, so re-saving updates rather than duplicates. */
  zh: string;
  py: string;
  en: string;
  hsk?: number;
  /** The sentence it was found in, which is most of what makes it memorable. */
  sentence: string;
  bookTitle: string;
  addedAt: number;
  // SM-2
  repetitions: number;
  easeFactor: number;
  intervalDays: number;
  dueAt: number;
};

interface BookLensDB extends DBSchema {
  shelf: {
    key: string;
    value: ShelfEntry;
    indexes: { 'by-date': number };
  };
  words: {
    key: string;
    value: WordEntry;
    indexes: { 'by-due': number; 'by-added': number };
  };
}

let dbPromise: Promise<IDBPDatabase<BookLensDB>> | null = null;

function db(): Promise<IDBPDatabase<BookLensDB>> {
  if (!dbPromise) {
    dbPromise = openDB<BookLensDB>('booklens', 1, {
      upgrade(database) {
        const shelf = database.createObjectStore('shelf', { keyPath: 'id' });
        shelf.createIndex('by-date', 'createdAt');

        const words = database.createObjectStore('words', { keyPath: 'zh' });
        words.createIndex('by-due', 'dueAt');
        words.createIndex('by-added', 'addedAt');
      },
    });
  }
  return dbPromise;
}

export function buildSearchBlob(result: ScanResult): string {
  const parts: string[] = [];
  if (result.book) {
    parts.push(result.book.title_zh, result.book.title_en, result.book.title_pinyin);
    parts.push(result.book.author_zh, result.book.author_en);
    parts.push(...result.book.genre);
  }
  for (const s of result.summaries) parts.push(s.zh, s.en);
  for (const t of result.key_terms) parts.push(t.zh, t.en);
  return parts.filter(Boolean).join(' ').toLowerCase();
}

// --- shelf ---------------------------------------------------------------

export async function saveScan(entry: Omit<ShelfEntry, 'searchBlob'>): Promise<void> {
  const d = await db();
  await d.put('shelf', { ...entry, searchBlob: buildSearchBlob(entry.result) });
}

export async function listScans(): Promise<ShelfEntry[]> {
  const d = await db();
  const all = await d.getAllFromIndex('shelf', 'by-date');
  return all.reverse(); // newest first
}

export async function getScan(id: string): Promise<ShelfEntry | undefined> {
  return (await db()).get('shelf', id);
}

export async function deleteScan(id: string): Promise<void> {
  await (await db()).delete('shelf', id);
}

export async function searchScans(query: string): Promise<ShelfEntry[]> {
  const all = await listScans();
  const q = query.trim().toLowerCase();
  if (!q) return all;
  return all.filter((e) => e.searchBlob.includes(q));
}

// --- wordbank ------------------------------------------------------------

export async function saveWord(
  word: Pick<WordEntry, 'zh' | 'py' | 'en' | 'hsk' | 'sentence' | 'bookTitle'>,
): Promise<void> {
  const d = await db();
  const existing = await d.get('words', word.zh);
  if (existing) {
    // Keep the review schedule; refresh the context it was seen in.
    await d.put('words', { ...existing, ...word });
    return;
  }
  await d.put('words', {
    ...word,
    addedAt: Date.now(),
    repetitions: 0,
    easeFactor: 2.5,
    intervalDays: 0,
    dueAt: Date.now(),
  });
}

export async function listWords(): Promise<WordEntry[]> {
  const d = await db();
  return (await d.getAllFromIndex('words', 'by-added')).reverse();
}

export async function dueWords(now = Date.now()): Promise<WordEntry[]> {
  const d = await db();
  return (await d.getAll('words')).filter((w) => w.dueAt <= now);
}

export async function deleteWord(zh: string): Promise<void> {
  await (await db()).delete('words', zh);
}

export async function hasWord(zh: string): Promise<boolean> {
  return Boolean(await (await db()).get('words', zh));
}

/**
 * SM-2. Quality 0–5; anything under 3 is a lapse and restarts the interval,
 * which is the part of the algorithm that actually does the work.
 */
export function schedule(word: WordEntry, quality: number, now = Date.now()): WordEntry {
  const q = Math.max(0, Math.min(5, quality));
  let { repetitions, easeFactor, intervalDays } = word;

  if (q < 3) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    repetitions += 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 6;
    else intervalDays = Math.round(intervalDays * easeFactor);
  }

  easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  return {
    ...word,
    repetitions,
    easeFactor,
    intervalDays,
    dueAt: now + intervalDays * 24 * 60 * 60 * 1000,
  };
}

export async function reviewWord(zh: string, quality: number): Promise<void> {
  const d = await db();
  const word = await d.get('words', zh);
  if (!word) return;
  await d.put('words', schedule(word, quality));
}

// --- export --------------------------------------------------------------

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Anki-importable CSV: hanzi, pinyin, english, sentence, book. */
export function wordsToAnkiCsv(words: WordEntry[]): string {
  const rows = words.map((w) =>
    [w.zh, w.py, w.en, w.sentence, w.bookTitle].map(csvCell).join(','),
  );
  return ['"Hanzi","Pinyin","English","Sentence","Book"', ...rows].join('\n');
}

/** Pleco's flashcard import format is tab-separated hanzi/pinyin/definition. */
export function wordsToPleco(words: WordEntry[]): string {
  return words.map((w) => `${w.zh}\t${w.py}\t${w.en}`).join('\n');
}

export function scanToMarkdown(entry: ShelfEntry): string {
  const r = entry.result;
  const lines: string[] = [];
  const title = r.book?.title_zh || 'Untitled';
  lines.push(`# ${title}`);
  if (r.book?.title_en) lines.push(`*${r.book.title_en}*`);
  if (r.book?.title_pinyin) lines.push(`\`${r.book.title_pinyin}\``);
  if (r.book?.author_zh || r.book?.author_en)
    lines.push(`\n**Author:** ${[r.book.author_zh, r.book.author_en].filter(Boolean).join(' · ')}`);
  lines.push('');

  for (const s of r.summaries) {
    lines.push(`## ${s.label_zh} — ${s.kind}`);
    lines.push(s.zh);
    if (s.pinyin) lines.push(`\n*${s.pinyin}*`);
    lines.push(`\n${s.en}\n`);
  }

  if (r.key_terms.length) {
    lines.push('## 生词 Key terms\n');
    for (const t of r.key_terms) lines.push(`- **${t.zh}** \`${t.py}\` — ${t.en}`);
    lines.push('');
  }

  if (r.talking_points.length) {
    lines.push('## Talking points\n');
    for (const p of r.talking_points) lines.push(`- ${p}`);
    lines.push('');
  }

  if (r.extracted_text) lines.push(`## Transcription\n\n${r.extracted_text}\n`);
  if (r.caveats) lines.push(`> ${r.caveats}`);

  lines.push(`\n---\n*Scanned ${new Date(entry.createdAt).toLocaleString()} · ${entry.modelLabel}*`);
  return lines.join('\n');
}

export function download(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
}

export async function clearAll(): Promise<void> {
  const d = await db();
  await d.clear('shelf');
  await d.clear('words');
}

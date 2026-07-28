#!/usr/bin/env node
/**
 * Build the bundled dictionary.
 *
 * Fetches CC-CEDICT from MDBG, keeps the entries a reader is actually likely to
 * tap, and packs them into a compact map:
 *
 *   { "图书馆": ["tú shū guǎn", "library", "圖書館"] }
 *
 * The full file is ~120k entries and mostly proper nouns, chemical compounds,
 * and place names — trimming to common words takes it from ~9MB to ~1MB while
 * losing almost nothing you'd meet in a book.
 *
 *   npm run cedict
 */

import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const GZ = join(PUBLIC, '.cedict.txt.gz');
const OUT = join(PUBLIC, 'cedict.min.json');
const SOURCE = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz';

const MAX_DEFS = 3;
const MAX_DEF_CHARS = 70;

/**
 * CC-CEDICT is ~125k entries, and the bulk of the long tail is place names,
 * chemical compounds, radicals, and cross-references — none of which anyone
 * taps while reading a novel. Measured distribution before filtering:
 *
 *   1 char   9.7k entries  0.42 MB
 *   2 chars 59.9k entries  3.42 MB   ← the ones that matter
 *   3 chars 22.9k entries  1.61 MB   ← mostly 三民区 "a district of Kaohsiung"
 *   4 chars 18.9k entries  1.65 MB   ← mostly chengyu and proper nouns
 *
 * So 1–2 characters are kept generously, and 3–4 only when the gloss looks like
 * a real word rather than a gazetteer entry.
 */
const PLACE_OR_NAME =
  /\b(a (district|county|prefecture|city|town|village|province|township)|county|prefecture|autonomous region|abbr\.? for|see also|radical|surname|variant|erhua variant|used in|Japanese variant|old name for)\b/i;

function shouldSkip(simplified, definitions, gloss) {
  const len = [...simplified].length;
  if (len > 4) return true;
  // Anything non-Han: pinyin abbreviations, alphanumeric codes, Latin letters.
  if (!/^\p{Script=Han}+$/u.test(simplified)) return true;

  const joined = definitions.join(' ');
  if (PLACE_OR_NAME.test(joined)) return true;
  // A gloss that is only a capitalised name is a proper noun.
  if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/.test(gloss.trim())) return true;

  // Beyond two characters, keep only entries with a short, ordinary gloss —
  // that filters gazetteer prose while keeping chengyu and compound words.
  if (len >= 3 && gloss.length > 34) return true;

  return false;
}

/**
 * Strip CC-CEDICT's inline apparatus: cross-references like 白族[Bai2 zu2],
 * traditional|simplified pairs, and `CL:` classifier notes. The classifier is
 * useful to a grammarian and pure noise in a tap-to-define popover.
 */
function cleanGloss(definition) {
  if (/^CL:/i.test(definition.trim())) return '';
  return definition
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[一-鿿]+\|[一-鿿]+/g, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*CL:.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,;/]\s*$/, '')
    .trim();
}

/**
 * CC-CEDICT lists several readings for the same characters and they are not
 * ordered by frequency — 故事 appears as both `gu4 shi4 /old practice/` and
 * `gu4 shi5 /narrative/story/tale/`, and taking the first one gives "old
 * practice", which is wrong for essentially every reader.
 *
 * The common reading reliably carries more senses, so richer entry wins.
 */
function isBetterEntry(candidate, existing) {
  if (candidate.senseCount !== existing.senseCount) {
    return candidate.senseCount > existing.senseCount;
  }
  return candidate.gloss.length > existing.gloss.length;
}

/** Convert CC-CEDICT's numbered pinyin (ni3 hao3) to tone marks (nǐ hǎo). */
const VOWELS = {
  a: 'āáǎàa',
  e: 'ēéěèe',
  i: 'īíǐìi',
  o: 'ōóǒòo',
  u: 'ūúǔùu',
  'ü': 'ǖǘǚǜü',
};

function toneMark(syllable) {
  const m = syllable.match(/^([a-zü:]+)([1-5])$/i);
  if (!m) return syllable;
  let [, letters, tone] = m;
  letters = letters.replace(/u:/g, 'ü').toLowerCase();
  const index = Number(tone) - 1;
  if (index === 4) return letters; // neutral tone, no mark

  // Standard placement: a/e win; in "ou" the o takes it; otherwise the last vowel.
  let target = -1;
  if (letters.includes('a')) target = letters.indexOf('a');
  else if (letters.includes('e')) target = letters.indexOf('e');
  else if (letters.includes('ou')) target = letters.indexOf('o');
  else {
    for (let i = letters.length - 1; i >= 0; i--) {
      if ('aeiouü'.includes(letters[i])) {
        target = i;
        break;
      }
    }
  }
  if (target === -1) return letters;
  const ch = letters[target];
  const marked = VOWELS[ch]?.[index] ?? ch;
  return letters.slice(0, target) + marked + letters.slice(target + 1);
}

function prettyPinyin(raw) {
  return raw
    .split(/\s+/)
    .map((s) => toneMark(s))
    .join(' ');
}

async function ensureSource() {
  try {
    const info = await stat(GZ);
    if (info.size > 1000) {
      console.log('· using cached download');
      return;
    }
  } catch {
    /* not downloaded yet */
  }
  console.log('· downloading CC-CEDICT from mdbg.net …');
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  await mkdir(PUBLIC, { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(GZ));
}

async function build() {
  await ensureSource();

  const dict = {};
  let total = 0;

  const lines = createInterface({
    input: createReadStream(GZ).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    // 傳統 传统 [chuan2 tong3] /tradition/traditional/
    const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+\/(.*)\/\s*$/);
    if (!m) continue;
    total++;

    const [, traditional, simplified, pinyinRaw, defsRaw] = m;
    const definitions = defsRaw.split('/').filter(Boolean);

    // Stripping the apparatus can collapse distinct entries into the same words
    // ("time (period)" and "time (instant)" both become "time"), so dedupe.
    const senses = [...new Set(definitions.map(cleanGloss).filter(Boolean))];
    const gloss = senses.slice(0, MAX_DEFS).join('/').slice(0, MAX_DEF_CHARS);
    if (!gloss) continue;
    if (shouldSkip(simplified, definitions, gloss)) continue;

    const candidate = { gloss, senseCount: senses.length, pinyinRaw, traditional };
    const existing = dict[simplified];
    if (existing && !isBetterEntry(candidate, existing)) continue;

    const packed = [prettyPinyin(pinyinRaw), gloss];
    if (traditional !== simplified) packed.push(traditional);
    // Keep the comparison fields alongside the packed row; stripped on write.
    packed.senseCount = senses.length;
    packed.gloss = gloss;
    dict[simplified] = packed;
  }

  const json = JSON.stringify(dict);
  await writeFile(OUT, json, 'utf8');

  const kb = (Buffer.byteLength(json) / 1024).toFixed(0);
  console.log(`✓ ${Object.keys(dict).length.toLocaleString()} entries (from ${total.toLocaleString()}) → public/cedict.min.json  ${kb} KB`);
  console.log('  Served gzipped by any static host; cached permanently by the service worker.');
}

build().catch((err) => {
  console.error('✗', err.message);
  process.exitCode = 1;
});

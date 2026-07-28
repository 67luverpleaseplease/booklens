/**
 * The voice catalogue.
 *
 * Voices are enumerated from the device at runtime, never hardcoded — the list
 * differs per OS, per browser, and per which voices the user has downloaded.
 * What IS hardcoded is a gender map, because `SpeechSynthesisVoice` exposes no
 * gender field at all and "give me a man, not a woman" is the whole point.
 *
 * Verified on macOS 25.5 with `say -v '?'`, and both synthesize real audio:
 *   MALE    Eddy · Reed · Rocko · Grandpa
 *   FEMALE  Tingting · Flo · Sandy · Shelley · Grandma · Meijia · Sinji
 * The same Apple voice set ships on iOS, so this holds on iPhone too.
 */

export type Gender = 'male' | 'female' | 'unknown';

export type Voice = {
  /** `voiceURI`, stable enough to persist a preference against. */
  id: string;
  /** What the OS calls it. */
  name: string;
  /** What we show — Chinese name where the voice has one. */
  label: string;
  gender: Gender;
  lang: string;
  /** One-word character note, so the picker isn't eight identical rows. */
  note: string;
  localService: boolean;
};

/**
 * Lowercased substring → gender. Matching on substring rather than equality
 * because platforms decorate names ("Eddy (Chinese (China mainland))",
 * "Microsoft Kangkang - Chinese (Simplified)").
 */
const GENDER_MAP: Array<[string, Gender]> = [
  // Apple — macOS and iOS
  ['eddy', 'male'],
  ['reed', 'male'],
  ['rocko', 'male'],
  ['grandpa', 'male'],
  ['li-mu', 'male'],
  ['lilian', 'female'],
  ['tingting', 'female'],
  ['ting-ting', 'female'],
  ['flo', 'female'],
  ['sandy', 'female'],
  ['shelley', 'female'],
  ['grandma', 'female'],
  ['meijia', 'female'],
  ['mei-jia', 'female'],
  ['sinji', 'female'],
  // Microsoft — Windows and Edge
  ['kangkang', 'male'],
  ['yunxi', 'male'],
  ['yunjian', 'male'],
  ['yunyang', 'male'],
  ['yunxia', 'male'],
  ['huihui', 'female'],
  ['yaoyao', 'female'],
  ['xiaoxiao', 'female'],
  ['xiaoyi', 'female'],
  ['xiaobei', 'female'],
  ['xiaoni', 'female'],
  ['hanhan', 'female'],
  // Google — Android and Chrome
  ['male', 'male'],
  ['female', 'female'],
];

/** Chinese names, so the picker reads naturally to someone learning Chinese. */
const LABEL_MAP: Record<string, string> = {
  tingting: '婷婷 Tingting',
  meijia: '美佳 Meijia',
  sinji: '善怡 Sinji',
  yunxi: '云希 Yunxi',
  yunjian: '云健 Yunjian',
  yunyang: '云扬 Yunyang',
  xiaoxiao: '晓晓 Xiaoxiao',
  xiaoyi: '晓伊 Xiaoyi',
  kangkang: '康康 Kangkang',
  huihui: '慧慧 Huihui',
  yaoyao: '瑶瑶 Yaoyao',
};

const NOTE_MAP: Record<string, string> = {
  eddy: 'natural, conversational',
  reed: 'calm, lower',
  rocko: 'bright, energetic',
  grandpa: 'older, storytelling',
  tingting: 'the classic Mandarin voice',
  flo: 'light, easy',
  sandy: 'warm',
  shelley: 'soft',
  grandma: 'older, gentle',
  meijia: 'Taiwan Mandarin',
  sinji: 'Cantonese',
  kangkang: 'clear, steady',
  huihui: 'clear',
  yunxi: 'warm',
  xiaoxiao: 'expressive',
};

function firstMatch<T>(haystack: string, table: Array<[string, T]>): T | undefined {
  for (const [needle, value] of table) {
    if (haystack.includes(needle)) return value;
  }
  return undefined;
}

function keyFor(name: string): string {
  const lower = name.toLowerCase();
  for (const k of Object.keys(NOTE_MAP)) if (lower.includes(k)) return k;
  for (const k of Object.keys(LABEL_MAP)) if (lower.includes(k)) return k;
  return lower;
}

export function classify(voice: SpeechSynthesisVoice): Voice {
  const lower = voice.name.toLowerCase();
  const key = keyFor(voice.name);
  // Strip the platform's parenthetical language decoration for display.
  const bare = voice.name.replace(/\s*\(.*\)\s*$/, '').trim();

  return {
    id: voice.voiceURI || voice.name,
    name: voice.name,
    label: LABEL_MAP[key] ?? bare,
    gender: firstMatch(lower, GENDER_MAP) ?? 'unknown',
    lang: voice.lang,
    note: NOTE_MAP[key] ?? '',
    localService: voice.localService,
  };
}

/**
 * `speechSynthesis.getVoices()` returns an empty array until the engine has
 * loaded, and fires `voiceschanged` when it's ready. Chrome in particular needs
 * this; polling blindly is the classic bug.
 */
export function loadSystemVoices(timeoutMs = 3000): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === 'undefined') return resolve([]);

    const immediate = speechSynthesis.getVoices();
    if (immediate.length) return resolve(immediate);

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      speechSynthesis.removeEventListener('voiceschanged', finish);
      resolve(speechSynthesis.getVoices());
    };

    speechSynthesis.addEventListener('voiceschanged', finish);
    // Some engines never fire the event — don't hang the UI waiting.
    setTimeout(finish, timeoutMs);
  });
}

export type VoiceCatalogue = {
  chinese: Voice[];
  english: Voice[];
  male: Voice[];
  female: Voice[];
};

/** Sort so named, gendered, local voices float to the top of the picker. */
function rank(v: Voice): number {
  let score = 0;
  if (v.gender !== 'unknown') score -= 4;
  if (v.note) score -= 3;
  if (v.localService) score -= 1;
  if (v.lang.toLowerCase().startsWith('zh-cn')) score -= 2;
  return score;
}

export async function loadCatalogue(): Promise<VoiceCatalogue> {
  const system = await loadSystemVoices();
  const all = system.map(classify);

  const chinese = all
    .filter((v) => v.lang.toLowerCase().startsWith('zh'))
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
  const english = all
    .filter((v) => v.lang.toLowerCase().startsWith('en'))
    .sort((a, b) => rank(a) - rank(b));

  return {
    chinese,
    english,
    male: chinese.filter((v) => v.gender === 'male'),
    female: chinese.filter((v) => v.gender === 'female'),
  };
}

/**
 * Resolve a saved preference against what's actually installed. A voice can
 * vanish between sessions (different device, uninstalled voice), so fall back
 * to the same gender before falling back to anything at all.
 */
export function resolveVoice(
  catalogue: VoiceCatalogue,
  savedId: string | null,
  preferredGender: Gender = 'male',
): Voice | null {
  if (catalogue.chinese.length === 0) return null;
  if (savedId) {
    const exact = catalogue.chinese.find((v) => v.id === savedId);
    if (exact) return exact;
  }
  const byGender =
    preferredGender === 'male'
      ? catalogue.male[0]
      : preferredGender === 'female'
        ? catalogue.female[0]
        : undefined;
  return byGender ?? catalogue.chinese[0];
}

/** A line worth hearing when comparing voices — not "hello, testing 1 2 3". */
export const PREVIEW_LINE = '这本书讲的是一个关于家和记忆的故事。';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Gender } from '../tts/voices';

export type PinyinMode = 'off' | 'ruby' | 'line';
export type ReadLang = 'zh' | 'en' | 'both';
export type TextSize = 'sm' | 'md' | 'lg';

type SettingsState = {
  // Chinese
  /** 1–6 = HSK band, 7 = native. */
  level: number;
  traditional: boolean;
  pinyin: PinyinMode;
  textSize: TextSize;

  // Voice
  voiceId: string | null;
  preferredGender: Gender;
  rate: number;
  readLang: ReadLang;
  autoplay: boolean;

  // Capture
  intent: 'cover' | 'pages';

  // Meta
  onboarded: boolean;

  set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
  cyclePinyin: () => void;
  cycleTextSize: () => void;
  reset: () => void;
};

const DEFAULTS = {
  level: 4,
  traditional: false,
  pinyin: 'ruby' as PinyinMode,
  textSize: 'md' as TextSize,
  voiceId: null,
  preferredGender: 'male' as Gender,
  rate: 1,
  readLang: 'zh' as ReadLang,
  autoplay: false,
  intent: 'cover' as const,
  onboarded: false,
};

const PINYIN_CYCLE: PinyinMode[] = ['off', 'ruby', 'line'];
const SIZE_CYCLE: TextSize[] = ['sm', 'md', 'lg'];

/** Chinese body size per step. Ruby scales with it via the em-based rt rule. */
export const TEXT_SIZE_PX: Record<TextSize, number> = { sm: 18, md: 21, lg: 26 };
export const TEXT_SIZE_LABEL: Record<TextSize, string> = { sm: 'A', md: 'A', lg: 'A' };

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULTS,
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      cyclePinyin: () => {
        const i = PINYIN_CYCLE.indexOf(get().pinyin);
        set({ pinyin: PINYIN_CYCLE[(i + 1) % PINYIN_CYCLE.length] });
      },
      cycleTextSize: () => {
        const i = SIZE_CYCLE.indexOf(get().textSize);
        set({ textSize: SIZE_CYCLE[(i + 1) % SIZE_CYCLE.length] });
      },
      reset: () => set({ ...DEFAULTS }),
    }),
    { name: 'booklens.settings.v1' },
  ),
);

export function levelLabel(level: number): string {
  return level >= 7 ? 'Native' : `HSK ${level}`;
}

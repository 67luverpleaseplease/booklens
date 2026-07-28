import type { Voice } from '../lib/tts/voices';
import type { PinyinMode, ReadLang, TextSize } from '../lib/store/settings';

const PINYIN_LABEL: Record<PinyinMode, string> = {
  off: 'off',
  ruby: '拼音',
  line: 'line',
};

const LANG_LABEL: Record<ReadLang, string> = { zh: '中文', en: 'EN', both: '双语' };
const RATES = [0.5, 0.75, 1, 1.25, 1.5];

export function PlayerBar({
  speaking,
  onPlayPause,
  voice,
  onOpenVoices,
  pinyinMode,
  onCyclePinyin,
  readLang,
  onCycleLang,
  rate,
  onRate,
  textSize,
  onCycleTextSize,
  looping,
  onStopLoop,
}: {
  speaking: boolean;
  onPlayPause: () => void;
  voice: Voice | null;
  onOpenVoices: () => void;
  pinyinMode: PinyinMode;
  onCyclePinyin: () => void;
  readLang: ReadLang;
  onCycleLang: () => void;
  rate: number;
  onRate: (r: number) => void;
  textSize: TextSize;
  onCycleTextSize: () => void;
  looping: boolean;
  onStopLoop: () => void;
}) {
  const nextRate = () => {
    const i = RATES.indexOf(rate);
    onRate(RATES[(i === -1 ? 2 : i + 1) % RATES.length]);
  };

  return (
    <div className="pointer-events-auto rounded-2xl border border-paper-line bg-paper/95 backdrop-blur-sm">
      {/* Looping is a mode you can get stuck in, so it announces itself and
          offers a way out rather than living only in the text highlight. */}
      {looping ? (
        <button
          type="button"
          onClick={onStopLoop}
          className="flex w-full items-center gap-2 rounded-t-2xl bg-amber/20 px-3 py-1.5 text-left"
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" aria-hidden />
          <span className="han flex-1 text-[12px] text-ink">循环朗读中</span>
          <span className="font-mono text-[9.5px] tracking-wide text-graphite uppercase">
            looping · tap to stop
          </span>
        </button>
      ) : null}

      <div className="flex items-center gap-1.5 px-2 py-2">
      <button
        type="button"
        onClick={onPlayPause}
        aria-label={speaking ? 'Stop' : 'Read aloud'}
        className={[
          'grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-colors',
          speaking ? 'bg-seal text-paper' : 'bg-ink text-paper hover:bg-seal',
        ].join(' ')}
      >
        {speaking ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <button
        type="button"
        onClick={onOpenVoices}
        className="flex min-w-0 flex-1 flex-col items-start rounded-xl px-2.5 py-1 transition-colors hover:bg-paper-deep"
      >
        <span className="font-mono text-[8.5px] tracking-[0.16em] text-graphite/70 uppercase">
          {voice?.gender === 'male' ? '男声 male' : voice?.gender === 'female' ? '女声 female' : 'voice'}
        </span>
        <span className="w-full truncate text-left text-[13px] text-ink">
          {voice?.label ?? 'No voice'}
        </span>
      </button>

      <Chip label={LANG_LABEL[readLang]} onClick={onCycleLang} title="Reading language" />
        <Chip
          label={PINYIN_LABEL[pinyinMode]}
          onClick={onCyclePinyin}
          title="Pinyin display"
          active={pinyinMode !== 'off'}
        />
        <TextSizeChip size={textSize} onClick={onCycleTextSize} />
        <Chip label={`${rate}×`} onClick={nextRate} title="Speed" mono />
      </div>
    </div>
  );
}

/** The control shows its own effect: the A grows with the setting. */
function TextSizeChip({ size, onClick }: { size: TextSize; onClick: () => void }) {
  const px = { sm: 11, md: 14, lg: 17 }[size];
  return (
    <button
      type="button"
      onClick={onClick}
      title="Text size"
      aria-label={`Text size: ${size}`}
      className="grid h-10 w-9 shrink-0 place-items-center rounded-xl bg-paper-deep text-graphite transition-colors hover:bg-paper-line"
    >
      <span className="font-display leading-none" style={{ fontSize: px }}>
        A
      </span>
    </button>
  );
}

function Chip({
  label,
  onClick,
  title,
  active,
  mono,
}: {
  label: string;
  onClick: () => void;
  title: string;
  active?: boolean;
  mono?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={[
        'h-10 shrink-0 rounded-xl px-2.5 text-[12px] transition-colors',
        mono ? 'font-mono text-[11px]' : 'han',
        active ? 'bg-seal/12 text-seal' : 'bg-paper-deep text-graphite hover:bg-paper-line',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

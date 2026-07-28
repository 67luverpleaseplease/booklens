import { motion } from 'motion/react';
import { ChineseText } from './ChineseText';
import type { SummaryCard as Card, SummaryKind, Token } from '../lib/vision/schema';
import { KIND_LABEL_EN } from '../lib/vision/schema';
import type { PinyinMode, TextSize } from '../lib/store/settings';

/**
 * Each card kind gets its own accent, so a stack of six reads as a sequence
 * rather than six identical boxes. Hook and takeaway — the two you actually say
 * out loud — carry the strongest colour.
 */
const KIND_ACCENT: Record<SummaryKind, string> = {
  hook: 'var(--color-seal)',
  plot: 'var(--color-ink)',
  theme: 'var(--color-jade)',
  takeaway: 'var(--color-amber)',
  context: 'var(--color-graphite)',
  passage: 'var(--color-graphite)',
};

export function SummaryCardView({
  card,
  index,
  pinyinMode,
  textSize,
  onWordTap,
  onSpeak,
  onSentenceTap,
  onSentenceHold,
  speaking,
  highlightRange,
  loopRange,
}: {
  card: Card;
  index: number;
  pinyinMode: PinyinMode;
  textSize: TextSize;
  onWordTap: (token: Token, sentence: string, anchor: HTMLElement) => void;
  onSpeak: (card: Card) => void;
  onSentenceTap: (cardIndex: number, sentenceIndex: number, text: string) => void;
  onSentenceHold: (cardIndex: number, sentenceIndex: number, text: string) => void;
  speaking: boolean;
  highlightRange?: { start: number; end: number } | null;
  loopRange?: { start: number; end: number } | null;
}) {
  const accent = KIND_ACCENT[card.kind];

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, type: 'spring', stiffness: 320, damping: 30 }}
      className={[
        'card-lift relative overflow-hidden rounded-[18px] border bg-paper py-4 pr-4 pl-4 transition-all duration-200',
        speaking ? 'border-seal/45' : 'border-paper-line',
      ].join(' ')}
    >
      {/* A hairline of the kind's colour down the left edge. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: accent, opacity: speaking ? 1 : 0.55 }}
      />

      <header className="mb-2 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <span className="font-display text-[30px] leading-none italic" style={{ color: accent }}>
            {index + 1}
          </span>
          <span className="han text-[14px] text-ink">{card.label_zh}</span>
          <span className="font-mono text-[9.5px] tracking-[0.16em] text-graphite/70 uppercase">
            {KIND_LABEL_EN[card.kind]}
          </span>
        </div>

        <button
          type="button"
          onClick={() => onSpeak(card)}
          aria-label={speaking ? 'Stop reading this card' : 'Read this card aloud'}
          className={[
            'grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors',
            speaking
              ? 'bg-seal text-paper'
              : 'bg-paper-deep text-graphite hover:bg-ink hover:text-paper',
          ].join(' ')}
        >
          {speaking ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      </header>

      <ChineseText
        tokens={card.tokens}
        pinyinMode={pinyinMode}
        pinyinLine={card.pinyin}
        size={textSize}
        highlightRange={highlightRange}
        loopRange={loopRange}
        onWordTap={(token, _i, anchor) => onWordTap(token, card.zh, anchor)}
        onSentenceTap={(sIndex, text) => onSentenceTap(index, sIndex, text)}
        onSentenceHold={(sIndex, text) => onSentenceHold(index, sIndex, text)}
      />

      {card.en ? (
        <p className="mt-2.5 border-t border-paper-line pt-2.5 text-[15px] leading-snug text-graphite">
          {card.en}
        </p>
      ) : null}
    </motion.article>
  );
}

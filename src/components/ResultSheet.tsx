import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, animate, type PanInfo } from 'motion/react';
import { BookHeader } from './BookHeader';
import { SummaryCardView } from './SummaryCard';
import { ChineseText } from './ChineseText';
import type { AnalyzeOutcome } from '../lib/vision/analyze';
import type { SummaryCard, Token } from '../lib/vision/schema';
import type { PinyinMode, TextSize } from '../lib/store/settings';
import { scanToMarkdown, download, type ShelfEntry } from '../lib/store/db';
import { sharePoster } from '../lib/share/poster';

/** Fractions of viewport height the sheet rests at. */
const SNAP = { peek: 0.32, half: 0.62, full: 0.92 } as const;
export type SnapPoint = keyof typeof SNAP;

export function ResultSheet({
  outcome,
  thumbnail,
  pinyinMode,
  textSize,
  onWordTap,
  onSpeakCard,
  onSentenceTap,
  onSentenceHold,
  speakingCardIndex,
  highlightRange,
  loopCardIndex,
  loopRange,
  onRetry,
  retrying,
  canRetry,
  onClose,
  desktop,
}: {
  outcome: AnalyzeOutcome;
  thumbnail?: string;
  pinyinMode: PinyinMode;
  textSize: TextSize;
  onWordTap: (token: Token, sentence: string, anchor: HTMLElement) => void;
  onSpeakCard: (card: SummaryCard, index: number) => void;
  onSentenceTap: (cardIndex: number, sentenceIndex: number, text: string) => void;
  onSentenceHold: (cardIndex: number, sentenceIndex: number, text: string) => void;
  speakingCardIndex: number;
  highlightRange?: { start: number; end: number } | null;
  loopCardIndex: number;
  loopRange?: { start: number; end: number } | null;
  onRetry: () => void;
  retrying: boolean;
  canRetry: boolean;
  onClose: () => void;
  desktop: boolean;
}) {
  const [shareState, setShareState] = useState<'idle' | 'rendering' | 'done'>('idle');
  const [snap, setSnap] = useState<SnapPoint>('half');
  const y = useMotionValue(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const heightFor = (point: SnapPoint) =>
    typeof window === 'undefined' ? 500 : window.innerHeight * SNAP[point];

  // Animate to the new resting height whenever the snap point changes.
  useEffect(() => {
    if (desktop) return;
    const target = window.innerHeight - heightFor(snap);
    const controls = animate(y, target, { type: 'spring', stiffness: 380, damping: 34 });
    return () => controls.stop();
  }, [snap, desktop, y]);

  const handleDragEnd = (_e: unknown, info: PanInfo) => {
    const current = window.innerHeight - y.get();
    const projected = current - info.velocity.y * 0.18;
    const fraction = projected / window.innerHeight;

    // Velocity-weighted nearest snap, so a flick overshoots the way you expect.
    let nearest: SnapPoint = 'half';
    let best = Infinity;
    for (const point of Object.keys(SNAP) as SnapPoint[]) {
      const d = Math.abs(SNAP[point] - fraction);
      if (d < best) {
        best = d;
        nearest = point;
      }
    }
    if (fraction < SNAP.peek * 0.55) {
      onClose();
      return;
    }
    setSnap(nearest);
  };

  const body = (
    <>
      <div
        ref={scrollRef}
        data-reading-surface
        className="thin-scroll flex-1 overflow-y-auto overscroll-contain px-4 pb-28"
      >
        <BookHeader result={outcome.result} thumbnail={thumbnail} modelLabel={outcome.modelLabel} />

        {outcome.result.caveats ? (
          <p className="mt-3 rounded-xl border-l-[3px] border-amber bg-amber/10 px-3 py-2 text-[13px] leading-snug text-graphite">
            {outcome.result.caveats}
          </p>
        ) : null}

        <div className="mt-4 space-y-2.5">
          {outcome.result.summaries.map((card, i) => (
            <SummaryCardView
              key={i}
              card={card}
              index={i}
              pinyinMode={pinyinMode}
              textSize={textSize}
              onWordTap={onWordTap}
              onSpeak={() => onSpeakCard(card, i)}
              onSentenceTap={onSentenceTap}
              onSentenceHold={onSentenceHold}
              speaking={speakingCardIndex === i}
              highlightRange={speakingCardIndex === i ? highlightRange : null}
              loopRange={loopCardIndex === i ? loopRange : null}
            />
          ))}
        </div>

        {outcome.result.key_terms.length ? (
          <section className="mt-5">
            <h2 className="font-mono text-[10px] tracking-[0.18em] text-graphite/70 uppercase">
              生词 · key terms
            </h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {outcome.result.key_terms.map((term) => (
                <button
                  key={term.zh}
                  type="button"
                  onClick={(e) =>
                    onWordTap(
                      { w: term.zh, py: term.py, en: term.en },
                      term.note || term.en,
                      e.currentTarget,
                    )
                  }
                  className="rounded-xl border border-paper-line bg-paper px-2.5 py-1.5 text-left transition-colors hover:border-seal/50"
                >
                  <span className="han block text-[15px] text-ink">{term.zh}</span>
                  <span className="block font-mono text-[10px] text-seal">{term.py}</span>
                  <span className="block max-w-[130px] truncate text-[11px] text-graphite">
                    {term.en}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* The payoff: what you'd actually say to another person. Given the
            strongest treatment on the page because it is the point. */}
        {outcome.result.talking_points.length ? (
          <section className="mt-5 overflow-hidden rounded-2xl bg-ink px-4 py-4 text-paper">
            <h2 className="flex items-baseline gap-2">
              <span className="han text-[15px]">说给别人听</span>
              <span className="font-mono text-[9.5px] tracking-[0.18em] text-paper/45 uppercase">
                say it out loud
              </span>
            </h2>
            <ul className="mt-2.5 space-y-2.5">
              {outcome.result.talking_points.map((p, i) => (
                <li key={i} className="flex gap-2.5 text-[15px] leading-snug">
                  <span className="font-display shrink-0 text-[20px] leading-none text-seal italic">
                    {i + 1}
                  </span>
                  <span className="text-paper/90">{p}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {outcome.result.extracted_text ? (
          <details className="mt-5 rounded-2xl border border-paper-line px-3.5 py-2.5">
            <summary className="cursor-pointer font-mono text-[10px] tracking-[0.16em] text-graphite/70 uppercase">
              原文 · transcription
            </summary>
            <div className="mt-2.5">
              <ChineseText
                tokens={[{ w: outcome.result.extracted_text, py: '', en: '' }]}
                pinyinMode="off"
                size="sm"
              />
            </div>
          </details>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={shareState === 'rendering'}
            onClick={async () => {
              setShareState('rendering');
              try {
                await sharePoster(outcome.result, outcome.modelLabel);
                setShareState('done');
                setTimeout(() => setShareState('idle'), 2000);
              } catch {
                setShareState('idle');
              }
            }}
            className="flex-1 rounded-xl bg-seal px-3 py-2.5 font-mono text-[11px] tracking-wide text-paper transition-colors hover:bg-seal-deep disabled:opacity-60"
          >
            {shareState === 'rendering'
              ? 'drawing…'
              : shareState === 'done'
                ? 'saved ✓'
                : 'share as image'}
          </button>

          <button
            type="button"
            onClick={() => {
              const entry: ShelfEntry = {
                id: 'export',
                createdAt: Date.now(),
                thumbnail: '',
                intent: 'cover',
                model: outcome.model,
                modelLabel: outcome.modelLabel,
                result: outcome.result,
                searchBlob: '',
              };
              const name = outcome.result.book?.title_en || outcome.result.book?.title_zh || 'book';
              download(`${name}.md`, scanToMarkdown(entry), 'text/markdown');
            }}
            className="rounded-xl bg-ink px-3 py-2.5 font-mono text-[11px] tracking-wide text-paper transition-colors hover:bg-graphite"
          >
            markdown
          </button>

          <button
            type="button"
            onClick={() => {
              const text = outcome.result.summaries.map((s) => `${s.zh}\n${s.en}`).join('\n\n');
              void navigator.clipboard?.writeText(text);
            }}
            className="rounded-xl border border-paper-line px-3 py-2.5 font-mono text-[11px] text-graphite transition-colors hover:border-ink"
          >
            copy
          </button>
        </div>

        {/* Gemma occasionally returns something thin or wrong. Rather than make
            the user re-photograph the book, offer the other model family. */}
        {canRetry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="mt-2 w-full rounded-xl border border-dashed border-paper-line px-3 py-2.5 text-left transition-colors hover:border-graphite disabled:opacity-60"
          >
            <span className="block font-mono text-[11px] tracking-wide text-graphite">
              {retrying ? 'asking a different model…' : 'not right? try a different model'}
            </span>
            <span className="mt-0.5 block font-mono text-[9.5px] text-graphite/60">
              re-reads the same photo with Nemotron · uses 1 of today's scans
            </span>
          </button>
        ) : null}
      </div>
    </>
  );

  if (desktop) {
    // min-h-0 + flex-1 rather than h-full: the player bar is a sibling below it
    // in the column, and h-full would claim all of it and push the bar offscreen.
    return (
      <aside className="flex min-h-0 w-[420px] flex-1 shrink-0 flex-col overflow-hidden rounded-3xl bg-paper text-ink">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="font-mono text-[10px] tracking-[0.18em] text-graphite/70 uppercase">
            summary
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-full bg-paper-deep text-graphite hover:bg-paper-line"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {body}
      </aside>
    );
  }

  return (
    <AnimatePresence>
      <motion.section
        key="sheet"
        role="dialog"
        aria-label="Book summary"
        initial={{ y: '100%' }}
        animate={{ y: window.innerHeight - heightFor('half') }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        drag="y"
        dragConstraints={{
          top: window.innerHeight - heightFor('full'),
          bottom: window.innerHeight,
        }}
        dragElastic={0.04}
        onDragEnd={handleDragEnd}
        style={{ y, height: heightFor('full'), borderRadius: 'var(--sheet-radius) var(--sheet-radius) 0 0' }}
        className="fixed inset-x-0 top-0 z-40 flex flex-col bg-paper text-ink shadow-[0_-14px_50px_-10px_rgba(0,0,0,0.6)]"
      >
        <div
          className="flex cursor-grab touch-none items-center justify-center py-2.5 active:cursor-grabbing"
          onDoubleClick={() => setSnap(snap === 'full' ? 'half' : 'full')}
        >
          <span className="h-1 w-9 rounded-full bg-paper-line" aria-hidden />
        </div>
        {body}
      </motion.section>
    </AnimatePresence>
  );
}

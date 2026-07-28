import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Token } from '../lib/vision/schema';
import { toPinyin } from '../lib/chinese/pinyin';
import { lookup, type DictEntry } from '../lib/chinese/dict';
import { hasWord, saveWord } from '../lib/store/db';

/**
 * Tap-to-define, the affordance Pleco, Du Chinese and Readibu all built their
 * reputation on.
 *
 * Lookup order matters: the model's own gloss first (it saw the sentence, so
 * it disambiguates better than a dictionary can), then CC-CEDICT, then a bare
 * pinyin reading. Something always shows.
 */
export function WordPopover({
  token,
  anchor,
  sentence,
  bookTitle,
  onClose,
  onSpeak,
}: {
  token: Token | null;
  anchor: HTMLElement | null;
  sentence: string;
  bookTitle: string;
  onClose: () => void;
  onSpeak: (word: string) => void;
}) {
  const [entry, setEntry] = useState<DictEntry | null>(null);
  const [fallbackPy, setFallbackPy] = useState('');
  const [saved, setSaved] = useState(false);
  const [strokeOpen, setStrokeOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!token) return;
    setEntry(null);
    setFallbackPy('');
    setStrokeOpen(false);

    let alive = true;
    void lookup(token.w).then((e) => alive && setEntry(e));
    if (!token.py) void toPinyin(token.w).then((p) => alive && setFallbackPy(p));
    void hasWord(token.w).then((h) => alive && setSaved(h));
    return () => {
      alive = false;
    };
  }, [token]);

  // Dismiss on outside click or Escape.
  useEffect(() => {
    if (!token) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    // Deferred so the tap that opened it doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [token, onClose]);

  const pinyin = token?.py || entry?.pinyin || fallbackPy;
  const gloss = token?.en || entry?.definitions.join('; ') || '';

  // Position above the word, clamped to the reading surface rather than the
  // viewport — on desktop the surface is a 420px rail, and clamping to the
  // window would drop the popover onto the camera panel beside it.
  const rect = anchor?.getBoundingClientRect();
  const width = 268;
  const surface = anchor?.closest('[data-reading-surface]')?.getBoundingClientRect();
  const minLeft = Math.max(12, (surface?.left ?? 0) + 8);
  const maxLeft = Math.min(window.innerWidth, surface?.right ?? window.innerWidth) - width - 8;
  const left = rect
    ? Math.max(minLeft, Math.min(rect.left + rect.width / 2 - width / 2, Math.max(minLeft, maxLeft)))
    : minLeft;
  const placeAbove = rect ? rect.top > 220 : true;
  const top = rect ? (placeAbove ? rect.top - 12 : rect.bottom + 12) : 80;

  return (
    <AnimatePresence>
      {token ? (
        <motion.div
          ref={cardRef}
          initial={{ opacity: 0, y: placeAbove ? 6 : -6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: placeAbove ? 4 : -4, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 500, damping: 34 }}
          role="dialog"
          aria-label={`Definition of ${token.w}`}
          className="fixed z-50 rounded-2xl border border-paper-line bg-paper p-3.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.45)]"
          style={{
            left,
            top,
            width,
            transform: placeAbove ? 'translateY(-100%)' : undefined,
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="han text-[30px] leading-tight text-ink">{token.w}</div>
              {pinyin ? (
                <div className="mt-0.5 font-mono text-[13px] text-seal">{pinyin}</div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {token.hsk ?? entry?.hsk ? (
                <span className="rounded-full bg-paper-deep px-2 py-0.5 font-mono text-[10px] text-graphite">
                  HSK {token.hsk ?? entry?.hsk}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => onSpeak(token.w)}
                aria-label={`Say ${token.w}`}
                className="grid h-8 w-8 place-items-center rounded-full bg-paper-deep text-ink transition-colors hover:bg-seal hover:text-paper"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            </div>
          </div>

          {gloss ? (
            <p className="mt-2 text-[14px] leading-snug text-graphite">{gloss}</p>
          ) : (
            <p className="mt-2 text-[13px] text-graphite/70 italic">No definition found.</p>
          )}

          {strokeOpen ? <StrokeOrder char={token.w[0]} /> : null}

          <div className="mt-3 flex items-center gap-2 border-t border-paper-line pt-2.5">
            <button
              type="button"
              disabled={saved}
              onClick={async () => {
                await saveWord({
                  zh: token.w,
                  py: pinyin,
                  en: gloss,
                  hsk: token.hsk ?? entry?.hsk,
                  sentence,
                  bookTitle,
                });
                setSaved(true);
              }}
              className={[
                'flex-1 rounded-lg px-2.5 py-1.5 font-mono text-[11px] tracking-wide transition-colors',
                saved
                  ? 'bg-jade/15 text-[color-mix(in_srgb,var(--color-jade)_70%,var(--color-ink))]'
                  : 'bg-ink text-paper hover:bg-seal',
              ].join(' ')}
            >
              {saved ? '已存 saved' : '+ 生词本'}
            </button>
            <button
              type="button"
              onClick={() => setStrokeOpen((v) => !v)}
              className="rounded-lg bg-paper-deep px-2.5 py-1.5 font-mono text-[11px] text-graphite transition-colors hover:bg-paper-line"
            >
              笔顺
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Stroke-order animation. hanzi-writer is heavy, so it loads only on demand. */
function StrokeOrder({ char }: { char: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      try {
        const mod = await import('hanzi-writer');
        if (disposed || !hostRef.current) return;
        hostRef.current.innerHTML = '';
        const writer = mod.default.create(hostRef.current, char, {
          width: 96,
          height: 96,
          padding: 6,
          strokeColor: '#0B0B0D',
          radicalColor: '#E2483D',
          delayBetweenStrokes: 180,
          strokeAnimationSpeed: 1.2,
        });
        writer.loopCharacterAnimation();
        cleanup = () => {
          // No destroy() in the public API — stopping the loop and dropping the
          // SVG is what actually releases it.
          writer.cancelQuiz?.();
          writer.hideCharacter();
        };
      } catch {
        if (!disposed) setFailed(true);
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
      if (hostRef.current) hostRef.current.innerHTML = '';
    };
  }, [char]);

  if (failed) {
    return (
      <p className="mt-2 font-mono text-[11px] text-graphite/70">Stroke data unavailable offline.</p>
    );
  }
  return (
    <div className="mt-2 flex justify-center rounded-xl bg-paper-deep/60 py-2">
      <div ref={hostRef} aria-label={`Stroke order for ${char}`} />
    </div>
  );
}

import { useMemo, useRef } from 'react';
import type { Token } from '../lib/vision/schema';
import { type PinyinMode, type TextSize, TEXT_SIZE_PX } from '../lib/store/settings';

/**
 * The reading surface.
 *
 * Renders the model's token array rather than a raw string, which is what makes
 * pinyin ruby, tap-to-define, and sentence-level playback all fall out of one
 * structure.
 *
 * The layout-shift problem: toggling ruby normally reflows the paragraph.
 * Solved by reserving the annotation space on the line box up front and only
 * hiding the <rt> contents, so geometry is identical in `off` and `ruby`.
 */

const PUNCTUATION = /^[\s，。！？；：、""''（）《》…—·,.!?;:()"'\[\]{}]+$/;
const TERMINATORS = '。！？!?；;…';

export function isPunctuation(word: string): boolean {
  return PUNCTUATION.test(word);
}

type SentenceGroup = { tokens: Array<{ token: Token; index: number }>; start: number; end: number };

/**
 * Group tokens into sentences so a whole sentence can be tapped to play or
 * held to loop, without losing per-word tap targets inside it.
 */
function groupSentences(tokens: Token[]): SentenceGroup[] {
  const groups: SentenceGroup[] = [];
  let current: SentenceGroup = { tokens: [], start: 0, end: 0 };
  let cursor = 0;

  tokens.forEach((token, index) => {
    if (current.tokens.length === 0) current.start = cursor;
    current.tokens.push({ token, index });
    cursor += token.w.length;
    current.end = cursor;

    if ([...token.w].some((ch) => TERMINATORS.includes(ch))) {
      groups.push(current);
      current = { tokens: [], start: cursor, end: cursor };
    }
  });

  if (current.tokens.length) groups.push(current);
  return groups;
}

export function ChineseText({
  tokens,
  pinyinMode,
  pinyinLine,
  onWordTap,
  onSentenceTap,
  onSentenceHold,
  highlightRange,
  loopRange,
  className = '',
  size = 'md',
}: {
  tokens: Token[];
  pinyinMode: PinyinMode;
  /** Whole-line pinyin, shown under the text in `line` mode. */
  pinyinLine?: string;
  onWordTap?: (token: Token, index: number, anchor: HTMLElement) => void;
  /** Tap a sentence to start reading from it. */
  onSentenceTap?: (sentenceIndex: number, text: string) => void;
  /** Hold a sentence to loop it — shadowing practice. */
  onSentenceHold?: (sentenceIndex: number, text: string) => void;
  /** Character span currently being spoken. */
  highlightRange?: { start: number; end: number } | null;
  /** Character span currently on loop. */
  loopRange?: { start: number; end: number } | null;
  className?: string;
  size?: TextSize;
}) {
  const sentences = useMemo(() => groupSentences(tokens), [tokens]);
  // Precomputed so the highlight lookup stays O(1) per token rather than
  // rescanning the array for every one of them.
  const offsets = useMemo(() => {
    let cursor = 0;
    return tokens.map((t) => {
      const start = cursor;
      cursor += t.w.length;
      return start;
    });
  }, [tokens]);
  const holdTimer = useRef<number | null>(null);
  const held = useRef(false);

  const showRuby = pinyinMode === 'ruby';
  const fontSize = TEXT_SIZE_PX[size];

  const startHold = (index: number, text: string) => {
    held.current = false;
    holdTimer.current = window.setTimeout(() => {
      held.current = true;
      navigator.vibrate?.(12);
      onSentenceHold?.(index, text);
    }, 500);
  };

  const endHold = (index: number, text: string, fromWord: boolean) => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    // A hold already fired, or the press landed on a word — don't also seek.
    if (held.current || fromWord) {
      held.current = false;
      return;
    }
    onSentenceTap?.(index, text);
  };

  return (
    <div className={className}>
      <p className="ruby-host han text-ink" style={{ fontSize }}>
        {sentences.map((sentence, sIndex) => {
          const text = sentence.tokens.map((t) => t.token.w).join('');
          const looping =
            loopRange && sentence.start < loopRange.end && sentence.end > loopRange.start;

          return (
            <span
              key={sIndex}
              data-sentence={sIndex}
              onPointerDown={() => onSentenceTap && startHold(sIndex, text)}
              onPointerUp={(e) => {
                if (!onSentenceTap) return;
                const fromWord = (e.target as HTMLElement).closest('ruby[role="button"]') !== null;
                endHold(sIndex, text, fromWord);
              }}
              onPointerLeave={() => {
                if (holdTimer.current !== null) {
                  clearTimeout(holdTimer.current);
                  holdTimer.current = null;
                }
              }}
              className={[
                'rounded-[4px] transition-colors duration-150',
                onSentenceTap ? 'cursor-pointer' : '',
                looping ? 'bg-[color-mix(in_srgb,var(--color-amber)_20%,transparent)]' : '',
              ].join(' ')}
            >
              {sentence.tokens.map(({ token, index }) => {
                const punct = isPunctuation(token.w);
                const start = offsets[index];
                const lit =
                  highlightRange &&
                  start < highlightRange.end &&
                  start + token.w.length > highlightRange.start;

                if (punct) {
                  return (
                    <ruby key={index}>
                      {token.w}
                      <rt data-hidden={!showRuby}>&nbsp;</rt>
                    </ruby>
                  );
                }

                return (
                  <ruby
                    key={index}
                    role={onWordTap ? 'button' : undefined}
                    tabIndex={onWordTap ? 0 : undefined}
                    aria-label={
                      onWordTap ? `${token.w}${token.en ? `, ${token.en}` : ''}` : undefined
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      onWordTap?.(token, index, e.currentTarget);
                    }}
                    onKeyDown={(e) => {
                      if (!onWordTap) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onWordTap(token, index, e.currentTarget as HTMLElement);
                      }
                    }}
                    className={[
                      'rounded-[3px] transition-colors duration-100',
                      onWordTap ? 'cursor-pointer hover:bg-paper-deep' : '',
                      lit ? 'bg-[color-mix(in_srgb,var(--color-seal)_16%,transparent)]' : '',
                    ].join(' ')}
                    style={lit ? { boxShadow: 'inset 0 -2px 0 0 var(--color-seal)' } : undefined}
                  >
                    {token.w}
                    <rt data-hidden={!showRuby}>{token.py || ' '}</rt>
                  </ruby>
                );
              })}
            </span>
          );
        })}
      </p>

      {pinyinMode === 'line' && pinyinLine ? (
        <p className="mt-1.5 font-mono text-[12px] leading-relaxed text-graphite">{pinyinLine}</p>
      ) : null}
    </div>
  );
}

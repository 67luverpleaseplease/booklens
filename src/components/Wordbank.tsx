import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  deleteWord,
  download,
  listWords,
  reviewWord,
  wordsToAnkiCsv,
  wordsToPleco,
  type WordEntry,
} from '../lib/store/db';

/**
 * Words you tapped, and a way to actually learn them.
 *
 * The review loop is deliberately thin — SM-2 and three buttons. Anki and Pleco
 * already do this better, so the real feature is the export.
 */
export function Wordbank({
  open,
  onClose,
  onSpeak,
}: {
  open: boolean;
  onClose: () => void;
  onSpeak: (word: string) => void;
}) {
  const [words, setWords] = useState<WordEntry[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const refresh = () => void listWords().then(setWords);
  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const due = words.filter((w) => w.dueAt <= Date.now());
  const card = due[index];

  const grade = async (quality: number) => {
    if (!card) return;
    await reviewWord(card.zh, quality);
    setRevealed(false);
    if (index + 1 >= due.length) {
      setReviewing(false);
      setIndex(0);
      refresh();
    } else {
      setIndex(index + 1);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 overflow-y-auto bg-paper text-ink"
        >
          <div className="mx-auto max-w-lg px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-16">
            <header className="mb-4 flex items-baseline justify-between">
              <h1 className="font-display text-[30px]">
                Words <span className="han text-[20px] text-graphite">生词本</span>
              </h1>
              <button
                type="button"
                onClick={() => {
                  setReviewing(false);
                  onClose();
                }}
                className="font-mono text-[11px] tracking-wide text-graphite uppercase"
              >
                done
              </button>
            </header>

            {words.length === 0 ? (
              <div className="py-16 text-center">
                <div className="han mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl border border-paper-line text-[24px] text-graphite/50">
                  词
                </div>
                <p className="text-[14px] text-graphite">
                  Tap a word in any summary to save it here.
                </p>
              </div>
            ) : reviewing && card ? (
              <div className="rounded-2xl border border-paper-line px-4 py-8 text-center">
                <p className="font-mono text-[10px] tracking-[0.16em] text-graphite/60 uppercase">
                  {index + 1} of {due.length}
                </p>
                <button
                  type="button"
                  onClick={() => onSpeak(card.zh)}
                  className="han my-4 block w-full text-[46px] text-ink"
                >
                  {card.zh}
                </button>

                {revealed ? (
                  <>
                    <p className="font-mono text-[14px] text-seal">{card.py}</p>
                    <p className="mt-1 text-[15px] text-graphite">{card.en}</p>
                    {card.sentence ? (
                      <p className="han mt-3 text-[14px] text-graphite/70">{card.sentence}</p>
                    ) : null}
                    <div className="mt-5 flex gap-1.5">
                      <GradeButton label="again" tone="seal" onClick={() => void grade(1)} />
                      <GradeButton label="hard" tone="amber" onClick={() => void grade(3)} />
                      <GradeButton label="good" tone="jade" onClick={() => void grade(5)} />
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRevealed(true)}
                    className="mt-2 w-full rounded-xl bg-ink px-4 py-2.5 font-mono text-[11px] tracking-wide text-paper"
                  >
                    show
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={due.length === 0}
                    onClick={() => {
                      setReviewing(true);
                      setIndex(0);
                      setRevealed(false);
                    }}
                    className="rounded-xl bg-ink px-3 py-2 font-mono text-[11px] text-paper transition-colors hover:bg-seal disabled:opacity-40"
                  >
                    review {due.length ? `(${due.length})` : '— all caught up'}
                  </button>
                  <button
                    type="button"
                    onClick={() => download('booklens-anki.csv', wordsToAnkiCsv(words), 'text/csv')}
                    className="rounded-xl bg-paper-deep px-3 py-2 font-mono text-[11px] text-graphite hover:bg-paper-line"
                  >
                    anki csv
                  </button>
                  <button
                    type="button"
                    onClick={() => download('booklens-pleco.txt', wordsToPleco(words))}
                    className="rounded-xl bg-paper-deep px-3 py-2 font-mono text-[11px] text-graphite hover:bg-paper-line"
                  >
                    pleco
                  </button>
                </div>

                <ul className="space-y-1">
                  {words.map((w) => (
                    <li
                      key={w.zh}
                      className="flex items-center gap-3 rounded-xl border border-paper-line px-3 py-2"
                    >
                      <button
                        type="button"
                        onClick={() => onSpeak(w.zh)}
                        className="han shrink-0 text-[20px] text-ink"
                        aria-label={`Say ${w.zh}`}
                      >
                        {w.zh}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[10.5px] text-seal">{w.py}</p>
                        <p className="truncate text-[12.5px] text-graphite">{w.en}</p>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteWord(w.zh);
                          refresh();
                        }}
                        aria-label={`Remove ${w.zh}`}
                        className="shrink-0 font-mono text-[10px] text-graphite/50 hover:text-seal"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function GradeButton({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: 'seal' | 'amber' | 'jade';
  onClick: () => void;
}) {
  const bg = {
    seal: 'bg-seal/12 text-seal',
    amber: 'bg-amber/15 text-[color-mix(in_srgb,var(--color-amber)_75%,var(--color-ink))]',
    jade: 'bg-jade/15 text-[color-mix(in_srgb,var(--color-jade)_65%,var(--color-ink))]',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-xl py-2 font-mono text-[11px] tracking-wide ${bg}`}
    >
      {label}
    </button>
  );
}

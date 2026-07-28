import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { keychain } from '../lib/openrouter/keychain';
import { useKeyTester } from '../hooks/useKeychain';
import { useKeys } from '../hooks/useKeychain';

/**
 * Three cards, shown once. It never blocks — you can skip straight through and
 * still browse the shelf; the app only needs a key when you actually scan.
 */
export function Onboarding({ open, onDone }: { open: boolean; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState('');
  const keys = useKeys();
  const { test, state, messages } = useKeyTester();

  const lastKey = keys[keys.length - 1];
  const keyOk = lastKey && state[lastKey.id] === 'ok';

  const addKey = async () => {
    const value = draft.trim();
    if (!value) return;
    const record = keychain.add(value, 'key 1');
    setDraft('');
    await test(record);
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] grid place-items-center bg-ink px-5"
        >
          <div className="w-full max-w-sm">
            {step === 0 ? (
              <Card>
                <div className="han mb-4 grid h-16 w-16 place-items-center rounded-[20px] bg-seal text-[32px] font-medium text-paper">
                  读
                </div>
                <h1 className="font-display text-[34px] leading-tight text-paper">
                  书镜 <span className="italic">BookLens</span>
                </h1>
                <p className="mt-2 text-[15px] leading-snug text-paper/70">
                  Point your camera at a Chinese book. Get a handful of short summaries in Chinese
                  and English — and have them read to you, in a voice you choose.
                </p>
                <Primary onClick={() => setStep(1)}>Start</Primary>
              </Card>
            ) : null}

            {step === 1 ? (
              <Card>
                <Step n={1} of={2} />
                <h2 className="font-display text-[26px] text-paper">Add a free key</h2>
                <p className="mt-1.5 text-[14px] leading-snug text-paper/70">
                  BookLens reads books using free models on OpenRouter. Your key stays on this
                  device and is sent only to OpenRouter — there is no server in between.
                </p>

                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block font-mono text-[11px] text-seal underline underline-offset-4"
                >
                  openrouter.ai/keys →
                </a>

                <div className="mt-3 flex gap-1.5">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void addKey()}
                    placeholder="sk-or-v1-…"
                    spellCheck={false}
                    autoComplete="off"
                    className="min-w-0 flex-1 rounded-xl border border-ink-line bg-ink-soft px-3 py-2.5 font-mono text-[12px] text-paper placeholder:text-ink-mute focus:border-seal focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void addKey()}
                    disabled={!draft.trim()}
                    className="rounded-xl bg-seal px-3.5 py-2.5 font-mono text-[11px] text-paper disabled:opacity-40"
                  >
                    add
                  </button>
                </div>

                {lastKey && messages[lastKey.id] ? (
                  <p
                    className={`mt-2 font-mono text-[11px] ${keyOk ? 'text-jade' : 'text-seal'}`}
                  >
                    {keyOk ? '✓ ' : '× '}
                    {messages[lastKey.id]}
                  </p>
                ) : null}

                <p className="mt-2.5 text-[11.5px] leading-relaxed text-paper/45">
                  The free tier is 50 scans a day. Adding a second key later doubles that — BookLens
                  rotates between them automatically.
                </p>

                <Primary onClick={() => setStep(2)}>{keys.length ? 'Next' : 'Skip for now'}</Primary>
              </Card>
            ) : null}

            {step === 2 ? (
              <Card>
                <Step n={2} of={2} />
                <h2 className="font-display text-[26px] text-paper">Allow the camera</h2>
                <p className="mt-1.5 text-[14px] leading-snug text-paper/70">
                  Photograph a cover to hear what a book is about, or photograph two pages to have
                  those pages summarised. You can also pick a photo from your library instead.
                </p>
                <p className="mt-3 text-[13px] leading-snug text-paper/50">
                  Reading aloud uses the voices already on your device — free, offline, and no key
                  needed. Pick a male or female voice from the player bar.
                </p>
                <Primary onClick={onDone}>Open the camera</Primary>
              </Card>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
    >
      {children}
    </motion.div>
  );
}

function Step({ n, of }: { n: number; of: number }) {
  return (
    <span className="mb-2 block font-mono text-[10px] tracking-[0.18em] text-ink-mute uppercase">
      step {n} of {of}
    </span>
  );
}

function Primary({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-5 w-full rounded-2xl bg-paper px-4 py-3 text-[15px] text-ink transition-colors hover:bg-seal hover:text-paper"
    >
      {children}
    </button>
  );
}

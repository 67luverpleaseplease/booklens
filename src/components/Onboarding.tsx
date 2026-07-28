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
          style={{
            background:
              'radial-gradient(ellipse 90% 60% at 50% -10%, color-mix(in srgb, var(--color-seal) 14%, transparent), transparent), var(--color-ink)',
          }}
        >
          <div className="w-full max-w-sm rounded-[26px] border border-ink-line bg-ink-soft/70 p-6 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.85)]">
            {step === 0 ? (
              <Card>
                <div className="relative mb-5 grid place-items-center">
                  <span
                    aria-hidden
                    className="han grid h-[72px] w-[72px] place-items-center rounded-[22px] text-[36px] font-medium text-paper"
                    style={{
                      background:
                        'linear-gradient(155deg, var(--color-seal) 15%, var(--color-seal-deep) 115%)',
                      boxShadow:
                        '0 0 0 7px color-mix(in srgb, var(--color-seal) 16%, transparent), 0 14px 34px -10px color-mix(in srgb, var(--color-seal) 65%, transparent), inset 0 1px 0 rgba(255,255,255,0.22)',
                    }}
                  >
                    读
                  </span>
                </div>
                <h1 className="text-center font-display text-[36px] leading-tight text-paper">
                  书镜 <span className="italic">BookLens</span>
                </h1>
                <p className="mt-2 text-center text-[15px] leading-snug text-paper/70">
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
            {/* progress dots */}
            <div className="mt-6 flex justify-center gap-1.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={[
                    'h-1.5 rounded-full transition-all duration-300',
                    i === step ? 'w-5 bg-seal' : 'w-1.5 bg-ink-line',
                  ].join(' ')}
                />
              ))}
            </div>
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
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      className="mt-5 w-full rounded-2xl bg-paper px-4 py-3.5 text-[15px] text-ink transition-colors hover:bg-seal hover:text-paper"
      style={{ boxShadow: '0 10px 26px -14px rgba(247,243,234,0.5)' }}
    >
      {children}
    </motion.button>
  );
}

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { QuotaDashboard } from './QuotaDashboard';
import { levelLabel, useSettings } from '../lib/store/settings';
import { clearAll, estimateStorage, listScans, scanToMarkdown, download } from '../lib/store/db';
import { PRIMARY_CHAIN, SECONDARY_CHAIN } from '../lib/openrouter/chains';
import { modeForChain } from '../lib/openrouter/jsonMode';

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings();
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRepair, setConfirmRepair] = useState(false);

  useEffect(() => {
    if (open) void estimateStorage().then(setStorage);
  }, [open]);

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
            <header className="mb-5 flex items-baseline justify-between">
              <h1 className="font-display text-[30px]">Settings</h1>
              <button
                type="button"
                onClick={onClose}
                className="font-mono text-[11px] tracking-wide text-graphite uppercase"
              >
                done
              </button>
            </header>

            <Section title="keys" sub="钥匙">
              <QuotaDashboard />
            </Section>

            <Section title="chinese" sub="中文">
              <Row label="Difficulty" hint="How hard the Chinese should be.">
                <div className="flex flex-wrap gap-1">
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => s.set('level', n)}
                      className={[
                        'rounded-lg px-2 py-1 font-mono text-[10.5px] transition-colors',
                        s.level === n
                          ? 'bg-seal text-paper'
                          : 'bg-paper-deep text-graphite hover:bg-paper-line',
                      ].join(' ')}
                    >
                      {n === 7 ? 'native' : `HSK${n}`}
                    </button>
                  ))}
                </div>
              </Row>

              <Toggle
                label="Traditional characters"
                hint="繁體字 instead of 简体字."
                value={s.traditional}
                onChange={(v) => s.set('traditional', v)}
              />

              <Row label="Pinyin" hint="Default display for new summaries.">
                <Segmented
                  options={[
                    ['off', 'off'],
                    ['ruby', '拼音'],
                    ['line', 'line'],
                  ]}
                  value={s.pinyin}
                  onChange={(v) => s.set('pinyin', v as typeof s.pinyin)}
                />
              </Row>

              <Row label="Text size" hint="How large the Chinese renders.">
                <Segmented
                  options={[
                    ['sm', 'small'],
                    ['md', 'medium'],
                    ['lg', 'large'],
                  ]}
                  value={s.textSize}
                  onChange={(v) => s.set('textSize', v as typeof s.textSize)}
                />
              </Row>
            </Section>

            <Section title="voice" sub="朗读">
              <Row label="Speed">
                <Segmented
                  options={[0.5, 0.75, 1, 1.25, 1.5].map((r) => [String(r), `${r}×`])}
                  value={String(s.rate)}
                  onChange={(v) => s.set('rate', Number(v))}
                />
              </Row>
              <Row label="Prefer" hint="Used when your saved voice isn't on this device.">
                <Segmented
                  options={[
                    ['male', '男声'],
                    ['female', '女声'],
                  ]}
                  value={s.preferredGender === 'female' ? 'female' : 'male'}
                  onChange={(v) => s.set('preferredGender', v as 'male' | 'female')}
                />
              </Row>
              <Toggle
                label="Read automatically"
                hint="Start speaking as soon as a summary arrives."
                value={s.autoplay}
                onChange={(v) => s.set('autoplay', v)}
              />
              <p className="mt-1 text-[11.5px] leading-relaxed text-graphite">
                Voices come from this device, so they cost nothing and work offline. Pick a specific
                one from the player bar. On iPhone, add more under Settings → Accessibility → Spoken
                Content → Voices → Chinese.
              </p>
            </Section>

            <Section title="models" sub="模型">
              <ChainRow chain={PRIMARY_CHAIN} primary />
              <ChainRow chain={SECONDARY_CHAIN} />
              <p className="mt-1 text-[11.5px] leading-relaxed text-graphite">
                All free. The whole first chain travels in one request — OpenRouter falls through it
                server-side, so three models still cost one scan from your daily budget.
              </p>
            </Section>

            <Section title="data" sub="数据">
              {storage ? (
                <p className="font-mono text-[11px] text-graphite">
                  {(storage.usage / 1024 / 1024).toFixed(1)} MB used
                  {storage.quota
                    ? ` of ${(storage.quota / 1024 / 1024 / 1024).toFixed(1)} GB available`
                    : ''}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={async () => {
                    const scans = await listScans();
                    if (!scans.length) return;
                    download(
                      'booklens-shelf.md',
                      scans.map(scanToMarkdown).join('\n\n---\n\n'),
                      'text/markdown',
                    );
                  }}
                  className="rounded-xl bg-paper-deep px-3 py-2 font-mono text-[11px] text-graphite hover:bg-paper-line"
                >
                  export everything
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirmClear) {
                      setConfirmClear(true);
                      setTimeout(() => setConfirmClear(false), 4000);
                      return;
                    }
                    await clearAll();
                    setConfirmClear(false);
                    setStorage(await estimateStorage());
                  }}
                  className={[
                    'rounded-xl px-3 py-2 font-mono text-[11px] transition-colors',
                    confirmClear ? 'bg-seal text-paper' : 'text-seal hover:bg-seal/10',
                  ].join(' ')}
                >
                  {confirmClear ? 'tap again to erase everything' : 'clear shelf & words'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirmRepair) {
                      setConfirmRepair(true);
                      setTimeout(() => setConfirmRepair(false), 4000);
                      return;
                    }
                    // Fresh-start for a stuck install: drop the service worker
                    // and every cache so the next load is guaranteed to be the
                    // newest build, and wipe stale quota/capability snapshots.
                    // Keys and the shelf are kept.
                    try {
                      const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
                      await Promise.all(regs.map((r) => r.unregister()));
                      for (const name of await caches.keys()) await caches.delete(name);
                      for (const k of Object.keys(localStorage)) {
                        if (k.startsWith('booklens.ledger.') || k.startsWith('booklens.caps.')) {
                          localStorage.removeItem(k);
                        }
                      }
                    } catch {
                      /* best effort — the reload is the important part */
                    }
                    location.reload();
                  }}
                  className={[
                    'rounded-xl px-3 py-2 font-mono text-[11px] transition-colors',
                    confirmRepair ? 'bg-seal text-paper' : 'text-seal hover:bg-seal/10',
                  ].join(' ')}
                >
                  {confirmRepair ? 'tap again to repair & reload' : 'repair app'}
                </button>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-graphite">
                If scans ever feel stuck, repair clears the app's cached copy and reloads the latest
                version. Your keys and shelf stay put.
              </p>
            </Section>

            <p className="mt-6 font-mono text-[10px] leading-relaxed text-graphite/60">
              书镜 BookLens · build {__BOOKLENS_BUILD__.slice(0, 7)} · everything runs in this
              browser · no server, no account
            </p>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function ChainRow({ chain, primary }: { chain: typeof PRIMARY_CHAIN; primary?: boolean }) {
  const mode = modeForChain(chain.models);
  return (
    <div className="mb-2 rounded-xl border border-paper-line px-3 py-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-ink">
          {chain.label}
          {primary ? (
            <span className="ml-1.5 font-mono text-[9px] tracking-wide text-seal uppercase">
              default
            </span>
          ) : (
            <span className="ml-1.5 font-mono text-[9px] tracking-wide text-graphite/60 uppercase">
              backup
            </span>
          )}
        </span>
        <span className="font-mono text-[9.5px] text-graphite/70">{mode}</span>
      </div>
      <ol className="mt-1.5 space-y-0.5">
        {chain.models.map((m, i) => (
          <li key={m} className="flex gap-2 font-mono text-[10px] text-graphite">
            <span className="text-graphite/50">{i + 1}</span>
            <span className="truncate">{m}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7">
      <h2 className="mb-2.5 flex items-baseline gap-2">
        <span aria-hidden className="h-1.5 w-1.5 translate-y-[-1px] rotate-45 bg-seal/80" />
        <span className="font-mono text-[10px] tracking-[0.18em] text-graphite/70 uppercase">
          {title}
        </span>
        <span className="han text-[12px] text-graphite/50">{sub}</span>
      </h2>
      {children}
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1.5">
        <span className="text-[13.5px] text-ink">{label}</span>
        {hint ? <span className="ml-2 text-[11.5px] text-graphite">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className="mb-3 flex w-full items-center justify-between gap-3 text-left"
    >
      <span>
        <span className="block text-[13.5px] text-ink">{label}</span>
        {hint ? <span className="block text-[11.5px] text-graphite">{hint}</span> : null}
      </span>
      <span
        className={[
          'relative h-6 w-10 shrink-0 rounded-full transition-colors',
          value ? 'bg-seal' : 'bg-paper-line',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 h-5 w-5 rounded-full bg-paper transition-transform',
            value ? 'translate-x-[1.125rem]' : 'translate-x-0.5',
          ].join(' ')}
        />
      </span>
    </button>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: Array<[string, string]>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={[
            'rounded-lg px-2.5 py-1 text-[11.5px] transition-colors',
            value === key ? 'bg-seal text-paper' : 'bg-paper-deep text-graphite hover:bg-paper-line',
          ].join(' ')}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export { levelLabel };

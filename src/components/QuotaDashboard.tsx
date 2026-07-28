import { useEffect, useState } from 'react';
import { keychain } from '../lib/openrouter/keychain';
import { maskKey } from '../lib/openrouter/keychain';
import { useKeyHealth, useKeyTester } from '../hooks/useKeychain';

function countdown(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const s = Math.ceil(ms / 1000);
  if (s <= 0) return 'ready';
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.ceil(m / 60)}h`;
}

const DOT: Record<string, string> = {
  healthy: 'bg-jade',
  cooling: 'bg-amber',
  'quota-exhausted': 'bg-amber',
  invalid: 'bg-seal',
};

/**
 * Live view of every key: what's left today, what's left this minute, and when
 * a spent key comes back. Making the budget visible is what stops "it stopped
 * working" from being a mystery.
 */
export function QuotaDashboard() {
  const [tick, setTick] = useState(0);
  const keys = useKeyHealth(tick);
  const { test, state, messages } = useKeyTester();
  const [draft, setDraft] = useState('');
  const [dragging, setDragging] = useState<number | null>(null);

  // Countdowns need to move even when nothing else changes.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Re-check usage when the tab regains focus — the numbers may have moved.
  useEffect(() => {
    const onFocus = () => keychain.list().forEach((k) => k.status !== 'invalid' && void test(k));
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [test]);

  const addKey = () => {
    const value = draft.trim();
    if (!value) return;
    const record = keychain.add(value);
    setDraft('');
    void test(record);
  };

  const totalToday = keys.reduce((n, k) => n + k.quota.dayUsed, 0);
  const totalLimit = keys.reduce((n, k) => n + (k.status === 'invalid' ? 0 : k.quota.dayLimit), 0);

  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between">
        <h3 className="font-mono text-[10px] tracking-[0.18em] text-graphite/70 uppercase">
          openrouter keys
        </h3>
        {keys.length ? (
          <span className="font-mono text-[10px] text-graphite">
            {totalToday}/{totalLimit} today
          </span>
        ) : null}
      </div>

      <div className="space-y-1.5">
        {keys.map((k, i) => {
          const dayPct = Math.min(100, (k.quota.dayUsed / Math.max(1, k.quota.dayLimit)) * 100);
          const testState = state[k.id];
          return (
            <div
              key={k.id}
              draggable
              onDragStart={() => setDragging(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragging !== null && dragging !== i) keychain.reorder(dragging, i);
                setDragging(null);
              }}
              className="rounded-xl border border-paper-line bg-paper px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${DOT[k.status] ?? 'bg-graphite'}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                  {k.label}{' '}
                  <span className="font-mono text-[10px] text-graphite/70">{maskKey(k.key)}</span>
                </span>
                <span className="font-mono text-[9px] tracking-wide text-graphite/60 uppercase">
                  #{i + 1}
                </span>
              </div>

              <div className="mt-2 h-1 overflow-hidden rounded-full bg-paper-deep">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${
                    dayPct > 85 ? 'bg-seal' : dayPct > 55 ? 'bg-amber' : 'bg-jade'
                  }`}
                  style={{ width: `${dayPct}%` }}
                />
              </div>

              <div className="mt-1.5 flex items-center justify-between font-mono text-[9.5px] text-graphite">
                <span>
                  today {k.quota.dayUsed}/{k.quota.dayLimit} · min {k.quota.minuteUsed}/
                  {k.quota.minuteLimit}
                </span>
                <span>
                  {k.status === 'invalid'
                    ? 'rejected'
                    : k.readyIn > 0
                      ? `back in ${countdown(k.readyIn)}`
                      : 'ready'}
                </span>
              </div>

              {messages[k.id] ? (
                <p
                  className={`mt-1 text-[11px] ${
                    testState === 'failed' ? 'text-seal' : 'text-graphite'
                  }`}
                >
                  {messages[k.id]}
                </p>
              ) : null}

              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => void test(k)}
                  disabled={testState === 'testing'}
                  className="rounded-lg bg-paper-deep px-2.5 py-1 font-mono text-[10px] text-graphite transition-colors hover:bg-paper-line disabled:opacity-50"
                >
                  {testState === 'testing' ? 'testing…' : 'test'}
                </button>
                {k.status === 'invalid' ? (
                  <button
                    type="button"
                    onClick={() => keychain.revive(k.id)}
                    className="rounded-lg bg-paper-deep px-2.5 py-1 font-mono text-[10px] text-graphite hover:bg-paper-line"
                  >
                    retry
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => keychain.remove(k.id)}
                  className="ml-auto rounded-lg px-2.5 py-1 font-mono text-[10px] text-seal hover:bg-seal/10"
                >
                  remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2.5 flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addKey()}
          placeholder="sk-or-v1-…"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-xl border border-paper-line bg-paper px-3 py-2 font-mono text-[12px] text-ink placeholder:text-graphite/40 focus:border-seal focus:outline-none"
        />
        <button
          type="button"
          onClick={addKey}
          disabled={!draft.trim()}
          className="rounded-xl bg-ink px-3.5 py-2 font-mono text-[11px] text-paper transition-colors hover:bg-seal disabled:opacity-40"
        >
          add
        </button>
      </div>

      <p className="mt-2 text-[11.5px] leading-relaxed text-graphite">
        Free tier is 50 scans a day per key.{' '}
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noreferrer"
          className="text-seal underline underline-offset-2"
        >
          Get a key
        </a>
        {' — '}a second one doubles it. Keys stay on this device and are sent only to OpenRouter.
        Drag to reorder; the top key is tried first.
      </p>
    </div>
  );
}

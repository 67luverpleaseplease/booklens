import { useEffect, useState } from 'react';
import { useKeys } from './useKeychain';
import { keychain } from '../lib/openrouter/keychain';
import { ledger } from '../lib/openrouter/ledger';

export type QuotaSummary = {
  used: number;
  limit: number;
  keyCount: number;
  /** Keys that could serve a request right now. */
  readyCount: number;
  /** ms until the first key frees up, when none are ready. */
  readyIn: number | null;
};

/**
 * Whole-account budget, refreshed on a timer so the pip counts down without the
 * keychain having to change.
 */
export function useQuotaSummary(): QuotaSummary {
  const keys = useKeys();
  const [, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);

  const now = Date.now();
  let used = 0;
  let limit = 0;
  for (const k of keys) {
    if (k.status === 'invalid') continue;
    const snap = ledger.snapshot(k.id, k.limits, now);
    used += snap.dayUsed;
    limit += snap.dayLimit;
  }

  const ready = keychain.available(now);
  const nextAt = keychain.nextAvailableAt(now);

  return {
    used,
    limit,
    keyCount: keys.length,
    readyCount: ready.length,
    readyIn: ready.length > 0 || nextAt === null ? null : Math.max(0, nextAt - now),
  };
}

/**
 * Online/offline. `navigator.onLine` only reports whether the machine has a
 * network interface, not whether anything is reachable — but a false negative
 * here just means we let the request fail with a real error instead, which is
 * the safer direction.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}

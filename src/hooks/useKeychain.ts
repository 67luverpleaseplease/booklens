import { useSyncExternalStore, useCallback, useState } from 'react';
import { keychain, type KeyRecord } from '../lib/openrouter/keychain';
import { ledger, type QuotaSnapshot } from '../lib/openrouter/ledger';
import { fetchKeyInfo } from '../lib/openrouter/client';
import { classifyThrown, humanize } from '../lib/openrouter/errors';

/** Live view of the key list, re-rendering whenever the chain changes. */
export function useKeys(): readonly KeyRecord[] {
  return useSyncExternalStore(
    (cb) => keychain.subscribe(cb),
    () => keychain.list(),
    () => keychain.list(),
  );
}

export type KeyHealth = KeyRecord & {
  quota: QuotaSnapshot;
  /** ms until this key can be used again; 0 when it's ready now. */
  readyIn: number;
};

export function useKeyHealth(tick = 0): KeyHealth[] {
  const keys = useKeys();
  // `tick` is a caller-supplied counter that forces a recompute on a timer, so
  // countdowns move without the keychain itself changing.
  void tick;
  const now = Date.now();
  return keys.map((k) => {
    const quota = ledger.snapshot(k.id, k.limits, now);
    const dayBlocked = quota.dayUsed >= quota.dayLimit;
    const readyAt = Math.max(
      k.cooldownUntil,
      dayBlocked ? quota.dayResetAt : now + quota.minuteFreeIn,
    );
    return { ...k, quota, readyIn: k.status === 'invalid' ? Infinity : Math.max(0, readyAt - now) };
  });
}

export type TestState = 'idle' | 'testing' | 'ok' | 'failed';

/** Verify a key against GET /api/v1/key and record what we learn. */
export function useKeyTester() {
  const [state, setState] = useState<Record<string, TestState>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});

  const test = useCallback(async (record: KeyRecord) => {
    setState((s) => ({ ...s, [record.id]: 'testing' }));
    try {
      const info = await fetchKeyInfo(record.key);
      // `rate_limit` is deprecated by OpenRouter and its interval is not
      // necessarily one minute. Keep our documented RPM; use account tier for
      // the daily free-model limit.
      const rpd = info.isFreeTier ? 50 : 1000;
      const rpm = record.limits.rpm;
      // Older BookLens versions could poison this minute window when GET /key
      // itself returned 429. A successful verification clears that stale mark.
      ledger.clearMinute(record.id);
      keychain.update(record.id, {
        status: 'healthy',
        cooldownUntil: 0,
        failCount: 0,
        lastError: undefined,
        limits: { rpm, rpd },
        usage: { usage: info.usage, limit: info.limit, isFreeTier: info.isFreeTier },
        label: record.label === 'key' && info.label ? info.label : record.label,
      });
      setState((s) => ({ ...s, [record.id]: 'ok' }));
      setMessages((m) => ({
        ...m,
        [record.id]: info.isFreeTier ? 'Free tier — works.' : 'Has credits — works.',
      }));
    } catch (err) {
      const failure = classifyThrown(err);
      keychain.reportVerificationFailure(record.id, failure);
      setState((s) => ({ ...s, [record.id]: 'failed' }));
      setMessages((m) => ({ ...m, [record.id]: humanize(failure) }));
    }
  }, []);

  return { test, state, messages };
}

/**
 * Local quota accounting.
 *
 * OpenRouter's free tier publishes its limits (20 req/min, 50 req/day), so
 * spending a network round-trip just to *discover* a 429 is waste we can avoid.
 * We count locally, skip keys we know are spent, and let a real 429 correct us
 * when our estimate drifts.
 */

const STORAGE_KEY = 'booklens.ledger.v1';
const MINUTE_MS = 60_000;

export type KeyLimits = { rpm: number; rpd: number };

/** OpenRouter free-tier defaults, until GET /api/v1/key tells us otherwise. */
export const DEFAULT_LIMITS: KeyLimits = { rpm: 20, rpd: 50 };

export type QuotaState = {
  /** Request timestamps inside the current sliding minute. */
  minuteWindow: number[];
  dayCount: number;
  /** Epoch ms of the next daily reset (OpenRouter resets at UTC midnight). */
  dayResetAt: number;
};

export type QuotaSnapshot = {
  minuteUsed: number;
  minuteLimit: number;
  dayUsed: number;
  dayLimit: number;
  /** ms until the sliding minute frees up a slot; 0 if there's room now. */
  minuteFreeIn: number;
  dayResetAt: number;
};

export function nextUtcMidnight(from = Date.now()): number {
  const d = new Date(from);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
}

function emptyState(now = Date.now()): QuotaState {
  return { minuteWindow: [], dayCount: 0, dayResetAt: nextUtcMidnight(now) };
}

/**
 * Drops timestamps older than the sliding window and rolls the daily counter
 * when the reset time has passed. Mutates in place and returns the same object
 * so callers can prune-then-read without an extra allocation.
 */
function prune(state: QuotaState, now: number): QuotaState {
  const cutoff = now - MINUTE_MS;
  if (state.minuteWindow.length && state.minuteWindow[0] <= cutoff) {
    // Timestamps are appended in order, so a single scan from the front is enough.
    let i = 0;
    while (i < state.minuteWindow.length && state.minuteWindow[i] <= cutoff) i++;
    state.minuteWindow.splice(0, i);
  }
  if (now >= state.dayResetAt) {
    state.dayCount = 0;
    state.dayResetAt = nextUtcMidnight(now);
  }
  return state;
}

export class QuotaLedger {
  private states = new Map<string, QuotaState>();
  private persist: boolean;

  constructor(opts: { persist?: boolean } = {}) {
    this.persist = opts.persist ?? true;
    if (this.persist) this.load();
  }

  private stateFor(keyId: string, now: number): QuotaState {
    let s = this.states.get(keyId);
    if (!s) {
      s = emptyState(now);
      this.states.set(keyId, s);
    }
    return prune(s, now);
  }

  /** Can this key take another request right now? */
  hasRoom(keyId: string, limits: KeyLimits, now = Date.now()): boolean {
    const s = this.stateFor(keyId, now);
    return s.minuteWindow.length < limits.rpm && s.dayCount < limits.rpd;
  }

  /** Record that a request was actually sent. */
  record(keyId: string, now = Date.now()): void {
    const s = this.stateFor(keyId, now);
    s.minuteWindow.push(now);
    s.dayCount += 1;
    this.save();
  }

  /**
   * A real 429 means our local count was optimistic — saturate the minute
   * window so we stop trying until it drains.
   */
  markRateLimited(keyId: string, limits: KeyLimits, now = Date.now()): void {
    const s = this.stateFor(keyId, now);
    while (s.minuteWindow.length < limits.rpm) s.minuteWindow.push(now);
    this.save();
  }

  /** A real 402 / daily-cap error means the day is done regardless of our count. */
  markDayExhausted(keyId: string, limits: KeyLimits, now = Date.now()): void {
    const s = this.stateFor(keyId, now);
    s.dayCount = Math.max(s.dayCount, limits.rpd);
    this.save();
  }

  snapshot(keyId: string, limits: KeyLimits, now = Date.now()): QuotaSnapshot {
    const s = this.stateFor(keyId, now);
    const oldest = s.minuteWindow[0];
    return {
      minuteUsed: s.minuteWindow.length,
      minuteLimit: limits.rpm,
      dayUsed: s.dayCount,
      dayLimit: limits.rpd,
      minuteFreeIn:
        s.minuteWindow.length < limits.rpm || oldest === undefined
          ? 0
          : Math.max(0, oldest + MINUTE_MS - now),
      dayResetAt: s.dayResetAt,
    };
  }

  reset(keyId?: string): void {
    if (keyId) this.states.delete(keyId);
    else this.states.clear();
    this.save();
  }

  // --- persistence ------------------------------------------------------

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, QuotaState>;
      const now = Date.now();
      for (const [id, s] of Object.entries(parsed)) {
        if (!s || !Array.isArray(s.minuteWindow)) continue;
        this.states.set(id, prune({ ...s }, now));
      }
    } catch {
      // A corrupt ledger is not worth failing the app over — start clean.
    }
  }

  private save(): void {
    if (!this.persist) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.states)));
    } catch {
      // Private mode or a full quota — counting in memory still works.
    }
  }
}

export const ledger = new QuotaLedger();

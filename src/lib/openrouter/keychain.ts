/**
 * The key chain: rotate across your OpenRouter keys so one exhausted key
 * doesn't stop the app.
 *
 * Order is priority — keys are tried top-down, and the user drags to reorder.
 * A key is skipped without a network call when the local ledger already knows
 * it's spent (see ledger.ts); it's only marked from a real response when the
 * server disagrees with us.
 */

import { DEFAULT_LIMITS, ledger, nextUtcMidnight, type KeyLimits } from './ledger';
import type { RequestFailure } from './errors';

export type KeyStatus = 'healthy' | 'cooling' | 'quota-exhausted' | 'invalid';

export type KeyRecord = {
  id: string;
  label: string;
  key: string;
  status: KeyStatus;
  /** Epoch ms; requests are not attempted before this. */
  cooldownUntil: number;
  failCount: number;
  limits: KeyLimits;
  lastError?: string;
  /** Filled in from GET /api/v1/key. */
  usage?: { usage: number; limit: number | null; isFreeTier: boolean };
};

const STORAGE_KEY = 'booklens.keys.v1';
const OBFUSCATION_PAD = 'booklens';
const MIN_COOLDOWN_MS = 20_000;

/**
 * XOR + base64. This is deliberately NOT encryption — it only stops a key from
 * sitting in plain sight in devtools or a synced localStorage dump. Anyone with
 * access to the device can recover it, and the README says so.
 */
function obfuscate(plain: string): string {
  let out = '';
  for (let i = 0; i < plain.length; i++) {
    out += String.fromCharCode(plain.charCodeAt(i) ^ OBFUSCATION_PAD.charCodeAt(i % OBFUSCATION_PAD.length));
  }
  return btoa(unescape(encodeURIComponent(out)));
}

function deobfuscate(stored: string): string {
  try {
    const raw = decodeURIComponent(escape(atob(stored)));
    let out = '';
    for (let i = 0; i < raw.length; i++) {
      out += String.fromCharCode(raw.charCodeAt(i) ^ OBFUSCATION_PAD.charCodeAt(i % OBFUSCATION_PAD.length));
    }
    return out;
  } catch {
    return '';
  }
}

export function newKeyRecord(key: string, label?: string): KeyRecord {
  return {
    id: crypto.randomUUID(),
    label: label?.trim() || 'key',
    key: key.trim(),
    status: 'healthy',
    cooldownUntil: 0,
    failCount: 0,
    limits: { ...DEFAULT_LIMITS },
  };
}

/** Last 4 characters, for showing a key without showing the key. */
export function maskKey(key: string): string {
  const tail = key.slice(-4);
  return tail ? `····${tail}` : '····';
}

export class Keychain {
  private keys: KeyRecord[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    this.load();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.save();
    for (const fn of this.listeners) fn();
  }

  list(): readonly KeyRecord[] {
    return this.keys;
  }

  add(key: string, label?: string): KeyRecord {
    const rec = newKeyRecord(key, label ?? `key ${this.keys.length + 1}`);
    this.keys.push(rec);
    this.emit();
    return rec;
  }

  remove(id: string): void {
    this.keys = this.keys.filter((k) => k.id !== id);
    ledger.reset(id);
    this.emit();
  }

  update(id: string, patch: Partial<KeyRecord>): void {
    const k = this.keys.find((x) => x.id === id);
    if (!k) return;
    Object.assign(k, patch);
    this.emit();
  }

  /** Move a key to a new index — order is priority. */
  reorder(from: number, to: number): void {
    if (from === to || from < 0 || from >= this.keys.length) return;
    const [moved] = this.keys.splice(from, 1);
    this.keys.splice(Math.max(0, Math.min(to, this.keys.length)), 0, moved);
    this.emit();
  }

  /**
   * Keys worth trying right now, in priority order. Invalid keys never come
   * back; cooling and quota-spent keys reappear once their clock runs out.
   */
  available(now = Date.now()): KeyRecord[] {
    return this.keys.filter((k) => {
      if (k.status === 'invalid') return false;
      if (now < k.cooldownUntil) return false;
      return ledger.hasRoom(k.id, k.limits, now);
    });
  }

  /**
   * When nothing is available, this is when the first key comes back — used to
   * show a countdown instead of a dead end.
   */
  nextAvailableAt(now = Date.now()): number | null {
    let soonest = Infinity;
    for (const k of this.keys) {
      if (k.status === 'invalid') continue;
      const snap = ledger.snapshot(k.id, k.limits, now);
      const dayBlocked = snap.dayUsed >= snap.dayLimit;
      const at = Math.max(
        k.cooldownUntil,
        dayBlocked ? snap.dayResetAt : now + snap.minuteFreeIn,
      );
      if (at < soonest) soonest = at;
    }
    return Number.isFinite(soonest) ? soonest : null;
  }

  /** Called after every attempt so the chain learns from real responses. */
  reportFailure(id: string, failure: RequestFailure, now = Date.now()): void {
    const k = this.keys.find((x) => x.id === id);
    if (!k) return;
    k.failCount += 1;
    k.lastError = failure.message;

    switch (failure.kind) {
      case 'rate-limited': {
        const waitMs = Math.max(MIN_COOLDOWN_MS, (failure.retryAfter ?? 0) * 1000);
        k.status = 'cooling';
        k.cooldownUntil = now + waitMs;
        ledger.markRateLimited(k.id, k.limits, now);
        break;
      }
      case 'quota-exhausted':
        k.status = 'quota-exhausted';
        k.cooldownUntil = nextUtcMidnight(now);
        ledger.markDayExhausted(k.id, k.limits, now);
        break;
      case 'invalid-key':
        k.status = 'invalid';
        k.cooldownUntil = Number.MAX_SAFE_INTEGER;
        break;
      default:
        // Upstream and network problems say nothing about the key itself.
        break;
    }
    this.emit();
  }

  /**
   * GET /key has its own throttling. Only an auth rejection proves inference
   * cannot use this key; temporary metadata errors must not poison scan quota.
   */
  reportVerificationFailure(id: string, failure: RequestFailure): void {
    if (failure.kind === 'invalid-key') {
      this.reportFailure(id, failure);
      return;
    }
    const k = this.keys.find((x) => x.id === id);
    if (!k) return;
    k.failCount += 1;
    k.lastError = failure.message;
    this.emit();
  }

  reportSuccess(id: string): void {
    const k = this.keys.find((x) => x.id === id);
    if (!k) return;
    k.failCount = 0;
    k.lastError = undefined;
    k.status = 'healthy';
    k.cooldownUntil = 0;
    this.emit();
  }

  /** Clear a manual "invalid" verdict so the user can retry after editing. */
  revive(id: string): void {
    this.update(id, { status: 'healthy', cooldownUntil: 0, failCount: 0, lastError: undefined });
  }

  // --- persistence ------------------------------------------------------

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Array<KeyRecord & { key: string }>;
      const now = Date.now();
      this.keys = parsed
        .map((k) => ({
          ...k,
          key: deobfuscate(k.key),
          limits: k.limits ?? { ...DEFAULT_LIMITS },
          // Cooldowns and quota verdicts are session-scoped — most were stamped
          // during one bad evening of provider congestion, and persisting them
          // only makes a healthy key look dead on the dashboard. The ledger is
          // the real gate for quota; 'invalid' (a genuine 401) is the only
          // verdict worth carrying across sessions.
          status: k.status === 'invalid' ? ('invalid' as const) : ('healthy' as const),
          cooldownUntil: k.status === 'invalid' ? Number.MAX_SAFE_INTEGER : Math.min(k.cooldownUntil ?? 0, now),
        }))
        .filter((k) => k.key);
    } catch {
      this.keys = [];
    }
  }

  private save(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(this.keys.map((k) => ({ ...k, key: obfuscate(k.key) }))),
      );
    } catch {
      // Private mode — keys stay in memory for this session.
    }
  }
}

export const keychain = new Keychain();

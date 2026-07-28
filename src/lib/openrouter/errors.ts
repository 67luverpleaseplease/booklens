/**
 * OpenRouter returns the same envelope on every endpoint:
 *   {"error":{"message":"…","code":401}}
 * (verified against /api/v1/key and /api/v1/chat/completions)
 * so one classifier covers the whole surface.
 */

export type FailureKind =
  | 'rate-limited' // 429 — transient, cools off
  | 'quota-exhausted' // 402 / daily cap — cools until reset
  | 'invalid-key' // 401 / 403 — never retry this key
  | 'bad-request' // 400 / 422 — our fault, retrying won't help
  | 'upstream' // 5xx / 502-from-provider — retry same key once
  | 'network' // fetch threw — retry same key once
  | 'no-content'; // 200 but nothing usable in the body

export class RequestFailure extends Error {
  readonly kind: FailureKind;
  readonly status: number;
  /** Seconds the server asked us to wait, when it said so. */
  readonly retryAfter?: number;

  constructor(kind: FailureKind, status: number, message: string, retryAfter?: number) {
    super(message);
    this.name = 'RequestFailure';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
  }

  /** True when moving to a different key could plausibly succeed. */
  get shouldRotateKey(): boolean {
    return (
      this.kind === 'rate-limited' ||
      this.kind === 'quota-exhausted' ||
      this.kind === 'invalid-key'
    );
  }

  /** True when hitting the same key again is worth one shot. */
  get shouldRetrySameKey(): boolean {
    return this.kind === 'upstream' || this.kind === 'network';
  }
}

function readRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (raw) {
    const secs = Number(raw);
    if (Number.isFinite(secs)) return secs;
    const at = Date.parse(raw);
    if (Number.isFinite(at)) return Math.max(0, (at - Date.now()) / 1000);
  }
  // OpenRouter also exposes an epoch-millis reset on rate-limited responses.
  const reset = headers.get('x-ratelimit-reset');
  if (reset) {
    const at = Number(reset);
    if (Number.isFinite(at) && at > Date.now()) return (at - Date.now()) / 1000;
  }
  return undefined;
}

/** Pull the human-readable message out of whatever shape the body arrived in. */
export function extractMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim()) return body.slice(0, 400);
  if (body && typeof body === 'object') {
    const err = (body as Record<string, unknown>).error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const m = (err as Record<string, unknown>).message;
      if (typeof m === 'string' && m) return m;
    }
    const m = (body as Record<string, unknown>).message;
    if (typeof m === 'string' && m) return m;
  }
  return fallback;
}

/**
 * Some 200-OK responses carry a provider error inside the payload rather than
 * in the HTTP status. Callers pass the parsed body so we can catch those too.
 */
export function classifyResponse(res: Response, body: unknown): RequestFailure | null {
  const retryAfter = readRetryAfter(res.headers);
  const message = extractMessage(body, res.statusText || `HTTP ${res.status}`);

  if (res.ok) {
    // A 200 that still contains an `error` object — OpenRouter does this when an
    // upstream provider fails after the request was accepted.
    if (body && typeof body === 'object' && 'error' in (body as object)) {
      const inner = (body as { error?: { code?: unknown } }).error;
      const code = Number(inner?.code);
      if (Number.isFinite(code) && code >= 400) {
        return classifyStatus(code, message, retryAfter);
      }
      return new RequestFailure('upstream', 502, message, retryAfter);
    }
    return null;
  }

  return classifyStatus(res.status, message, retryAfter);
}

function classifyStatus(status: number, message: string, retryAfter?: number): RequestFailure {
  if (status === 429) return new RequestFailure('rate-limited', status, message, retryAfter);
  if (status === 402) return new RequestFailure('quota-exhausted', status, message, retryAfter);
  if (status === 401 || status === 403)
    return new RequestFailure('invalid-key', status, message, retryAfter);
  if (status >= 500) return new RequestFailure('upstream', status, message, retryAfter);

  // A 400 whose message mentions credits or limits is really a quota problem
  // wearing the wrong status code — providers are inconsistent about this.
  if (/\b(quota|credit|insufficient|limit reached|exceeded)\b/i.test(message)) {
    return new RequestFailure('quota-exhausted', status, message, retryAfter);
  }
  return new RequestFailure('bad-request', status, message, retryAfter);
}

export function classifyThrown(err: unknown): RequestFailure {
  if (err instanceof RequestFailure) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new RequestFailure('network', 0, 'Request was cancelled.');
  }
  return new RequestFailure('network', 0, message || 'Network request failed.');
}

/** Short, non-technical text for the UI. */
export function humanize(f: RequestFailure): string {
  switch (f.kind) {
    case 'rate-limited':
      return 'That key hit its per-minute limit.';
    case 'quota-exhausted':
      return "That key is out of requests for today.";
    case 'invalid-key':
      return 'That key was rejected — check it in Settings.';
    case 'bad-request':
      return `The request was rejected: ${f.message}`;
    case 'upstream':
      return 'The model provider had a problem.';
    case 'network':
      return 'No connection.';
    case 'no-content':
      return 'The model returned an empty response.';
  }
}

/**
 * The transport.
 *
 * Everything the app sends to OpenRouter goes through `chatComplete`, which
 * owns the four defences that keep a free-tier account usable:
 *
 *   ① ledger    — skip a key we already know is spent, with no network call
 *   ② chain     — `models[]`, walked server-side, one request for N models
 *   ③ rotation  — move to the next key on 429 / 402 / 401
 *   ④ same-key retry — one shot with jitter on a 5xx or a dropped connection
 */

import { OPENROUTER_BASE, type ModelChain } from './chains';
import { classifyResponse, classifyThrown, RequestFailure } from './errors';
import { keychain, type KeyRecord } from './keychain';
import { ledger } from './ledger';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | unknown[];
};

export type ChatRequest = {
  chain: ModelChain;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Extra body fields — `response_format`, `tools`, `tool_choice`. */
  extra?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Per-attempt timeout; defaults to ATTEMPT_TIMEOUT_MS. Tests shrink it. */
  timeoutMs?: number;
  /** Fires whenever the transport moves to a different key. */
  onKeyChange?: (key: KeyRecord, attempt: number) => void;
};

export type ChatResponse = {
  /** Raw text or tool-call arguments — see repair.extractPayload. */
  choice: unknown;
  /** The model OpenRouter actually served, which may be a chain fallback. */
  model: string;
  keyId: string;
  generationId?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export class AllKeysUnavailable extends Error {
  /** Epoch ms when the first key frees up, if any ever will. */
  readonly nextAvailableAt: number | null;
  readonly reason: 'no-keys' | 'exhausted';
  readonly lastFailure?: RequestFailure;

  constructor(reason: 'no-keys' | 'exhausted', nextAvailableAt: number | null, last?: RequestFailure) {
    super(
      reason === 'no-keys'
        ? 'No OpenRouter key has been added yet.'
        : 'Every key is out of requests right now.',
    );
    this.name = 'AllKeysUnavailable';
    this.reason = reason;
    this.nextAvailableAt = nextAvailableAt;
    this.lastFailure = last;
  }
}

const REFERER = typeof location !== 'undefined' ? location.origin : 'https://booklens.local';

function headersFor(key: string): HeadersInit {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    // OpenRouter uses these for app attribution; both are in its allowed-headers list.
    'HTTP-Referer': REFERER,
    'X-Title': 'BookLens',
  };
}

/**
 * Failure kinds that never produced a completion, so OpenRouter never counted
 * them against the account. The local ledger mirrors the server: refund these.
 * (quota-exhausted and invalid-key are excluded deliberately — the verdict
 * itself is the information we want to keep.)
 */
const NON_BILLABLE: ReadonlySet<RequestFailure['kind']> = new Set([
  'network',
  'upstream',
  'provider-rate-limited',
  'rate-limited',
  'timeout',
  'no-content',
  'bad-request',
]);

/**
 * Free providers hang far more often than they fail fast, and a stalled
 * connection used to pin a scan on a spinner for minutes. Cap each attempt;
 * the normal retry/rotation machinery then takes over. 130s on purpose: the
 * reasoning-class backups legitimately think for ~100-120s before answering,
 * and cutting them earlier converts the only working fallback into a failure.
 */
export const ATTEMPT_TIMEOUT_MS = 130_000;

/**
 * AbortSignal.any without the iOS 17.2 requirement: one controller driven by
 * both the caller's signal and a timeout. The timeout aborts with a
 * TimeoutError so it reads as a stall, not as a user cancel.
 */
function combinedSignal(
  user: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort(new DOMException('The model took too long to answer.', 'TimeoutError'));
    } catch {
      controller.abort();
    }
  }, ms);
  if (user) {
    if (user.aborted) {
      clearTimeout(timer);
      controller.abort();
    } else {
      user.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * One HTTP attempt against one key. Throws RequestFailure on anything that
 * isn't a usable completion.
 */
async function attempt(
  key: KeyRecord,
  req: ChatRequest,
): Promise<ChatResponse> {
  const body: Record<string, unknown> = {
    // First element is the primary; OpenRouter falls through the rest itself.
    models: req.chain.models,
    route: 'fallback',
    messages: req.messages,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
    ...(req.extra ?? {}),
  };

  // The timeout covers the BODY too, not just the connection: providers send
  // headers early and then stream for minutes, and a stalled stream must not
  // pin the scan either.
  let res: Response;
  let parsed: unknown;
  const timeout = combinedSignal(req.signal, req.timeoutMs ?? ATTEMPT_TIMEOUT_MS);
  try {
    res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: headersFor(key.key),
      body: JSON.stringify(body),
      signal: timeout.signal,
    });
    parsed = await readBody(res);
  } catch (err) {
    throw classifyThrown(err);
  } finally {
    timeout.cancel();
  }

  const failure = classifyResponse(res, parsed);
  if (failure) throw failure;

  const payload = parsed as {
    choices?: unknown[];
    model?: string;
    id?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = payload.choices?.[0];
  if (!choice) {
    throw new RequestFailure('no-content', res.status, 'The model returned no choices.');
  }

  return {
    choice,
    model: payload.model ?? req.chain.models[0],
    keyId: key.id,
    generationId: payload.id,
    usage: payload.usage,
  };
}

/**
 * Run a chat completion, rotating keys as needed.
 *
 * Throws `AllKeysUnavailable` when nothing can be tried, and the last
 * `RequestFailure` when every key was tried and all of them failed.
 */
export async function chatComplete(req: ChatRequest): Promise<ChatResponse> {
  if (keychain.list().length === 0) {
    throw new AllKeysUnavailable('no-keys', null);
  }

  let lastFailure: RequestFailure | undefined;
  let attemptNo = 0;
  // Scoped per call — two scans running at once must not share this.
  const tried = new Set<string>();

  // Re-read availability each pass: a cooldown may expire mid-loop, and
  // reportFailure can move a key out of the pool as we go.
  for (;;) {
    const candidates = keychain.available();
    if (candidates.length === 0) break;

    // Only try each key once per call — otherwise a slow cooldown could spin.
    const key = candidates.find((k) => !tried.has(k.id));
    if (!key) break;
    tried.add(key.id);
    attemptNo += 1;
    req.onKeyChange?.(key, attemptNo);

    // The request is going out for real, so it counts against the budget.
    ledger.record(key.id);

    try {
      const out = await attempt(key, req);
      keychain.reportSuccess(key.id);
      return out;
    } catch (err) {
      const failure = err instanceof RequestFailure ? err : classifyThrown(err);
      if (failure.kind === 'network' && req.signal?.aborted) throw failure;
      lastFailure = failure;

      // ④ A 5xx or a dropped connection says nothing about the key — one retry.
      if (failure.shouldRetrySameKey) {
        // The failed attempt never produced a completion — hand its slot back
        // before the retry takes its own.
        if (NON_BILLABLE.has(failure.kind)) ledger.refund(key.id);
        try {
          await sleep(400 + Math.random() * 300, req.signal);
          ledger.record(key.id);
          const out = await attempt(key, req);
          keychain.reportSuccess(key.id);
          return out;
        } catch (retryErr) {
          const retryFailure =
            retryErr instanceof RequestFailure ? retryErr : classifyThrown(retryErr);
          if (retryFailure.kind === 'network' && req.signal?.aborted) throw retryFailure;
          lastFailure = retryFailure;
          keychain.reportFailure(key.id, retryFailure);
          if (NON_BILLABLE.has(retryFailure.kind)) ledger.refund(key.id);
          if (!retryFailure.shouldRotateKey && retryFailure.kind === 'bad-request') throw retryFailure;
          continue;
        }
      }

      keychain.reportFailure(key.id, failure);
      if (NON_BILLABLE.has(failure.kind)) ledger.refund(key.id);

      // A malformed request will fail identically on every key — stop early.
      if (failure.kind === 'bad-request') throw failure;
    }
  }

  if (lastFailure) throw lastFailure;
  throw new AllKeysUnavailable('exhausted', keychain.nextAvailableAt(), lastFailure);
}

// --- key info ------------------------------------------------------------

export type KeyInfo = {
  label: string;
  usage: number;
  limit: number | null;
  isFreeTier: boolean;
  rateLimit?: { requests: number; interval: string };
};

/**
 * GET /api/v1/key — real usage and limits for one key, so the dashboard shows
 * the server's numbers rather than only our local estimate. Throws a
 * RequestFailure the caller can hand to keychain.reportFailure.
 */
export async function fetchKeyInfo(key: string, signal?: AbortSignal): Promise<KeyInfo> {
  let res: Response;
  try {
    res = await fetch(`${OPENROUTER_BASE}/key`, { headers: headersFor(key), signal });
  } catch (err) {
    throw classifyThrown(err);
  }
  const body = await readBody(res);
  const failure = classifyResponse(res, body);
  if (failure) throw failure;

  const d = (body as { data?: Record<string, unknown> })?.data ?? {};
  const rl = d.rate_limit as { requests?: number; interval?: string } | undefined;
  return {
    label: typeof d.label === 'string' ? d.label : '',
    usage: Number(d.usage ?? 0),
    limit: d.limit === null || d.limit === undefined ? null : Number(d.limit),
    isFreeTier: Boolean(d.is_free_tier),
    rateLimit:
      rl && typeof rl.requests === 'number'
        ? { requests: rl.requests, interval: String(rl.interval ?? '') }
        : undefined,
  };
}

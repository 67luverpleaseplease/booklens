/**
 * The fallback chain, end to end: four keys, four different failures, and the
 * request still lands. This is the behaviour the whole app depends on.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Isolated module state per test — keychain and ledger are singletons that read
// localStorage at construction, so they have to be re-imported after a reset.
async function freshModules() {
  vi.resetModules();
  localStorage.clear();
  const [{ keychain }, { ledger }, client, { PRIMARY_CHAIN }] = await Promise.all([
    import('./keychain'),
    import('./ledger'),
    import('./client'),
    import('./chains'),
  ]);
  return { keychain, ledger, ...client, PRIMARY_CHAIN };
}

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

/** Route replies by the bearer token, so each key can fail its own way. */
function mockFetchByKey(replies: Record<string, Reply | Reply[]>) {
  const seen: string[] = [];
  const cursors: Record<string, number> = {};

  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '');
    const token = auth.replace('Bearer ', '');
    seen.push(token);

    const entry = replies[token];
    const reply = Array.isArray(entry)
      ? entry[Math.min(cursors[token] ?? 0, entry.length - 1)]
      : entry;
    if (Array.isArray(entry)) cursors[token] = (cursors[token] ?? 0) + 1;

    if (!reply) return new Response(JSON.stringify({ error: { message: 'unknown key' } }), { status: 401 });
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) },
    });
  });

  vi.stubGlobal('fetch', fn);
  return { seen, fn };
}

const okBody = {
  id: 'gen-1',
  model: 'google/gemma-4-31b-it:free',
  choices: [{ message: { content: '{"ok":true}' } }],
};

describe('key rotation', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('walks 429 → 402 → 401 → 200 in key order and succeeds on the fourth', async () => {
    const { keychain, PRIMARY_CHAIN, chatComplete } = await freshModules();
    keychain.add('key-a', 'a');
    keychain.add('key-b', 'b');
    keychain.add('key-c', 'c');
    keychain.add('key-d', 'd');

    const { seen } = mockFetchByKey({
      'key-a': { status: 429, body: { error: { message: 'rate limited', code: 429 } } },
      'key-b': { status: 402, body: { error: { message: 'no credits', code: 402 } } },
      'key-c': { status: 401, body: { error: { message: 'bad key', code: 401 } } },
      'key-d': { status: 200, body: okBody },
    });

    const out = await chatComplete({
      chain: PRIMARY_CHAIN,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(seen).toEqual(['key-a', 'key-b', 'key-c', 'key-d']);
    expect(out.model).toBe('google/gemma-4-31b-it:free');

    const [a, b, c, d] = keychain.list();
    expect(a.status).toBe('cooling');
    expect(b.status).toBe('quota-exhausted');
    expect(c.status).toBe('invalid');
    expect(d.status).toBe('healthy');
  });

  it('never retries a key it has marked invalid', async () => {
    const { keychain, PRIMARY_CHAIN, chatComplete } = await freshModules();
    keychain.add('key-bad', 'bad');
    keychain.add('key-good', 'good');

    const { seen } = mockFetchByKey({
      'key-bad': { status: 401, body: { error: { message: 'bad key', code: 401 } } },
      'key-good': { status: 200, body: okBody },
    });

    await chatComplete({ chain: PRIMARY_CHAIN, messages: [{ role: 'user', content: 'hi' }] });
    await chatComplete({ chain: PRIMARY_CHAIN, messages: [{ role: 'user', content: 'hi' }] });

    // The dead key is tried once, then dropped from the pool for good.
    expect(seen.filter((k) => k === 'key-bad')).toHaveLength(1);
    expect(seen.filter((k) => k === 'key-good')).toHaveLength(2);
  });

  it('retries the SAME key once on a 5xx before moving on', async () => {
    const { keychain, PRIMARY_CHAIN, chatComplete } = await freshModules();
    keychain.add('key-a', 'a');
    keychain.add('key-b', 'b');

    // First call 503, second call succeeds — the retry should catch it.
    const { seen } = mockFetchByKey({
      'key-a': [{ status: 503, body: { error: { message: 'upstream' } } }, { status: 200, body: okBody }],
      'key-b': { status: 200, body: okBody },
    });

    await chatComplete({ chain: PRIMARY_CHAIN, messages: [{ role: 'user', content: 'hi' }] });

    expect(seen).toEqual(['key-a', 'key-a']);
    expect(seen).not.toContain('key-b');
  });

  it('honours Retry-After when setting the cooldown', async () => {
    const { keychain, PRIMARY_CHAIN, chatComplete } = await freshModules();
    keychain.add('key-a', 'a');
    keychain.add('key-b', 'b');

    mockFetchByKey({
      'key-a': {
        status: 429,
        body: { error: { message: 'slow down', code: 429 } },
        headers: { 'retry-after': '90' },
      },
      'key-b': { status: 200, body: okBody },
    });

    const before = Date.now();
    await chatComplete({ chain: PRIMARY_CHAIN, messages: [{ role: 'user', content: 'hi' }] });

    const a = keychain.list()[0];
    // 90s from the server, not the 20s floor.
    expect(a.cooldownUntil).toBeGreaterThan(before + 85_000);
    expect(a.cooldownUntil).toBeLessThan(before + 95_000);
  });

  it('skips a key the ledger already knows is spent, with no network call', async () => {
    const { keychain, ledger, PRIMARY_CHAIN, chatComplete } = await freshModules();
    const a = keychain.add('key-a', 'a');
    keychain.add('key-b', 'b');

    // Burn key-a's daily allowance locally.
    ledger.markDayExhausted(a.id, a.limits);

    const { seen } = mockFetchByKey({
      'key-a': { status: 200, body: okBody },
      'key-b': { status: 200, body: okBody },
    });

    await chatComplete({ chain: PRIMARY_CHAIN, messages: [{ role: 'user', content: 'hi' }] });

    expect(seen).toEqual(['key-b']);
  });

  it('reports when no key has been added at all', async () => {
    const { PRIMARY_CHAIN, chatComplete, AllKeysUnavailable } = await freshModules();
    mockFetchByKey({});
    await expect(
      chatComplete({ chain: PRIMARY_CHAIN, messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(AllKeysUnavailable);
  });

  it('surfaces the last failure when every key fails', async () => {
    const { keychain, PRIMARY_CHAIN, chatComplete } = await freshModules();
    keychain.add('key-a', 'a');
    keychain.add('key-b', 'b');

    mockFetchByKey({
      'key-a': { status: 429, body: { error: { message: 'rate limited', code: 429 } } },
      'key-b': { status: 429, body: { error: { message: 'rate limited too', code: 429 } } },
    });

    await expect(
      chatComplete({ chain: PRIMARY_CHAIN, messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/rate limited too/);
  });

  it('stops immediately on a malformed request rather than burning every key', async () => {
    const { keychain, PRIMARY_CHAIN, chatComplete } = await freshModules();
    keychain.add('key-a', 'a');
    keychain.add('key-b', 'b');

    const { seen } = mockFetchByKey({
      'key-a': { status: 400, body: { error: { message: 'model does not support images' } } },
      'key-b': { status: 200, body: okBody },
    });

    await expect(
      chatComplete({ chain: PRIMARY_CHAIN, messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/does not support images/);
    // A bad body fails the same way everywhere — no point spending key-b on it.
    expect(seen).toEqual(['key-a']);
  });

  it('sends the whole model chain in one request, so N models cost 1 call', async () => {
    const { keychain, PRIMARY_CHAIN, chatComplete } = await freshModules();
    keychain.add('key-a', 'a');
    const { fn } = mockFetchByKey({ 'key-a': { status: 200, body: okBody } });

    await chatComplete({ chain: PRIMARY_CHAIN, messages: [{ role: 'user', content: 'hi' }] });

    expect(fn).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fn.mock.calls[0][1] as RequestInit).body));
    expect(body.models).toEqual(PRIMARY_CHAIN.models);
    expect(body.route).toBe('fallback');
  });

  it('counts one ledger entry per network attempt, including the 5xx retry', async () => {
    const { keychain, ledger, PRIMARY_CHAIN, chatComplete } = await freshModules();
    const a = keychain.add('key-a', 'a');
    mockFetchByKey({
      'key-a': [{ status: 503, body: { error: { message: 'boom' } } }, { status: 200, body: okBody }],
    });

    await chatComplete({ chain: PRIMARY_CHAIN, messages: [{ role: 'user', content: 'hi' }] });

    expect(ledger.snapshot(a.id, a.limits).dayUsed).toBe(2);
  });
});

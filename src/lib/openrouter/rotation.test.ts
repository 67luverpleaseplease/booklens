/**
 * The fallback chain, end to end: four keys, four different failures, and the
 * request still lands. This is the behaviour the whole app depends on.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RequestFailure } from './errors';

// Isolated module state per test — keychain and ledger are singletons that read
// localStorage at construction, so they have to be re-imported after a reset.
async function freshModules() {
  vi.resetModules();
  localStorage.clear();
  const [{ keychain }, { ledger }, client, { PRIMARY_CHAIN }, vision] = await Promise.all([
    import('./keychain'),
    import('./ledger'),
    import('./client'),
    import('./chains'),
    import('../vision/analyze'),
  ]);
  return { keychain, ledger, ...client, PRIMARY_CHAIN, ...vision };
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

  it('keeps a key healthy when only the upstream provider is rate-limited', async () => {
    const { keychain, PRIMARY_CHAIN, chatComplete } = await freshModules();
    const a = keychain.add('key-a', 'a');

    mockFetchByKey({
      'key-a': [
        {
          status: 429,
          body: {
            error: {
              message: 'Rate limit exceeded',
              code: 429,
              metadata: {
                error_type: 'rate_limit_exceeded',
                provider_code: 'rate_limited',
              },
            },
          },
        },
        { status: 200, body: okBody },
      ],
    });

    const req = { chain: PRIMARY_CHAIN, messages: [{ role: 'user' as const, content: 'hi' }] };
    await expect(chatComplete(req)).rejects.toMatchObject({ kind: 'provider-rate-limited' });

    expect(keychain.list()[0].status).toBe('healthy');
    expect(keychain.available()).toContain(a);

    await expect(chatComplete(req)).resolves.toMatchObject({ model: okBody.model });
  });

  it('falls through to the backup model family after a provider 429', async () => {
    const { keychain, analyze } = await freshModules();
    const a = keychain.add('key-a', 'a');
    const result = {
      detected: 'cover',
      confidence: 0.9,
      book: null,
      summaries: [
        {
          kind: 'hook',
          label_zh: '钩子',
          zh: '好书',
          pinyin: 'hǎo shū',
          en: 'A good book.',
          tokens: [
            { w: '好', py: 'hǎo', en: 'good' },
            { w: '书', py: 'shū', en: 'book' },
          ],
        },
      ],
      key_terms: [],
      talking_points: [],
      extracted_text: '',
      caveats: '',
    };

    const { seen } = mockFetchByKey({
      'key-a': [
        {
          status: 429,
          body: {
            error: {
              message: 'Rate limit exceeded',
              code: 429,
              metadata: {
                error_type: 'rate_limit_exceeded',
                provider_code: 'rate_limited',
              },
            },
          },
        },
        {
          status: 200,
          body: {
            ...okBody,
            model: 'nvidia/nemotron-nano-12b-v2-vl:free',
            choices: [{ message: { content: JSON.stringify(result) } }],
          },
        },
      ],
    });

    const outcome = await analyze({
      images: ['data:image/jpeg;base64,AA=='],
      intent: 'cover',
      level: 4,
    });

    expect(seen.filter(Boolean)).toEqual(['key-a', 'key-a']);
    expect(outcome.result.summaries[0].zh).toBe('好书');
    expect(keychain.available()).toContain(a);
  });

  it('does not poison inference availability when key metadata check gets a 429', async () => {
    const { keychain, PRIMARY_CHAIN } = await freshModules();
    const a = keychain.add('key-a', 'a');

    keychain.reportVerificationFailure(
      a.id,
      new RequestFailure('rate-limited', 429, 'Metadata endpoint rate limit'),
    );

    expect(keychain.available()).toContain(a);
    expect(keychain.list()[0].status).toBe('healthy');
    expect(PRIMARY_CHAIN.models.length).toBeGreaterThan(0);
  });

  it('still rejects a key when metadata verification gets a 401', async () => {
    const { keychain } = await freshModules();
    const a = keychain.add('key-a', 'a');

    keychain.reportVerificationFailure(
      a.id,
      new RequestFailure('invalid-key', 401, 'Invalid API key'),
    );

    expect(keychain.available()).not.toContain(a);
    expect(keychain.list()[0].status).toBe('invalid');
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

import { describe, it, expect, beforeEach } from 'vitest';
import { QuotaLedger, nextUtcMidnight, DEFAULT_LIMITS } from './ledger';
import { modeForChain, modeForModel, buildJsonRequestParts } from './jsonMode';
import { repairJson, extractPayload } from './repair';
import { classifyResponse, RequestFailure } from './errors';
import { PRIMARY_CHAIN, SECONDARY_CHAIN, capsFor } from './chains';

// --- ledger --------------------------------------------------------------

describe('QuotaLedger', () => {
  const limits = { rpm: 3, rpd: 5 };
  let l: QuotaLedger;
  beforeEach(() => {
    l = new QuotaLedger({ persist: false });
  });

  it('allows requests up to the per-minute cap, then blocks', () => {
    const t = 1_700_000_000_000;
    for (let i = 0; i < 3; i++) {
      expect(l.hasRoom('k', limits, t)).toBe(true);
      l.record('k', t);
    }
    expect(l.hasRoom('k', limits, t)).toBe(false);
  });

  it('frees a slot exactly when the oldest request leaves the sliding window', () => {
    const t = 1_700_000_000_000;
    for (let i = 0; i < 3; i++) l.record('k', t);
    // One millisecond before the window rolls, still blocked.
    expect(l.hasRoom('k', limits, t + 60_000 - 1)).toBe(false);
    // The window is inclusive of the cutoff, so at exactly +60s the slot is back.
    expect(l.hasRoom('k', limits, t + 60_000)).toBe(true);
  });

  it('resets the daily counter at UTC midnight', () => {
    const t = Date.UTC(2026, 6, 27, 23, 59, 0);
    for (let i = 0; i < 5; i++) l.record('k', t);
    expect(l.hasRoom('k', limits, t)).toBe(false);

    const afterMidnight = Date.UTC(2026, 6, 28, 0, 0, 1);
    expect(l.hasRoom('k', limits, afterMidnight)).toBe(true);
    expect(l.snapshot('k', limits, afterMidnight).dayUsed).toBe(0);
  });

  it('lets a real 429 override an optimistic local count', () => {
    const t = 1_700_000_000_000;
    l.record('k', t); // local count says there is plenty of room
    expect(l.hasRoom('k', limits, t)).toBe(true);

    l.markRateLimited('k', limits, t);
    expect(l.hasRoom('k', limits, t)).toBe(false);
    expect(l.snapshot('k', limits, t).minuteUsed).toBe(limits.rpm);
  });

  it('lets a real 402 burn the rest of the day', () => {
    const t = 1_700_000_000_000;
    l.markDayExhausted('k', limits, t);
    const snap = l.snapshot('k', limits, t);
    expect(snap.dayUsed).toBe(limits.rpd);
    expect(snap.dayResetAt).toBe(nextUtcMidnight(t));
  });

  it('reports how long until the minute window frees up', () => {
    const t = 1_700_000_000_000;
    for (let i = 0; i < 3; i++) l.record('k', t);
    expect(l.snapshot('k', limits, t + 20_000).minuteFreeIn).toBe(40_000);
  });

  it('tracks keys independently', () => {
    const t = 1_700_000_000_000;
    for (let i = 0; i < 3; i++) l.record('a', t);
    expect(l.hasRoom('a', limits, t)).toBe(false);
    expect(l.hasRoom('b', limits, t)).toBe(true);
  });

  it('defaults to the documented OpenRouter free-tier limits', () => {
    expect(DEFAULT_LIMITS).toEqual({ rpm: 20, rpd: 50 });
  });
});

// --- jsonMode ------------------------------------------------------------

describe('JSON mode selection', () => {
  it('gives gemma-4-31b json_object, never a strict schema', () => {
    // This model reports response_format but NOT structured_outputs. Sending it
    // a json_schema would be rejected outright, so this is the guard.
    const caps = capsFor('google/gemma-4-31b-it:free');
    expect(caps.supportsResponseFormat).toBe(true);
    expect(caps.supportsStructuredOutputs).toBe(false);
    expect(modeForModel('google/gemma-4-31b-it:free')).toBe('json_object');
  });

  it('gives gemma-4-26b the strict schema it does support', () => {
    expect(modeForModel('google/gemma-4-26b-a4b-it:free')).toBe('json_schema');
  });

  it('falls to tool mode for the nemotron VLMs', () => {
    expect(modeForModel('nvidia/nemotron-nano-12b-v2-vl:free')).toBe('tool');
  });

  it('pins a chain to the weakest member, because they share one body', () => {
    // The 31B is the floor here even though the other two support json_schema.
    expect(modeForChain(PRIMARY_CHAIN.models)).toBe('json_object');
    expect(modeForChain(SECONDARY_CHAIN.models)).toBe('tool');
  });

  it('treats an unknown model as the weakest possible', () => {
    expect(modeForChain(['someone/brand-new-model'])).toBe('prompt');
  });

  it('builds the right request fields for each mode', () => {
    const schema = { type: 'object', properties: {} };
    expect(buildJsonRequestParts('json_object', schema).response_format).toEqual({
      type: 'json_object',
    });

    const strict = buildJsonRequestParts('json_schema', schema);
    expect((strict.response_format as Record<string, never>).type).toBe('json_schema');

    const tool = buildJsonRequestParts('tool', schema, { name: 'scan_result' });
    expect(tool.tools).toHaveLength(1);
    expect(tool.tool_choice).toEqual({ type: 'function', function: { name: 'scan_result' } });

    expect(buildJsonRequestParts('prompt', schema)).toEqual({});
  });
});

// --- repair --------------------------------------------------------------

describe('repairJson', () => {
  it('parses clean JSON without claiming a repair', () => {
    const r = repairJson('{"a":1}');
    expect(r).toMatchObject({ ok: true, repaired: false });
  });

  it('unwraps a markdown fence', () => {
    const r = repairJson('```json\n{"a":1}\n```');
    expect(r.ok && r.value).toEqual({ a: 1 });
  });

  it('ignores prose before and after the object', () => {
    const r = repairJson('Here you go!\n{"a":1}\nHope that helps.');
    expect(r.ok && r.value).toEqual({ a: 1 });
  });

  it('drops trailing commas', () => {
    const r = repairJson('{"a":1,"b":[1,2,],}');
    expect(r.ok && r.value).toEqual({ a: 1, b: [1, 2] });
  });

  it('closes an object truncated by a token cap', () => {
    const r = repairJson('{"summaries":[{"zh":"这本书很好"');
    expect(r.ok).toBe(true);
    expect((r as { value: { summaries: unknown[] } }).value.summaries).toHaveLength(1);
  });

  it('does not mistake braces inside strings for structure', () => {
    const r = repairJson('{"note":"use {curly} braces","n":2}');
    expect(r.ok && r.value).toEqual({ note: 'use {curly} braces', n: 2 });
  });

  it('handles an unterminated fence', () => {
    const r = repairJson('```json\n{"a":1}');
    expect(r.ok && r.value).toEqual({ a: 1 });
  });

  it('fails honestly when there is no JSON at all', () => {
    expect(repairJson('I cannot help with that.').ok).toBe(false);
    expect(repairJson('').ok).toBe(false);
  });
});

describe('extractPayload', () => {
  it('reads plain content', () => {
    expect(extractPayload({ message: { content: '{"a":1}' } })).toBe('{"a":1}');
  });

  it('prefers tool-call arguments when present', () => {
    const choice = {
      message: {
        content: '',
        tool_calls: [{ function: { arguments: '{"a":2}' } }],
      },
    };
    expect(extractPayload(choice)).toBe('{"a":2}');
  });

  it('joins array-shaped content', () => {
    expect(extractPayload({ message: { content: [{ text: '{"a"' }, { text: ':1}' }] } })).toBe(
      '{"a":1}',
    );
  });

  it('returns empty string rather than throwing on junk', () => {
    expect(extractPayload(null)).toBe('');
    expect(extractPayload({})).toBe('');
  });
});

// --- error classification -------------------------------------------------

function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: status === 204 ? 204 : status, headers });
}

describe('classifyResponse', () => {
  const body = { error: { message: 'nope', code: 0 } };

  it('classifies 429 as rate-limited and reads Retry-After', () => {
    const f = classifyResponse(res(429, { 'retry-after': '42' }), body)!;
    expect(f.kind).toBe('rate-limited');
    expect(f.retryAfter).toBe(42);
    expect(f.shouldRotateKey).toBe(true);
  });

  it('classifies 402 as quota-exhausted', () => {
    expect(classifyResponse(res(402), body)!.kind).toBe('quota-exhausted');
  });

  it('classifies 401 and 403 as an invalid key', () => {
    expect(classifyResponse(res(401), body)!.kind).toBe('invalid-key');
    expect(classifyResponse(res(403), body)!.kind).toBe('invalid-key');
  });

  it('classifies 5xx as upstream and retries the same key', () => {
    const f = classifyResponse(res(503), body)!;
    expect(f.kind).toBe('upstream');
    expect(f.shouldRetrySameKey).toBe(true);
    expect(f.shouldRotateKey).toBe(false);
  });

  it('reads a credit complaint wearing a 400 as a quota problem', () => {
    const f = classifyResponse(res(400), {
      error: { message: 'Insufficient credits to continue.' },
    })!;
    expect(f.kind).toBe('quota-exhausted');
  });

  it('catches a provider error hiding inside a 200', () => {
    const f = classifyResponse(res(200), { error: { message: 'upstream 429', code: 429 } })!;
    expect(f.kind).toBe('rate-limited');
  });

  it('returns null for a clean success', () => {
    expect(classifyResponse(res(200), { choices: [{}] })).toBeNull();
  });

  it('converts an epoch reset header into a wait in seconds', () => {
    const soon = Date.now() + 30_000;
    const f = classifyResponse(res(429, { 'x-ratelimit-reset': String(soon) }), body)!;
    expect(f.retryAfter).toBeGreaterThan(25);
    expect(f.retryAfter).toBeLessThanOrEqual(30);
  });
});

describe('RequestFailure routing flags', () => {
  it('rotates on key-level problems and not on our own bad request', () => {
    expect(new RequestFailure('rate-limited', 429, '').shouldRotateKey).toBe(true);
    expect(new RequestFailure('quota-exhausted', 402, '').shouldRotateKey).toBe(true);
    expect(new RequestFailure('invalid-key', 401, '').shouldRotateKey).toBe(true);
    expect(new RequestFailure('bad-request', 400, '').shouldRotateKey).toBe(false);
    expect(new RequestFailure('bad-request', 400, '').shouldRetrySameKey).toBe(false);
  });
});

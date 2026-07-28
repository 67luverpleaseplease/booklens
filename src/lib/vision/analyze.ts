/**
 * One scan, start to finish.
 *
 * Tries the primary chain, then the secondary chain if the first fails
 * outright, then normalises whatever came back into a ScanResult we can trust
 * to render.
 */

import { chatComplete, AllKeysUnavailable, type ChatResponse } from '../openrouter/client';
import {
  PRIMARY_CHAIN,
  SECONDARY_CHAIN,
  displayModel,
  getCapabilities,
  type ChainId,
  type ModelChain,
} from '../openrouter/chains';
import { buildJsonRequestParts, modeForChain } from '../openrouter/jsonMode';
import { extractPayload, repairJson } from '../openrouter/repair';
import { RequestFailure } from '../openrouter/errors';
import { buildMessages, buildRepairMessage, type CaptureIntent } from './prompts';
import {
  KIND_LABEL_ZH,
  SCAN_RESULT_JSON_SCHEMA,
  ScanResultSchema,
  tokensMatch,
  type ScanResult,
  type SummaryCard,
} from './schema';
import { segmentWords } from '../chinese/segment';
import { toPinyin } from '../chinese/pinyin';

export type ScanPhase = 'idle' | 'reading' | 'understanding' | 'writing' | 'done' | 'error';

export const PHASE_LABEL: Record<ScanPhase, { zh: string; en: string }> = {
  idle: { zh: '', en: '' },
  reading: { zh: '识别中', en: 'reading characters' },
  understanding: { zh: '理解中', en: 'understanding' },
  writing: { zh: '成文中', en: 'writing summaries' },
  done: { zh: '完成', en: 'done' },
  error: { zh: '出错了', en: 'something went wrong' },
};

export type ScanProgress = {
  phase: ScanPhase;
  /** Friendly name of the model currently being tried. */
  via?: string;
  /** 1-based index of the key being used, for "trying key 2…". */
  keyAttempt?: number;
};

export type AnalyzeOptions = {
  images: string[];
  intent: CaptureIntent;
  level: number;
  traditional?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: ScanProgress) => void;
  /**
   * Skip the primary chain and go straight to the other model family. Used by
   * "try a different model" when the first answer was thin or wrong.
   */
  preferChain?: ModelChain;
  /** Live payload text as it streams in — drives the "watch it read" overlay. */
  onStream?: (text: string) => void;
};

export type AnalyzeOutcome = {
  result: ScanResult;
  /** Model that actually produced it — may be a chain fallback. */
  model: string;
  modelLabel: string;
  /** True when the JSON needed repairing, for the debug panel. */
  repaired: boolean;
  /** Which chain produced this, so the UI can offer the other one. */
  chain: ChainId;
};

/** Run one chain and validate the reply. Throws on failure. */
async function runChain(
  chain: ModelChain,
  opts: AnalyzeOptions,
): Promise<{ outcome: AnalyzeOutcome; response: ChatResponse }> {
  const mode = modeForChain(chain.models);
  const messages = buildMessages(
    { intent: opts.intent, level: opts.level, traditional: opts.traditional },
    opts.images,
    mode,
  );
  const jsonParts = buildJsonRequestParts(mode, SCAN_RESULT_JSON_SCHEMA, {
    name: 'scan_result',
    description: 'Structured summary of a Chinese book from a photo.',
  });

  opts.onProgress?.({ phase: 'understanding', via: displayModel(chain.models[0]) });
  // A new attempt means new stream text — the overlay mirrors one attempt.
  opts.onStream?.('');

  const response = await chatComplete({
    chain,
    messages,
    temperature: 0.4,
    maxTokens: 4096,
    extra: jsonParts as Record<string, unknown>,
    signal: opts.signal,
    onStream: opts.onStream,
    onKeyChange: (_key, attempt) =>
      opts.onProgress?.({
        phase: 'understanding',
        via: displayModel(chain.models[0]),
        keyAttempt: attempt,
      }),
  });

  opts.onProgress?.({ phase: 'writing', via: displayModel(response.model) });

  // A reply can fail two ways: the JSON doesn't parse, or it parses but isn't
  // the shape we asked for (small free models love returning summaries as bare
  // strings). Both deserve the same single correction round-trip — worth a
  // request when the alternative is showing the user nothing, but never more
  // than one: free-tier budget is finite.
  let raw = extractPayload(response.choice);
  let parsedJson = repairJson(raw);
  let data: ScanResult | null = null;
  let problem: string | null = null;
  let coerced = false;
  let repaired = false;

  if (!parsedJson.ok) {
    problem = parsedJson.error;
  } else {
    repaired = parsedJson.repaired;
    const c = coerceScanShape(parsedJson.value);
    const v = ScanResultSchema.safeParse(c.value);
    if (v.success) {
      data = v.data;
      coerced = c.changed;
    } else {
      problem = formatIssues(v.error.issues);
    }
  }

  if (problem !== null) {
    opts.onStream?.('');
    const retry = await chatComplete({
      chain,
      messages: [
        ...messages,
        { role: 'assistant', content: raw.slice(0, 4000) },
        { role: 'user', content: buildRepairMessage(problem) },
      ],
      temperature: 0,
      maxTokens: 4096,
      extra: jsonParts as Record<string, unknown>,
      signal: opts.signal,
      onStream: opts.onStream,
    });
    raw = extractPayload(retry.choice);
    parsedJson = repairJson(raw);
    if (!parsedJson.ok) {
      throw new RequestFailure('no-content', 200, 'The model never returned valid JSON.');
    }
    repaired = parsedJson.repaired;
    const c2 = coerceScanShape(parsedJson.value);
    const v2 = ScanResultSchema.safeParse(c2.value);
    if (!v2.success) {
      throw new RequestFailure(
        'no-content',
        200,
        `The response did not match the expected shape: ${formatIssues(v2.error.issues)}`,
      );
    }
    data = v2.data;
    coerced = c2.changed;
  }

  return {
    outcome: {
      result: await normalize(data!),
      model: response.model,
      modelLabel: displayModel(response.model),
      repaired: repaired || coerced,
      chain: chain.id,
    },
    response,
  };
}

/** Field names small models invent instead of `zh`. */
const ZH_ALIASES = ['text', 'sentence', 'summary', 'content', 'chinese', 'zh_text'];

function coerceCard(item: unknown): unknown {
  if (typeof item === 'string') return { zh: item };
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const o = item as Record<string, unknown>;
  if (typeof o.zh === 'string' && o.zh.trim()) return o;
  for (const key of ZH_ALIASES) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) return { ...o, zh: v };
  }
  return o;
}

/**
 * Bend the common small-model shortcuts into our contract before zod sees the
 * value: summaries as bare strings, key_terms as strings, book as a bare
 * title, card text under an alias. normalize() then fills pinyin and tokens
 * like it does for any card. Anything we can't bend still fails validation
 * and earns the correction round-trip.
 */
export function coerceScanShape(value: unknown): { value: unknown; changed: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { value, changed: false };
  const o = { ...(value as Record<string, unknown>) };
  let changed = false;

  const s = o.summaries;
  if (typeof s === 'string' && s.trim()) {
    o.summaries = [{ zh: s }];
    changed = true;
  } else if (Array.isArray(s)) {
    const mapped = s.map(coerceCard);
    if (mapped.some((m, i) => m !== s[i])) {
      o.summaries = mapped;
      changed = true;
    }
  }

  const kt = o.key_terms;
  if (Array.isArray(kt)) {
    const mapped = kt.map((t) => (typeof t === 'string' ? { zh: t } : t));
    if (mapped.some((m, i) => m !== kt[i])) {
      o.key_terms = mapped;
      changed = true;
    }
  }

  if (typeof o.book === 'string') {
    o.book = { title_zh: o.book };
    changed = true;
  }

  return { value: changed ? o : value, changed };
}

/** Compact zod issues for the repair prompt — just enough to steer the model. */
function formatIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  const first = issues
    .slice(0, 3)
    .map((i) => `${i.path.map(String).join('.') || 'root'}: ${i.message}`)
    .join('; ');
  return first || 'unknown shape problem';
}

export async function analyze(opts: AnalyzeOptions): Promise<AnalyzeOutcome> {
  if (opts.images.length === 0) throw new Error('No image to read.');

  opts.onProgress?.({ phase: 'reading' });
  // Refresh capabilities in the background; a stale cache only costs us a
  // slightly weaker JSON mode, so this never blocks the scan.
  void getCapabilities();

  const first = opts.preferChain ?? PRIMARY_CHAIN;
  const second = first.id === PRIMARY_CHAIN.id ? SECONDARY_CHAIN : PRIMARY_CHAIN;

  try {
    const { outcome } = await runChain(first, opts);
    opts.onProgress?.({ phase: 'done', via: outcome.modelLabel });
    return outcome;
  } catch (err) {
    // No key to try, or the user cancelled — a second chain won't help.
    if (err instanceof AllKeysUnavailable) throw err;
    if (opts.signal?.aborted) throw err;

    try {
      const { outcome } = await runChain(second, opts);
      opts.onProgress?.({ phase: 'done', via: outcome.modelLabel });
      return outcome;
    } catch {
      // Report the *first* failure — it's the one about the model we chose.
      opts.onProgress?.({ phase: 'error' });
      throw err;
    }
  }
}

// --- normalisation --------------------------------------------------------

/**
 * Fill in what the model left out, and fix what it got structurally wrong.
 * Small free models drop fields; none of that should reach the UI.
 */
async function normalize(result: ScanResult): Promise<ScanResult> {
  const summaries: SummaryCard[] = [];

  for (const card of result.summaries) {
    const zh = card.zh.trim();
    if (!zh) continue;

    let tokens = card.tokens;
    // The invariant: concatenated tokens must rebuild zh exactly. When the model
    // breaks it, its tokens are unusable for tap-to-define, so re-segment.
    if (!tokensMatch({ zh, tokens })) {
      tokens = segmentWords(zh).map((w) => ({ w, py: '', en: '' }));
    }

    summaries.push({
      ...card,
      zh,
      label_zh: card.label_zh || KIND_LABEL_ZH[card.kind],
      pinyin: card.pinyin || (await toPinyin(zh)),
      tokens,
    });
  }

  return {
    ...result,
    summaries: summaries.length ? summaries : result.summaries,
    book: result.book && result.book.title_zh ? result.book : result.book,
  };
}

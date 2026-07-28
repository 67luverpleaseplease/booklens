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

  const response = await chatComplete({
    chain,
    messages,
    temperature: 0.4,
    maxTokens: 4096,
    extra: jsonParts as Record<string, unknown>,
    signal: opts.signal,
    onKeyChange: (_key, attempt) =>
      opts.onProgress?.({
        phase: 'understanding',
        via: displayModel(chain.models[0]),
        keyAttempt: attempt,
      }),
  });

  opts.onProgress?.({ phase: 'writing', via: displayModel(response.model) });

  const raw = extractPayload(response.choice);
  let parsedJson = repairJson(raw);

  // One correction round-trip. Worth a request when the alternative is showing
  // the user nothing, but never more than one — free-tier budget is finite.
  if (!parsedJson.ok) {
    const retry = await chatComplete({
      chain,
      messages: [
        ...messages,
        { role: 'assistant', content: raw.slice(0, 4000) },
        { role: 'user', content: buildRepairMessage(parsedJson.error) },
      ],
      temperature: 0,
      maxTokens: 4096,
      extra: jsonParts as Record<string, unknown>,
      signal: opts.signal,
    });
    parsedJson = repairJson(extractPayload(retry.choice));
    if (!parsedJson.ok) {
      throw new RequestFailure('no-content', 200, 'The model never returned valid JSON.');
    }
  }

  const validated = ScanResultSchema.safeParse(parsedJson.value);
  if (!validated.success) {
    throw new RequestFailure(
      'no-content',
      200,
      `The response did not match the expected shape: ${validated.error.issues[0]?.message ?? 'unknown'}`,
    );
  }

  return {
    outcome: {
      result: await normalize(validated.data),
      model: response.model,
      modelLabel: displayModel(response.model),
      repaired: parsedJson.repaired,
      chain: chain.id,
    },
    response,
  };
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

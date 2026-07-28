/**
 * Model chains.
 *
 * OpenRouter accepts a `models` array and walks it server-side on failure, so a
 * three-model chain still costs ONE request against the daily free-tier budget.
 * That's the whole reason the chains are shaped this way.
 *
 * The catch: every model in one `models[]` array shares a single request body,
 * so a chain can only use features that ALL of its members support. The free
 * models genuinely differ here — verified against /api/v1/models:
 *
 *   google/gemma-4-31b-it:free        response_format ✅  structured_outputs ❌
 *   google/gemma-4-26b-a4b-it:free    response_format ✅  structured_outputs ✅
 *   openrouter/free                   response_format ✅  structured_outputs ✅
 *   nvidia/nemotron-nano-12b-v2-vl:free      ❌            ❌        tools ✅
 *   nvidia/nemotron-3-nano-omni-…:free       ❌            ❌        tools ✅
 *
 * Hence two chains grouped by capability floor rather than one mixed list.
 */

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export type ChainId = 'primary' | 'secondary';

export type ModelChain = {
  id: ChainId;
  label: string;
  models: string[];
};

/**
 * Chain A — the default. Led by gemma-4-31b-it:free: the largest free Gemma,
 * 262k context, and Google's multilingual training makes it the strongest free
 * option on Chinese. gemma-4-26b-a4b-it is a mixture-of-experts with ~4B active
 * parameters, so it is *faster* than the 31B despite the bigger name. And
 * openrouter/free is a catch-all router over whatever free model is healthy
 * right now, so the chain degrades to "something" rather than to nothing.
 */
export const PRIMARY_CHAIN: ModelChain = {
  id: 'primary',
  label: 'Gemma 4',
  models: [
    'google/gemma-4-31b-it:free',
    'google/gemma-4-26b-a4b-it:free',
    'openrouter/free',
  ],
};

/** Chain B — different model family, so different failure modes. Tool-call mode. */
export const SECONDARY_CHAIN: ModelChain = {
  id: 'secondary',
  label: 'Nemotron',
  models: [
    'nvidia/nemotron-nano-12b-v2-vl:free',
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  ],
};

export const DEFAULT_CHAINS: ModelChain[] = [PRIMARY_CHAIN, SECONDARY_CHAIN];

/** Friendly names for the "via …" line under the scan status. */
const DISPLAY_NAMES: Record<string, string> = {
  'google/gemma-4-31b-it:free': 'Gemma 4 31B',
  'google/gemma-4-26b-a4b-it:free': 'Gemma 4 26B',
  'openrouter/free': 'OpenRouter Free',
  'nvidia/nemotron-nano-12b-v2-vl:free': 'Nemotron Nano VL',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free': 'Nemotron Omni',
};

export function displayModel(id: string | undefined): string {
  if (!id) return 'free model';
  return DISPLAY_NAMES[id] ?? id.split('/').pop()?.replace(':free', '') ?? id;
}

// --- capability cache ----------------------------------------------------

export type ModelCapabilities = {
  id: string;
  supportsStructuredOutputs: boolean;
  supportsResponseFormat: boolean;
  supportsTools: boolean;
  contextLength: number;
  maxCompletionTokens: number | null;
};

const CAPS_STORAGE_KEY = 'booklens.caps.v1';
const CAPS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Baked-in fallback so the app works on a cold start, offline, or if the models
 * endpoint changes shape. Verified live against /api/v1/models during planning.
 */
const FALLBACK_CAPS: Record<string, ModelCapabilities> = {
  'google/gemma-4-31b-it:free': {
    id: 'google/gemma-4-31b-it:free',
    supportsStructuredOutputs: false,
    supportsResponseFormat: true,
    supportsTools: true,
    contextLength: 262144,
    maxCompletionTokens: 32768,
  },
  'google/gemma-4-26b-a4b-it:free': {
    id: 'google/gemma-4-26b-a4b-it:free',
    supportsStructuredOutputs: true,
    supportsResponseFormat: true,
    supportsTools: true,
    contextLength: 262144,
    maxCompletionTokens: 32768,
  },
  'openrouter/free': {
    id: 'openrouter/free',
    supportsStructuredOutputs: true,
    supportsResponseFormat: true,
    supportsTools: true,
    contextLength: 200000,
    maxCompletionTokens: null,
  },
  'nvidia/nemotron-nano-12b-v2-vl:free': {
    id: 'nvidia/nemotron-nano-12b-v2-vl:free',
    supportsStructuredOutputs: false,
    supportsResponseFormat: false,
    supportsTools: true,
    contextLength: 128000,
    maxCompletionTokens: 128000,
  },
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free': {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    supportsStructuredOutputs: false,
    supportsResponseFormat: false,
    supportsTools: true,
    contextLength: 256000,
    maxCompletionTokens: 65536,
  },
};

type CapsCache = { fetchedAt: number; caps: Record<string, ModelCapabilities> };

let memoryCache: CapsCache | null = null;
let inflight: Promise<Record<string, ModelCapabilities>> | null = null;

function readCache(): CapsCache | null {
  if (memoryCache) return memoryCache;
  try {
    const raw = localStorage.getItem(CAPS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CapsCache;
    if (!parsed?.caps || typeof parsed.fetchedAt !== 'number') return null;
    memoryCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Live capabilities, cached 24h. Never throws — a failed fetch falls back to the
 * baked-in table, because being wrong about `structured_outputs` only costs us
 * a slightly weaker JSON mode, not a broken app.
 */
export async function getCapabilities(force = false): Promise<Record<string, ModelCapabilities>> {
  const cached = readCache();
  if (!force && cached && Date.now() - cached.fetchedAt < CAPS_TTL_MS) return cached.caps;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(`${OPENROUTER_BASE}/models`);
      if (!res.ok) throw new Error(`models: HTTP ${res.status}`);
      const body = (await res.json()) as { data?: unknown[] };
      const caps: Record<string, ModelCapabilities> = {};
      for (const raw of body.data ?? []) {
        const m = raw as {
          id?: string;
          context_length?: number;
          supported_parameters?: string[];
          top_provider?: { max_completion_tokens?: number | null };
        };
        if (!m.id) continue;
        const params = m.supported_parameters ?? [];
        caps[m.id] = {
          id: m.id,
          supportsStructuredOutputs: params.includes('structured_outputs'),
          supportsResponseFormat: params.includes('response_format'),
          supportsTools: params.includes('tools'),
          contextLength: m.context_length ?? 0,
          maxCompletionTokens: m.top_provider?.max_completion_tokens ?? null,
        };
      }
      const merged = { ...FALLBACK_CAPS, ...caps };
      memoryCache = { fetchedAt: Date.now(), caps: merged };
      try {
        localStorage.setItem(CAPS_STORAGE_KEY, JSON.stringify(memoryCache));
      } catch {
        /* private mode */
      }
      return merged;
    } catch {
      return cached?.caps ?? FALLBACK_CAPS;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Synchronous read for render paths — cache or the baked-in table. */
export function capabilitiesSync(): Record<string, ModelCapabilities> {
  return readCache()?.caps ?? FALLBACK_CAPS;
}

export function capsFor(modelId: string): ModelCapabilities {
  return (
    capabilitiesSync()[modelId] ??
    FALLBACK_CAPS[modelId] ?? {
      id: modelId,
      supportsStructuredOutputs: false,
      supportsResponseFormat: false,
      supportsTools: false,
      contextLength: 0,
      maxCompletionTokens: null,
    }
  );
}

/**
 * Picking how to ask a model for JSON.
 *
 * The free models differ in what they support, and getting this wrong is a hard
 * failure: sending `response_format: {type:"json_schema"}` to a model without
 * `structured_outputs` is rejected outright. So instead of hardcoding one mode,
 * we read each model's real capabilities and take the strongest one available.
 *
 * For a `models[]` chain the mode has to be the FLOOR across every member,
 * since they all share one request body.
 */

import { capsFor, type ModelCapabilities } from './chains';

export type JsonMode =
  /** Strict schema — the model literally cannot emit invalid shape. */
  | 'json_schema'
  /** Free-form JSON object — valid JSON guaranteed, shape is not. */
  | 'json_object'
  /** A single forced tool call whose parameters are the schema. */
  | 'tool'
  /** Nothing but the prompt. Needs the repair layer. */
  | 'prompt';

const STRENGTH: Record<JsonMode, number> = {
  json_schema: 3,
  json_object: 2,
  tool: 1,
  prompt: 0,
};

export function modeForCapabilities(caps: ModelCapabilities): JsonMode {
  if (caps.supportsStructuredOutputs) return 'json_schema';
  if (caps.supportsResponseFormat) return 'json_object';
  if (caps.supportsTools) return 'tool';
  return 'prompt';
}

export function modeForModel(modelId: string): JsonMode {
  return modeForCapabilities(capsFor(modelId));
}

/**
 * The strongest mode every model in the chain can honour.
 *
 * This is why `google/gemma-4-31b-it:free` leading the primary chain pins that
 * chain to `json_object` — it supports `response_format` but not
 * `structured_outputs`, so a strict schema would break the whole request.
 */
export function modeForChain(models: string[]): JsonMode {
  if (models.length === 0) return 'prompt';
  let weakest: JsonMode = 'json_schema';
  for (const m of models) {
    const mode = modeForModel(m);
    if (STRENGTH[mode] < STRENGTH[weakest]) weakest = mode;
  }
  return weakest;
}

export type JsonRequestParts = {
  response_format?: Record<string, unknown>;
  tools?: unknown[];
  tool_choice?: unknown;
};

/**
 * Turn a mode plus a JSON Schema into the request fields that express it.
 * Returns an empty object for `prompt` mode — the instruction lives in the
 * system message instead, and `repair.ts` cleans up whatever comes back.
 */
export function buildJsonRequestParts(
  mode: JsonMode,
  schema: Record<string, unknown>,
  opts: { name?: string; description?: string } = {},
): JsonRequestParts {
  const name = opts.name ?? 'scan_result';
  switch (mode) {
    case 'json_schema':
      return {
        response_format: {
          type: 'json_schema',
          json_schema: { name, strict: true, schema },
        },
      };
    case 'json_object':
      return { response_format: { type: 'json_object' } };
    case 'tool':
      return {
        tools: [
          {
            type: 'function',
            function: {
              name,
              description: opts.description ?? 'Return the structured result.',
              parameters: schema,
            },
          },
        ],
        tool_choice: { type: 'function', function: { name } },
      };
    case 'prompt':
      return {};
  }
}

/** Modes that need an explicit "reply with JSON only" nudge in the prompt. */
export function needsPromptNudge(mode: JsonMode): boolean {
  return mode === 'json_object' || mode === 'prompt';
}

/**
 * Getting usable JSON out of a model that wasn't held to a strict schema.
 *
 * In `json_object` and `prompt` modes the response is only *probably* JSON. The
 * failures are boringly consistent — a ```json fence, a sentence of preamble, a
 * trailing comma, or an output truncated mid-object by a token cap — so each
 * gets handled in turn rather than throwing the whole response away.
 */

/** Strip markdown code fences, keeping the fenced body. */
function stripFences(text: string): string {
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/;
  const m = text.match(fence);
  if (m && m[1].trim()) return m[1].trim();
  // An unterminated fence — the model started a block and hit the token cap.
  const open = text.indexOf('```');
  if (open !== -1) {
    const after = text.slice(open + 3).replace(/^(?:json|JSON)\s*/i, '');
    if (after.trim()) return after.trim();
  }
  return text.trim();
}

/**
 * Find the outermost balanced JSON object, ignoring braces inside strings.
 * Returns the substring, or null when there's no `{` at all.
 */
function extractOutermostObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // Never closed — truncated output. Hand back what we have and let the
  // balancer below try to finish it.
  return text.slice(start);
}

/** Close any structures the model left open when it ran out of tokens. */
function balance(text: string): string {
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }

  let out = text;
  if (inString) out += '"';
  // Drop a dangling `"key":` or trailing comma before closing.
  out = out.replace(/,\s*$/, '').replace(/"[^"]*"\s*:\s*$/, '');
  while (stack.length) {
    const open = stack.pop();
    out += open === '{' ? '}' : ']';
  }
  return out;
}

/** Remove trailing commas and normalise control characters inside strings. */
function tidy(text: string): string {
  return text
    .replace(/,(\s*[}\]])/g, '$1')
    // Literal newlines and tabs inside a JSON string are invalid — escape them.
    .replace(/"(?:[^"\\]|\\.)*"/g, (s) =>
      s.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'),
    )
    // Smart quotes occasionally leak into keys from a model imitating prose.
    .replace(/[“”]/g, '"');
}

export type RepairResult =
  | { ok: true; value: unknown; repaired: boolean }
  | { ok: false; error: string; attempted: string };

/**
 * Best-effort parse. `repaired` reports whether anything beyond a plain
 * JSON.parse was needed, so callers can log how often models misbehave.
 */
export function repairJson(raw: string): RepairResult {
  if (!raw || !raw.trim()) return { ok: false, error: 'Empty response.', attempted: '' };

  // Fast path — a well-behaved model.
  try {
    return { ok: true, value: JSON.parse(raw), repaired: false };
  } catch {
    /* fall through to repair */
  }

  const candidates: string[] = [];
  const unfenced = stripFences(raw);
  candidates.push(unfenced);

  const extracted = extractOutermostObject(unfenced);
  if (extracted) {
    candidates.push(extracted);
    candidates.push(tidy(extracted));
    candidates.push(balance(tidy(extracted)));
    candidates.push(tidy(balance(extracted)));
  }

  for (const candidate of candidates) {
    if (!candidate.trim()) continue;
    try {
      return { ok: true, value: JSON.parse(candidate), repaired: true };
    } catch {
      continue;
    }
  }

  return {
    ok: false,
    error: 'Could not parse the response as JSON.',
    attempted: (extracted ?? unfenced).slice(0, 500),
  };
}

/**
 * Pull the payload out of a chat completion, handling both plain content and a
 * forced tool call (`tool` mode puts the JSON in `arguments`).
 */
export function extractPayload(choice: unknown): string {
  const c = choice as {
    message?: {
      content?: unknown;
      tool_calls?: Array<{ function?: { arguments?: string } }>;
    };
  };
  const msg = c?.message;
  if (!msg) return '';

  const toolArgs = msg.tool_calls?.[0]?.function?.arguments;
  if (typeof toolArgs === 'string' && toolArgs.trim()) return toolArgs;

  const content = msg.content;
  if (typeof content === 'string') return content;
  // Some providers return content as an array of parts.
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'string' ? p : ((p as { text?: string })?.text ?? '')))
      .join('');
  }
  return '';
}

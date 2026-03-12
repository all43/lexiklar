/**
 * Shared LLM calling module for the Lexiklar pipeline.
 *
 * Supports four providers:
 *   - openai       (requires OPENAI_API_KEY)
 *   - anthropic    (requires ANTHROPIC_API_KEY)
 *   - ollama       (local, no key needed)
 *   - lm-studio    (local, no key needed)
 *
 * Response caching:
 *   Successful responses are cached in data/raw/llm-cache/ keyed by a hash of
 *   (provider, model, systemPrompt, userMessage). Disable with LLM_CACHE=0.
 */

import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

// Cache is enabled by default; set LLM_CACHE=0 to disable.
const CACHE_ENABLED = process.env.LLM_CACHE !== "0";
const CACHE_DIR = process.env.LLM_CACHE_DIR
  || join(process.cwd(), "data", "raw", "llm-cache");

// Cache path: {CACHE_DIR}/{provider}/{model_slug}/{hash}.json
// Prefix by provider/model so entire model caches can be wiped with rm -rf.
function getCachePath(provider, model, systemPrompt, userMessage, maxTokens) {
  const slug = (model || "default").replace(/[^a-zA-Z0-9._-]/g, "_");
  const hash = createHash("sha256")
    .update(JSON.stringify({ systemPrompt, userMessage, maxTokens }))
    .digest("hex")
    .slice(0, 20);
  return join(CACHE_DIR, provider, slug, `${hash}.json`);
}

function readCache(filePath) {
  if (!CACHE_ENABLED) return null;
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function writeCache(filePath, result) {
  if (!CACHE_ENABLED) return;
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(result));
  } catch {
    // Cache write failure is non-fatal
  }
}

const PROVIDER_DEFAULTS = {
  openai: {
    url: "https://api.openai.com",
    model: "gpt-4.1-mini",
    keyEnv: "OPENAI_API_KEY",
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    model: "claude-haiku-4-5-20251001",
    keyEnv: "ANTHROPIC_API_KEY",
  },
  ollama: {
    url: process.env.OLLAMA_URL || "http://127.0.0.1:11434",
    model: "gemma3:4b",
    keyEnv: null,
  },
  "lm-studio": {
    url: process.env.LM_STUDIO_URL || "http://127.0.0.1:1234",
    model: "default",
    keyEnv: null,
  },
};

/**
 * Whether a provider runs locally (no API key needed).
 * @param {string} provider
 * @returns {boolean}
 */
export function isLocalProvider(provider) {
  return provider === "ollama" || provider === "lm-studio";
}

/**
 * Get the API key for a provider, or null if not set.
 * @param {string} provider
 * @returns {string|null}
 */
export function getApiKey(provider) {
  const keyEnv = PROVIDER_DEFAULTS[provider]?.keyEnv;
  return keyEnv ? process.env[keyEnv] || null : null;
}

/**
 * Get default model name for a provider.
 * @param {string} provider
 * @returns {string}
 */
export function getDefaultModel(provider) {
  return PROVIDER_DEFAULTS[provider]?.model || "default";
}

/**
 * Parse --provider and --model from argv.
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{ provider: string, model: string|null }}
 */
export function parseProviderArgs(argv, defaultProvider = "openai") {
  const providerIdx = argv.indexOf("--provider");
  const provider = providerIdx >= 0 ? argv[providerIdx + 1] : defaultProvider;
  const modelIdx = argv.indexOf("--model");
  const model = modelIdx >= 0 ? argv[modelIdx + 1] : null;
  return { provider, model };
}

// ============================================================
// Provider-specific call functions
// ============================================================

async function callOpenAICompatible(systemPrompt, userMessage, baseUrl, model, options) {
  const { maxTokens = 64, temperature = 0.2, apiKey = null, jsonMode = false, jsonSchema = null, timeoutMs = 0, isLocal = false } = options;

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  // Local models (LM Studio, Ollama) only understand max_tokens.
  // Cloud OpenAI rejects having both fields simultaneously (as of 2025).
  const tokenField = isLocal ? "max_tokens" : "max_completion_tokens";
  const body = {
    model,
    temperature,
    [tokenField]: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  };

  // Structured output: json_schema (strict, supports arrays-in-objects) takes precedence
  // over the older json_object mode. LM Studio 0.3.6+ and OpenAI both support json_schema.
  if (jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "response", strict: true, schema: jsonSchema },
    };
  } else if (jsonMode) {
    // json_object: guarantees valid JSON but forces an object (not array) root.
    // Only used for cloud OpenAI when no schema is provided.
    body.response_format = { type: "json_object" };
  }

  const fetchOptions = { method: "POST", headers, body: JSON.stringify(body) };
  if (timeoutMs > 0) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    fetchOptions.signal = controller.signal;
    var clearTimer = () => clearTimeout(timer);
  }

  let res;
  try {
    res = await fetch(`${baseUrl}/v1/chat/completions`, fetchOptions);
  } catch (err) {
    clearTimer?.();
    if (err.name === "AbortError") throw new Error(`Local model timed out after ${timeoutMs / 1000}s — model may be too slow or not loaded`);
    throw err;
  }
  clearTimer?.();

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  const data = await res.json();

  if (!data.choices?.length) {
    throw new Error(`Model returned no choices — is a model loaded and ready? Response: ${JSON.stringify(data).slice(0, 200)}`);
  }

  // Strip chat-template tokens that some models leak into output (e.g. <|im_start|>)
  // If only special tokens remain, the model is not generating real content
  const choice = data.choices[0];
  const finishReason = choice.finish_reason ?? "unknown";

  // Truncation means the JSON will be incomplete — fail fast so retry logic kicks in
  if (finishReason === "length") {
    throw new Error(
      `Response truncated (finish_reason: length) — maxTokens (${maxTokens}) too low for this batch. ` +
      `Reduce batch size or increase maxTokens.`
    );
  }

  const rawContent = choice.message.content ?? "";
  const content = rawContent.replace(/<\|[^|>]*\|>/g, "").trim();

  if (!content) {
    if (finishReason === "content_filter") {
      throw new Error("Model refused to respond (content_filter) — batch may contain sensitive content");
    }
    throw new Error(`Model returned empty content (finish_reason: ${finishReason}) — try reloading the model or reduce batch size`);
  }

  const usage = data.usage || {};
  return {
    content,
    input_tokens: usage.prompt_tokens || 0,
    output_tokens: usage.completion_tokens || 0,
  };
}

async function callAnthropic(systemPrompt, userMessage, model, options) {
  const { maxTokens = 64, temperature = 0.2, apiKey } = options;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }

  const data = await res.json();

  if (data.stop_reason === "max_tokens") {
    const { maxTokens = 64 } = options;
    throw new Error(
      `Response truncated (stop_reason: max_tokens) — maxTokens (${maxTokens}) too low for this request.`
    );
  }

  const usage = data.usage || {};
  return {
    content: data.content[0].text,
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
  };
}

/**
 * Resolve the active model for a local provider (ollama, lm-studio) via /v1/models.
 * - LM Studio 0.3.6+ no longer accepts "default" — requires the real loaded model ID.
 * - Ollama benefits from the same: uses whatever model is currently loaded rather than
 *   a hardcoded default that may not be installed.
 * Falls back to the provider's default model name if the endpoint is unreachable.
 *
 * @param {string} baseUrl - e.g. "http://127.0.0.1:1234" or "http://127.0.0.1:11434"
 * @param {string} fallback - default model name to use if auto-detection fails
 * @returns {Promise<string>}
 */
async function resolveLocalModel(baseUrl, fallback) {
  try {
    const res = await fetch(`${baseUrl}/v1/models`);
    if (!res.ok) return fallback;
    const data = await res.json();
    const modelId = data.data?.[0]?.id;
    return modelId || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Call an LLM with a system prompt and user message.
 *
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {Object} options
 * @param {string} options.provider - 'openai' | 'anthropic' | 'ollama' | 'lm-studio'
 * @param {string} [options.model] - model override (uses provider default if null)
 * @param {number} [options.maxTokens=64]
 * @param {number} [options.temperature=0.2]
 * @param {boolean} [options.jsonMode=false] - Request JSON output via response_format (cloud OpenAI only; ignored for local providers and Anthropic)
 * @returns {Promise<{content: string, input_tokens: number, output_tokens: number}>}
 */
export async function callLLM(systemPrompt, userMessage, options = {}) {
  const { provider = "openai", model: modelOverride, maxTokens = 64, temperature = 0.2, jsonMode = false, jsonSchema = null } = options;
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.openai;
  const apiKey = getApiKey(provider);

  if (provider === "anthropic") {
    const model = modelOverride || defaults.model;
    const cachePath = getCachePath(provider, model, systemPrompt, userMessage, maxTokens);
    const cached = readCache(cachePath);
    if (cached) return { ...cached, _cached: true };
    const result = await callAnthropic(systemPrompt, userMessage, model, { maxTokens, temperature, apiKey });
    writeCache(cachePath, result);
    return result;
  }

  // For local providers: auto-detect the loaded model unless --model was passed explicitly.
  // Avoids hardcoded defaults that may not be installed (lm-studio no longer accepts "default").
  let model = modelOverride || defaults.model;
  if (isLocalProvider(provider) && !modelOverride) {
    model = await resolveLocalModel(defaults.url, defaults.model);
  }

  const cachePath = getCachePath(provider, model, systemPrompt, userMessage, maxTokens);
  const cached = readCache(cachePath);
  if (cached) return { ...cached, _cached: true };

  const result = await callOpenAICompatible(systemPrompt, userMessage, defaults.url, model, {
    maxTokens,
    temperature,
    apiKey,
    jsonSchema,
    jsonMode: jsonMode && !isLocalProvider(provider),
    timeoutMs: isLocalProvider(provider) ? (parseInt(process.env.LOCAL_TIMEOUT_MS) || 300_000) : 0,
    isLocal: isLocalProvider(provider),
  });
  writeCache(cachePath, result);
  return result;
}

/**
 * Extract and parse JSON from an LLM response that may be wrapped in noise.
 *
 * Handles (in order):
 *   1. Plain JSON
 *   2. ```json ... ``` markdown fences
 *   3. <function=name>CONTENT</function> tool-call wrappers (some local models)
 *   4. Bracket-extraction: find first { or [ and parse from there
 *   5. Best-effort Python-style single-quote → JSON double-quote conversion
 *
 * If the extracted object has shape { examples: [...] } and you expect an
 * array, unwrap it yourself after calling this function.
 *
 * @param {string} text - raw LLM response string
 * @returns {any} - parsed value
 * @throws {Error} - if no valid JSON could be extracted
 */
export function extractJSON(text) {
  // Strip chat-template special tokens that some local models leak into output
  // e.g. <|im_start|>, <|im_end|>, <|user_id_abc123|>
  const s = text.replace(/<\|[^|>]*\|>/g, "").trim();

  if (!s) throw new Error("Empty response from model (only special tokens received)");

  // 1. Direct parse — fastest path for well-behaved models
  try { return JSON.parse(s); } catch {}

  // 2. Markdown code fence
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch {}
  }

  // 3. <function=name> wrapper — local models (LM Studio, some Ollama models)
  //    that confuse text output with tool-calling syntax
  const funcMatch = s.match(/<function[^>]*>([\s\S]*?)(?:<\/function>|$)/);
  const candidate = funcMatch ? funcMatch[1].trim() : s;

  // 4. Bracket extraction — find first structural { or [ and slice to matching closer
  const obj = candidate.indexOf("{");
  const arr = candidate.indexOf("[");
  const start = arr !== -1 && (obj === -1 || arr < obj) ? arr : obj;
  if (start !== -1) {
    const closer = start === arr ? candidate.lastIndexOf("]") : candidate.lastIndexOf("}");
    if (closer > start) {
      const slice = candidate.slice(start, closer + 1);
      try { return JSON.parse(slice); } catch {}

      // 5. Best-effort: Python dict → JSON
      //    Replace 'key' and 'value' delimiters with double quotes.
      //    Handles escaped \' inside strings; may fail on unescaped apostrophes.
      const converted = slice.replace(/'((?:[^'\\]|\\.)*)'/g, (_, inner) => {
        const escaped = inner.replace(/\\'/g, "'").replace(/(?<!\\)"/g, '\\"');
        return `"${escaped}"`;
      });
      try { return JSON.parse(converted); } catch {}
    }
  }

  throw new Error(
    `Could not extract valid JSON from LLM response: ${text.slice(0, 120)}`,
  );
}

/**
 * Retry a function with exponential backoff.
 *
 * @param {Function} fn - async function to call
 * @param {number} [maxRetries=3]
 * @param {number} [baseDelay=1000] - base delay in ms (multiplied by retry count)
 * @returns {Promise<any>}
 */
export async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * (attempt + 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

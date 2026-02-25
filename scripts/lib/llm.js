/**
 * Shared LLM calling module for the Lexiklar pipeline.
 *
 * Supports four providers:
 *   - openai       (requires OPENAI_API_KEY)
 *   - anthropic    (requires ANTHROPIC_API_KEY)
 *   - ollama       (local, no key needed)
 *   - lm-studio    (local, no key needed)
 */

const PROVIDER_DEFAULTS = {
  openai: {
    url: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyEnv: "OPENAI_API_KEY",
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    model: "claude-3-5-haiku-20241022",
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
export function parseProviderArgs(argv) {
  const providerIdx = argv.indexOf("--provider");
  const provider = providerIdx >= 0 ? argv[providerIdx + 1] : "openai";
  const modelIdx = argv.indexOf("--model");
  const model = modelIdx >= 0 ? argv[modelIdx + 1] : null;
  return { provider, model };
}

// ============================================================
// Provider-specific call functions
// ============================================================

async function callOpenAICompatible(systemPrompt, userMessage, baseUrl, model, options) {
  const { maxTokens = 64, temperature = 0.2, apiKey = null } = options;

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const usage = data.usage || {};
  return {
    content: data.choices[0].message.content,
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
  const usage = data.usage || {};
  return {
    content: data.content[0].text,
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
  };
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
 * @returns {Promise<{content: string, input_tokens: number, output_tokens: number}>}
 */
export async function callLLM(systemPrompt, userMessage, options = {}) {
  const { provider = "openai", model: modelOverride, maxTokens = 64, temperature = 0.2 } = options;
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.openai;
  const model = modelOverride || defaults.model;
  const apiKey = getApiKey(provider);

  if (provider === "anthropic") {
    return callAnthropic(systemPrompt, userMessage, model, { maxTokens, temperature, apiKey });
  }

  return callOpenAICompatible(systemPrompt, userMessage, defaults.url, model, {
    maxTokens,
    temperature,
    apiKey,
  });
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
  const s = text.trim();

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

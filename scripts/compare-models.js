#!/usr/bin/env node
/**
 * compare-models.js
 *
 * Compare German→English translation quality across multiple LLM providers/models
 * by re-translating a random sample of already-translated examples and showing
 * results side-by-side with the existing reference translation.
 *
 * Default models (change with --models):
 *   openai/gpt-4o-mini  · openai/gpt-4.1-mini  · anthropic/haiku-3.5
 *   lm-studio (auto-detect loaded model)  · ollama (auto-detect loaded model)
 *
 * Usage:
 *   node scripts/compare-models.js
 *   node scripts/compare-models.js --models openai/gpt-4o-mini,anthropic/haiku-3.5
 *   node scripts/compare-models.js --probe lm-studio     # debug raw response
 *   node scripts/compare-models.js --count 10            # sample size (default: 10)
 *   node scripts/compare-models.js --seed 42             # reproducible selection
 *   node scripts/compare-models.js --type expression     # only idioms/proverbs/etc.
 *   node scripts/compare-models.js --models lm-studio/sauerkraut  # local model only
 *   node scripts/compare-models.js --local-batch 3      # chunk size for slow local models
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  callLLM,
  extractJSON,
  retryWithBackoff,
  getApiKey,
  isLocalProvider,
} from "./lib/llm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const EXAMPLES_FILE = join(ROOT, "data", "examples.json");

// ── Model registry ────────────────────────────────────────────────────────────

const MODEL_REGISTRY = {
  "openai/gpt-4.1-nano": { provider: "openai",    model: "gpt-4.1-nano" },
  "openai/gpt-4o-mini":  { provider: "openai",    model: "gpt-4o-mini" },
  "openai/gpt-4.1-mini": { provider: "openai",    model: "gpt-4.1-mini" },
  "openai/gpt-4.1":      { provider: "openai",    model: "gpt-4.1" },
  // o-series / reasoning models only accept temperature=1 and consume extra tokens for thinking
  "openai/gpt-5-mini":   { provider: "openai",    model: "gpt-5-mini",   temperature: 1, maxTokens: 8192 },
  "anthropic/haiku-4.5": { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  "anthropic/sonnet-4.5":{ provider: "anthropic", model: "claude-sonnet-4-5-20250929" },
  "lm-studio":           { provider: "lm-studio", model: null },              // auto-detect first loaded
  "lm-studio/tower":     { provider: "lm-studio", model: "tower-plus-9b-mlx" },      // translation-specific
  "lm-studio/sauerkraut":{ provider: "lm-studio", model: "sauerkrautlm-v2-14b-sft-mlx", batchSize: 5 }, // 14B — chunks to avoid timeout
  "lm-studio/gemma3":    { provider: "lm-studio", model: "google/gemma-3-12b", batchSize: 10 },
  "ollama":              { provider: "ollama",     model: null },              // auto-detect
  "ollama/gemma3":       { provider: "ollama",     model: "gemma3:4b",         batchSize: 5 },
  "ollama/deepseek":     { provider: "ollama",     model: "deepseek-r1:latest", batchSize: 5 },
};

const DEFAULT_MODELS = [
  "openai/gpt-4.1-nano",
  "openai/gpt-4o-mini",
  "openai/gpt-4.1-mini",
  "openai/gpt-4.1",
  "openai/gpt-5-mini",
  "anthropic/haiku-4.5",
  "anthropic/sonnet-4.5",
  // Local models excluded from defaults — opt-in with --models lm-studio or --models ollama
];

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag, defaultVal) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : defaultVal;
}

const COUNT        = parseInt(getArg("--count", "10"), 10);
const SEED         = parseInt(getArg("--seed", String(Date.now())), 10);
const TYPE_FILTER  = getArg("--type", null);   // e.g. "expression", "example", "proverb"
const FIXTURES     = args.includes("--fixtures"); // use scripts/test-idioms.json instead of examples.json
const PROBE        = getArg("--probe", null);  // provider key to probe for raw output
const DEBUG        = args.includes("--debug"); // print raw model response + parsed map
// Override per-model batchSize for local models (e.g. --local-batch 3 for very slow machines)
const LOCAL_BATCH  = parseInt(getArg("--local-batch", "0"), 10) || null;

const modelsArg   = getArg("--models", null);
const ACTIVE_KEYS = modelsArg ? modelsArg.split(",").map(s => s.trim()) : DEFAULT_MODELS;

// ── Prompt (same as translate-examples.js) ────────────────────────────────────

const SYSTEM_PROMPT = `You are a German-English translation assistant for a dictionary app targeting B2 learners.

Each item has a "type" field:
- "example" (or absent): a full sentence. Translate naturally.
- "expression": an idiomatic phrase. Translate the idiomatic meaning (not word-for-word).
- "proverb": a saying or proverb. Use the established English equivalent if one exists; otherwise translate the meaning.

Rules:
- Translate accurately and naturally — no paraphrasing or explanations
- For expressions/proverbs: use the recognised English idiom/saying if one exists

Output format:
- Your ENTIRE response must be a raw JSON array: [{...}, {...}]
- Start with [ and end with ] — no wrapper object, no key
- Each item: {"id":"...","translation":"..."}
- Use JSON double quotes " for all strings
- No markdown fences, no function calls, no preamble, no trailing text`;

function buildPrompt(batch) {
  const lines = [`Translate ${batch.length} German sentence(s) to English:\n`];
  for (const { id, text, type } of batch) {
    let line = `[${id}] ${text}`;
    if (type) line += `  (type: ${type})`;
    lines.push(line);
  }
  lines.push('\nReply with ONLY a JSON array: [{"id":"...","translation":"..."}, ...]');
  return lines.join("\n");
}

// ── Seeded random sampling ────────────────────────────────────────────────────

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(1664525, s) + 1013904223 >>> 0;
    return s / 0x100000000;
  };
}

function pickRandom(array, n, seed) {
  const rng = seededRandom(seed);
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

// ── JSON schema for structured output (local providers) ───────────────────────

/**
 * JSON schema for LM Studio / Ollama structured output.
 * Forces the model to emit { "translations": [{ "id": "...", "translation": "..." }, ...] }
 * eliminating the need for extractJSON fallbacks (function-call wrappers, Python dicts, etc.)
 *
 * Note: JSON Schema does not allow an array at the root — the array is wrapped in an object.
 * The existing normalization code already handles { translations: [...] } via
 * Object.values(parsed).find(v => Array.isArray(v)).
 */
const TRANSLATION_SCHEMA = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id:          { type: "string" },
          translation: { type: "string" },
        },
        required: ["id", "translation"],
        additionalProperties: false,
      },
    },
  },
  required: ["translations"],
  additionalProperties: false,
};

// ── Translation via one model ─────────────────────────────────────────────────

/**
 * Send a single chunk (subset of examples) to one model. Returns a partial map.
 */
async function translateChunk(chunk, key) {
  const cfg = MODEL_REGISTRY[key];

  const prompt = buildPrompt(chunk);
  // Budget ~100 tokens per example (translation text + JSON punctuation + headroom).
  // Minimum 512 for a small chunk, scaled with chunk size.
  const autoTokens = Math.max(512, chunk.length * 100);

  // Use JSON schema for local providers: forces structured output and eliminates
  // function-call wrappers, Python-dict format, and other noise from local models.
  const useSchema = isLocalProvider(cfg.provider);

  const result = await retryWithBackoff(() =>
    callLLM(SYSTEM_PROMPT, prompt, {
      provider:    cfg.provider,
      model:       cfg.model,
      maxTokens:   cfg.maxTokens ?? autoTokens,
      temperature: cfg.temperature ?? 0.3,
      // json_schema: local providers get structured output via schema.
      // Do NOT use jsonMode (json_object) for array responses — it forces an object root
      // which causes models to return only the first item instead of all of them.
      jsonSchema:  useSchema ? TRANSLATION_SCHEMA : null,
      jsonMode:    false,
    })
  , 2, 1500);

  let parsed;
  try {
    parsed = extractJSON(result.content);
  } catch (err) {
    throw new Error(`JSON parse failed: ${err.message}\nRaw (first 300 chars): ${result.content.slice(0, 300)}`);
  }

  if (DEBUG) {
    console.log(`\n[DEBUG raw] ${key} (chunk ${chunk[0]?.id}…):\n${result.content.slice(0, 600)}`);
  }

  // Normalise: may be wrapped object or bare array
  if (!Array.isArray(parsed)) {
    if (parsed && (parsed.id || parsed.translation)) {
      parsed = [parsed];
    } else {
      const inner = Object.values(parsed).find(v => Array.isArray(v));
      parsed = inner ?? [];
    }
  }

  const map = {};
  for (const item of parsed) {
    if (item.id) map[item.id] = item.translation ?? "(no translation)";
  }

  // Positional fallback: some local models (e.g. sauerkrautlm) output one
  // <function=translate>{'text': '...'}</function> block per input item instead of
  // a JSON array with id fields. When that happens, parsed has no ids — fall back to
  // matching by position (N function blocks → N chunk items).
  if (Object.keys(map).length === 0) {
    const funcBlocks = [...result.content.matchAll(/<function[^>]*>([\s\S]*?)(?:<\/function>|$)/g)];
    if (funcBlocks.length > 0 && funcBlocks.length <= chunk.length) {
      for (let i = 0; i < funcBlocks.length; i++) {
        const inner = funcBlocks[i][1].trim();
        // Try to extract the 'text' value from {'text': '...'} or {"text": "..."}
        // Also handle bare text (just the translation without a wrapper)
        let text = null;
        try {
          // Convert Python-style single-quote dict to JSON
          const asJson = inner.replace(/'((?:[^'\\]|\\.)*)'/g, (_, v) =>
            `"${v.replace(/\\'/g, "'").replace(/(?<!\\)"/g, '\\"')}"`
          );
          const obj = JSON.parse(asJson.startsWith('{') ? asJson : `{${asJson}}`);
          text = obj.text ?? obj.translation ?? obj.output ?? null;
        } catch {
          // If parsing fails, use the raw inner content
          text = inner.replace(/^['"]|['"]$/g, '').trim() || null;
        }
        if (text && chunk[i]) map[chunk[i].id] = text;
      }
    }
  }

  if (DEBUG) {
    console.log(`[DEBUG map] ${key}: ${JSON.stringify(map).slice(0, 400)}`);
  }

  return { map, tokens: result };
}

/**
 * Translate a full batch with one model.
 * If `cfg.batchSize` (or `--local-batch`) is set and smaller than the batch,
 * splits into sequential chunks so slow local models don't time out.
 *
 * @returns {{ map: Record<string,string> }} id → translation
 */
async function translateWith(batch, key) {
  const cfg = MODEL_REGISTRY[key];
  if (!cfg) throw new Error(`Unknown model key: "${key}". Available: ${Object.keys(MODEL_REGISTRY).join(", ")}`);

  // Determine chunk size: CLI override > per-model config > full batch at once
  const chunkSize = LOCAL_BATCH ?? cfg.batchSize ?? batch.length;

  if (chunkSize < batch.length) {
    // Split into sequential sub-batches and merge results
    const fullMap = {};
    for (let i = 0; i < batch.length; i += chunkSize) {
      const chunk = batch.slice(i, i + chunkSize);
      if (DEBUG) console.log(`  [DEBUG] ${key}: chunk ${i / chunkSize + 1}/${Math.ceil(batch.length / chunkSize)} (${chunk.length} items)`);
      const { map } = await translateChunk(chunk, key);
      Object.assign(fullMap, map);
    }
    return { map: fullMap };
  }

  return translateChunk(batch, key);
}

// ── Probe mode: single request, raw output ────────────────────────────────────

async function runProbe(providerKey) {
  const cfg = MODEL_REGISTRY[providerKey];
  if (!cfg) {
    console.error(`Unknown provider key: "${providerKey}"`);
    console.error(`Available: ${Object.keys(MODEL_REGISTRY).join(", ")}`);
    process.exit(1);
  }

  if (!existsSync(EXAMPLES_FILE)) {
    console.error("No examples.json found.");
    process.exit(1);
  }

  const examples = JSON.parse(readFileSync(EXAMPLES_FILE, "utf-8"));
  const withTrans = Object.entries(examples)
    .filter(([, ex]) => ex.translation)
    .slice(0, 3)
    .map(([id, ex]) => ({ id, text: ex.text, type: ex.type ?? null }));

  const prompt = buildPrompt(withTrans);

  console.log(`\n── Probe: ${providerKey} (provider: ${cfg.provider}, model: ${cfg.model ?? "auto"}) ──`);
  console.log("\n── User prompt sent ────────────────────────────────────────");
  console.log(prompt);
  console.log("\n── Raw response ────────────────────────────────────────────");

  let raw;
  try {
    raw = await callLLM(SYSTEM_PROMPT, prompt, {
      provider:    cfg.provider,
      model:       cfg.model,
      maxTokens:   512,
      temperature: 0.3,
      jsonMode:    !isLocalProvider(cfg.provider),
    });
    console.log(raw.content);
    console.log(`\nTokens: ${raw.input_tokens} in / ${raw.output_tokens} out`);
  } catch (err) {
    console.error(`ERROR calling model: ${err.message}`);
    process.exit(1);
  }

  console.log("\n── extractJSON result ──────────────────────────────────────");
  try {
    const parsed = extractJSON(raw.content);
    console.log(JSON.stringify(parsed, null, 2));
    console.log("\n✓ JSON extracted successfully");
  } catch (err) {
    console.error(`✗ extractJSON failed: ${err.message}`);
  }
}

// ── Quality scoring (BLEU-1) ──────────────────────────────────────────────────

/**
 * Tokenise a translation string into lowercase word tokens.
 */
function tokenize(text) {
  return (text || "").toLowerCase().match(/\b[a-z']+\b/g) || [];
}

/**
 * BLEU-1: unigram precision with brevity penalty.
 * Returns a value in [0, 1].  1.0 = perfect match.
 */
function bleu1(reference, candidate) {
  const refTokens  = tokenize(reference);
  const candTokens = tokenize(candidate);
  if (!candTokens.length) return 0;
  if (!refTokens.length)  return 0;

  // Clipped unigram counts
  const refCounts = {};
  for (const w of refTokens) refCounts[w] = (refCounts[w] || 0) + 1;

  let matches = 0;
  const seen = {};
  for (const w of candTokens) {
    seen[w] = (seen[w] || 0) + 1;
    if (seen[w] <= (refCounts[w] || 0)) matches++;
  }

  const precision = matches / candTokens.length;
  // Brevity penalty: penalise candidates shorter than the reference
  const bp = candTokens.length >= refTokens.length
    ? 1
    : Math.exp(1 - refTokens.length / candTokens.length);

  return bp * precision;
}

// ── Display ───────────────────────────────────────────────────────────────────

const LABEL_WIDTH = 22;
const TRANS_WIDTH = 68;

function wrapAt(text, width) {
  if (!text) return ["(—)"];
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > width) { lines.push(cur); cur = w; }
    else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

function printResult(examples, refMap, resultsByKey) {
  const divider = "─".repeat(LABEL_WIDTH + TRANS_WIDTH + 5);

  for (let i = 0; i < examples.length; i++) {
    const { id, text, type } = examples[i];
    const typeTag = type ? `  [${type}]` : "";
    console.log(`\n${i + 1}. ${text}${typeTag}`);
    console.log(divider);

    // Reference
    const refLines = wrapAt(refMap[id], TRANS_WIDTH);
    console.log(`  ${"Reference".padEnd(LABEL_WIDTH)} ${refLines[0]}`);
    for (let j = 1; j < refLines.length; j++) {
      console.log(`  ${"".padEnd(LABEL_WIDTH)} ${refLines[j]}`);
    }

    // Each model
    for (const key of ACTIVE_KEYS) {
      const trans = resultsByKey[key]?.[id];
      if (trans === undefined) { console.log(`  ${key.padEnd(LABEL_WIDTH)} (skipped)`); continue; }

      const score = bleu1(refMap[id], trans);
      const scoreTag = ` [${score.toFixed(2)}]`;
      const tLines = wrapAt(trans, TRANS_WIDTH);
      console.log(`  ${key.padEnd(LABEL_WIDTH)} ${tLines[0]}${scoreTag}`);
      for (let j = 1; j < tLines.length; j++) {
        console.log(`  ${"".padEnd(LABEL_WIDTH)} ${tLines[j]}`);
      }
    }
  }
  console.log();
}

function printSummary(examples, refMap, resultsByKey, timings, skipped) {
  console.log("── Summary ──────────────────────────────────────────────────────────────");
  console.log(`  ${"Model".padEnd(LABEL_WIDTH)} ${"Parsed".padEnd(9)} ${"Avg BLEU-1".padEnd(12)} ${"Min".padEnd(6)} ${"Max".padEnd(6)} Time`);
  console.log(`  ${"─".repeat(LABEL_WIDTH)} ${"─".repeat(8)} ${"─".repeat(11)} ${"─".repeat(5)} ${"─".repeat(5)} ${"─".repeat(6)}`);
  for (const key of ACTIVE_KEYS) {
    if (skipped.has(key)) {
      console.log(`  ${key.padEnd(LABEL_WIDTH)} skipped (no API key)`);
      continue;
    }
    const map = resultsByKey[key];
    if (!map) { console.log(`  ${key.padEnd(LABEL_WIDTH)} FAILED`); continue; }

    const ok = examples.filter(({ id }) => map[id]).length;
    const scores = examples
      .filter(({ id }) => map[id])
      .map(({ id }) => bleu1(refMap[id], map[id]));

    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const min = scores.length ? Math.min(...scores) : 0;
    const max = scores.length ? Math.max(...scores) : 0;
    const ms  = timings[key] != null ? `${(timings[key] / 1000).toFixed(1)}s` : "?";

    console.log(
      `  ${key.padEnd(LABEL_WIDTH)} ${String(ok + "/" + examples.length).padEnd(9)}` +
      ` ${avg.toFixed(3).padEnd(12)} ${min.toFixed(2).padEnd(6)} ${max.toFixed(2).padEnd(6)} ${ms}`
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Probe mode
  if (PROBE) {
    await runProbe(PROBE);
    return;
  }

  // Validate model keys
  for (const key of ACTIVE_KEYS) {
    if (!MODEL_REGISTRY[key]) {
      console.error(`Unknown model key: "${key}"`);
      console.error(`Available: ${Object.keys(MODEL_REGISTRY).join(", ")}`);
      process.exit(1);
    }
  }

  // Check API keys for cloud providers
  const missingKeys = [];
  for (const key of ACTIVE_KEYS) {
    const { provider } = MODEL_REGISTRY[key];
    if (!isLocalProvider(provider) && !getApiKey(provider)) {
      const envVar = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
      missingKeys.push(`${key} (needs ${envVar})`);
    }
  }
  if (missingKeys.length) {
    console.warn(`Warning: missing API keys for:\n  ${missingKeys.join("\n  ")}`);
    console.warn("These models will be skipped.\n");
  }

  // ── Fixtures mode: use curated hard idioms from test-idioms.json ──────────────
  if (FIXTURES) {
    const fixturesFile = join(ROOT, "scripts", "test-idioms.json");
    if (!existsSync(fixturesFile)) {
      console.error("scripts/test-idioms.json not found.");
      process.exit(1);
    }
    const fixtures = JSON.parse(readFileSync(fixturesFile, "utf-8"));
    const selected  = fixtures;
    const batch     = selected.map(({ id, text, type }) => ({ id, text, type }));
    const refMap    = Object.fromEntries(selected.map(({ id, ref }) => [id, ref]));

    console.log(`\nModel comparison — ${selected.length} hard idioms (fixtures mode)`);
    console.log(`Models: ${ACTIVE_KEYS.join("  ·  ")}\n`);

    const resultsByKey = {};
    const timings      = {};
    const skipped      = new Set();

    for (const key of ACTIVE_KEYS) {
      const { provider } = MODEL_REGISTRY[key];
      if (!isLocalProvider(provider) && !getApiKey(provider)) {
        console.log(`  Skipping ${key} (no API key)`);
        skipped.add(key);
        continue;
      }
      process.stdout.write(`  Running ${key.padEnd(LABEL_WIDTH)}... `);
      const t0 = Date.now();
      try {
        const { map } = await translateWith(batch, key);
        timings[key] = Date.now() - t0;
        resultsByKey[key] = map;
        console.log(`${Object.keys(map).length}/${selected.length} translations  (${(timings[key] / 1000).toFixed(1)}s)`);
      } catch (err) {
        timings[key] = Date.now() - t0;
        console.log(`FAILED: ${err.message.slice(0, 120)}`);
      }
    }

    printResult(selected, refMap, resultsByKey);
    printSummary(selected, refMap, resultsByKey, timings, skipped);
    return;
  }

  if (!existsSync(EXAMPLES_FILE)) {
    console.error("No examples.json found. Run transform first.");
    process.exit(1);
  }

  const allExamples = JSON.parse(readFileSync(EXAMPLES_FILE, "utf-8"));

  // Filter to translated examples with plausibly English translations.
  // Require common English function words — German text rarely has "the", "a", "is",
  // "to", "in", "of", "and", "he", "she", "it", "you", "was", "are", etc.
  const enFunctionWords = /\b(the|a|an|is|are|was|were|to|of|and|in|it|he|she|they|you|that|this|with|for|on|at|be|have|has|had|do|not|his|her|its|we|by|from|as|but)\b/i;
  const looksEnglish = t => enFunctionWords.test(t) && t.length > 15;

  let pool = Object.entries(allExamples)
    .filter(([, ex]) => ex.translation && looksEnglish(ex.translation))
    .map(([id, ex]) => ({ id, text: ex.text, type: ex.type ?? null, ref: ex.translation }));

  if (TYPE_FILTER) {
    pool = pool.filter(({ type }) => type === TYPE_FILTER);
    if (pool.length === 0) {
      console.error(`No translated examples found with type="${TYPE_FILTER}"`);
      process.exit(1);
    }
  }

  if (pool.length < COUNT) {
    console.warn(`Only ${pool.length} examples available; using all of them.`);
  }

  const selected = pickRandom(pool, Math.min(COUNT, pool.length), SEED);
  const batch    = selected.map(({ id, text, type }) => ({ id, text, type }));
  const refMap   = Object.fromEntries(selected.map(({ id, ref }) => [id, ref]));

  console.log(`\nModel comparison — ${selected.length} examples  (seed: ${SEED}${TYPE_FILTER ? `, type: ${TYPE_FILTER}` : ""})`);
  console.log(`Models: ${ACTIVE_KEYS.join("  ·  ")}\n`);

  const resultsByKey = {};
  const timings      = {};
  const skipped      = new Set();

  for (const key of ACTIVE_KEYS) {
    const { provider } = MODEL_REGISTRY[key];
    if (!isLocalProvider(provider) && !getApiKey(provider)) {
      console.log(`  Skipping ${key} (no API key)`);
      skipped.add(key);
      continue;
    }
    process.stdout.write(`  Running ${key.padEnd(LABEL_WIDTH)}... `);
    const t0 = Date.now();
    try {
      const { map } = await translateWith(batch, key);
      timings[key] = Date.now() - t0;
      resultsByKey[key] = map;
      const got = Object.keys(map).length;
      const cached = Object.values(map).filter(v => v?._cached).length;
      const cacheNote = cached > 0 ? `  ${cached} from cache` : "";
      console.log(`${got}/${selected.length} translations  (${(timings[key] / 1000).toFixed(1)}s)${cacheNote}`);
    } catch (err) {
      timings[key] = Date.now() - t0;
      console.log(`FAILED: ${err.message.slice(0, 120)}`);
    }
  }

  printResult(selected, refMap, resultsByKey);
  printSummary(selected, refMap, resultsByKey, timings, skipped);
}

main().catch(err => {
  console.error("Comparison failed:", err);
  process.exit(1);
});

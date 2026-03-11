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
 *   node scripts/compare-models.js                        # default: all idiom fixtures
 *   node scripts/compare-models.js --random               # random examples from examples.json
 *   node scripts/compare-models.js --random --count 20    # 20 random examples (default: 10)
 *   node scripts/compare-models.js --random --seed 42     # reproducible selection
 *   node scripts/compare-models.js --random --type expression
 *   node scripts/compare-models.js --models openai/gpt-4o-mini,anthropic/haiku-4.5
 *   node scripts/compare-models.js --probe lm-studio     # debug raw response
 *   node scripts/compare-models.js --local-batch 3      # chunk size for slow local models
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
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
const RANDOM_MODE  = args.includes("--random"); // random sample from examples.json
const FIXTURES     = !RANDOM_MODE;              // default: curated idiom fixtures
const PROBE        = getArg("--probe", null);  // provider key to probe for raw output
const DEBUG        = args.includes("--debug"); // print raw model response + parsed map
// Override per-model batchSize for local models (e.g. --local-batch 3 for very slow machines)
const LOCAL_BATCH  = parseInt(getArg("--local-batch", "0"), 10) || null;

const modelsArg   = getArg("--models", null);
const ACTIVE_KEYS = modelsArg ? modelsArg.split(",").map(s => s.trim()) : DEFAULT_MODELS;

// ── Prompt: idioms mode (translation only) ────────────────────────────────────

const IDIOM_SYSTEM_PROMPT = `You are a German-English translation assistant for a dictionary app targeting B2 learners.

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

function buildIdiomPrompt(batch) {
  const lines = [`Translate ${batch.length} German sentence(s) to English:\n`];
  for (const { id, text, type } of batch) {
    let line = `[${id}] ${text}`;
    if (type) line += `  (type: ${type})`;
    lines.push(line);
  }
  lines.push('\nReply with ONLY a JSON array: [{"id":"...","translation":"..."}, ...]');
  return lines.join("\n");
}

// ── Prompt: examples mode (translation + annotations) ─────────────────────────

const EXAMPLES_SYSTEM_PROMPT = `You are a German-English translation assistant for a dictionary app targeting B2 learners.

Translate each German sentence to English accurately and naturally.

For each sentence, also annotate content words (nouns, verbs, adjectives only):
- "form": the exact word as written in the sentence
- "lemma": dictionary form (infinitive for verbs, nominative singular for nouns, base form for adjectives)
- "pos": one of "noun", "verb", "adjective"
- "gloss_hint": null

Rules:
- Skip articles (der/die/das/ein/eine), prepositions, pronouns, conjunctions, particles, adverbs
- Skip proper nouns unless they are also common nouns
- For separable verbs, use the full infinitive as lemma (e.g. "kommt...an" → "ankommen")
- For reflexive verbs, use the reflexive infinitive as lemma (e.g. "erinnert sich" → "sich erinnern")

Output format:
- Your ENTIRE response must be a JSON object: {"examples": [{...}, {...}]}
- Each item: {"id":"...","translation":"...","annotations":[{"form":"...","lemma":"...","pos":"...","gloss_hint":null}, ...]}
- Use JSON double quotes " for all strings
- No markdown fences, no function calls, no preamble, no trailing text`;

function buildExamplesPrompt(batch) {
  const lines = [`Translate ${batch.length} German sentence(s) to English and annotate content words:\n`];
  for (const { id, text } of batch) {
    lines.push(`[${id}] ${text}`);
  }
  lines.push('\nReply with: {"examples": [{"id":"...","translation":"...","annotations":[...]}, ...]}');
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

const EXAMPLE_SCHEMA = {
  type: "object",
  properties: {
    examples: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id:          { type: "string" },
          translation: { type: "string" },
          annotations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                form:       { type: "string" },
                lemma:      { type: "string" },
                pos:        { type: "string" },
                gloss_hint: { type: ["string", "null"] },
              },
              required: ["form", "lemma", "pos", "gloss_hint"],
              additionalProperties: false,
            },
          },
        },
        required: ["id", "translation", "annotations"],
        additionalProperties: false,
      },
    },
  },
  required: ["examples"],
  additionalProperties: false,
};

// ── Lemma scoring ─────────────────────────────────────────────────────────────

const CONTENT_POS = new Set(["noun", "verb", "adjective"]);

/**
 * Score annotation quality by comparing lemma+pos pairs.
 * Returns { precision, recall, f1, missing, extra }.
 */
function lemmaScore(refAnnotations, candAnnotations) {
  const toKey = a => `${a.lemma.toLowerCase()}|${a.pos}`;
  const ref  = (refAnnotations  || []).filter(a => CONTENT_POS.has(a.pos));
  const cand = (candAnnotations || []).filter(a => CONTENT_POS.has(a.pos));

  const refSet  = new Set(ref.map(toKey));
  const candSet = new Set(cand.map(toKey));

  if (refSet.size === 0 && candSet.size === 0) return { precision: 1, recall: 1, f1: 1, missing: [], extra: [] };
  if (refSet.size === 0) return { precision: 0, recall: 1, f1: 0, missing: [], extra: [...candSet] };

  const matches = [...candSet].filter(x => refSet.has(x)).length;
  const precision = candSet.size > 0 ? matches / candSet.size : 0;
  const recall    = matches / refSet.size;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  const missing = [...refSet].filter(x => !candSet.has(x));   // in ref but not in candidate
  const extra   = [...candSet].filter(x => !refSet.has(x));   // in candidate but not in ref

  return { precision, recall, f1, missing, extra };
}

// ── Translation via one model ─────────────────────────────────────────────────

/**
 * Send a single chunk (subset of examples) to one model. Returns a partial map.
 * @param {object} opts
 * @param {'idioms'|'examples'} opts.mode - idioms: translation only; examples: translation + annotations
 */
async function translateChunk(chunk, key, { mode = "idioms" } = {}) {
  const cfg = MODEL_REGISTRY[key];
  const isExamples = mode === "examples";

  const systemPrompt = isExamples ? EXAMPLES_SYSTEM_PROMPT : IDIOM_SYSTEM_PROMPT;
  const prompt = isExamples ? buildExamplesPrompt(chunk) : buildIdiomPrompt(chunk);

  // Budget: ~100 tokens/item for idioms, ~250 for examples (annotations are verbose)
  const perItem = isExamples ? 250 : 100;
  const autoTokens = Math.max(512, chunk.length * perItem);

  // Use JSON schema for local providers (always) and for examples mode (all providers)
  const useSchema = isLocalProvider(cfg.provider) || isExamples;
  const schema = isExamples ? EXAMPLE_SCHEMA : TRANSLATION_SCHEMA;

  const result = await retryWithBackoff(() =>
    callLLM(systemPrompt, prompt, {
      provider:    cfg.provider,
      model:       cfg.model,
      maxTokens:   cfg.maxTokens ?? autoTokens,
      temperature: cfg.temperature ?? 0.3,
      jsonSchema:  useSchema ? schema : null,
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
  const annotations = {};
  for (const item of parsed) {
    if (item.id) {
      map[item.id] = item.translation ?? "(no translation)";
      if (isExamples && Array.isArray(item.annotations)) {
        annotations[item.id] = item.annotations.filter(a => a.form && a.lemma && a.pos);
      }
    }
  }

  // Positional fallback for local models
  if (Object.keys(map).length === 0) {
    const funcBlocks = [...result.content.matchAll(/<function[^>]*>([\s\S]*?)(?:<\/function>|$)/g)];
    if (funcBlocks.length > 0 && funcBlocks.length <= chunk.length) {
      for (let i = 0; i < funcBlocks.length; i++) {
        const inner = funcBlocks[i][1].trim();
        let text = null;
        try {
          const asJson = inner.replace(/'((?:[^'\\]|\\.)*)'/g, (_, v) =>
            `"${v.replace(/\\'/g, "'").replace(/(?<!\\)"/g, '\\"')}"`
          );
          const obj = JSON.parse(asJson.startsWith('{') ? asJson : `{${asJson}}`);
          text = obj.text ?? obj.translation ?? obj.output ?? null;
        } catch {
          text = inner.replace(/^['"]|['"]$/g, '').trim() || null;
        }
        if (text && chunk[i]) map[chunk[i].id] = text;
      }
    }
  }

  if (DEBUG) {
    console.log(`[DEBUG map] ${key}: ${JSON.stringify(map).slice(0, 400)}`);
  }

  return { map, annotations, tokens: result };
}

/**
 * Translate a full batch with one model.
 * If `cfg.batchSize` (or `--local-batch`) is set and smaller than the batch,
 * splits into sequential chunks so slow local models don't time out.
 *
 * @param {'idioms'|'examples'} opts.mode
 * @returns {{ map: Record<string,string>, annotations: Record<string,Array> }}
 */
async function translateWith(batch, key, { mode = "idioms" } = {}) {
  const cfg = MODEL_REGISTRY[key];
  if (!cfg) throw new Error(`Unknown model key: "${key}". Available: ${Object.keys(MODEL_REGISTRY).join(", ")}`);

  // Determine chunk size: CLI override > per-model config > full batch at once
  const chunkSize = LOCAL_BATCH ?? cfg.batchSize ?? batch.length;

  if (chunkSize < batch.length) {
    // Split into sequential sub-batches and merge results
    const fullMap = {};
    const fullAnnotations = {};
    for (let i = 0; i < batch.length; i += chunkSize) {
      const chunk = batch.slice(i, i + chunkSize);
      if (DEBUG) console.log(`  [DEBUG] ${key}: chunk ${i / chunkSize + 1}/${Math.ceil(batch.length / chunkSize)} (${chunk.length} items)`);
      const { map, annotations } = await translateChunk(chunk, key, { mode });
      Object.assign(fullMap, map);
      Object.assign(fullAnnotations, annotations);
    }
    return { map: fullMap, annotations: fullAnnotations };
  }

  return translateChunk(batch, key, { mode });
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

// ── Markdown report ────────────────────────────────────────────────────────────

function mdCell(text) {
  return (text ?? "—").toString().replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function generateMarkdownReport(examples, refMap, resultsByKey, timings, skipped, meta) {
  const { seed, typeFilter, fixtures, mode, refAnnotationsMap, annotationsByKey } = meta;
  const isExamples = mode === "examples";
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const activeKeys = ACTIVE_KEYS.filter(k => !skipped.has(k) && resultsByKey[k]);
  const lines = [];

  // ── Header
  lines.push(`# Translation Model Comparison`);
  lines.push(``);
  lines.push(`**Date**: ${now}  |  **Count**: ${examples.length}  |  **Seed**: ${seed}${typeFilter ? `  |  **Type**: ${typeFilter}` : ""}  |  **Mode**: ${fixtures ? "fixtures" : "examples"}`);
  lines.push(``);
  lines.push(`**Models**: ${ACTIVE_KEYS.join(" · ")}`);
  lines.push(``);

  // ── Summary table
  lines.push(`## Summary`);
  lines.push(``);
  if (isExamples) {
    lines.push(`| Model | Parsed | Avg BLEU-1 | Avg Lemma F1 | Avg Precision | Avg Recall | Time |`);
    lines.push(`|:---|---:|---:|---:|---:|---:|---:|`);
  } else {
    lines.push(`| Model | Parsed | Avg BLEU-1 | Min | Max | Time |`);
    lines.push(`|:---|---:|---:|---:|---:|---:|`);
  }

  for (const key of ACTIVE_KEYS) {
    if (skipped.has(key)) {
      lines.push(`| ${key} | skipped | — | — | — | — |${isExamples ? " — |" : ""}`);
      continue;
    }
    const map = resultsByKey[key];
    if (!map) {
      lines.push(`| **${key}** | **FAILED** | — | — | — | — |${isExamples ? " — |" : ""}`);
      continue;
    }
    const scores = examples.filter(({ id }) => map[id]).map(({ id }) => bleu1(refMap[id], map[id]));
    const ok  = scores.length;
    const avg = ok ? scores.reduce((a, b) => a + b, 0) / ok : 0;
    const min = ok ? Math.min(...scores) : 0;
    const max = ok ? Math.max(...scores) : 0;
    const ms  = timings[key] != null ? `${(timings[key] / 1000).toFixed(1)}s` : "?";

    if (isExamples) {
      const annMap = annotationsByKey?.[key] || {};
      const lemmaScores = examples
        .filter(({ id }) => map[id] && refAnnotationsMap?.[id])
        .map(({ id }) => lemmaScore(refAnnotationsMap[id], annMap[id] || []));
      const avgF1  = lemmaScores.length ? lemmaScores.reduce((a, s) => a + s.f1, 0) / lemmaScores.length : 0;
      const avgP   = lemmaScores.length ? lemmaScores.reduce((a, s) => a + s.precision, 0) / lemmaScores.length : 0;
      const avgR   = lemmaScores.length ? lemmaScores.reduce((a, s) => a + s.recall, 0) / lemmaScores.length : 0;
      lines.push(`| ${key} | ${ok}/${examples.length} | **${avg.toFixed(3)}** | **${avgF1.toFixed(3)}** | ${avgP.toFixed(3)} | ${avgR.toFixed(3)} | ${ms} |`);
    } else {
      lines.push(`| ${key} | ${ok}/${examples.length} | **${avg.toFixed(3)}** | ${min.toFixed(2)} | ${max.toFixed(2)} | ${ms} |`);
    }
  }
  lines.push(``);

  // ── Per-example stats
  const exStats = examples.map(({ id, text, type }) => {
    const scores = activeKeys.map(k => {
      const t = resultsByKey[k]?.[id];
      return t ? bleu1(refMap[id], t) : null;
    }).filter(s => s !== null);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const min = scores.length ? Math.min(...scores) : 0;
    const max = scores.length ? Math.max(...scores) : 0;
    const variance = scores.length > 1
      ? scores.reduce((acc, s) => acc + (s - avg) ** 2, 0) / scores.length
      : 0;

    // Lemma stats per example (examples mode only)
    let avgLemmaF1 = null;
    if (isExamples && refAnnotationsMap?.[id]) {
      const f1s = activeKeys.map(k => {
        const annMap = annotationsByKey?.[k] || {};
        return lemmaScore(refAnnotationsMap[id], annMap[id] || []).f1;
      });
      avgLemmaF1 = f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : 0;
    }

    return { id, text, type, avg, min, max, stddev: Math.sqrt(variance), avgLemmaF1 };
  });

  function renderExampleTable(stat) {
    const { id, text, type } = stat;
    const typeTag = type ? ` \`[${type}]\`` : "";
    lines.push(`> **"${mdCell(text)}"**${typeTag}`);
    lines.push(``);

    if (isExamples) {
      lines.push(`| Model | Translation | BLEU-1 | Lemma F1 | Missing | Extra |`);
      lines.push(`|:---|:---|---:|---:|:---|:---|`);
      // Show reference lemmas
      const refAnns = (refAnnotationsMap?.[id] || []).filter(a => CONTENT_POS.has(a.pos));
      const refLemmas = refAnns.map(a => `${a.lemma}(${a.pos[0]})`).join(", ");
      lines.push(`| _Reference_ | _${mdCell(refMap[id])}_ | — | — | _${refLemmas}_ | — |`);
      for (const key of activeKeys) {
        const t = resultsByKey[key]?.[id];
        const bScore = t != null ? bleu1(refMap[id], t).toFixed(2) : "—";
        const annMap = annotationsByKey?.[key] || {};
        const ls = lemmaScore(refAnnotationsMap?.[id] || [], annMap[id] || []);
        const missingStr = ls.missing.length ? ls.missing.map(m => m.split("|").join("(") + ")").join(", ") : "—";
        const extraStr = ls.extra.length ? ls.extra.map(e => e.split("|").join("(") + ")").join(", ") : "—";
        lines.push(`| ${key} | ${mdCell(t ?? "(missing)")} | ${bScore} | ${ls.f1.toFixed(2)} | ${missingStr} | ${extraStr} |`);
      }
    } else {
      lines.push(`| Model | Translation | BLEU-1 |`);
      lines.push(`|:---|:---|---:|`);
      lines.push(`| _Reference_ | _${mdCell(refMap[id])}_ | — |`);
      for (const key of activeKeys) {
        const t = resultsByKey[key]?.[id];
        const score = t != null ? bleu1(refMap[id], t).toFixed(2) : "—";
        lines.push(`| ${key} | ${mdCell(t ?? "(missing)")} | ${score} |`);
      }
    }

    lines.push(``);
    let statsLine = `*avg ${stat.avg.toFixed(2)} · min ${stat.min.toFixed(2)} · max ${stat.max.toFixed(2)} · σ ${stat.stddev.toFixed(2)}`;
    if (stat.avgLemmaF1 != null) statsLine += ` · lemma F1 ${stat.avgLemmaF1.toFixed(2)}`;
    statsLine += `*`;
    lines.push(statsLine);
    lines.push(``);
  }

  const TOP_N = Math.min(3, examples.length);

  // ── Most contested
  lines.push(`## Most Contested  _(models disagree most — highest σ)_`);
  lines.push(``);
  [...exStats].sort((a, b) => b.stddev - a.stddev).slice(0, TOP_N).forEach(renderExampleTable);

  if (isExamples) {
    // ── Worst lemma matching
    lines.push(`## Worst Lemma Matching  _(lowest avg Lemma F1)_`);
    lines.push(``);
    [...exStats].sort((a, b) => (a.avgLemmaF1 ?? 1) - (b.avgLemmaF1 ?? 1)).slice(0, TOP_N).forEach(renderExampleTable);

    // ── Best lemma matching
    lines.push(`## Best Lemma Matching  _(highest avg Lemma F1)_`);
    lines.push(``);
    [...exStats].sort((a, b) => (b.avgLemmaF1 ?? 0) - (a.avgLemmaF1 ?? 0)).slice(0, TOP_N).forEach(renderExampleTable);
  } else {
    // ── Worst performing
    lines.push(`## Hardest to Translate  _(lowest avg BLEU-1)_`);
    lines.push(``);
    [...exStats].sort((a, b) => a.avg - b.avg).slice(0, TOP_N).forEach(renderExampleTable);

    // ── Best performing
    lines.push(`## Easiest to Translate  _(highest avg BLEU-1)_`);
    lines.push(``);
    [...exStats].sort((a, b) => b.avg - a.avg).slice(0, TOP_N).forEach(renderExampleTable);
  }

  // ── All examples
  lines.push(`## All Examples`);
  lines.push(``);
  const sortKey = isExamples
    ? (a, b) => (a.avgLemmaF1 ?? 1) - (b.avgLemmaF1 ?? 1)  // worst lemma first
    : (a, b) => a.avg - b.avg;
  [...exStats].sort(sortKey).forEach(renderExampleTable);

  return lines.join("\n");
}

function writeReport(examples, refMap, resultsByKey, timings, skipped, meta) {
  const md = generateMarkdownReport(examples, refMap, resultsByKey, timings, skipped, meta);
  const reportsDir = join(ROOT, "reports");
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const filename = `comparison-${ts}.md`;
  const outPath = join(reportsDir, filename);
  writeFileSync(outPath, md);
  console.log(`\nReport written to: reports/${filename}`);
  return outPath;
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

    console.log(`\nModel comparison — ${selected.length} curated idioms`);
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
    writeReport(selected, refMap, resultsByKey, timings, skipped, { seed: SEED, typeFilter: TYPE_FILTER, fixtures: true, mode: "idioms" });
    return;
  }

  if (!existsSync(EXAMPLES_FILE)) {
    console.error("No examples.json found. Run transform first.");
    process.exit(1);
  }

  const allExamples = JSON.parse(readFileSync(EXAMPLES_FILE, "utf-8"));

  // Filter to translated examples with plausibly English translations.
  // Reject translations that are actually German text (multi-part examples where the
  // "translation" is just the continuation of the German source, e.g. poem lines, Q&A pairs).
  // Primary guard: block on unambiguous German morphological markers. Secondary: require
  // at least one common English function word (original heuristic, now broadened).
  const DE_MARKERS  = /\b(der|die|das|und|ist|wir|nicht|den|des|dem|auf|mit|von|zu|für|beim|zur|vom|einen|einer|eines|werden|wurde|wurden|hatte|hatten|seine|ihrem|ihrer|ihm|ihnen)\b/i;
  const EN_WORDS_RE = /\b(the|a|an|is|are|was|were|to|of|and|in|it|he|she|they|you|that|this|with|for|on|at|be|have|has|had|do|not|his|her|its|we|by|from|as|but|or|if|so|all|any|one|no|can|may|will|would|could|should)\b/i;
  const looksEnglish = t => {
    if (!t || t.length < 15) return false;
    if ((t.match(/\S+/g) ?? []).length < 3) return false;  // need at least 3 words
    if (DE_MARKERS.test(t)) return false;
    return EN_WORDS_RE.test(t);
  };

  // For examples mode, only pick examples that have annotations (content words to compare)
  let pool = Object.entries(allExamples)
    .filter(([, ex]) => ex.translation && looksEnglish(ex.translation))
    .filter(([, ex]) => {
      // Must have reference annotations with content words
      const contentAnns = (ex.annotations || []).filter(a => CONTENT_POS.has(a.pos));
      return contentAnns.length > 0;
    })
    .map(([id, ex]) => ({
      id, text: ex.text, type: ex.type ?? null, ref: ex.translation,
      refAnnotations: ex.annotations || [],
    }));

  if (TYPE_FILTER) {
    pool = pool.filter(({ type }) => type === TYPE_FILTER);
    if (pool.length === 0) {
      console.error(`No annotated examples found with type="${TYPE_FILTER}"`);
      process.exit(1);
    }
  }

  if (pool.length < COUNT) {
    console.warn(`Only ${pool.length} annotated examples available; using all of them.`);
  }

  const selected = pickRandom(pool, Math.min(COUNT, pool.length), SEED);
  const batch    = selected.map(({ id, text }) => ({ id, text }));
  const refMap   = Object.fromEntries(selected.map(({ id, ref }) => [id, ref]));
  const refAnnotationsMap = Object.fromEntries(selected.map(({ id, refAnnotations }) => [id, refAnnotations]));

  console.log(`\nModel comparison — ${selected.length} random examples with lemma matching  (seed: ${SEED}${TYPE_FILTER ? `, type: ${TYPE_FILTER}` : ""})`);
  console.log(`Models: ${ACTIVE_KEYS.join("  ·  ")}\n`);

  const resultsByKey      = {};
  const annotationsByKey  = {};
  const timings           = {};
  const skipped           = new Set();

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
      const { map, annotations } = await translateWith(batch, key, { mode: "examples" });
      timings[key] = Date.now() - t0;
      resultsByKey[key] = map;
      annotationsByKey[key] = annotations;
      const got = Object.keys(map).length;
      const annCount = Object.keys(annotations).length;
      console.log(`${got}/${selected.length} translations, ${annCount} annotated  (${(timings[key] / 1000).toFixed(1)}s)`);
    } catch (err) {
      timings[key] = Date.now() - t0;
      console.log(`FAILED: ${err.message.slice(0, 120)}`);
    }
  }

  printResult(selected, refMap, resultsByKey);
  printSummary(selected, refMap, resultsByKey, timings, skipped);
  writeReport(selected, refMap, resultsByKey, timings, skipped, {
    seed: SEED, typeFilter: TYPE_FILTER, fixtures: false, mode: "examples",
    refAnnotationsMap, annotationsByKey,
  });
}

main().catch(err => {
  console.error("Comparison failed:", err);
  process.exit(1);
});

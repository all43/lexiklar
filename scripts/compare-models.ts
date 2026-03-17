#!/usr/bin/env node
/**
 * compare-models.ts
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
 *   node scripts/compare-models.ts                        # default: all idiom fixtures
 *   node scripts/compare-models.ts --random               # random examples from examples.json
 *   node scripts/compare-models.ts --random --count 20    # 20 random examples (default: 10)
 *   node scripts/compare-models.ts --random --seed 42     # reproducible selection
 *   node scripts/compare-models.ts --random --type expression
 *   node scripts/compare-models.ts --glosses              # gloss translation comparison (default: gpt-4.1-mini + haiku + sauerkraut)
 *   node scripts/compare-models.ts --glosses --count 30   # 30 glosses (default: 30)
 *   node scripts/compare-models.ts --glosses --multi-sense  # only words with 2+ senses
 *   node scripts/compare-models.ts --glosses --word bank,tisch  # specific word(s)
 *   node scripts/compare-models.ts --glosses --models openai/gpt-4.1-mini,anthropic/haiku-4.5
 *   node scripts/compare-models.ts --models openai/gpt-4o-mini,anthropic/haiku-4.5
 *   node scripts/compare-models.ts --probe lm-studio     # debug raw response
 *   node scripts/compare-models.ts --local-batch 3      # chunk size for slow local models
 *   node scripts/compare-models.ts --fresh              # ignore per-item cache, re-translate everything
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import {
  callLLM,
  extractJSON,
  retryWithBackoff,
  getApiKey,
  isLocalProvider,
} from "./lib/llm.js";
import { WORD_SYSTEM_PROMPT as GLOSS_SYSTEM_PROMPT, WORD_SYSTEM_PROMPT_BATCH_IDS as GLOSS_BATCH_SYSTEM_PROMPT_FROM_LIB } from "./lib/prompts.js";
import { stripReferences } from "./lib/references.js";
import { POS_DIRS } from "./lib/pos.js";
import { loadExamples } from "./lib/examples.js";
import type { LLMResponse, LLMProvider } from "../types/index.js";
import type { Annotation, Word } from "../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── Types ─────────────────────────────────────────────────────────────────────

interface ModelConfig {
  provider: LLMProvider;
  model: string | null;
  batchSize?: number;
  temperature?: number;
  maxTokens?: number;
}

interface BatchItem {
  id: string;
  text: string;
  type?: string | null;
}

interface GlossItem extends BatchItem {
  word: string;
  pos: string;
  phraseType: string | null;
  gloss: string;
  cleanGloss: string;
  senseIdx: number;
}

interface FixtureItem extends BatchItem {
  ref?: string;
  refs?: string[];
}

interface PoolItem extends BatchItem {
  ref: string;
  refAnnotations: Annotation[];
}

interface TranslationEntry {
  id: string;
  translation: string;
  annotations?: Annotation[];
}

interface ChunkResult {
  map: Record<string, string>;
  annotations: Record<string, Annotation[]>;
  tokens: LLMResponse;
}

interface TranslateResult {
  map: Record<string, string>;
  annotations: Record<string, Annotation[]>;
}

interface CachedTranslateResult extends TranslateResult {
  fromCache: number;
  fromApi: number;
}

interface LemmaScoreResult {
  precision: number;
  recall: number;
  f1: number;
  missing: string[];
  extra: string[];
}

interface ExampleStat {
  id: string;
  text: string;
  type: string | null | undefined;
  avg: number;
  min: number;
  max: number;
  stddev: number;
  avgLemmaF1: number | null;
  winners: string[];
}

interface ReportMeta {
  seed: number;
  typeFilter: string | null;
  fixtures: boolean;
  mode: string;
  refAnnotationsMap?: Record<string, Annotation[]>;
  annotationsByKey?: Record<string, Record<string, Annotation[]>>;
}

interface CacheEntry {
  text: string;
  translation: string;
  annotations?: Annotation[];
}

// ── Model registry ────────────────────────────────────────────────────────────

const MODEL_REGISTRY: Record<string, ModelConfig> = {
  "openai/gpt-4.1-nano": { provider: "openai",    model: "gpt-4.1-nano" },
  "openai/gpt-4o-mini":  { provider: "openai",    model: "gpt-4o-mini" },
  "openai/gpt-4.1-mini": { provider: "openai",    model: "gpt-4.1-mini" },
  "openai/gpt-4.1":      { provider: "openai",    model: "gpt-4.1" },
  // o-series / reasoning models only accept temperature=1 and consume extra tokens for thinking
  "openai/gpt-5-mini":   { provider: "openai",    model: "gpt-5-mini",   temperature: 1, maxTokens: 8192 },
  "anthropic/haiku-4.5": { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  "anthropic/sonnet-4.5":{ provider: "anthropic", model: "claude-sonnet-4-5-20250929" },
  "lm-studio":           { provider: "lm-studio", model: null },              // auto-detect first loaded
  "lm-studio/tower":     { provider: "lm-studio", model: "tower-plus-9b-mlx", batchSize: 5 }, // translation-specific
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

function getArg(flag: string, defaultVal: string | null): string | null {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : defaultVal;
}

const COUNT        = parseInt(getArg("--count", "10") ?? "10", 10);
const SEED         = parseInt(getArg("--seed", String(Date.now())) ?? String(Date.now()), 10);
const TYPE_FILTER  = getArg("--type", null);   // e.g. "expression", "example", "proverb"
const RANDOM_MODE  = args.includes("--random"); // random sample from examples.json
const GLOSSES_MODE = args.includes("--glosses"); // gloss translation comparison
const MULTI_SENSE  = args.includes("--multi-sense"); // only words with 2+ senses
const WORD_FILTER  = getArg("--word", null);    // filter to specific word(s), comma-separated
const FIXTURES     = !RANDOM_MODE && !GLOSSES_MODE; // default: curated idiom fixtures
const PROBE        = getArg("--probe", null);  // provider key to probe for raw output
const DEBUG        = args.includes("--debug"); // print raw model response + parsed map
// Override per-model batchSize for local models (e.g. --local-batch 3 for very slow machines)
const LOCAL_BATCH  = parseInt(getArg("--local-batch", "0") ?? "0", 10) || null;
// Bypass per-item cache and re-translate everything from scratch
const FRESH        = args.includes("--fresh");
// Disable JSON schema structured output (for A/B testing hallucination rates)
const NO_SCHEMA    = args.includes("--no-schema");

const GLOSS_DEFAULT_MODELS = [
  "openai/gpt-4.1-mini",
  "anthropic/haiku-4.5",
  "lm-studio/sauerkraut",
];

const modelsArg   = getArg("--models", null);
const ACTIVE_KEYS = modelsArg
  ? modelsArg.split(",").map(s => s.trim())
  : GLOSSES_MODE ? GLOSS_DEFAULT_MODELS : DEFAULT_MODELS;

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
- Each item: {"id":"...","translation":"..."} — copy the id exactly as shown
- Preserve the exact order of items; output one entry per input, no skipping
- Use JSON double quotes " for all strings
- No markdown fences, no function calls, no preamble, no trailing text`;

function buildIdiomPrompt(batch: BatchItem[]): string {
  const lines = [`Translate ${batch.length} German phrase(s) to English:\n`];
  for (const { id, text, type } of batch) {
    let line = `[${id}] ${text}`;
    if (type) line += `  (type: ${type})`;
    lines.push(line);
  }
  lines.push(`\nReply with ONLY a JSON array of exactly ${batch.length} items. Each item must use the exact id from the input above: [{"id":"the-id-from-above","translation":"..."}, ...]`);
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
- Each item: {"id":"...","translation":"...","annotations":[...]} — copy the id exactly as shown
- Preserve the exact order of items; output one entry per input, no skipping
- Use JSON double quotes " for all strings
- No markdown fences, no function calls, no preamble, no trailing text`;

function buildExamplesPrompt(batch: BatchItem[]): string {
  const lines = [`Translate ${batch.length} German sentence(s) to English and annotate content words:\n`];
  for (const { id, text } of batch) {
    lines.push(`[${id}] ${text}`);
  }
  lines.push('\nReply with: {"examples": [{"id":"...","translation":"...","annotations":[...]}, ...]}');
  return lines.join("\n");
}

// ── Gloss comparison mode ─────────────────────────────────────────────────────

// Imported from lib/prompts.js — ID-keyed batch format, no string-replace needed.
const GLOSS_BATCH_SYSTEM_PROMPT = GLOSS_BATCH_SYSTEM_PROMPT_FROM_LIB;

const WORDS_DIR_GLOSSES = join(ROOT, "data", "words");

function collectGlossItems(): GlossItem[] {
  const items: GlossItem[] = [];
  for (const posDir of POS_DIRS) {
    const dir = join(WORDS_DIR_GLOSSES, posDir);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const data = JSON.parse(readFileSync(join(dir, file), "utf-8")) as Word;
      const fileSlug = file.replace(/\.json$/, "").replace(/[^a-z0-9]/gi, "_").toLowerCase();
      for (let i = 0; i < (data.senses || []).length; i++) {
        const sense = data.senses[i];
        if (!sense.gloss) continue;
        const cleanGloss = stripReferences(sense.gloss);
        if (cleanGloss.length < 5) continue;
        const base = `word="${data.word}", pos="${data.pos}"`;
        const phraseType = (data as unknown as Record<string, unknown>).phrase_type as string | undefined;
        const typeClause = phraseType ? `, phrase_type="${phraseType}"` : "";
        const text = `${base}${typeClause}, gloss="${cleanGloss}"`;
        items.push({
          id: `${fileSlug}_${i}`,
          text,       // formatted prompt string — used as cache key + LLM input
          word: data.word,
          pos: data.pos,
          phraseType: phraseType || null,
          gloss: sense.gloss,
          cleanGloss,
          senseIdx: i,
        });
      }
    }
  }
  return items;
}

/**
 * Short stable hash derived from item text — used as the prompt-facing ID.
 * Opaque to the model (no semantic leak) and stable regardless of batch position.
 */
function glossPromptId(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

function buildGlossPrompt(batch: GlossItem[]): string {
  // Use content-hash IDs — opaque so no semantic leakage, stable so unaffected
  // by batch position changes when the cache filters out already-translated items.
  const lines: string[] = [
    `Translate ${batch.length} German gloss(es) to English.`,
    `Treat each entry as completely independent \u2014 do not let one entry influence another.\n`,
  ];
  for (const item of batch) {
    lines.push(`[${glossPromptId(item.text)}] ${item.text}`);
  }
  lines.push(
    `\nReply with ONLY a JSON array of exactly ${batch.length} items: ` +
    `[{"id":"the-hash-from-above","translation":"..."}, ...]`
  );
  return lines.join("\n");
}

// ── Seeded random sampling ────────────────────────────────────────────────────

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(1664525, s) + 1013904223 >>> 0;
    return s / 0x100000000;
  };
}

function pickRandom<T>(array: T[], n: number, seed: number): T[] {
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
const TRANSLATION_SCHEMA: Record<string, unknown> = {
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

const EXAMPLE_SCHEMA: Record<string, unknown> = {
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
function lemmaScore(refAnnotations: Annotation[], candAnnotations: Annotation[]): LemmaScoreResult {
  const toKey = (a: Annotation): string => `${a.lemma.toLowerCase()}|${a.pos}`;
  const ref  = (refAnnotations  || []).filter(a => CONTENT_POS.has(a.pos));
  const cand = (candAnnotations || []).filter(a => CONTENT_POS.has(a.pos));

  const refSet  = new Set(ref.map(toKey));
  const candSet = new Set(cand.map(toKey));

  if (refSet.size === 0 && candSet.size === 0) return { precision: 1, recall: 1, f1: 1, missing: [], extra: [] };
  if (refSet.size === 0) return { precision: 0, recall: 1, f1: 0, missing: [], extra: [...candSet] };

  const matchCount = [...candSet].filter(x => refSet.has(x)).length;
  const precision = candSet.size > 0 ? matchCount / candSet.size : 0;
  const recall    = matchCount / refSet.size;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  const missing = [...refSet].filter(x => !candSet.has(x));   // in ref but not in candidate
  const extra   = [...candSet].filter(x => !refSet.has(x));   // in candidate but not in ref

  return { precision, recall, f1, missing, extra };
}

// ── Translation via one model ─────────────────────────────────────────────────

type TranslateMode = "idioms" | "examples" | "glosses";

/**
 * Send a single chunk (subset of examples) to one model. Returns a partial map.
 * @param {object} opts
 * @param {'idioms'|'examples'} opts.mode - idioms: translation only; examples: translation + annotations
 */
async function translateChunk(chunk: BatchItem[], key: string, { mode = "idioms" as TranslateMode } = {}): Promise<ChunkResult> {
  const cfg = MODEL_REGISTRY[key];
  const isExamples = mode === "examples";
  const isGlosses  = mode === "glosses";

  const systemPrompt = isExamples ? EXAMPLES_SYSTEM_PROMPT
    : isGlosses        ? GLOSS_BATCH_SYSTEM_PROMPT
    :                    IDIOM_SYSTEM_PROMPT;
  const prompt = isExamples ? buildExamplesPrompt(chunk)
    : isGlosses        ? buildGlossPrompt(chunk as GlossItem[])
    :                    buildIdiomPrompt(chunk);

  // Budget: ~250 tokens/item for examples (annotations), ~50 for glosses, ~100 for idioms
  const perItem = isExamples ? 250 : isGlosses ? 50 : 100;
  const autoTokens = Math.max(512, chunk.length * perItem);

  // Use JSON schema for all providers — enforces well-formed output and reduces hallucinated fields
  // Can be disabled with --no-schema for A/B testing
  const useSchema = !NO_SCHEMA;
  const schema = isExamples ? EXAMPLE_SCHEMA : TRANSLATION_SCHEMA;

  const result = await retryWithBackoff(() =>
    callLLM(systemPrompt, prompt, {
      provider:    cfg.provider,
      model:       cfg.model ?? undefined,
      maxTokens:   cfg.maxTokens ?? autoTokens,
      temperature: cfg.temperature ?? 0.3,
      jsonSchema:  useSchema ? schema : undefined,
      jsonMode:    false,
    })
  , 2, 1500);

  let parsed: TranslationEntry[];
  try {
    const rawParsed = extractJSON(result.content) as unknown;
    if (Array.isArray(rawParsed)) {
      parsed = rawParsed as TranslationEntry[];
    } else if (rawParsed && typeof rawParsed === "object") {
      const obj = rawParsed as Record<string, unknown>;
      if (obj.id || obj.translation) {
        parsed = [obj as unknown as TranslationEntry];
      } else {
        const inner = Object.values(obj).find(v => Array.isArray(v));
        parsed = (inner as TranslationEntry[] | undefined) ?? [];
      }
    } else {
      parsed = [];
    }
  } catch (err) {
    throw new Error(`JSON parse failed: ${err instanceof Error ? err.message : String(err)}\nRaw (first 300 chars): ${result.content.slice(0, 300)}`);
  }

  if (DEBUG) {
    console.log(`\n[DEBUG raw] ${key} (chunk ${chunk[0]?.id}\u2026):\n${result.content.slice(0, 600)}`);
  }

  const map: Record<string, string> = {};
  const annotations: Record<string, Annotation[]> = {};

  // Pre-build hash→realId map for glosses mode remapping
  const glossHashToId: Record<string, string> = isGlosses
    ? Object.fromEntries(chunk.map(it => [glossPromptId(it.text), it.id]))
    : {};

  for (const item of parsed) {
    if (item.id === undefined || item.id === null) continue;
    // In glosses mode the prompt uses content-hash IDs to avoid leaking semantic
    // context via file slugs. Remap them back to real cache IDs using the hash map.
    let realId: string;
    if (isGlosses) {
      realId = glossHashToId[String(item.id)] ?? String(item.id);
    } else {
      realId = item.id;
    }
    map[realId] = item.translation ?? "(no translation)";
    if (isExamples && Array.isArray(item.annotations)) {
      annotations[realId] = item.annotations.filter(a => a.form && a.lemma && a.pos);
    }
  }

  // Detect likely mix-ups: if two items in the same batch share the exact same translation,
  // the model may have copy-pasted one into the other's slot. Log a warning so it shows up.
  const seenTranslations: Record<string, string> = {};
  for (const [id, trans] of Object.entries(map)) {
    const norm = trans.trim().toLowerCase();
    if (seenTranslations[norm]) {
      console.warn(`  \u26a0\ufe0f  [${key}] Possible mix-up: items "${seenTranslations[norm]}" and "${id}" have identical translation: "${trans}"`);
    } else {
      seenTranslations[norm] = id;
    }
  }

  // Positional fallback for local models that return <function> blocks instead of JSON
  if (Object.keys(map).length === 0) {
    const funcBlocks = [...result.content.matchAll(/<function[^>]*>([\s\S]*?)(?:<\/function>|$)/g)];
    if (funcBlocks.length > 0 && funcBlocks.length <= chunk.length) {
      for (let i = 0; i < funcBlocks.length; i++) {
        const inner = funcBlocks[i][1].trim();
        let text: string | null = null;
        try {
          const asJson = inner.replace(/'((?:[^'\\]|\\.)*)'/g, (_: string, v: string) =>
            `"${v.replace(/\\'/g, "'").replace(/(?<!\\)"/g, '\\"')}"`
          );
          const obj = JSON.parse(asJson.startsWith('{') ? asJson : `{${asJson}}`) as Record<string, unknown>;
          text = (obj.text ?? obj.translation ?? obj.output ?? null) as string | null;
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
async function translateWith(batch: BatchItem[], key: string, { mode = "idioms" as TranslateMode } = {}): Promise<TranslateResult> {
  const cfg = MODEL_REGISTRY[key];
  if (!cfg) throw new Error(`Unknown model key: "${key}". Available: ${Object.keys(MODEL_REGISTRY).join(", ")}`);

  // For glosses mode, local models must process one item at a time — batching causes
  // context bleed where a long gloss infects the next item's response in the same chunk.
  const isGlosses = mode === "glosses";
  const defaultBatch = (isGlosses && isLocalProvider(cfg.provider)) ? 1 : cfg.batchSize;
  // Determine chunk size: CLI override > per-model config > full batch at once
  const chunkSize = LOCAL_BATCH ?? defaultBatch ?? batch.length;

  if (chunkSize < batch.length) {
    // Split into sequential sub-batches and merge results
    const fullMap: Record<string, string> = {};
    const fullAnnotations: Record<string, Annotation[]> = {};
    for (let i = 0; i < batch.length; i += chunkSize) {
      const chunk = batch.slice(i, i + chunkSize);
      if (DEBUG) console.log(`  [DEBUG] ${key}: chunk ${i / chunkSize + 1}/${Math.ceil(batch.length / chunkSize)} (${chunk.length} items)`);
      const { map, annotations } = await translateChunk(chunk, key, { mode });
      Object.assign(fullMap, map);
      Object.assign(fullAnnotations, annotations);
    }
    return { map: fullMap, annotations: fullAnnotations };
  }

  const { map, annotations } = await translateChunk(batch, key, { mode });
  return { map, annotations };
}

// ── Per-item result cache ─────────────────────────────────────────────────────
//
// Caches each (modelKey, itemId) pair individually so that adding new fixtures
// or changing batch size doesn't invalidate existing results.
//
// Layout: data/raw/llm-compare-cache/{model_slug}/{item_id}.json
// Content: { text, translation, annotations? }
//
// Text is stored alongside the translation so stale cache entries are detected
// when a fixture's source text is edited.

const COMPARE_CACHE_DIR = join(ROOT, "data", "raw", "llm-compare-cache");

function modelCacheSlug(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function itemCachePath(modelKey: string, itemId: string): string {
  return join(COMPARE_CACHE_DIR, modelCacheSlug(modelKey), `${itemId}.json`);
}

function readItemCache(modelKey: string, itemId: string, expectedText: string): CacheEntry | null {
  if (FRESH) return null;
  const p = itemCachePath(modelKey, itemId);
  if (!existsSync(p)) return null;
  try {
    const entry = JSON.parse(readFileSync(p, "utf-8")) as CacheEntry;
    // Invalidate if the source text has changed
    if (entry.text !== expectedText) return null;
    return entry;
  } catch { return null; }
}

function writeItemCache(modelKey: string, itemId: string, data: CacheEntry): void {
  const p = itemCachePath(modelKey, itemId);
  const dir = dirname(p);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(p, JSON.stringify(data));
  } catch { /* non-fatal */ }
}

/**
 * Translate a batch with one model, using per-item caching.
 *
 * Items whose (modelKey, itemId, text) are already cached are returned
 * immediately. Only uncached items are sent to the API (still batched).
 * New results are written to cache after each API call.
 *
 * @returns {{ map, annotations, fromCache: number, fromApi: number }}
 */
async function translateWithCache(batch: BatchItem[], key: string, { mode = "idioms" as TranslateMode } = {}): Promise<CachedTranslateResult> {
  const cachedMap: Record<string, string> = {};
  const cachedAnnotations: Record<string, Annotation[]> = {};
  const uncached: BatchItem[] = [];

  for (const item of batch) {
    const entry = readItemCache(key, item.id, item.text);
    if (entry?.translation) {
      cachedMap[item.id] = entry.translation;
      if (entry.annotations) cachedAnnotations[item.id] = entry.annotations;
    } else {
      uncached.push(item);
    }
  }

  if (uncached.length === 0) {
    return { map: cachedMap, annotations: cachedAnnotations, fromCache: batch.length, fromApi: 0 };
  }

  const { map: newMap, annotations: newAnnotations } = await translateWith(uncached, key, { mode });

  // Persist each new result individually
  for (const item of uncached) {
    if (newMap[item.id]) {
      const entry: CacheEntry = { text: item.text, translation: newMap[item.id] };
      if (newAnnotations[item.id]) entry.annotations = newAnnotations[item.id];
      writeItemCache(key, item.id, entry);
    }
  }

  return {
    map: { ...cachedMap, ...newMap },
    annotations: { ...cachedAnnotations, ...newAnnotations },
    fromCache: Object.keys(cachedMap).length,
    fromApi: Object.keys(newMap).length,
  };
}

// ── Probe mode: single request, raw output ────────────────────────────────────

async function runProbe(providerKey: string): Promise<void> {
  const cfg = MODEL_REGISTRY[providerKey];
  if (!cfg) {
    console.error(`Unknown provider key: "${providerKey}"`);
    console.error(`Available: ${Object.keys(MODEL_REGISTRY).join(", ")}`);
    process.exit(1);
  }

  const examples = loadExamples();
  if (Object.keys(examples).length === 0) {
    console.error("No examples found.");
    process.exit(1);
  }
  const withTrans = Object.entries(examples)
    .filter(([, ex]) => ex.translation)
    .slice(0, 3)
    .map(([id, ex]) => ({ id, text: ex.text, type: ex.type ?? null }));

  const prompt = buildIdiomPrompt(withTrans);

  console.log(`\n\u2500\u2500 Probe: ${providerKey} (provider: ${cfg.provider}, model: ${cfg.model ?? "auto"}) \u2500\u2500`);
  console.log("\n\u2500\u2500 User prompt sent \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.log(prompt);
  console.log("\n\u2500\u2500 Raw response \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");

  let raw: LLMResponse;
  try {
    raw = await callLLM(IDIOM_SYSTEM_PROMPT, prompt, {
      provider:    cfg.provider,
      model:       cfg.model ?? undefined,
      maxTokens:   512,
      temperature: 0.3,
      jsonMode:    !isLocalProvider(cfg.provider),
    });
    console.log(raw.content);
    console.log(`\nTokens: ${raw.input_tokens} in / ${raw.output_tokens} out`);
  } catch (err) {
    console.error(`ERROR calling model: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log("\n\u2500\u2500 extractJSON result \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  try {
    const parsed = extractJSON(raw.content) as unknown;
    console.log(JSON.stringify(parsed, null, 2));
    console.log("\n\u2713 JSON extracted successfully");
  } catch (err) {
    console.error(`\u2717 extractJSON failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Quality scoring (BLEU-1) ──────────────────────────────────────────────────

/**
 * Tokenise a translation string into lowercase word tokens.
 */
function tokenize(text: string): string[] {
  return (text || "").toLowerCase().match(/\b[a-z']+\b/g) || [];
}

/**
 * BLEU-1: unigram precision with brevity penalty.
 * Returns a value in [0, 1].  1.0 = perfect match.
 */
function bleu1(reference: string, candidate: string): number {
  const refTokens  = tokenize(reference);
  const candTokens = tokenize(candidate);
  if (!candTokens.length) return 0;
  if (!refTokens.length)  return 0;

  // Clipped unigram counts
  const refCounts: Record<string, number> = {};
  for (const w of refTokens) refCounts[w] = (refCounts[w] || 0) + 1;

  let matchCount = 0;
  const seen: Record<string, number> = {};
  for (const w of candTokens) {
    seen[w] = (seen[w] || 0) + 1;
    if (seen[w] <= (refCounts[w] || 0)) matchCount++;
  }

  const precision = matchCount / candTokens.length;
  // Brevity penalty: penalise candidates shorter than the reference
  const bp = candTokens.length >= refTokens.length
    ? 1
    : Math.exp(1 - refTokens.length / candTokens.length);

  return bp * precision;
}

/**
 * Multi-reference BLEU-1: score a candidate against one or more reference strings.
 * Returns the maximum bleu1 score across all references.
 * Accepts a single string or string[].
 */
function bleuScore(refs: string[], candidate: string): number {
  const refList = Array.isArray(refs) ? refs : [refs];
  return Math.max(...refList.map(r => bleu1(r, candidate)));
}

// ── Display ───────────────────────────────────────────────────────────────────

const LABEL_WIDTH = 22;
const TRANS_WIDTH = 68;

function wrapAt(text: string | null | undefined, width: number): string[] {
  if (!text) return ["(\u2014)"];
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > width) { lines.push(cur); cur = w; }
    else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

function printResult(examples: BatchItem[], refMap: Record<string, string[]>, resultsByKey: Record<string, Record<string, string>>): void {
  const divider = "\u2500".repeat(LABEL_WIDTH + TRANS_WIDTH + 5);

  for (let i = 0; i < examples.length; i++) {
    const { id, text, type } = examples[i];
    const typeTag = type ? `  [${type}]` : "";
    console.log(`\n${i + 1}. ${text}${typeTag}`);
    console.log(divider);

    // Reference (show primary; hint if multiple exist)
    const refs = refMap[id];
    const refLines = wrapAt(refs[0], TRANS_WIDTH);
    const refLabel = refs.length > 1 ? `Reference (+${refs.length - 1})` : "Reference";
    console.log(`  ${refLabel.padEnd(LABEL_WIDTH)} ${refLines[0]}`);
    for (let j = 1; j < refLines.length; j++) {
      console.log(`  ${"".padEnd(LABEL_WIDTH)} ${refLines[j]}`);
    }

    // Compute best score so we can mark the winner
    const itemScores = ACTIVE_KEYS
      .filter(k => resultsByKey[k]?.[id] !== undefined)
      .map(k => bleuScore(refs, resultsByKey[k][id]));
    const bestScore = itemScores.length ? Math.max(...itemScores) : -1;

    // Each model
    for (const key of ACTIVE_KEYS) {
      const trans = resultsByKey[key]?.[id];
      if (trans === undefined) { console.log(`  ${key.padEnd(LABEL_WIDTH)} (skipped)`); continue; }

      const score = bleuScore(refs, trans);
      const winner = itemScores.length > 1 && score >= bestScore - 0.001 ? " \u2605" : "";
      const scoreTag = ` [${score.toFixed(2)}]${winner}`;
      const tLines = wrapAt(trans, TRANS_WIDTH);
      console.log(`  ${key.padEnd(LABEL_WIDTH)} ${tLines[0]}${scoreTag}`);
      for (let j = 1; j < tLines.length; j++) {
        console.log(`  ${"".padEnd(LABEL_WIDTH)} ${tLines[j]}`);
      }
    }
  }
  console.log();
}

function printSummary(examples: BatchItem[], refMap: Record<string, string[]>, resultsByKey: Record<string, Record<string, string>>, timings: Record<string, number>, skipped: Set<string>): void {
  // Compute per-model win counts
  const activeKeys = ACTIVE_KEYS.filter(k => !skipped.has(k) && resultsByKey[k]);
  const wins: Record<string, number> = Object.fromEntries(activeKeys.map(k => [k, 0]));
  for (const { id } of examples) {
    const scored = activeKeys
      .filter(k => resultsByKey[k]?.[id])
      .map(k => ({ key: k, score: bleuScore(refMap[id], resultsByKey[k][id]) }));
    if (!scored.length) continue;
    const best = Math.max(...scored.map(s => s.score));
    for (const { key, score } of scored) {
      if (score >= best - 0.001) wins[key]++;
    }
  }

  // Sort active keys by avg BLEU descending for display
  const sorted = [...ACTIVE_KEYS].sort((a, b) => {
    const mapA = resultsByKey[a], mapB = resultsByKey[b];
    if (!mapA && !mapB) return 0;
    if (!mapA) return 1;
    if (!mapB) return -1;
    const avgA = examples.filter(({ id }) => mapA[id]).reduce((s, { id }) => s + bleuScore(refMap[id], mapA[id]), 0) / examples.length;
    const avgB = examples.filter(({ id }) => mapB[id]).reduce((s, { id }) => s + bleuScore(refMap[id], mapB[id]), 0) / examples.length;
    return avgB - avgA;
  });

  console.log("\u2500\u2500 Summary \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.log(`  ${"Model".padEnd(LABEL_WIDTH)} ${"Parsed".padEnd(9)} ${"Avg BLEU-1".padEnd(12)} ${"Min".padEnd(6)} ${"Max".padEnd(6)} ${"Wins".padEnd(6)} Time`);
  console.log(`  ${"\u2500".repeat(LABEL_WIDTH)} ${"\u2500".repeat(8)} ${"\u2500".repeat(11)} ${"\u2500".repeat(5)} ${"\u2500".repeat(5)} ${"\u2500".repeat(5)} ${"\u2500".repeat(6)}`);
  for (const key of sorted) {
    if (skipped.has(key)) {
      console.log(`  ${key.padEnd(LABEL_WIDTH)} skipped (no API key)`);
      continue;
    }
    const map = resultsByKey[key];
    if (!map) { console.log(`  ${key.padEnd(LABEL_WIDTH)} FAILED`); continue; }

    const ok = examples.filter(({ id }) => map[id]).length;
    const scores = examples
      .filter(({ id }) => map[id])
      .map(({ id }) => bleuScore(refMap[id], map[id]));

    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const min = scores.length ? Math.min(...scores) : 0;
    const max = scores.length ? Math.max(...scores) : 0;
    const ms  = timings[key] != null ? `${(timings[key] / 1000).toFixed(1)}s` : "?";
    const w   = wins[key] ?? 0;

    console.log(
      `  ${key.padEnd(LABEL_WIDTH)} ${String(ok + "/" + examples.length).padEnd(9)}` +
      ` ${avg.toFixed(3).padEnd(12)} ${min.toFixed(2).padEnd(6)} ${max.toFixed(2).padEnd(6)} ${String(w).padEnd(6)} ${ms}`
    );
  }
}

// ── Markdown report ────────────────────────────────────────────────────────────

function mdCell(text: string | null | undefined): string {
  return (text ?? "\u2014").toString().replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function generateMarkdownReport(examples: BatchItem[], refMap: Record<string, string[]>, resultsByKey: Record<string, Record<string, string>>, timings: Record<string, number>, skipped: Set<string>, meta: ReportMeta): string {
  const { seed, typeFilter, fixtures, mode, refAnnotationsMap, annotationsByKey } = meta;
  const isExamples = mode === "examples";
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const activeKeys = ACTIVE_KEYS.filter(k => !skipped.has(k) && resultsByKey[k]);
  const lines: string[] = [];

  // ── Header
  lines.push(`# Translation Model Comparison`);
  lines.push(``);
  lines.push(`**Date**: ${now}  |  **Count**: ${examples.length}  |  **Seed**: ${seed}${typeFilter ? `  |  **Type**: ${typeFilter}` : ""}  |  **Mode**: ${fixtures ? "fixtures" : "examples"}`);
  lines.push(``);
  lines.push(`**Models**: ${ACTIVE_KEYS.join(" \u00b7 ")}`);
  lines.push(``);

  // ── Summary table
  lines.push(`## Summary`);
  lines.push(``);
  // Compute wins per model for summary table
  const mdWins: Record<string, number> = Object.fromEntries(activeKeys.map(k => [k, 0]));
  for (const { id } of examples) {
    const scored = activeKeys
      .filter(k => resultsByKey[k]?.[id])
      .map(k => ({ key: k, score: bleuScore(refMap[id], resultsByKey[k][id]) }));
    if (!scored.length) continue;
    const best = Math.max(...scored.map(s => s.score));
    for (const { key, score } of scored) {
      if (score >= best - 0.001) mdWins[key]++;
    }
  }

  // Sort models by avg BLEU descending for the summary table
  const sortedKeys = [...ACTIVE_KEYS].sort((a, b) => {
    const mapA = resultsByKey[a], mapB = resultsByKey[b];
    if (!mapA && !mapB) return 0;
    if (!mapA) return 1;
    if (!mapB) return -1;
    const avgA = examples.filter(({ id }) => mapA[id]).reduce((s, { id }) => s + bleuScore(refMap[id], mapA[id]), 0) / examples.length;
    const avgB = examples.filter(({ id }) => mapB[id]).reduce((s, { id }) => s + bleuScore(refMap[id], mapB[id]), 0) / examples.length;
    return avgB - avgA;
  });

  if (isExamples) {
    lines.push(`| Model | Parsed | Avg BLEU-1 | Wins | Avg Lemma F1 | Avg Precision | Avg Recall | Time |`);
    lines.push(`|:---|---:|---:|---:|---:|---:|---:|---:|`);
  } else {
    lines.push(`| Model | Parsed | Avg BLEU-1 | Wins | Min | Max | Time |`);
    lines.push(`|:---|---:|---:|---:|---:|---:|---:|`);
  }

  for (const key of sortedKeys) {
    if (skipped.has(key)) {
      lines.push(`| ${key} | skipped | \u2014 | \u2014 | \u2014 | \u2014 | \u2014 |${isExamples ? " \u2014 |" : ""}`);
      continue;
    }
    const map = resultsByKey[key];
    if (!map) {
      lines.push(`| **${key}** | **FAILED** | \u2014 | \u2014 | \u2014 | \u2014 | \u2014 |${isExamples ? " \u2014 |" : ""}`);
      continue;
    }
    const scores = examples.filter(({ id }) => map[id]).map(({ id }) => bleuScore(refMap[id], map[id]));
    const ok  = scores.length;
    const avg = ok ? scores.reduce((a, b) => a + b, 0) / ok : 0;
    const min = ok ? Math.min(...scores) : 0;
    const max = ok ? Math.max(...scores) : 0;
    const ms  = timings[key] != null ? `${(timings[key] / 1000).toFixed(1)}s` : "?";
    const w   = mdWins[key] ?? 0;

    if (isExamples) {
      const annMap = annotationsByKey?.[key] || {};
      const lemmaScores = examples
        .filter(({ id }) => map[id] && refAnnotationsMap?.[id])
        .map(({ id }) => lemmaScore(refAnnotationsMap![id], annMap[id] || []));
      const avgF1  = lemmaScores.length ? lemmaScores.reduce((a, s) => a + s.f1, 0) / lemmaScores.length : 0;
      const avgP   = lemmaScores.length ? lemmaScores.reduce((a, s) => a + s.precision, 0) / lemmaScores.length : 0;
      const avgR   = lemmaScores.length ? lemmaScores.reduce((a, s) => a + s.recall, 0) / lemmaScores.length : 0;
      lines.push(`| ${key} | ${ok}/${examples.length} | **${avg.toFixed(3)}** | ${w} | **${avgF1.toFixed(3)}** | ${avgP.toFixed(3)} | ${avgR.toFixed(3)} | ${ms} |`);
    } else {
      lines.push(`| ${key} | ${ok}/${examples.length} | **${avg.toFixed(3)}** | ${w} | ${min.toFixed(2)} | ${max.toFixed(2)} | ${ms} |`);
    }
  }
  lines.push(``);

  // ── Per-example stats
  const exStats: ExampleStat[] = examples.map(({ id, text, type }) => {
    const scores = activeKeys.map(k => {
      const t = resultsByKey[k]?.[id];
      return t ? bleuScore(refMap[id], t) : null;
    }).filter((s): s is number => s !== null);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const min = scores.length ? Math.min(...scores) : 0;
    const max = scores.length ? Math.max(...scores) : 0;
    const variance = scores.length > 1
      ? scores.reduce((acc, s) => acc + (s - avg) ** 2, 0) / scores.length
      : 0;

    // Which model(s) won this item
    const winners = scores.length
      ? activeKeys.filter(k => {
          const t = resultsByKey[k]?.[id];
          return t && bleuScore(refMap[id], t) >= max - 0.001;
        })
      : [];

    // Lemma stats per example (examples mode only)
    let avgLemmaF1: number | null = null;
    if (isExamples && refAnnotationsMap?.[id]) {
      const f1s = activeKeys.map(k => {
        const annMap = annotationsByKey?.[k] || {};
        return lemmaScore(refAnnotationsMap[id], annMap[id] || []).f1;
      });
      avgLemmaF1 = f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : 0;
    }

    return { id, text, type, avg, min, max, stddev: Math.sqrt(variance), avgLemmaF1, winners };
  });

  function renderExampleTable(stat: ExampleStat): void {
    const { id, text, type } = stat;
    const typeTag = type ? ` \`[${type}]\`` : "";
    const refs = refMap[id];
    // Show primary ref in heading; list alternatives inline if multiple
    const refDisplay = refs.length > 1
      ? `${mdCell(refs[0])}  _(also: ${refs.slice(1).map(r => `"${mdCell(r)}"`).join(" \u00b7 ")})_`
      : mdCell(refs[0]);
    lines.push(`> **"${mdCell(text)}"**${typeTag}`);
    lines.push(`> _Ref: ${refDisplay}_`);
    lines.push(``);

    // Compute per-model scores for this item to bold the winner(s)
    const itemScoreMap: Record<string, number | null> = Object.fromEntries(
      activeKeys.map(k => {
        const t = resultsByKey[k]?.[id];
        return [k, t != null ? bleuScore(refs, t) : null];
      })
    );
    const validScores = Object.values(itemScoreMap).filter((s): s is number => s !== null);
    const itemBest = validScores.length ? Math.max(...validScores) : -1;

    if (isExamples) {
      lines.push(`| Model | Translation | BLEU-1 | Lemma F1 | Missing | Extra |`);
      lines.push(`|:---|:---|---:|---:|:---|:---|`);
      // Show reference lemmas
      const refAnns = (refAnnotationsMap?.[id] || []).filter(a => CONTENT_POS.has(a.pos));
      const refLemmas = refAnns.map(a => `${a.lemma}(${a.pos[0]})`).join(", ");
      lines.push(`| _Reference_ | _${mdCell(refs[0])}_ | \u2014 | \u2014 | _${refLemmas}_ | \u2014 |`);
      for (const key of activeKeys) {
        const t = resultsByKey[key]?.[id];
        const rawScore = itemScoreMap[key];
        const isBest = rawScore !== null && rawScore >= itemBest - 0.001 && validScores.length > 1;
        const bScore = rawScore != null ? (isBest ? `**${rawScore.toFixed(2)}**` : rawScore.toFixed(2)) : "\u2014";
        const annMap = annotationsByKey?.[key] || {};
        const ls = lemmaScore(refAnnotationsMap?.[id] || [], annMap[id] || []);
        const missingStr = ls.missing.length ? ls.missing.map(m => m.split("|").join("(") + ")").join(", ") : "\u2014";
        const extraStr = ls.extra.length ? ls.extra.map(e => e.split("|").join("(") + ")").join(", ") : "\u2014";
        lines.push(`| ${key} | ${mdCell(t ?? "(missing)")} | ${bScore} | ${ls.f1.toFixed(2)} | ${missingStr} | ${extraStr} |`);
      }
    } else {
      lines.push(`| Model | Translation | BLEU-1 |`);
      lines.push(`|:---|:---|---:|`);
      lines.push(`| _Reference_ | _${mdCell(refs[0])}_ | \u2014 |`);
      for (const key of activeKeys) {
        const t = resultsByKey[key]?.[id];
        const rawScore = itemScoreMap[key];
        const isBest = rawScore !== null && rawScore >= itemBest - 0.001 && validScores.length > 1;
        const scoreStr = rawScore != null ? (isBest ? `**${rawScore.toFixed(2)}**` : rawScore.toFixed(2)) : "\u2014";
        lines.push(`| ${key} | ${mdCell(t ?? "(missing)")} | ${scoreStr} |`);
      }
    }

    lines.push(``);
    let statsLine = `*avg ${stat.avg.toFixed(2)} \u00b7 min ${stat.min.toFixed(2)} \u00b7 max ${stat.max.toFixed(2)} \u00b7 \u03c3 ${stat.stddev.toFixed(2)}`;
    if (stat.avgLemmaF1 != null) statsLine += ` \u00b7 lemma F1 ${stat.avgLemmaF1.toFixed(2)}`;
    if (stat.winners.length) statsLine += ` \u00b7 \ud83c\udfc6 ${stat.winners.join(", ")}`;
    statsLine += `*`;
    lines.push(statsLine);
    lines.push(``);
  }

  const TOP_N = Math.min(3, examples.length);

  // ── Most contested
  lines.push(`## Most Contested  _(models disagree most \u2014 highest \u03c3)_`);
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
    ? (a: ExampleStat, b: ExampleStat) => (a.avgLemmaF1 ?? 1) - (b.avgLemmaF1 ?? 1)  // worst lemma first
    : (a: ExampleStat, b: ExampleStat) => a.avg - b.avg;
  [...exStats].sort(sortKey).forEach(renderExampleTable);

  return lines.join("\n");
}

function writeReport(examples: BatchItem[], refMap: Record<string, string[]>, resultsByKey: Record<string, Record<string, string>>, timings: Record<string, number>, skipped: Set<string>, meta: ReportMeta): string {
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

// ── Gloss mode: report + main runner ──────────────────────────────────────────

function generateGlossReport(selected: GlossItem[], activeKeys: string[], resultsByKey: Record<string, Record<string, string>>, timings: Record<string, number>, skipped: Set<string>): string {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const lines: string[] = [];

  lines.push(`# Gloss Translation Comparison`);
  lines.push(``);
  lines.push(`**Date**: ${now}  |  **Count**: ${selected.length}`);
  lines.push(``);
  lines.push(`**Models**: ${ACTIVE_KEYS.join(" \u00b7 ")}`);
  lines.push(``);

  // Agreement stats per model pair
  const itemsWithAll = selected.filter(item => activeKeys.every(k => resultsByKey[k]?.[item.id]));
  const agreed = itemsWithAll.filter(item => {
    const ts = activeKeys.map(k => resultsByKey[k][item.id].toLowerCase());
    return ts.every(t => t === ts[0]);
  });

  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`Overall agreement: **${agreed.length}/${itemsWithAll.length}** (${Math.round(agreed.length / Math.max(itemsWithAll.length, 1) * 100)}%)`);
  lines.push(``);
  lines.push(`| Model | Parsed | Time |`);
  lines.push(`|:---|---:|---:|`);
  for (const key of ACTIVE_KEYS) {
    if (skipped.has(key)) { lines.push(`| ${key} | skipped | \u2014 |`); continue; }
    const map = resultsByKey[key];
    if (!map) { lines.push(`| **${key}** | **FAILED** | \u2014 |`); continue; }
    const ok = selected.filter(item => map[item.id]).length;
    const ms = timings[key] != null ? `${(timings[key] / 1000).toFixed(1)}s` : "?";
    lines.push(`| ${key} | ${ok}/${selected.length} | ${ms} |`);
  }
  lines.push(``);

  // Disagreements
  const disagreements = itemsWithAll.filter(item => {
    const ts = activeKeys.map(k => resultsByKey[k][item.id].toLowerCase());
    return !ts.every(t => t === ts[0]);
  });

  if (disagreements.length) {
    lines.push(`## Disagreements (${disagreements.length})`);
    lines.push(``);
    for (const item of disagreements) {
      lines.push(`> **"${mdCell(item.word)}"** \`${item.pos}\`  `);
      lines.push(`> _${mdCell(item.cleanGloss)}_`);
      lines.push(``);
      lines.push(`| Model | Translation |`);
      lines.push(`|:---|:---|`);
      for (const key of activeKeys) {
        lines.push(`| ${key} | ${mdCell(resultsByKey[key]?.[item.id] ?? "(missing)")} |`);
      }
      lines.push(``);
    }
  }

  // All items
  lines.push(`## All Glosses`);
  lines.push(``);
  lines.push(`| Word | POS | Gloss | ${activeKeys.map(k => k.split("/").pop()).join(" | ")} | \u2713 |`);
  lines.push(`|:---|:---|:---|${activeKeys.map(() => ":---|").join("")}:---|`);
  for (const item of selected) {
    const ts = activeKeys.map(k => mdCell(resultsByKey[k]?.[item.id] ?? "\u2014"));
    const allSame = activeKeys.every(k => resultsByKey[k]?.[item.id]?.toLowerCase() === resultsByKey[activeKeys[0]]?.[item.id]?.toLowerCase());
    lines.push(`| ${mdCell(item.word)} | ${item.pos} | ${mdCell(item.cleanGloss)} | ${ts.join(" | ")} | ${allSame ? "\u2713" : "\u2260"} |`);
  }
  lines.push(``);

  return lines.join("\n");
}

function writeGlossReport(selected: GlossItem[], activeKeys: string[], resultsByKey: Record<string, Record<string, string>>, timings: Record<string, number>, skipped: Set<string>): void {
  const md = generateGlossReport(selected, activeKeys, resultsByKey, timings, skipped);
  const reportsDir = join(ROOT, "reports");
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const filename = `glosses-${ts}.md`;
  const outPath = join(reportsDir, filename);
  writeFileSync(outPath, md);
  console.log(`\nReport written to: reports/${filename}`);
}

async function runGlossMode(): Promise<void> {
  let pool = collectGlossItems();
  console.log(`Collected ${pool.length} glosses total.`);

  // Filter by specific word(s)
  if (WORD_FILTER) {
    const words = WORD_FILTER.toLowerCase().split(",").map(w => w.trim());
    pool = pool.filter(item => words.includes(item.word.toLowerCase()));
    console.log(`Filtered to ${pool.length} glosses for word(s): ${WORD_FILTER}`);
  }

  // Filter to multi-sense words (same word+pos with 2+ senses)
  if (MULTI_SENSE) {
    const counts: Record<string, number> = {};
    for (const item of pool) {
      const k = `${item.word.toLowerCase()}_${item.pos}`;
      counts[k] = (counts[k] || 0) + 1;
    }
    pool = pool.filter(item => counts[`${item.word.toLowerCase()}_${item.pos}`] > 1);
    console.log(`Filtered to ${pool.length} glosses from multi-sense words.`);
  }

  if (pool.length === 0) {
    console.error("No matching glosses found.");
    process.exit(1);
  }

  const count = parseInt(getArg("--count", "30") ?? "30", 10);
  const selected = (WORD_FILTER && !MULTI_SENSE)
    ? pool  // show all senses for the requested word(s)
    : pickRandom(pool, Math.min(count, pool.length), SEED);

  console.log(`\nGloss comparison \u2014 ${selected.length} items  (seed: ${SEED})`);
  console.log(`Models: ${ACTIVE_KEYS.join("  \u00b7  ")}\n`);

  const resultsByKey: Record<string, Record<string, string>> = {};
  const timings: Record<string, number> = {};
  const skipped = new Set<string>();

  for (const key of ACTIVE_KEYS) {
    if (!MODEL_REGISTRY[key]) {
      console.error(`Unknown model key: "${key}". Available: ${Object.keys(MODEL_REGISTRY).join(", ")}`);
      process.exit(1);
    }
    const { provider } = MODEL_REGISTRY[key];
    if (!isLocalProvider(provider) && !getApiKey(provider)) {
      console.log(`  Skipping ${key} (no API key)`);
      skipped.add(key);
      continue;
    }
    process.stdout.write(`  Running ${key.padEnd(LABEL_WIDTH)}... `);
    const t0 = Date.now();
    try {
      const { map, fromCache, fromApi } = await translateWithCache(selected, key, { mode: "glosses" });
      timings[key] = Date.now() - t0;
      resultsByKey[key] = map;
      const cacheNote = fromCache > 0 ? ` (${fromCache} cached, ${fromApi} new)` : "";
      console.log(`${Object.keys(map).length}/${selected.length}${cacheNote}  (${(timings[key] / 1000).toFixed(1)}s)`);
    } catch (err) {
      timings[key] = Date.now() - t0;
      console.log(`FAILED: ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}`);
    }
  }

  const activeKeys = ACTIVE_KEYS.filter(k => !skipped.has(k) && resultsByKey[k]);

  // Print side-by-side results
  console.log();
  for (let i = 0; i < selected.length; i++) {
    const item = selected[i];
    const ts = activeKeys.map(k => resultsByKey[k]?.[item.id] ?? "(missing)");
    const allSame = ts.length > 1 && ts.every(t => t.toLowerCase() === ts[0].toLowerCase());
    const marker = allSame ? "\u2713" : "\u2260";
    console.log(`[${i + 1}/${selected.length}] "${item.word}" (${item.pos})  ${marker}  ${ts.join("  |  ")}`);
  }

  // Agreement summary
  const itemsWithAll = selected.filter(item => activeKeys.every(k => resultsByKey[k]?.[item.id]));
  const agreed = itemsWithAll.filter(item => {
    const ts = activeKeys.map(k => resultsByKey[k][item.id].toLowerCase());
    return ts.every(t => t === ts[0]);
  });

  console.log(`\n${"\u2500".repeat(80)}`);
  console.log(`Agreement: ${agreed.length}/${itemsWithAll.length} (${Math.round(agreed.length / Math.max(itemsWithAll.length, 1) * 100)}%)\n`);

  // Disagreements
  const disagreements = itemsWithAll.filter(item => {
    const ts = activeKeys.map(k => resultsByKey[k][item.id].toLowerCase());
    return !ts.every(t => t === ts[0]);
  });
  if (disagreements.length) {
    console.log(`DISAGREEMENTS (${disagreements.length}):\n`);
    for (const item of disagreements) {
      console.log(`  word="${item.word}"  pos=${item.pos}`);
      console.log(`  gloss: ${item.cleanGloss}`);
      for (const key of activeKeys) {
        console.log(`    ${key.padEnd(38)} \u2192 ${resultsByKey[key][item.id] ?? "ERROR"}`);
      }
      console.log();
    }
  }

  // Timing
  console.log("Avg response time:");
  for (const key of activeKeys) {
    const ms = timings[key];
    console.log(`  ${key}: ${ms != null ? (ms / 1000).toFixed(1) + "s" : "?"}`);
  }

  writeGlossReport(selected, activeKeys, resultsByKey, timings, skipped);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Probe mode
  if (PROBE) {
    await runProbe(PROBE);
    return;
  }

  // Glosses mode
  if (GLOSSES_MODE) {
    await runGlossMode();
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
  const missingKeys: string[] = [];
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
    const fixtures = JSON.parse(readFileSync(fixturesFile, "utf-8")) as FixtureItem[];
    const selected  = fixtures;
    const batch: BatchItem[]     = selected.map(({ id, text, type }) => ({ id, text, type }));
    // refMap stores an array of accepted translations per item (multi-ref BLEU)
    const refMap: Record<string, string[]>    = Object.fromEntries(selected.map(({ id, ref, refs }) => [id, refs ?? (ref ? [ref] : [])]));

    console.log(`\nModel comparison \u2014 ${selected.length} curated idioms`);
    console.log(`Models: ${ACTIVE_KEYS.join("  \u00b7  ")}\n`);

    const resultsByKey: Record<string, Record<string, string>> = {};
    const timings: Record<string, number>      = {};
    const skipped = new Set<string>();

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
        const { map, fromCache, fromApi } = await translateWithCache(batch, key);
        timings[key] = Date.now() - t0;
        resultsByKey[key] = map;
        const cacheNote = fromCache > 0 ? ` (${fromCache} cached, ${fromApi} new)` : "";
        console.log(`${Object.keys(map).length}/${selected.length} translations${cacheNote}  (${(timings[key] / 1000).toFixed(1)}s)`);
      } catch (err) {
        timings[key] = Date.now() - t0;
        console.log(`FAILED: ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}`);
      }
    }

    printResult(selected, refMap, resultsByKey);
    printSummary(selected, refMap, resultsByKey, timings, skipped);
    writeReport(selected, refMap, resultsByKey, timings, skipped, { seed: SEED, typeFilter: TYPE_FILTER, fixtures: true, mode: "idioms" });
    return;
  }

  const allExamples = loadExamples();
  if (Object.keys(allExamples).length === 0) {
    console.error("No examples found. Run transform first.");
    process.exit(1);
  }

  // Filter to translated examples with plausibly English translations.
  // Reject translations that are actually German text (multi-part examples where the
  // "translation" is just the continuation of the German source, e.g. poem lines, Q&A pairs).
  // Primary guard: block on unambiguous German morphological markers. Secondary: require
  // at least one common English function word (original heuristic, now broadened).
  const DE_MARKERS  = /\b(der|die|das|und|ist|wir|nicht|den|des|dem|auf|mit|von|zu|für|beim|zur|vom|einen|einer|eines|werden|wurde|wurden|hatte|hatten|seine|ihrem|ihrer|ihm|ihnen)\b/i;
  const EN_WORDS_RE = /\b(the|a|an|is|are|was|were|to|of|and|in|it|he|she|they|you|that|this|with|for|on|at|be|have|has|had|do|not|his|her|its|we|by|from|as|but|or|if|so|all|any|one|no|can|may|will|would|could|should)\b/i;
  const looksEnglish = (t: string | null): boolean => {
    if (!t || t.length < 15) return false;
    if ((t.match(/\S+/g) ?? []).length < 3) return false;  // need at least 3 words
    if (DE_MARKERS.test(t)) return false;
    return EN_WORDS_RE.test(t);
  };

  // For examples mode, only pick examples that have annotations (content words to compare)
  let pool: PoolItem[] = Object.entries(allExamples)
    .filter(([, ex]) => ex.translation && looksEnglish(ex.translation))
    .filter(([, ex]) => {
      // Must have reference annotations with content words
      const contentAnns = (ex.annotations || []).filter(a => CONTENT_POS.has(a.pos));
      return contentAnns.length > 0;
    })
    .map(([id, ex]) => ({
      id, text: ex.text, type: ex.type ?? null, ref: ex.translation!,
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
  const batch: BatchItem[]    = selected.map(({ id, text }) => ({ id, text }));
  // refMap stores arrays for consistent multi-ref scoring (random mode has one ref per item)
  const refMap: Record<string, string[]>   = Object.fromEntries(selected.map(({ id, ref }) => [id, [ref]]));
  const refAnnotationsMap: Record<string, Annotation[]> = Object.fromEntries(selected.map(({ id, refAnnotations }) => [id, refAnnotations]));

  console.log(`\nModel comparison \u2014 ${selected.length} random examples with lemma matching  (seed: ${SEED}${TYPE_FILTER ? `, type: ${TYPE_FILTER}` : ""})`);
  console.log(`Models: ${ACTIVE_KEYS.join("  \u00b7  ")}\n`);

  const resultsByKey: Record<string, Record<string, string>>      = {};
  const annotationsByKey: Record<string, Record<string, Annotation[]>>  = {};
  const timings: Record<string, number>           = {};
  const skipped = new Set<string>();

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
      const { map, annotations, fromCache, fromApi } = await translateWithCache(batch, key, { mode: "examples" });
      timings[key] = Date.now() - t0;
      resultsByKey[key] = map;
      annotationsByKey[key] = annotations;
      const got = Object.keys(map).length;
      const annCount = Object.keys(annotations).length;
      const cacheNote = fromCache > 0 ? ` (${fromCache} cached, ${fromApi} new)` : "";
      console.log(`${got}/${selected.length} translations, ${annCount} annotated${cacheNote}  (${(timings[key] / 1000).toFixed(1)}s)`);
    } catch (err) {
      timings[key] = Date.now() - t0;
      console.log(`FAILED: ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}`);
    }
  }

  printResult(selected, refMap, resultsByKey);
  printSummary(selected, refMap, resultsByKey, timings, skipped);
  writeReport(selected, refMap, resultsByKey, timings, skipped, {
    seed: SEED, typeFilter: TYPE_FILTER, fixtures: false, mode: "examples",
    refAnnotationsMap, annotationsByKey,
  });
}

main().catch((err: unknown) => {
  console.error("Comparison failed:", err);
  process.exit(1);
});

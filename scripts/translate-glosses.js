/**
 * Translate German glosses (senses[].gloss) to English (senses[].gloss_en).
 *
 * Reads all word files, collects senses with gloss_en === null,
 * sends each one individually to an LLM, and writes translations back.
 *
 * Usage:
 *   node scripts/translate-glosses.js                         # default: OpenAI GPT-4.1-mini
 *   node scripts/translate-glosses.js --provider anthropic    # Claude Haiku 4.5
 *   node scripts/translate-glosses.js --provider ollama       # local Ollama (free, offline)
 *   node scripts/translate-glosses.js --provider lm-studio   # local LM Studio
 *   node scripts/translate-glosses.js --model gemma3:4b       # custom model (with any provider)
 *   node scripts/translate-glosses.js --dry-run               # preview without API calls
 *   node scripts/translate-glosses.js --concurrency 5        # run 5 API calls in parallel
 *   node scripts/translate-glosses.js --reset --provider ...        # clear all gloss_en, then re-translate
 *   node scripts/translate-glosses.js --reset-idioms --provider ... # clear gloss_en only for idiom phrases, then re-translate
 *
 * Requires OPENAI_API_KEY or ANTHROPIC_API_KEY env var (not needed for ollama/lm-studio).
 * Exits 0 if no key found (pipeline-safe).
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { callLLM, extractJSON, retryWithBackoff, parseProviderArgs, getApiKey, isLocalProvider, getDefaultModel } from "./lib/llm.js";
import { stripReferences } from "./lib/references.js";
import { POS_CONFIG, POS_DIRS } from "./lib/pos.js";
import {
  WORD_SYSTEM_PROMPT,
  WORD_SYSTEM_PROMPT_BATCH,
  PHRASE_SYSTEM_PROMPT,
  SYSTEM_PROMPT_FULL,
  TRANSLATIONS_SCHEMA,
} from "./lib/prompts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORDS_DIR = join(ROOT, "data", "words");

// ============================================================
// CLI args
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN         = args.includes("--dry-run");
const RESET           = args.includes("--reset");
const RESET_IDIOMS    = args.includes("--reset-idioms");
const RESET_GPT_MULTI = args.includes("--reset-gpt-multi");
const FULL_MODE       = args.includes("--full");
const { provider: PROVIDER, model: MODEL } = parseProviderArgs(args);
const MODEL_LABEL = `${PROVIDER}/${MODEL ?? getDefaultModel(PROVIDER)}`;

// How many single-sense words to pack into one API call.
// Multi-sense words always get their own call.
const batchSizeIdx = args.indexOf("--batch-size");
const SINGLE_SENSE_BATCH_SIZE = batchSizeIdx >= 0 ? parseInt(args[batchSizeIdx + 1]) : 20;

// Limit total word-jobs processed (for test runs). 0 = no limit.
const limitIdx = args.indexOf("--limit");
const JOB_LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 0;

// Number of concurrent API calls. Default: 1 (sequential). Use 5–10 for cloud providers.
const concurrencyIdx = args.indexOf("--concurrency");
const CONCURRENCY = concurrencyIdx >= 0 ? parseInt(args[concurrencyIdx + 1]) : 1;

/** Run items through fn with at most `concurrency` calls in-flight at once. */
async function runPool(items, concurrency, fn) {
  let i = 0;
  const workers = Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

// ============================================================
// Collect untranslated senses from all word files
// ============================================================

/**
 * Collect untranslated senses grouped by word file.
 *
 * Returns an array of "jobs", one per file that has untranslated senses:
 *   { filePath, word, pos, phraseType,
 *     toTranslate: [{ senseIdx, gloss }],   // senses needing translation
 *     alreadyDone: [{ senseIdx, gloss_en }] // translated senses (context for multi-sense)
 *   }
 */
function collectWordBatches(targetField) {
  const jobs = [];

  for (const posDir of POS_DIRS) {
    const dir = join(WORDS_DIR, posDir);
    if (!existsSync(dir)) continue;

    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(dir, file);
      const data = JSON.parse(readFileSync(filePath, "utf-8"));

      const toTranslate = [];
      const alreadyDone = [];
      for (let i = 0; i < (data.senses || []).length; i++) {
        const s = data.senses[i];
        // Skip Wiktionary formatting artifacts: headers like "transitiv, Hilfsverb „haben":"
        // or section markers like "mit Plural:" / "ohne Plural:" — these end with ":" and
        // contain no translatable definition content.
        const isArtifact = s.gloss && s.gloss.trim().endsWith(":");
        if (!s[targetField] && s.gloss && !isArtifact) {
          toTranslate.push({ senseIdx: i, gloss: s.gloss });
        } else if (s[targetField]) {
          alreadyDone.push({ senseIdx: i, gloss_en: s[targetField] });
        }
      }
      if (toTranslate.length > 0) {
        jobs.push({
          filePath,
          word: data.word,
          pos: data.pos,
          phraseType: data.phrase_type || null,
          toTranslate,
          alreadyDone,
        });
      }
    }
  }

  return jobs;
}

// Kept for FULL_MODE (individual calls, no batching needed there).
function collectSenses(targetField) {
  const items = [];
  for (const posDir of POS_DIRS) {
    const dir = join(WORDS_DIR, posDir);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(dir, file);
      const data = JSON.parse(readFileSync(filePath, "utf-8"));
      for (let i = 0; i < (data.senses || []).length; i++) {
        const sense = data.senses[i];
        if (!sense[targetField] && sense.gloss) {
          items.push({ filePath, senseIdx: i, word: data.word, pos: data.pos,
            phraseType: data.phrase_type || null, gloss: sense.gloss, allSenses: data.senses });
        }
      }
    }
  }
  return items;
}

// ============================================================
// System prompts — re-exported from lib/prompts.js
// (All prompt definitions live in lib/prompts.js; import from there directly
//  for new scripts. These re-exports maintain backward compatibility.)
// ============================================================

export { WORD_SYSTEM_PROMPT, WORD_SYSTEM_PROMPT_BATCH, PHRASE_SYSTEM_PROMPT, SYSTEM_PROMPT_FULL, TRANSLATIONS_SCHEMA } from "./lib/prompts.js";

// Backward-compat alias (used by test-gloss-translation.js and compare-models.js)
export { WORD_SYSTEM_PROMPT as SYSTEM_PROMPT } from "./lib/prompts.js";

// ============================================================
// Build prompt and parse response (single item)
// ============================================================

export function buildUserPrompt(item) {
  const cleanGloss = stripReferences(item.gloss);
  const base = `word="${item.word}", pos="${item.pos}"`;
  const typeClause = item.phraseType ? `, phrase_type="${item.phraseType}"` : "";
  let prompt = `${base}${typeClause}, gloss="${cleanGloss}"`;

  // When a word has multiple senses, show siblings so the model produces distinct labels.
  // Skip in full-mode (definitions can be longer and context adds less value there).
  if (!FULL_MODE && item.allSenses && item.allSenses.length > 1) {
    const siblings = item.allSenses
      .map((s, idx) => {
        if (idx === item.senseIdx) return null; // skip current sense
        const g = stripReferences(s.gloss || "");
        if (!g) return null;
        const en = s.gloss_en ? ` → ${s.gloss_en}` : "";
        return `  ${idx + 1}. ${g}${en}`;
      })
      .filter(Boolean)
      .join("\n");
    if (siblings) {
      prompt += `\nOther senses of "${item.word}" (your label MUST be distinct from any → already shown):\n${siblings}`;
    }
  }

  return prompt;
}

/**
 * Build prompt for a batch of single-sense jobs (different words, 1 sense each).
 * Returns a numbered list; the model returns { translations: [N strings] }.
 */
export function buildSingleSenseBatchPrompt(jobs) {
  return jobs
    .map((job, i) => {
      const g = stripReferences(job.toTranslate[0].gloss);
      const typeClause = job.phraseType ? `, phrase_type="${job.phraseType}"` : "";
      return `${i + 1}. word="${job.word}", pos="${job.pos}"${typeClause}, gloss="${g}"`;
    })
    .join("\n");
}

/**
 * Build prompt for a multi-sense word (one word, all untranslated senses).
 * Returns a header + numbered glosses + already-translated context.
 */
export function buildMultiSensePrompt(job) {
  const typeClause = job.phraseType ? `, phrase_type="${job.phraseType}"` : "";
  const header = `word="${job.word}", pos="${job.pos}"${typeClause} — translate all ${job.toTranslate.length} senses, all DISTINCT:`;
  const lines = job.toTranslate
    .map((s, i) => `${i + 1}. ${stripReferences(s.gloss)}`)
    .join("\n");
  let prompt = `${header}\n${lines}`;
  if (job.alreadyDone.length > 0) {
    const ctx = job.alreadyDone.map((s) => `  - "${s.gloss_en}"`).join("\n");
    prompt += `\n\nAlready translated for this word (your labels MUST be distinct from these):\n${ctx}`;
  }
  return prompt;
}

/**
 * Build prompt for full-mode batching: all untranslated senses of one word in a single call.
 * Returns a numbered list of German glosses; the model returns { definitions: [N strings] }.
 */
export function buildFullBatchPrompt(job) {
  const typeClause = job.phraseType ? `, phrase_type="${job.phraseType}"` : "";
  const header = `word="${job.word}", pos="${job.pos}"${typeClause}`;
  const lines = job.toTranslate
    .map((s, i) => `${i + 1}. ${stripReferences(s.gloss)}`)
    .join("\n");
  let prompt = `${header}\nTranslate each German definition to a natural English definition (1-2 sentences each):\n${lines}`;
  if (job.alreadyDone.length > 0) {
    const ctx = job.alreadyDone.map((s) => `  - "${s.gloss_en}"`).join("\n");
    prompt += `\n\nAlready translated for this word (for context):\n${ctx}`;
  }
  prompt += `\n\nReturn JSON: { "definitions": ["...", "..."] } — one definition per numbered gloss, in order.`;
  return prompt;
}

const FULL_BATCH_SCHEMA = {
  type: "object",
  properties: {
    definitions: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["definitions"],
  additionalProperties: false,
};

function parseFullBatchResponse(content, expectedCount) {
  const obj = extractJSON(content);
  const arr = Array.isArray(obj) ? obj : obj.definitions;
  if (!Array.isArray(arr)) throw new Error(`Expected array in response, got: ${JSON.stringify(obj)}`);
  if (arr.length < expectedCount) {
    throw new Error(`Count mismatch: expected ${expectedCount} definitions, got ${arr.length}`);
  }
  if (arr.length > expectedCount) arr.length = expectedCount;
  return arr.map((t) => {
    let s = String(t).trim();
    // Collapse excess whitespace
    s = s.replace(/\n+/g, " ").trim();
    return s;
  });
}

/**
 * Parse a batch JSON response and validate the count matches.
 * Uses extractJSON from llm.js to handle markdown fences / wrapper noise.
 */
function parseBatchResponse(content, expectedCount) {
  const obj = extractJSON(content);
  const arr = Array.isArray(obj) ? obj : obj.translations;
  if (!Array.isArray(arr)) throw new Error(`Expected array in response, got: ${JSON.stringify(obj)}`);
  if (arr.length < expectedCount) {
    throw new Error(`Count mismatch: expected ${expectedCount} translations, got ${arr.length}`);
  }
  if (arr.length > expectedCount) arr.length = expectedCount;
  return arr.map((t) => {
    let s = String(t).trim();
    if (s.endsWith(".")) s = s.slice(0, -1).trim();
    return s;
  });
}

function parseResponse(content) {
  let cleaned = content.trim();
  // Strip <function=...> wrapper (some local models use tool-call syntax)
  const funcMatch = cleaned.match(/<function[^>]*>([\s\S]*?)(?:<\/function>|$)/);
  if (funcMatch) cleaned = funcMatch[1].trim();
  // Strip quotes if model wraps in them
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  // Strip markdown fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:\w+)?\n?/, "").replace(/\n?```$/, "").trim();
  }
  if (FULL_MODE) {
    // Full mode: allow multiple sentences, just collapse excess whitespace
    cleaned = cleaned.replace(/\n+/g, " ").trim();
  } else {
    // Short label mode: take only first line, strip trailing period
    cleaned = cleaned.split("\n")[0].trim();
    if (cleaned.endsWith(".")) cleaned = cleaned.slice(0, -1).trim();
  }

  if (!cleaned) throw new Error("Empty response");
  return cleaned;
}

// ============================================================
// Write a single translation back to its word file
// ============================================================

function writeTranslation(item, translation) {
  const data = JSON.parse(readFileSync(item.filePath, "utf-8"));
  if (data.senses[item.senseIdx]) {
    const targetField = FULL_MODE ? "gloss_en_full" : "gloss_en";
    data.senses[item.senseIdx][targetField] = translation;
    data.senses[item.senseIdx][targetField + "_model"] = MODEL_LABEL;
  }
  writeFileSync(item.filePath, JSON.stringify(data, null, 2) + "\n");
}

// ============================================================
// Write helpers
// ============================================================

/** Write all translations from a word-batch job back to disk (single file read+write). */
function writeWordTranslations(job, targetField, translations) {
  const data = JSON.parse(readFileSync(job.filePath, "utf-8"));
  for (let i = 0; i < job.toTranslate.length; i++) {
    const { senseIdx } = job.toTranslate[i];
    if (data.senses[senseIdx]) {
      data.senses[senseIdx][targetField] = translations[i];
      data.senses[senseIdx][targetField + "_model"] = MODEL_LABEL;
    }
  }
  writeFileSync(job.filePath, JSON.stringify(data, null, 2) + "\n");
}

function printSummary(translated, errors, startAll, totalInputTokens, totalOutputTokens) {
  const totalTime = ((Date.now() - startAll) / 1000).toFixed(1);
  console.log(
    `\nDone. Translated ${translated} senses in ${totalTime}s.${errors > 0 ? ` ${errors} failed.` : ""}`,
  );
  console.log(`Tokens: ${totalInputTokens} input + ${totalOutputTokens} output.`);
  if (!isLocalProvider(PROVIDER)) {
    const costEstimate =
      PROVIDER === "anthropic"
        ? (totalInputTokens * 0.8 + totalOutputTokens * 4.0) / 1_000_000
        : (totalInputTokens * 0.15 + totalOutputTokens * 0.6) / 1_000_000;
    console.log(`Estimated cost: $${costEstimate.toFixed(4)}`);
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  const targetField = FULL_MODE ? "gloss_en_full" : "gloss_en";

  // Reset gpt-4.1-mini translations on multi-sense words so they get re-translated
  // with sibling context (--reset-gpt-multi)
  if (RESET_GPT_MULTI && !DRY_RUN) {
    let resetCount = 0;
    for (const posDir of POS_DIRS) {
      const dir = join(WORDS_DIR, posDir);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".json")) continue;
        const filePath = join(dir, file);
        const data = JSON.parse(readFileSync(filePath, "utf-8"));
        if ((data.senses || []).length <= 1) continue; // single-sense words: leave as-is
        let changed = false;
        for (const sense of data.senses) {
          if (sense.gloss_en_model === "openai/gpt-4.1-mini") {
            sense.gloss_en = null;
            sense.gloss_en_model = null;
            resetCount++;
            changed = true;
          }
        }
        if (changed) writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
      }
    }
    console.log(`Reset ${resetCount} gpt-4.1-mini gloss_en fields on multi-sense words.`);
  }

  // Reset the target field if requested (skipped in dry-run mode)
  if ((RESET || RESET_IDIOMS) && !DRY_RUN) {
    let resetCount = 0;
    for (const posDir of POS_DIRS) {
      const dir = join(WORDS_DIR, posDir);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".json")) continue;
        const filePath = join(dir, file);
        const data = JSON.parse(readFileSync(filePath, "utf-8"));
        // --reset-idioms: only touch phrase files with phrase_type === "idiom"
        if (RESET_IDIOMS && !(data.pos === "phrase" && data.phrase_type === "idiom")) continue;
        let changed = false;
        for (const sense of data.senses || []) {
          if (sense[targetField]) { sense[targetField] = null; resetCount++; changed = true; }
        }
        if (changed) writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
      }
    }
    const scope = RESET_IDIOMS ? "idiom phrase" : "";
    console.log(`Reset ${resetCount} ${scope} ${targetField} fields to null.`);
  }

  // Check API key now (after resets, so reset-only runs don't need a key)
  if (!isLocalProvider(PROVIDER) && !DRY_RUN) {
    const apiKey = getApiKey(PROVIDER);
    if (!apiKey) {
      const keyName = PROVIDER === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
      console.log(
        `No ${keyName} found. Skipping gloss translation. Set the env var to enable, or use --provider ollama for local.`,
      );
      process.exit(0);
    }
  }

  // ── FULL_MODE: batch senses per word file ──────────────────────────────────
  if (FULL_MODE) {
    const allJobs = collectWordBatches(targetField);
    if (allJobs.length === 0) {
      console.log(`All ${targetField} fields already translated. Nothing to do.`);
      return;
    }

    const limitedJobs = JOB_LIMIT > 0 ? allJobs.slice(0, JOB_LIMIT) : allJobs;
    const totalSenses = limitedJobs.reduce((s, j) => s + j.toTranslate.length, 0);
    console.log(`Translating ${totalSenses} ${targetField} senses across ${limitedJobs.length} word files.`);
    console.log(`Provider: ${PROVIDER}, mode: full definition (batched per word), concurrency: ${CONCURRENCY}`);

    if (DRY_RUN) {
      console.log("\nDry run: would send %d API calls.", limitedJobs.length);
      if (limitedJobs.length > 0) {
        console.log("\nSample prompt (first word):");
        console.log("  System: " + SYSTEM_PROMPT_FULL.split("\n")[0] + "...");
        console.log("  User:\n" + buildFullBatchPrompt(limitedJobs[0]));
      }
      return;
    }

    let translated = 0, totalInputTokens = 0, totalOutputTokens = 0, errors = 0;
    let callsDone = 0;
    const startAll = Date.now();

    await runPool(limitedJobs, CONCURRENCY, async (job, i) => {
      const sysPrompt = job.pos === "phrase" ? PHRASE_SYSTEM_PROMPT : SYSTEM_PROMPT_FULL;
      const userPrompt = buildFullBatchPrompt(job);
      const maxTokens = job.toTranslate.length * 100 + 50;
      try {
        const response = await retryWithBackoff(
          () => callLLM(sysPrompt, userPrompt, {
            provider: PROVIDER, model: MODEL, maxTokens, temperature: 0.2,
            jsonSchema: FULL_BATCH_SCHEMA,
          }), 3, 1000,
        );
        totalInputTokens += response.input_tokens;
        totalOutputTokens += response.output_tokens;
        const translations = parseFullBatchResponse(response.content, job.toTranslate.length);
        writeWordTranslations(job, targetField, translations);
        translated += translations.length;
        callsDone++;
        if (callsDone % 50 === 0 || callsDone === limitedJobs.length) {
          const elapsed = ((Date.now() - startAll) / 1000).toFixed(0);
          process.stdout.write(
            `  [${callsDone}/${limitedJobs.length}] "${job.word}" (${translations.length} senses) (${elapsed}s)\n`,
          );
        }
      } catch (err) {
        console.error(`  FAILED "${job.word}": ${err.message}`);
        errors += job.toTranslate.length;
        callsDone++;
      }
    });

    printSummary(translated, errors, startAll, totalInputTokens, totalOutputTokens);
    return;
  }

  // ── SHORT LABEL MODE: batch single-sense words; one call per multi-sense word ──
  const allJobs = collectWordBatches(targetField);
  if (allJobs.length === 0) {
    console.log(`All ${targetField} fields already translated. Nothing to do.`);
    return;
  }

  // Apply job limit if set (--limit N limits total word-files processed).
  const limitedJobs = JOB_LIMIT > 0 ? allJobs.slice(0, JOB_LIMIT) : allJobs;

  // Phrases get individual calls with PHRASE_SYSTEM_PROMPT (idiom-aware prompt).
  // Single-sense words are packed N-per-call (safe: N inputs → N outputs, independent).
  // Multi-sense words get one call each so all senses are translated distinctly together.
  const phraseJobs = limitedJobs.filter((j) => j.pos === "phrase");
  const singleJobs = limitedJobs.filter((j) => j.pos !== "phrase" && j.toTranslate.length === 1);
  const multiJobs  = limitedJobs.filter((j) => j.pos !== "phrase" && j.toTranslate.length > 1);

  const singleBatches = [];
  for (let i = 0; i < singleJobs.length; i += SINGLE_SENSE_BATCH_SIZE) {
    singleBatches.push(singleJobs.slice(i, i + SINGLE_SENSE_BATCH_SIZE));
  }

  const totalSenses = allJobs.reduce((s, j) => s + j.toTranslate.length, 0);
  const totalCalls  = phraseJobs.length + singleBatches.length + multiJobs.length;

  console.log(`Translating ${totalSenses} ${targetField} senses across ${allJobs.length} word files.`);
  console.log(`  Phrases:      ${phraseJobs.length} individual calls`);
  console.log(`  Single-sense: ${singleJobs.length} words → ${singleBatches.length} batches (size ${SINGLE_SENSE_BATCH_SIZE})`);
  console.log(`  Multi-sense:  ${multiJobs.length} words → ${multiJobs.length} calls`);
  console.log(`  Total API calls: ${totalCalls}`);
  console.log(`Provider: ${PROVIDER}, mode: short label, concurrency: ${CONCURRENCY}`);

  if (DRY_RUN) {
    console.log("\nDry run: would send %d API calls.", totalCalls);
    if (singleBatches.length > 0) {
      console.log("\nSample single-sense batch prompt (first batch):");
      console.log("  System: " + WORD_SYSTEM_PROMPT_BATCH.split("\n")[0] + "...");
      console.log("  User:\n" + buildSingleSenseBatchPrompt(singleBatches[0]));
    }
    if (multiJobs.length > 0) {
      console.log("\nSample multi-sense prompt (first multi-sense word):");
      console.log("  System: " + WORD_SYSTEM_PROMPT_BATCH.split("\n")[0] + "...");
      console.log("  User:\n" + buildMultiSensePrompt(multiJobs[0]));
    }
    return;
  }

  let translated = 0, totalInputTokens = 0, totalOutputTokens = 0, errors = 0;
  let callsDone = 0;
  const startAll = Date.now();

  // Individual-call options (phrases)
  const llmOptions = { provider: PROVIDER, model: MODEL, maxTokens: 128, temperature: 0.2 };
  // Batch call options: enforce structured output via JSON schema (OpenAI) or tool use (Anthropic).
  const batchOptions = {
    provider: PROVIDER, model: MODEL, temperature: 0.2,
    jsonSchema: TRANSLATIONS_SCHEMA,
  };

  // ── 1. Phrases (individual, PHRASE_SYSTEM_PROMPT) ────────────────────────
  await runPool(phraseJobs, CONCURRENCY, async (job) => {
    const sense = job.toTranslate[0];
    const item = {
      filePath: job.filePath, senseIdx: sense.senseIdx,
      word: job.word, pos: job.pos, phraseType: job.phraseType,
      gloss: sense.gloss, allSenses: [],
    };
    try {
      const response = await retryWithBackoff(
        () => callLLM(PHRASE_SYSTEM_PROMPT, buildUserPrompt(item), llmOptions), 3, 1000,
      );
      totalInputTokens += response.input_tokens;
      totalOutputTokens += response.output_tokens;
      const translation = parseResponse(response.content);
      writeTranslation(item, translation);
      translated++;
      callsDone++;
      if (callsDone % 50 === 0 || callsDone === totalCalls) {
        const elapsed = ((Date.now() - startAll) / 1000).toFixed(0);
        process.stdout.write(`  [${callsDone}/${totalCalls}] phrase "${job.word}": "${translation}" (${elapsed}s)\n`);
      }
    } catch (err) {
      console.error(`  FAILED phrase "${job.word}": ${err.message}`);
      errors++; callsDone++;
    }
  });

  // ── 2. Single-sense batches (WORD_SYSTEM_PROMPT_BATCH + JSON schema) ─────
  await runPool(singleBatches, CONCURRENCY, async (batch, bi) => {
    const userPrompt = buildSingleSenseBatchPrompt(batch);
    try {
      const response = await retryWithBackoff(
        () => callLLM(WORD_SYSTEM_PROMPT_BATCH, userPrompt, {
          ...batchOptions, maxTokens: batch.length * 20 + 30,
        }), 3, 1000,
      );
      totalInputTokens += response.input_tokens;
      totalOutputTokens += response.output_tokens;
      const translations = parseBatchResponse(response.content, batch.length);
      for (let j = 0; j < batch.length; j++) {
        writeWordTranslations(batch[j], targetField, [translations[j]]);
        translated++;
      }
      callsDone++;
      if (callsDone % 10 === 0 || bi === singleBatches.length - 1) {
        const elapsed = ((Date.now() - startAll) / 1000).toFixed(0);
        process.stdout.write(`  [${callsDone}/${totalCalls}] batch ${bi + 1}/${singleBatches.length}: ${batch.length} words (${elapsed}s)\n`);
      }
    } catch (err) {
      console.error(`  FAILED batch ${bi + 1}: ${err.message}`);
      errors += batch.length; callsDone++;
    }
  });

  // ── 3. Multi-sense words (one call per word, all senses distinct) ─────────
  await runPool(multiJobs, CONCURRENCY, async (job, i) => {
    const userPrompt = buildMultiSensePrompt(job);
    try {
      const response = await retryWithBackoff(
        () => callLLM(WORD_SYSTEM_PROMPT_BATCH, userPrompt, {
          ...batchOptions, maxTokens: job.toTranslate.length * 30 + 50,
        }), 3, 1000,
      );
      totalInputTokens += response.input_tokens;
      totalOutputTokens += response.output_tokens;
      const translations = parseBatchResponse(response.content, job.toTranslate.length);
      writeWordTranslations(job, targetField, translations);
      translated += job.toTranslate.length;
      callsDone++;
      if (callsDone % 10 === 0 || i === multiJobs.length - 1) {
        const elapsed = ((Date.now() - startAll) / 1000).toFixed(0);
        process.stdout.write(
          `  [${callsDone}/${totalCalls}] "${job.word}" (${job.toTranslate.length}): [${translations.join(" | ")}] (${elapsed}s)\n`,
        );
      }
    } catch (err) {
      console.error(`  FAILED "${job.word}": ${err.message}`);
      errors += job.toTranslate.length; callsDone++;
    }
  });

  printSummary(translated, errors, startAll, totalInputTokens, totalOutputTokens);
}

// Only run when executed directly (not when imported by test harness)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Gloss translation failed:", err);
    process.exit(1);
  });
}

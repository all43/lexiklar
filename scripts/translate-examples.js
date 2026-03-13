import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { callLLM, extractJSON, retryWithBackoff, parseProviderArgs, getApiKey, isLocalProvider, getDefaultModel } from "./lib/llm.js";
import { stripReferences } from "./lib/references.js";
import { POS_CONFIG } from "./lib/pos.js";
import { EXAMPLES_SYSTEM_PROMPT } from "./lib/prompts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const WORDS_DIR = join(DATA_DIR, "words");
const EXAMPLES_FILE = join(DATA_DIR, "examples.json");

// ============================================================
// CLI args
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const { provider: PROVIDER, model: MODEL } = parseProviderArgs(args, "anthropic");
const MODEL_LABEL = `${PROVIDER}/${MODEL ?? getDefaultModel(PROVIDER)}`;

// Idiom/expression model — gpt-4.1 by default (better at idiomatic translation).
// If --model is explicitly passed, use it for everything (testing override).
const MODEL_EXPLICIT = args.includes("--model");
const IDIOM_MODEL_NAME = (() => {
  const idx = args.indexOf("--idiom-model");
  return idx >= 0 ? args[idx + 1] : "gpt-4.1";
})();
const IDIOM_PROVIDER = MODEL_EXPLICIT ? PROVIDER : "openai";
const IDIOM_MODEL    = MODEL_EXPLICIT ? MODEL    : IDIOM_MODEL_NAME;
const IDIOM_MODEL_LABEL = `${IDIOM_PROVIDER}/${IDIOM_MODEL}`;

// Local models have small context windows — default to a much smaller batch.
// Cloud providers can handle 10+ easily.
const DEFAULT_BATCH_SIZE = isLocalProvider(PROVIDER) ? 3 : 10;
const BATCH_SIZE = (() => {
  const idx = args.indexOf("--batch-size");
  return idx >= 0 ? parseInt(args[idx + 1], 10) || DEFAULT_BATCH_SIZE : DEFAULT_BATCH_SIZE;
})();

const MAX_CONSECUTIVE_ERRORS = (() => {
  const idx = args.indexOf("--max-consecutive-errors");
  return idx >= 0 ? parseInt(args[idx + 1], 10) || 5 : 5;
})();

const LIMIT = (() => {
  const idx = args.indexOf("--limit");
  return idx >= 0 ? parseInt(args[idx + 1], 10) || null : null;
})();

const CONCURRENCY = (() => {
  const idx = args.indexOf("--concurrency");
  return idx >= 0 ? parseInt(args[idx + 1], 10) || 1 : 1;
})();

const MAX_PER_WORD = (() => {
  const idx = args.indexOf("--max-per-word");
  return idx >= 0 ? parseInt(args[idx + 1], 10) || null : null;
})();

const FREQ_LIMIT = (() => {
  const idx = args.indexOf("--freq-limit");
  return idx >= 0 ? parseInt(args[idx + 1], 10) || null : null;
})();

/**
 * Build a map of word → { frequency, whitelisted } from word files + whitelist.
 * Used by the --freq-limit filter.
 */
function buildWordFreqMap() {
  const whitelistPath = join(ROOT, "config", "word-whitelist.json");
  const whitelistSet = new Set(
    existsSync(whitelistPath)
      ? JSON.parse(readFileSync(whitelistPath, "utf-8")).words.map(w => w.word)
      : []
  );

  const map = new Map(); // word → { frequency: number|null, whitelisted: bool }
  for (const { dir: posDir } of Object.values(POS_CONFIG)) {
    const dir = join(WORDS_DIR, posDir);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const d = JSON.parse(readFileSync(join(dir, file), "utf-8"));
        map.set(d.word, {
          frequency: d.frequency ?? null,
          whitelisted: whitelistSet.has(d.word),
        });
      } catch {}
    }
  }
  return map;
}

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

// Disambiguation dict adds many tokens and risks blowing local context.
// Skip it for local providers unless the user opts in explicitly.
const USE_DISAMBIG = !isLocalProvider(PROVIDER) || args.includes("--disambig");

// ============================================================
// Load gloss_en from a phrase/word file via its ref path
// ============================================================

function loadGlossEn(ref) {
  if (!ref) return null;
  try {
    const filePath = join(WORDS_DIR, ref + ".json");
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    return data.senses?.[0]?.gloss_en ?? null;
  } catch {
    return null;
  }
}

// ============================================================
// Build disambiguation dictionary from word files
// ============================================================

function buildDisambiguationDict() {
  const dict = new Map(); // key: "lemma|pos" → array of gloss strings

  for (const { dir: posDir, label: posName } of Object.values(POS_CONFIG)) {
    const dir = join(WORDS_DIR, posDir);
    if (!existsSync(dir)) continue;

    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const data = JSON.parse(readFileSync(join(dir, file), "utf-8"));
      const key = `${data.word}|${posName}`;
      // Prefer gloss_en if translate-glosses has already run — shorter, works
      // better for local models, and is what the disambiguation hint will reference.
      const glosses = (data.senses || []).map((s) => s.gloss_en || s.gloss).filter(Boolean);

      if (dict.has(key)) {
        // Homonym: merge glosses from both files
        dict.get(key).push(...glosses);
      } else {
        dict.set(key, glosses);
      }
    }
  }

  // Only keep entries with 2+ senses (need disambiguation)
  for (const [key, glosses] of dict) {
    if (glosses.length < 2) dict.delete(key);
  }

  console.log(
    `Built disambiguation dict: ${dict.size} multi-sense lemmas.`,
  );
  return dict;
}

// ============================================================
// Find relevant disambiguation entries for a set of examples
// ============================================================

function getRelevantDisambiguation(examples, disambigDict) {
  const result = {};
  const textBlock = examples.map((e) => e.text).join(" ");
  const textLower = textBlock.toLowerCase();

  for (const [key, glosses] of disambigDict) {
    const lemma = key.split("|")[0];
    // Check case-insensitive presence of lemma in the combined text
    if (textLower.includes(lemma.toLowerCase())) {
      // Truncate long glosses to save tokens
      result[key] = glosses.map((g) =>
        g.length > 80 ? g.slice(0, 80) + "..." : g,
      );
    }
  }

  return result;
}

// ============================================================
// System prompt and user prompt
// ============================================================

// Imported from lib/prompts.js
const SYSTEM_PROMPT = EXAMPLES_SYSTEM_PROMPT;

function buildUserPrompt(batch, disambig) {
  const lines = [];

  lines.push(`Translate ${batch.length} German sentence(s) to English:\n`);

  for (const { id, text, type, note, gloss_en } of batch) {
    let line = `[${id}] ${stripReferences(text)}`;
    if (type)     line += `  (type: ${type})`;
    if (note)     line += `  (note: ${note})`;
    if (gloss_en) line += `  (gloss_en: ${gloss_en})`;
    lines.push(line);
  }

  const disambigEntries = Object.entries(disambig);
  if (disambigEntries.length > 0) {
    lines.push("\nDisambiguation hints (use for gloss_hint field):");
    for (const [key, glosses] of disambigEntries) {
      lines.push(`  ${key}: ${glosses.join(" | ")}`);
    }
  }

  lines.push('\nReply with: {"examples": [{"id":"...","translation":"...","annotations":[...]}, ...]}');

  return lines.join("\n");
}

// ============================================================
// JSON schema for structured output
// ============================================================

// Wraps the array in { "examples": [...] } because JSON Schema requires an object root.
// parseResponse already handles both bare arrays and { examples: [...] } wrappers.
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

// ============================================================
// Parse and validate LLM response
// ============================================================

function parseResponse(content) {
  let parsed = extractJSON(content);

  // Local models sometimes wrap the array in {"examples": [...]}
  if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.examples)) {
    parsed = parsed.examples;
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Response is not an array");
  }

  for (const item of parsed) {
    if (!item.id || typeof item.translation !== "string") {
      throw new Error(`Invalid item: missing id or translation`);
    }
    // Annotations are best-effort — allow missing
    if (!item.annotations) item.annotations = [];
    // Validate annotation shape
    item.annotations = item.annotations.filter(
      (a) => a.form && a.lemma && a.pos,
    );
  }

  return parsed;
}

// ============================================================
// Error logging
// ============================================================

const ERROR_LOG = join(ROOT, "data", "raw", "translation-errors.log");

function logError(batchNum, totalBatches, err, rawResponse, userPrompt) {
  const rawDir = join(ROOT, "data", "raw");
  if (!existsSync(rawDir)) mkdirSync(rawDir, { recursive: true });
  const sep = "=".repeat(80);
  const entry = [
    `\n${sep}`,
    `[${new Date().toISOString()}] Batch ${batchNum}/${totalBatches}`,
    `ERROR: ${err.message}`,
    `--- USER PROMPT ---`,
    userPrompt,
    `--- RAW RESPONSE ---`,
    rawResponse ?? "(no response captured)",
    sep,
  ].join("\n");
  appendFileSync(ERROR_LOG, entry + "\n");
}

// ============================================================
// Main
// ============================================================

async function main() {
  // Check API key
  if (!isLocalProvider(PROVIDER) && !DRY_RUN) {
    const apiKey = getApiKey(PROVIDER);
    if (!apiKey) {
      const keyName = PROVIDER === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
      console.log(
        `No ${keyName} found. Skipping translation step. Set the env var to enable.`,
      );
      process.exit(0);
    }
  }

  // Load examples
  if (!existsSync(EXAMPLES_FILE)) {
    console.error("No examples.json found. Run transform first.");
    process.exit(1);
  }

  const examples = JSON.parse(readFileSync(EXAMPLES_FILE, "utf-8"));
  const total = Object.keys(examples).length;

  // Filter to untranslated
  const alreadyDone = Object.values(examples).filter(ex => ex.translation).length;
  let untranslated = Object.entries(examples)
    .filter(([, ex]) => !ex.translation)
    .map(([id, ex]) => {
      const isIdiom = ex.type === "expression" || ex.type === "proverb";
      return {
        id,
        text: ex.text,
        type: ex.type || null,
        note: ex.note || null,
        gloss_en: isIdiom ? loadGlossEn(ex.ref) : null,
        lemmas: ex.lemmas || [],
      };
    });

  // Frequency filter: keep examples where at least one lemma has freq ≤ FREQ_LIMIT
  // or is in the whitelist. Lemmas not found in word files are kept (safe default).
  if (FREQ_LIMIT) {
    const wordFreqMap = buildWordFreqMap();
    const before = untranslated.length;
    untranslated = untranslated.filter(item => {
      if (!item.lemmas.length) return true;
      return item.lemmas.some(l => {
        const info = wordFreqMap.get(l);
        if (!info) return true; // unknown word — keep
        if (info.whitelisted) return true;
        if (info.frequency !== null && info.frequency <= FREQ_LIMIT) return true;
        return false;
      });
    });
    console.log(`Freq filter (≤${FREQ_LIMIT} + whitelist): ${before} → ${untranslated.length} examples selected.`);
  }

  // Cap examples per word: count already-translated examples per lemma, then
  // greedily include untranslated examples that still have budget for any lemma.
  if (MAX_PER_WORD) {
    const budget = new Map(); // lemma → remaining slots
    for (const [, ex] of Object.entries(examples)) {
      if (!ex.translation) continue;
      for (const lemma of ex.lemmas || []) {
        budget.set(lemma, (budget.get(lemma) ?? MAX_PER_WORD) - 1);
      }
    }
    const filtered = [];
    for (const item of untranslated) {
      const hasSlot = item.lemmas.length === 0 ||
        item.lemmas.some(l => (budget.get(l) ?? MAX_PER_WORD) > 0);
      if (hasSlot) {
        filtered.push(item);
        for (const l of item.lemmas) {
          budget.set(l, (budget.get(l) ?? MAX_PER_WORD) - 1);
        }
      }
    }
    console.log(`Per-word cap (${MAX_PER_WORD}): ${untranslated.length} → ${filtered.length} examples selected.`);
    untranslated = filtered;
  }

  if (untranslated.length === 0) {
    console.log(`All ${total} examples already translated. Nothing to do.`);
    return;
  }

  if (LIMIT) {
    untranslated = untranslated.slice(0, LIMIT);
    console.log(`Limit: processing first ${LIMIT} untranslated examples.`);
  }

  console.log(
    `Translating examples... (${total} total, ${alreadyDone} already done, ${untranslated.length} remaining${LIMIT ? ` (capped at ${LIMIT})` : ""})`,
  );
  console.log(`Provider: ${PROVIDER}, batch size: ${BATCH_SIZE}, concurrency: ${CONCURRENCY}${!USE_DISAMBIG ? " (disambiguation disabled for local model — use --disambig to enable)" : ""}`);

  // Build disambiguation dict (skipped for local providers to save context)
  const disambigDict = USE_DISAMBIG ? buildDisambiguationDict() : new Map();

  // Split by type: expressions/proverbs → gpt-4.1; everything else → default model
  const idiomItems   = untranslated.filter(i => i.type === "expression" || i.type === "proverb");
  const regularItems = untranslated.filter(i => i.type !== "expression" && i.type !== "proverb");

  if (DRY_RUN) {
    const allBatches = [];
    for (let i = 0; i < untranslated.length; i += BATCH_SIZE) allBatches.push(untranslated.slice(i, i + BATCH_SIZE));
    console.log(`\nDry run: would send ${allBatches.length} batches (${idiomItems.length} idioms via ${IDIOM_MODEL_LABEL}, ${regularItems.length} regular via ${MODEL_LABEL}).`);
    if (allBatches.length > 0) {
      const sampleDisambig = getRelevantDisambiguation(allBatches[0], disambigDict);
      const samplePrompt = buildUserPrompt(allBatches[0], sampleDisambig);
      console.log("\nSample batch 1 prompt:");
      console.log(samplePrompt);
      const approxTokens = Math.ceil((SYSTEM_PROMPT.length + samplePrompt.length) / 4);
      console.log(`\nDisambiguation entries for batch 1: ${Object.keys(sampleDisambig).length}`);
      console.log(`Approx prompt size: ~${approxTokens} tokens (system + user, rough estimate)`);
    }
    return;
  }

  let translated = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let errors = 0;

  async function processBatches(items, llmOptions, modelLabel, label) {
    if (items.length === 0) return;
    const batches = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) batches.push(items.slice(i, i + BATCH_SIZE));
    console.log(`\n${label}: ${items.length} items, ${batches.length} batches (${modelLabel})`);

    let batchesDone = 0;
    let consecutiveErrors = 0;
    let stopped = false;

    function saveExamples() {
      const sorted = {};
      for (const key of Object.keys(examples).sort()) sorted[key] = examples[key];
      writeFileSync(EXAMPLES_FILE, JSON.stringify(sorted, null, 2));
    }

    await runPool(batches, CONCURRENCY, async (batch, i) => {
      if (stopped) return;
      const disambig = getRelevantDisambiguation(batch, disambigDict);
      const userPrompt = buildUserPrompt(batch, disambig);
      let rawResponse = null;

      try {
        const startTime = Date.now();
        const response = await retryWithBackoff(
          () => callLLM(SYSTEM_PROMPT, userPrompt, llmOptions),
          3, 4000,
        );
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        rawResponse = response.content;
        totalInputTokens += response.input_tokens;
        totalOutputTokens += response.output_tokens;

        const results = parseResponse(response.content);

        for (const result of results) {
          if (examples[result.id]) {
            examples[result.id].translation = result.translation;
            examples[result.id].translation_model = modelLabel;
            const exType = examples[result.id].type;
            if (exType === "expression" || exType === "proverb") {
              delete examples[result.id].annotations;
            } else {
              examples[result.id].annotations = result.annotations;
            }
          }
        }

        translated += results.length;
        consecutiveErrors = 0;
        batchesDone++;
        process.stdout.write(`  Batch ${i + 1}/${batches.length}: translated ${results.length} [${elapsed}s]\n`);

        // Write every 5 completed batches for crash safety (reduced from every batch
        // to avoid excessive I/O overhead under concurrency).
        if (batchesDone % 5 === 0) saveExamples();
      } catch (err) {
        consecutiveErrors++;
        errors += batch.length;
        console.error(`  Batch ${i + 1}/${batches.length}: FAILED after retries: ${err.message}`);
        logError(i + 1, batches.length, err, rawResponse, userPrompt);
        console.error(`  Full response logged to: ${ERROR_LOG}`);

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.error(`\n${consecutiveErrors} consecutive failures — stopping early.`);
          console.error(`Check ${ERROR_LOG} for raw responses.`);
          stopped = true;
        }
      }
    });

    // Final write to capture any remaining batches
    saveExamples();
  }

  const idiomLlmOptions   = { provider: IDIOM_PROVIDER, model: IDIOM_MODEL,   maxTokens: 4096, temperature: 0.3, jsonSchema: EXAMPLE_SCHEMA };
  const regularLlmOptions = { provider: PROVIDER,        model: MODEL,          maxTokens: 8192, temperature: 0.3, jsonSchema: EXAMPLE_SCHEMA };

  await processBatches(idiomItems,   idiomLlmOptions,   IDIOM_MODEL_LABEL, "Idioms/expressions");
  await processBatches(regularItems, regularLlmOptions, MODEL_LABEL,       "Regular examples");

  // Cost estimate
  if (!isLocalProvider(PROVIDER)) {
    // Both models are OpenAI — use gpt-4o-mini pricing as approximation
    const costEstimate = (totalInputTokens * 0.15) / 1_000_000 + (totalOutputTokens * 0.6) / 1_000_000;
    console.log(`\nDone. Translated ${translated} examples.${errors > 0 ? ` ${errors} failed.` : ""}`);
    console.log(`Tokens: ${totalInputTokens} input + ${totalOutputTokens} output. Estimated cost: $${costEstimate.toFixed(3)}`);
  } else {
    console.log(`\nDone. Translated ${translated} examples.${errors > 0 ? ` ${errors} failed.` : ""}`);
  }

}

main().catch((err) => {
  console.error("Translation failed:", err);
  process.exit(1);
});

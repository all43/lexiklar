#!/usr/bin/env node
/**
 * fix-gloss-hints.js — Validate and fix gloss_hint values in examples.json.
 *
 * Three-phase approach:
 *   1. Auto-fix: set hint to null for single-sense words and missing word files
 *   2. Auto-fix: set hint to the only matching gloss_en for unambiguous substring matches
 *   3. LLM pass: for multi-sense words where no gloss_en matches the current hint,
 *      ask a local model to pick the correct gloss_en given the sentence context
 *
 * Usage:
 *   node scripts/fix-gloss-hints.js                              # dry run (default)
 *   node scripts/fix-gloss-hints.js --apply                      # write fixes (lm-studio default)
 *   node scripts/fix-gloss-hints.js --apply --provider ollama    # use Ollama
 *   node scripts/fix-gloss-hints.js --apply --provider anthropic # cloud fallback
 *   node scripts/fix-gloss-hints.js --stats                      # just print statistics
 *
 * Recommended local model: gemma-3-12b in LM Studio (87% accuracy on hint picking)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { callLLM, extractJSON, retryWithBackoff, parseProviderArgs, isLocalProvider, getApiKey, getDefaultModel } from "./lib/llm.js";

const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--apply");
const STATS_ONLY = args.includes("--stats");
const BATCH_SIZE = parseInt(args[args.indexOf("--batch-size") + 1]) || 20;
const { provider: PROVIDER, model: MODEL_OVERRIDE } = parseProviderArgs(args, "lm-studio");

const EXAMPLES_FILE = "data/examples.json";
const WORDS_DIR = "data/words";
const POS_DIRS = { noun: "nouns", verb: "verbs", adjective: "adjectives" };

// ============================================================
// Load word data for gloss lookup
// ============================================================

/** Cache of word file data keyed by "lemma|pos" */
const wordCache = new Map();

function loadWordData(lemma, pos) {
  const key = `${lemma}|${pos}`;
  if (wordCache.has(key)) return wordCache.get(key);

  const dir = POS_DIRS[pos];
  if (!dir) { wordCache.set(key, null); return null; }

  const dirPath = join(WORDS_DIR, dir);
  let data = null;

  // Try exact match first
  const exactPath = join(dirPath, `${lemma}.json`);
  if (existsSync(exactPath)) {
    try { data = JSON.parse(readFileSync(exactPath, "utf-8")); } catch {}
  }

  // Try homonym files (e.g., Bank_geldinstitut.json)
  if (!data) {
    try {
      const files = readdirSync(dirPath).filter(
        (f) => f.startsWith(lemma + "_") && f.endsWith(".json"),
      );
      if (files.length > 0) {
        // Merge senses from all homonym files
        const allSenses = [];
        for (const f of files) {
          try {
            const d = JSON.parse(readFileSync(join(dirPath, f), "utf-8"));
            allSenses.push(...(d.senses || []));
          } catch {}
        }
        if (allSenses.length > 0) {
          data = { senses: allSenses };
        }
      }
    } catch {}
  }

  wordCache.set(key, data);
  return data;
}

function getGlossesEn(data) {
  if (!data?.senses) return [];
  return data.senses.map((s) => s.gloss_en).filter(Boolean);
}

function hintMatches(hint, glosses) {
  const h = hint.toLowerCase();
  return glosses.some((g) => {
    const gl = g.toLowerCase();
    return gl.includes(h) || h.includes(gl);
  });
}

// ============================================================
// Analyze all annotations
// ============================================================

console.log("Loading examples...");
const examples = JSON.parse(readFileSync(EXAMPLES_FILE, "utf-8"));

const autoFixes = []; // { exId, annoIdx, reason }
const llmNeeded = []; // { exId, annoIdx, text, lemma, pos, hint, glosses }
let totalHints = 0;
let alreadyOk = 0;

for (const [id, ex] of Object.entries(examples)) {
  if (!ex.annotations) continue;
  for (let i = 0; i < ex.annotations.length; i++) {
    const a = ex.annotations[i];
    if (!a.gloss_hint) continue;
    totalHints++;

    const data = loadWordData(a.lemma, a.pos);
    const glosses = data ? getGlossesEn(data) : [];

    if (!data || glosses.length === 0) {
      // No word file or no gloss_en — can't disambiguate
      autoFixes.push({ exId: id, annoIdx: i, reason: "no_file" });
      continue;
    }

    if (glosses.length === 1) {
      // Single sense — no disambiguation needed
      autoFixes.push({ exId: id, annoIdx: i, reason: "single_sense" });
      continue;
    }

    if (hintMatches(a.gloss_hint, glosses)) {
      alreadyOk++;
      continue;
    }

    // Multi-sense, hint doesn't match any gloss_en → needs LLM
    llmNeeded.push({
      exId: id,
      annoIdx: i,
      text: ex.text,
      lemma: a.lemma,
      pos: a.pos,
      hint: a.gloss_hint,
      glosses,
    });
  }
}

console.log(`\nGloss hint analysis:`);
console.log(`  Total hints:     ${totalHints}`);
console.log(`  Already OK:      ${alreadyOk}`);
console.log(`  Auto-fix → null: ${autoFixes.length} (${autoFixes.filter((f) => f.reason === "no_file").length} no file, ${autoFixes.filter((f) => f.reason === "single_sense").length} single sense)`);
console.log(`  Need LLM:        ${llmNeeded.length}`);

if (STATS_ONLY) process.exit(0);

// ============================================================
// Apply auto-fixes
// ============================================================

let fixCount = 0;

if (!DRY_RUN) {
  for (const { exId, annoIdx } of autoFixes) {
    examples[exId].annotations[annoIdx].gloss_hint = null;
    fixCount++;
  }
  console.log(`\nApplied ${fixCount} auto-fixes (set to null).`);
}

// ============================================================
// LLM pass for multi-sense mismatches
// ============================================================

if (llmNeeded.length === 0) {
  console.log("\nNo LLM fixes needed.");
  if (!DRY_RUN) {
    writeFileSync(EXAMPLES_FILE, JSON.stringify(examples, null, 2));
    console.log("Saved examples.json.");
  }
  process.exit(0);
}

if (DRY_RUN) {
  console.log(`\nDry run: would send ${Math.ceil(llmNeeded.length / BATCH_SIZE)} batches to ${PROVIDER}.`);
  console.log("Sample items:");
  for (const item of llmNeeded.slice(0, 5)) {
    console.log(`  "${item.text}" → ${item.lemma} (${item.pos}): hint="${item.hint}", glosses=[${item.glosses.join(", ")}]`);
  }
  console.log("\nRe-run with --apply to write fixes.");
  process.exit(0);
}

// Check API key for cloud providers
if (!isLocalProvider(PROVIDER) && !getApiKey(PROVIDER)) {
  console.log(`\nNo API key for ${PROVIDER}. Set ${PROVIDER === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} or use --provider ollama/lm-studio.`);
  process.exit(1);
}

const model = MODEL_OVERRIDE || getDefaultModel(PROVIDER);
console.log(`\nLLM pass: ${llmNeeded.length} items, batch size ${BATCH_SIZE}, provider ${PROVIDER} (${model})`);

const SYSTEM_PROMPT = `You are a German language expert helping to disambiguate word senses in example sentences.

For each item, you receive:
- A German sentence
- A word (lemma) that appears in the sentence
- A list of possible English glosses for that word

Your task: pick the SINGLE gloss from the list that best matches how the word is used in the sentence.

Return a JSON array of objects: [{"id": 0, "gloss": "the chosen gloss"}, ...]

Rules:
- You MUST pick from the provided glosses list — do NOT invent new glosses
- Copy the gloss string EXACTLY as given (preserve casing, parenthetical notes, etc.)
- If none of the glosses clearly fit, pick the closest one
- Return valid JSON only, no markdown fences`;

const HINT_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "number" },
          gloss: { type: "string" },
        },
        required: ["id", "gloss"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

let llmFixed = 0;
let llmErrors = 0;
let inputTokens = 0;
let outputTokens = 0;

// Process in batches
const batches = [];
for (let i = 0; i < llmNeeded.length; i += BATCH_SIZE) {
  batches.push(llmNeeded.slice(i, i + BATCH_SIZE));
}

for (let b = 0; b < batches.length; b++) {
  const batch = batches[b];
  const userLines = [];

  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    userLines.push(`${i}. Sentence: "${item.text}"`);
    userLines.push(`   Word: ${item.lemma} (${item.pos})`);
    userLines.push(`   Glosses: ${item.glosses.map((g) => `"${g}"`).join(" | ")}`);
    userLines.push("");
  }

  const userPrompt = userLines.join("\n");

  try {
    const response = await retryWithBackoff(
      () =>
        callLLM(SYSTEM_PROMPT, userPrompt, {
          provider: PROVIDER,
          model: MODEL_OVERRIDE || undefined,
          maxTokens: 512,
          temperature: 0.0,
          jsonSchema: HINT_SCHEMA,
        }),
      3,
    );

    inputTokens += response.input_tokens || 0;
    outputTokens += response.output_tokens || 0;

    const parsed = extractJSON(response.content);
    const items = parsed.items || parsed;

    for (const result of items) {
      const idx = result.id;
      if (idx < 0 || idx >= batch.length) continue;

      const item = batch[idx];
      const chosenGloss = result.gloss;

      // Validate: must be one of the provided glosses (case-insensitive match)
      const exactMatch = item.glosses.find(
        (g) => g.toLowerCase() === chosenGloss.toLowerCase(),
      );
      if (exactMatch) {
        // Use the exact gloss_en as the hint (or a short identifying substring)
        examples[item.exId].annotations[item.annoIdx].gloss_hint = exactMatch;
        llmFixed++;
      } else {
        // Partial match — check if LLM response is a substring of any gloss
        const partial = item.glosses.find(
          (g) =>
            g.toLowerCase().includes(chosenGloss.toLowerCase()) ||
            chosenGloss.toLowerCase().includes(g.toLowerCase()),
        );
        if (partial) {
          examples[item.exId].annotations[item.annoIdx].gloss_hint = partial;
          llmFixed++;
        } else {
          // No match at all — set to null
          examples[item.exId].annotations[item.annoIdx].gloss_hint = null;
          llmErrors++;
        }
      }
    }
  } catch (err) {
    console.error(`  Batch ${b + 1} failed: ${err.message}`);
    // Set all in this batch to null
    for (const item of batch) {
      examples[item.exId].annotations[item.annoIdx].gloss_hint = null;
      llmErrors++;
    }
  }

  // Save after each batch (crash-safe)
  writeFileSync(EXAMPLES_FILE, JSON.stringify(examples, null, 2));

  const pct = (((b + 1) / batches.length) * 100).toFixed(0);
  process.stdout.write(
    `\r  Batch ${b + 1}/${batches.length} (${pct}%) — fixed: ${llmFixed}, errors: ${llmErrors}`,
  );
}

console.log(`\n\nDone.`);
console.log(`  Auto-fixed:  ${fixCount} (set to null)`);
console.log(`  LLM fixed:   ${llmFixed} (picked correct gloss_en)`);
console.log(`  LLM errors:  ${llmErrors} (set to null)`);
console.log(`  Tokens:      ${inputTokens} in / ${outputTokens} out`);
console.log(`Saved examples.json.`);

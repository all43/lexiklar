#!/usr/bin/env node
/**
 * check-idiom-translations.js
 *
 * Two-phase QA tool for idiom phrase translations:
 *
 *   Phase 1 (always, free): heuristic pre-filter
 *     - Word count > MAX_WORDS  →  likely a paraphrase
 *     - Cognate leak  →  German root word appears translated verbatim in English
 *
 *   Phase 2 (--llm, costs API credits): batch LLM review
 *     Sends all translated idioms in batches, asks the model to flag:
 *       - Literal word-for-word translations
 *       - Plain adjective/adverb where an English idiom exists
 *       - Wrong idiom chosen (meaning mismatch)
 *       - Verbose paraphrase instead of a concise idiom
 *     Returns JSON array of flagged items with a suggested fix for each.
 *
 * Usage:
 *   node scripts/check-idiom-translations.js
 *   node scripts/check-idiom-translations.js --llm
 *   node scripts/check-idiom-translations.js --llm --provider anthropic
 *   node scripts/check-idiom-translations.js --llm --provider ollama
 *   node scripts/check-idiom-translations.js --llm --model gpt-4o
 *   node scripts/check-idiom-translations.js --llm --batch-size 30
 *   node scripts/check-idiom-translations.js --max-words 4   # stricter heuristic
 *   node scripts/check-idiom-translations.js --json          # JSON output (both phases)
 */

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  callLLM,
  retryWithBackoff,
  parseProviderArgs,
  getApiKey,
  isLocalProvider,
  extractJSON,
} from "./lib/llm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PHRASES_DIR = join(ROOT, "data", "words", "phrases");

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const USE_LLM    = args.includes("--llm");
const JSON_OUT   = args.includes("--json");
const APPLY      = args.includes("--apply");

const maxWordsIdx  = args.indexOf("--max-words");
const MAX_WORDS    = maxWordsIdx !== -1 ? parseInt(args[maxWordsIdx + 1], 10) : 5;

const batchSizeIdx = args.indexOf("--batch-size");
const BATCH_SIZE   = batchSizeIdx !== -1 ? parseInt(args[batchSizeIdx + 1], 10) : 25;

const limitIdx = args.indexOf("--limit");
const LIMIT    = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

const { provider: PROVIDER, model: MODEL } = parseProviderArgs(args);

// ── Heuristic data ────────────────────────────────────────────────────────────

// German word (lowercase) → English cognate.
// Presence of BOTH in a phrase+translation pair signals a likely literal rendering.
const COGNATES = new Map([
  ["blut", "blood"], ["wasser", "water"], ["feuer", "fire"], ["kopf", "head"],
  ["herz", "heart"], ["hand", "hand"], ["auge", "eye"], ["augen", "eye"],
  ["mund", "mouth"], ["zahn", "tooth"], ["zähne", "teeth"], ["stein", "stone"],
  ["gold", "gold"], ["geld", "money"], ["wind", "wind"], ["sturm", "storm"],
  ["welt", "world"], ["tag", "day"], ["nacht", "night"], ["zeit", "time"],
  ["weg", "way"], ["brot", "bread"], ["salz", "salt"], ["milch", "milk"],
  ["öl", "oil"], ["wolf", "wolf"], ["fuchs", "fox"], ["hund", "dog"],
  ["katze", "cat"], ["vogel", "bird"], ["baum", "tree"], ["haus", "house"],
  ["mann", "man"], ["frau", "woman"], ["kind", "child"], ["kinder", "children"],
  ["vater", "father"], ["mutter", "mother"], ["sohn", "son"],
  ["arm", "arm"], ["bein", "leg"], ["fuss", "foot"], ["fuß", "foot"],
  ["ohr", "ear"], ["nase", "nose"], ["haar", "hair"], ["himmel", "heaven"],
  ["erde", "earth"], ["licht", "light"], ["sonne", "sun"], ["mond", "moon"],
  ["stern", "star"], ["sand", "sand"], ["gras", "grass"], ["bauch", "belly"],
  ["rücken", "back"], ["finger", "finger"], ["tochter", "daughter"],
  ["bruder", "brother"], ["schwester", "sister"],
]);

function wordCount(str) {
  return str.trim().split(/\s+/).length;
}

function tokenize(str) {
  return str.toLowerCase().split(/[\s,;.!?'"()\-]+/).filter(Boolean);
}

function heuristicCheck(word, gloss_en) {
  const reasons = [];
  const wc = wordCount(gloss_en);
  if (wc > MAX_WORDS) reasons.push(`${wc} words`);

  const deTokens = new Set(tokenize(word));
  const enTokens = new Set(tokenize(gloss_en));
  const leaks = [];
  for (const [deWord, enWord] of COGNATES) {
    if (deTokens.has(deWord) && enTokens.has(enWord)) leaks.push(`${deWord}→${enWord}`);
  }
  if (leaks.length) reasons.push(`cognates: ${leaks.join(", ")}`);

  return reasons;
}

// ── Load idioms ───────────────────────────────────────────────────────────────

function loadTranslatedIdioms() {
  const idioms = [];
  for (const file of readdirSync(PHRASES_DIR)) {
    if (!file.endsWith(".json")) continue;
    let data;
    try { data = JSON.parse(readFileSync(join(PHRASES_DIR, file), "utf-8")); }
    catch { continue; }
    if (data.phrase_type !== "idiom") continue;
    const gloss_en = data.senses?.[0]?.gloss_en;
    if (!gloss_en) continue;
    idioms.push({
      file,
      word: data.word,
      gloss_en,
      gloss: data.senses?.[0]?.gloss ?? "",
    });
  }
  return idioms;
}

// ── LLM review ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `\
You are a German-English idiom QA reviewer. You will receive a numbered list of
German idiom → English translation pairs. Review each one and identify BAD translations.

A translation is BAD if it is:
- A literal word-for-word rendering (e.g. "have beans in one's ears" instead of "turn a deaf ear")
- A plain adjective or adverb with no idiomatic flavour (e.g. "annoying" instead of "get on one's nerves")
- The wrong English idiom — meaning mismatch (e.g. "hit the fan" for an idiom about disillusionment)
- A verbose paraphrase (> 8 words) when a concise English idiom exists

A translation is GOOD if it is a recognised English idiom/saying that matches the meaning,
even if it shares a word with the German (e.g. "an eye for an eye", "storm in a teacup",
"money makes the world go round").

Reply with ONLY a JSON array of the bad ones:
[
  { "idx": 3, "word": "...", "current": "...", "issue": "...", "suggestion": "..." },
  ...
]
If everything looks good, return an empty array: []`;

function buildBatchPrompt(batch) {
  return batch
    .map(({ idx, word, gloss_en, gloss }, i) =>
      `${idx}. "${word}" → "${gloss_en}"\n   (German meaning: ${gloss.slice(0, 80)})`,
    )
    .join("\n");
}

async function llmReview(idioms) {
  const apiKey = getApiKey(PROVIDER);
  if (!apiKey && !isLocalProvider(PROVIDER)) {
    console.error(`No API key for provider "${PROVIDER}". Set ${PROVIDER === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"}.`);
    process.exit(1);
  }

  const flagged = [];
  const batches = [];
  for (let i = 0; i < idioms.length; i += BATCH_SIZE) {
    batches.push(idioms.slice(i, i + BATCH_SIZE).map((item, j) => ({
      ...item,
      idx: i + j + 1,
    })));
  }

  console.log(`\nLLM review: ${idioms.length} idioms in ${batches.length} batches (provider: ${PROVIDER}, batch-size: ${BATCH_SIZE})`);

  let totalIn = 0, totalOut = 0;

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    process.stdout.write(`  Batch ${b + 1}/${batches.length} (items ${batch[0].idx}–${batch[batch.length - 1].idx})... `);

    let result;
    try {
      result = await retryWithBackoff(() =>
        callLLM(SYSTEM_PROMPT, buildBatchPrompt(batch), {
          provider: PROVIDER,
          model: MODEL,
          maxTokens: 1024,
          temperature: 0.1,
          jsonMode: true,
        })
      );
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      continue;
    }

    totalIn  += result.input_tokens;
    totalOut += result.output_tokens;

    let parsed;
    try {
      parsed = extractJSON(result.content);
      // Normalize: json_object mode may return a single item or a {key: [...]} wrapper
      // instead of a bare array — handle all three shapes.
      if (!Array.isArray(parsed)) {
        if (parsed.word || parsed.idx) {
          // Single flagged item returned as a plain object → wrap it
          parsed = [parsed];
        } else {
          // Object wrapping an array e.g. { "flagged": [...] } → unwrap first array found
          const inner = Object.values(parsed).find(v => Array.isArray(v));
          parsed = inner ?? [];
        }
      }
    } catch {
      console.log(`parse error — skipping batch`);
      continue;
    }

    console.log(`${parsed.length} flagged`);
    flagged.push(...parsed);
  }

  console.log(`\nTokens used: ${totalIn} in / ${totalOut} out`);
  return flagged;
}

// ── Apply fixes ───────────────────────────────────────────────────────────────

/**
 * Write LLM suggestions back to phrase JSON files.
 * Matches flagged items to files by word name (case-insensitive fallback).
 * Only updates senses[0].gloss_en — all other fields are preserved.
 */
function applyFixes(flagged, wordToFile) {
  let applied = 0;
  let skipped = 0;

  for (const { word, suggestion } of flagged) {
    if (!suggestion?.trim()) { skipped++; continue; }

    // Try exact match first, then case-insensitive
    const filePath = wordToFile.get(word)
      ?? wordToFile.get(word.toLowerCase())
      ?? [...wordToFile.entries()].find(([k]) => k.toLowerCase() === word.toLowerCase())?.[1];

    if (!filePath) {
      console.warn(`  [apply] No file found for "${word}" — skipping`);
      skipped++;
      continue;
    }

    let data;
    try { data = JSON.parse(readFileSync(filePath, "utf-8")); }
    catch { console.warn(`  [apply] Could not read ${filePath} — skipping`); skipped++; continue; }

    if (!data.senses?.[0]) { skipped++; continue; }

    const old = data.senses[0].gloss_en;
    data.senses[0].gloss_en = suggestion.trim();
    writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
    console.log(`  [apply] "${word}": "${old}" → "${suggestion.trim()}"`);
    applied++;
  }

  console.log(`\n  Applied ${applied} fix(es), skipped ${skipped}.`);
}

// ── Output ────────────────────────────────────────────────────────────────────

function printHeuristic(flagged) {
  if (JSON_OUT) return; // printed together at the end
  console.log(`\n── Heuristic (max_words=${MAX_WORDS}) ──────────────────────────────────`);
  if (flagged.length === 0) { console.log("  None flagged."); return; }
  for (const { word, gloss_en, gloss, reasons } of flagged) {
    console.log(`  "${word}"`);
    console.log(`    → "${gloss_en}"  [${reasons.join(" | ")}]`);
    console.log(`    gloss: "${gloss.slice(0, 80)}"`);
  }
  console.log(`\n  ${flagged.length} flagged`);
}

function printLLM(flagged) {
  if (JSON_OUT) return;
  console.log(`\n── LLM review ──────────────────────────────────────────────────────────`);
  if (flagged.length === 0) { console.log("  None flagged — looks clean!"); return; }
  for (const { word, current, issue, suggestion } of flagged) {
    console.log(`  "${word}"`);
    console.log(`    current:    "${current}"`);
    console.log(`    issue:      ${issue}`);
    console.log(`    suggestion: "${suggestion}"`);
  }
  console.log(`\n  ${flagged.length} flagged`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const allIdioms = loadTranslatedIdioms();
const idioms = allIdioms.slice(0, LIMIT);
console.log(`Loaded ${idioms.length}${LIMIT < Infinity ? ` (of ${allIdioms.length})` : ""} translated idioms`);

// word → absolute file path (used by --apply)
const wordToFile = new Map(allIdioms.map(({ word, file }) => [word, join(PHRASES_DIR, file)]));

// Phase 1: heuristics
const heuristicFlagged = idioms
  .map(item => ({ ...item, reasons: heuristicCheck(item.word, item.gloss_en) }))
  .filter(item => item.reasons.length > 0)
  .sort((a, b) =>
    (b.reasons.length + (wordCount(b.gloss_en) > MAX_WORDS ? wordCount(b.gloss_en) - MAX_WORDS : 0)) -
    (a.reasons.length + (wordCount(a.gloss_en) > MAX_WORDS ? wordCount(a.gloss_en) - MAX_WORDS : 0))
  );

printHeuristic(heuristicFlagged);

// Phase 2: LLM (optional)
let llmFlagged = [];
if (USE_LLM) {
  llmFlagged = await llmReview(idioms);
  printLLM(llmFlagged);

  if (APPLY && llmFlagged.length > 0) {
    console.log(`\n── Applying fixes ──────────────────────────────────────────────────────────`);
    applyFixes(llmFlagged, wordToFile);
  }
}

// JSON output (both phases together)
if (JSON_OUT) {
  console.log(JSON.stringify({ heuristic: heuristicFlagged, llm: llmFlagged }, null, 2));
}

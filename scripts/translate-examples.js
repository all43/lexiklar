import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { callLLM, extractJSON, retryWithBackoff, parseProviderArgs, getApiKey, isLocalProvider } from "./lib/llm.js";
import { stripReferences } from "./lib/references.js";
import { POS_CONFIG } from "./lib/pos.js";

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
const { provider: PROVIDER, model: MODEL } = parseProviderArgs(args);

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

// Disambiguation dict adds many tokens and risks blowing local context.
// Skip it for local providers unless the user opts in explicitly.
const USE_DISAMBIG = !isLocalProvider(PROVIDER) || args.includes("--disambig");

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

const SYSTEM_PROMPT = `You are a German-English translation assistant for a dictionary app targeting B2 learners.

Each item has a "type" field:
- "example" (or absent): a full sentence. Translate naturally. Include annotations for content words.
- "expression": an idiomatic phrase. Translate the idiomatic meaning (not word-for-word). No annotations needed.
- "proverb": a saying or proverb. Use the established English equivalent if one exists; otherwise translate the meaning. No annotations needed.

If a "note" field is present, it explains the meaning in German — use it to disambiguate.

For items that need annotations (type "example" only), provide for each content word:
- "form": the exact word as written in the sentence
- "lemma": dictionary form (infinitive for verbs, nominative singular for nouns, base form for adjectives)
- "pos": one of "noun", "verb", "adjective"
- "gloss_hint": if the DISAMBIGUATION object contains the key "lemma|pos" with multiple glosses, pick a 1-3 word substring from the matching gloss that best identifies the intended meaning. If not in disambiguation or has only one meaning, use null.

Rules:
- Skip articles (der/die/das/ein/eine), prepositions, pronouns, conjunctions, particles
- Skip proper nouns unless they are also common nouns
- For separable verbs, use the full infinitive as lemma (e.g. "kommt...an" → "ankommen")
- For expressions and proverbs, return an EMPTY annotations array []

Output format:
- Your ENTIRE response must be a raw JSON array: [{...}, {...}]
- Start with [ and end with ] — no wrapper object, no "examples" key
- Use JSON double quotes " for all strings — not Python-style single quotes '
- No markdown fences, no function calls, no preamble, no trailing text`;

function buildUserPrompt(batch, disambig) {
  const lines = [];

  lines.push(`Translate ${batch.length} German sentence(s) to English:\n`);

  for (const { id, text, type, note } of batch) {
    let line = `[${id}] ${stripReferences(text)}`;
    if (type) line += `  (type: ${type})`;
    if (note) line += `  (note: ${note})`;
    lines.push(line);
  }

  const disambigEntries = Object.entries(disambig);
  if (disambigEntries.length > 0) {
    lines.push("\nDisambiguation hints (use for gloss_hint field):");
    for (const [key, glosses] of disambigEntries) {
      lines.push(`  ${key}: ${glosses.join(" | ")}`);
    }
  }

  lines.push('\nReply with a JSON array, one object per sentence: [{"id":"...","translation":"...","annotations":[...]}]');

  return lines.join("\n");
}

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
  const untranslated = Object.entries(examples)
    .filter(([, ex]) => !ex.translation)
    .map(([id, ex]) => ({
      id,
      text: ex.text,
      type: ex.type || null,
      note: ex.note || null,
    }));

  if (untranslated.length === 0) {
    console.log(`All ${total} examples already translated. Nothing to do.`);
    return;
  }

  console.log(
    `Translating examples... (${total} total, ${total - untranslated.length} already done, ${untranslated.length} remaining)`,
  );
  console.log(`Provider: ${PROVIDER}, batch size: ${BATCH_SIZE}${!USE_DISAMBIG ? " (disambiguation disabled for local model — use --disambig to enable)" : ""}`);

  // Build disambiguation dict (skipped for local providers to save context)
  const disambigDict = USE_DISAMBIG ? buildDisambiguationDict() : new Map();

  // Create batches
  const batches = [];
  for (let i = 0; i < untranslated.length; i += BATCH_SIZE) {
    batches.push(untranslated.slice(i, i + BATCH_SIZE));
  }

  if (DRY_RUN) {
    console.log(`\nDry run: would send ${batches.length} batches.`);
    // Show first batch as sample
    const sampleDisambig = getRelevantDisambiguation(batches[0], disambigDict);
    const samplePrompt = buildUserPrompt(batches[0], sampleDisambig);
    console.log("\nSample batch 1 prompt:");
    console.log(samplePrompt);
    const approxTokens = Math.ceil((SYSTEM_PROMPT.length + samplePrompt.length) / 4);
    console.log(`\nDisambiguation entries for batch 1: ${Object.keys(sampleDisambig).length}`);
    console.log(`Approx prompt size: ~${approxTokens} tokens (system + user, rough estimate)`);
    return;
  }

  let translated = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let errors = 0;
  let consecutiveErrors = 0;
  const llmOptions = { provider: PROVIDER, model: MODEL, maxTokens: 4096, temperature: 0.3, jsonMode: true };

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
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

      // Merge results into examples
      for (const result of results) {
        if (examples[result.id]) {
          examples[result.id].translation = result.translation;
          // Expressions and proverbs don't get annotations
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
      process.stdout.write(
        `  Batch ${i + 1}/${batches.length}: translated ${results.length} examples [${elapsed}s]\n`,
      );

      // Write after each batch for crash safety
      const sorted = {};
      for (const key of Object.keys(examples).sort()) {
        sorted[key] = examples[key];
      }
      writeFileSync(EXAMPLES_FILE, JSON.stringify(sorted, null, 2));
    } catch (err) {
      consecutiveErrors++;
      errors += batch.length;
      console.error(
        `  Batch ${i + 1}/${batches.length}: FAILED after retries: ${err.message}`,
      );
      logError(i + 1, batches.length, err, rawResponse, userPrompt);
      console.error(`  Full response logged to: ${ERROR_LOG}`);

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(
          `\n${consecutiveErrors} consecutive failures — model appears broken. Stopping early.`,
        );
        console.error(`Check ${ERROR_LOG} for raw responses.`);
        break;
      }
    }

    // Rate limit: 200ms between batches
    if (i < batches.length - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Cost estimate
  if (!isLocalProvider(PROVIDER)) {
    let costEstimate;
    if (PROVIDER === "openai") {
      costEstimate =
        (totalInputTokens * 0.15) / 1_000_000 +
        (totalOutputTokens * 0.6) / 1_000_000;
    } else {
      costEstimate =
        (totalInputTokens * 0.8) / 1_000_000 +
        (totalOutputTokens * 4.0) / 1_000_000;
    }

    console.log(
      `\nDone. Translated ${translated} examples.${errors > 0 ? ` ${errors} failed.` : ""}`,
    );
    console.log(
      `Tokens: ${totalInputTokens} input + ${totalOutputTokens} output. Estimated cost: $${costEstimate.toFixed(3)}`,
    );
  } else {
    console.log(
      `\nDone. Translated ${translated} examples.${errors > 0 ? ` ${errors} failed.` : ""}`,
    );
  }

}

main().catch((err) => {
  console.error("Translation failed:", err);
  process.exit(1);
});

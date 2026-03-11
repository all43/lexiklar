/**
 * Translate German glosses (senses[].gloss) to English (senses[].gloss_en).
 *
 * Reads all word files, collects senses with gloss_en === null,
 * sends each one individually to an LLM, and writes translations back.
 *
 * Usage:
 *   node scripts/translate-glosses.js                         # default: OpenAI GPT-4o-mini
 *   node scripts/translate-glosses.js --provider anthropic    # Claude Haiku 3.5
 *   node scripts/translate-glosses.js --provider ollama       # local Ollama (free, offline)
 *   node scripts/translate-glosses.js --provider lm-studio   # local LM Studio
 *   node scripts/translate-glosses.js --model gemma3:4b       # custom model (with any provider)
 *   node scripts/translate-glosses.js --dry-run               # preview without API calls
 *   node scripts/translate-glosses.js --reset --provider ...        # clear all gloss_en, then re-translate
 *   node scripts/translate-glosses.js --reset-idioms --provider ... # clear gloss_en only for idiom phrases, then re-translate
 *
 * Requires OPENAI_API_KEY or ANTHROPIC_API_KEY env var (not needed for ollama/lm-studio).
 * Exits 0 if no key found (pipeline-safe).
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { callLLM, retryWithBackoff, parseProviderArgs, getApiKey, isLocalProvider, getDefaultModel } from "./lib/llm.js";
import { stripReferences } from "./lib/references.js";
import { POS_CONFIG, POS_DIRS } from "./lib/pos.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORDS_DIR = join(ROOT, "data", "words");

// ============================================================
// CLI args
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN      = args.includes("--dry-run");
const RESET        = args.includes("--reset");
const RESET_IDIOMS = args.includes("--reset-idioms");
const FULL_MODE    = args.includes("--full");
const { provider: PROVIDER, model: MODEL } = parseProviderArgs(args);
const MODEL_LABEL = `${PROVIDER}/${MODEL ?? getDefaultModel(PROVIDER)}`;

// ============================================================
// Collect untranslated senses from all word files
// ============================================================

function collectSenses() {
  const items = []; // { filePath, senseIdx, word, pos, gloss }

  for (const posDir of POS_DIRS) {
    const dir = join(WORDS_DIR, posDir);
    if (!existsSync(dir)) continue;

    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(dir, file);
      const data = JSON.parse(readFileSync(filePath, "utf-8"));

      for (let i = 0; i < (data.senses || []).length; i++) {
        const sense = data.senses[i];
        const targetField = FULL_MODE ? "gloss_en_full" : "gloss_en";
        if (!sense[targetField] && sense.gloss) {
          items.push({
            filePath,
            senseIdx: i,
            word: data.word,
            pos: data.pos,
            phraseType: data.phrase_type || null,
            gloss: sense.gloss,
          });
        }
      }
    }
  }

  return items;
}

// ============================================================
// System prompt (exported for test harness)
// ============================================================

export const SYSTEM_PROMPT = `You are a German-English translator for a bilingual dictionary.

You receive a German entry with its pos (part of speech) and German definition (gloss).
Reply with ONLY the English equivalent — no explanation, no quotes, no punctuation.

For pos="noun", pos="verb", pos="adjective", pos="adverb", and similar single words:
- Give the English EQUIVALENT WORD for this specific sense
- Use 1-3 words. Single word preferred. Add a parenthetical only to disambiguate
- Do NOT add articles (a/the) unless essential
- Examples:
    word="Tisch", pos="noun", gloss="Möbelstück mit Platte und Beinen" → table
    word="Tisch", pos="noun", gloss="Mahlzeit" → meal
    word="Bank", pos="noun", gloss="Sitzgelegenheit für mehrere Personen" → bench
    word="Bank", pos="noun", gloss="Geldinstitut" → bank
    word="Bank", pos="noun", gloss="Auswechselbank" → bench (sports)
    word="laufen", pos="verb", gloss="sich auf den Beinen fortbewegen" → run
    word="laufen", pos="verb", gloss="dargeboten oder ausgestrahlt werden" → be showing

For pos="phrase":
- Use the phrase TEXT (word field) as the primary signal — you know what this German phrase means
- phrase_type gives a hint when present:
    phrase_type="idiom"       → find the matching English idiom or set phrase
                                 ⚠ NEVER translate word-for-word — the German words are almost never the English idiom words
                                 ⚠ NEVER pick an idiom just because it shares a surface word with the German
                                 ⚠ NEVER output a bare adjective or adverb — always give an idiomatic phrase
                                 ⚠ If no perfect match exists, use the closest English idiom; as a last resort a concise natural phrase (≤ 6 words)
    phrase_type="proverb"     → use the standard English proverb equivalent
    phrase_type="collocation" → give a direct natural translation (no idiom-hunting needed)
    phrase_type="greeting"    → give the standard English greeting equivalent
    phrase_type="toponym"     → transliterate or use the established English place name

Idiom translation — avoid these mistakes:
    word="Bohnen in den Ohren haben" (meaning: to ignore / not listen)
      ✗ "have beans in one's ears"  ← literal — German idiom words ≠ English idiom words
      ✓ "turn a deaf ear"
    word="Blut und Wasser schwitzen" (meaning: to be extremely anxious)
      ✗ "sweat blood and water"  ← literal
      ✓ "sweat blood"
    word="Nägel mit Köpfen machen" (meaning: to do something thoroughly and decisively)
      ✗ "hit the nail on the head"  ← shares "nail" but wrong meaning
      ✓ "go the whole hog"
    word="auf die Nerven gehen" (meaning: to irritate someone)
      ✗ "annoying"  ← bare adjective, not an idiom
      ✓ "get on one's nerves"
    word="aus voller Kehle" (meaning: singing or shouting as loudly as possible)
      ✗ "loudly"  ← bare adverb, not an idiom
      ✓ "at the top of one's lungs"

Good idiom translations:
    word="bis an die Zähne bewaffnet sein", pos="phrase", phrase_type="idiom", gloss="vollständig bewaffnet sein" → armed to the teeth
    word="aus einer Mücke einen Elefanten machen", pos="phrase", phrase_type="idiom", gloss="etwas übertrieben darstellen" → make a mountain out of a molehill
    word="Rosinen im Kopf haben", pos="phrase", phrase_type="idiom", gloss="übertriebene Vorstellungen von sich selbst haben" → have ideas above one's station
    word="aus allen Himmeln fallen", pos="phrase", phrase_type="idiom", gloss="plötzlich enttäuscht werden" → come down to earth with a bump
    word="wer Wind sät, wird Sturm ernten", pos="phrase", phrase_type="proverb", gloss="wer anderen schadet, muss mit Konsequenzen rechnen" → you reap what you sow
    word="schwarzer Kaffee", pos="phrase", phrase_type="collocation", gloss="Kaffee ohne Milch" → black coffee
    word="Grüne Minna", pos="phrase", phrase_type="collocation", gloss="Fahrzeug der Polizei zum Gefangenentransport" → paddy wagon
    word="wie im Bilderbuch", pos="phrase", phrase_type="idiom", gloss="perfekt, großartig" → picture-perfect

Reply with ONLY the translation, nothing else`;

export const SYSTEM_PROMPT_FULL = `You are a German-English translator for a bilingual dictionary.

Translate the German definition (gloss) into natural, fluent English.
Translate faithfully — only what is written in the source, no added context or assumptions.
Phrase it as a native English speaker would write a dictionary definition.
Keep it to 1-2 sentences. Do NOT start with "A word meaning...", "This refers to...", or similar meta-phrases.
Reply with ONLY the English definition, nothing else.

Examples:
  word="Tisch", pos="noun", gloss="Möbelstück, das aus einer flachen Platte auf Beinen besteht"
    → A piece of furniture consisting of a flat surface on legs
  word="laufen", pos="verb", gloss="sich auf den Beinen fortbewegen"
    → To move forward on foot
  word="Hoffnung", pos="noun", gloss="Zuversicht, dass etwas Erwünschtes eintreten wird"
    → Confidence that something desired will happen
  word="jemandem den Rücken stärken", pos="phrase", gloss="jemanden in seinem Standpunkt oder Vorhaben unterstützen"
    → To support someone in their position or plans`;

// ============================================================
// Build prompt and parse response (single item)
// ============================================================

function buildUserPrompt(item) {
  const cleanGloss = stripReferences(item.gloss);
  const base = `word="${item.word}", pos="${item.pos}"`;
  const typeClause = item.phraseType ? `, phrase_type="${item.phraseType}"` : "";
  return `${base}${typeClause}, gloss="${cleanGloss}"`;
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
// Main
// ============================================================

async function main() {
  // Check API key (not needed for local providers)
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

  const targetField = FULL_MODE ? "gloss_en_full" : "gloss_en";
  const activePrompt = FULL_MODE ? SYSTEM_PROMPT_FULL : SYSTEM_PROMPT;

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

  // Collect untranslated senses
  const items = collectSenses();

  if (items.length === 0) {
    console.log(`All ${targetField} fields already translated. Nothing to do.`);
    return;
  }

  const fileCount = new Set(items.map((i) => i.filePath)).size;
  console.log(`Translating ${items.length} ${targetField} fields across ${fileCount} word files.`);
  console.log(`Provider: ${PROVIDER}, mode: ${FULL_MODE ? "full definition" : "short label"}`);

  if (DRY_RUN) {
    console.log("\nDry run: would send %d API calls.", items.length);
    console.log("\nSample prompt:");
    console.log("  System: " + SYSTEM_PROMPT.split("\n")[0] + "...");
    console.log("  User:   " + buildUserPrompt(items[0]));
    return;
  }

  let translated = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let errors = 0;
  const startAll = Date.now();
  // Full definitions can be 1-2 sentences; short labels are 1-3 words
  const llmOptions = { provider: PROVIDER, model: MODEL, maxTokens: FULL_MODE ? 256 : 128, temperature: 0.2 };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const userPrompt = buildUserPrompt(item);

    try {
      const response = await retryWithBackoff(
        () => callLLM(activePrompt, userPrompt, llmOptions),
        3, 1000,
      );
      totalInputTokens += response.input_tokens;
      totalOutputTokens += response.output_tokens;

      const translation = parseResponse(response.content);
      writeTranslation(item, translation);
      translated++;

      // Progress: print every 10 items or on first/last
      if (i === 0 || (i + 1) % 10 === 0 || i === items.length - 1) {
        const elapsed = ((Date.now() - startAll) / 1000).toFixed(0);
        process.stdout.write(
          `  [${i + 1}/${items.length}] ${item.word}: "${translation}" (${elapsed}s)\n`,
        );
      }
    } catch (err) {
      console.error(`  [${i + 1}/${items.length}] FAILED: ${item.word} — ${err.message}`);
      errors++;
    }

    // Small delay between calls for local models (avoid hammering)
    if (i < items.length - 1) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  const totalTime = ((Date.now() - startAll) / 1000).toFixed(1);
  console.log(
    `\nDone. Translated ${translated} glosses in ${totalTime}s.${errors > 0 ? ` ${errors} failed.` : ""}`,
  );
  console.log(
    `Tokens: ${totalInputTokens} input + ${totalOutputTokens} output.`,
  );

  // Cost estimate (not applicable for local models)
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
    console.log(`Estimated cost: $${costEstimate.toFixed(4)}`);
  }

}

// Only run when executed directly (not when imported by test harness)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Gloss translation failed:", err);
    process.exit(1);
  });
}

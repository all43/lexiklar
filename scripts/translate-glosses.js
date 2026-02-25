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
 *   node scripts/translate-glosses.js --reset --provider ...  # clear all gloss_en, then re-translate
 *
 * Requires OPENAI_API_KEY or ANTHROPIC_API_KEY env var (not needed for ollama/lm-studio).
 * Exits 0 if no key found (pipeline-safe).
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORDS_DIR = join(ROOT, "data", "words");

// ============================================================
// CLI args
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const RESET = args.includes("--reset");
const PROVIDER = (() => {
  const idx = args.indexOf("--provider");
  return idx >= 0 ? args[idx + 1] : "openai";
})();
const MODEL = (() => {
  const idx = args.indexOf("--model");
  return idx >= 0 ? args[idx + 1] : null;
})();
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const LM_STUDIO_URL = process.env.LM_STUDIO_URL || "http://127.0.0.1:1234";

// ============================================================
// Collect untranslated senses from all word files
// ============================================================

function collectSenses() {
  const items = []; // { filePath, senseIdx, word, pos, gloss }

  for (const [posDir] of [
    ["nouns"],
    ["verbs"],
    ["adjectives"],
  ]) {
    const dir = join(WORDS_DIR, posDir);
    if (!existsSync(dir)) continue;

    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(dir, file);
      const data = JSON.parse(readFileSync(filePath, "utf-8"));

      for (let i = 0; i < (data.senses || []).length; i++) {
        const sense = data.senses[i];
        if (!sense.gloss_en && sense.gloss) {
          items.push({
            filePath,
            senseIdx: i,
            word: data.word,
            pos: data.pos,
            gloss: sense.gloss,
          });
        }
      }
    }
  }

  return items;
}

// ============================================================
// LLM API calls
// ============================================================

const SYSTEM_PROMPT = `You are a German-English translator for a bilingual dictionary.

You receive a German word with its German definition (gloss). Reply with ONLY the English equivalent — no explanation, no quotes, no punctuation.

Examples:
  word="Tisch", gloss="Möbelstück mit Platte und Beinen" → table
  word="Tisch", gloss="Mahlzeit" → meal
  word="Hoffnung", gloss="Zuversicht, dass etwas eintreten wird" → hope
  word="Bank", gloss="Sitzgelegenheit für mehrere Personen" → bench
  word="Bank", gloss="Geldinstitut" → bank
  word="Bank", gloss="geologische Formation" → stratum
  word="Bank", gloss="Auswechselbank" → bench (sports)
  word="laufen", gloss="sich auf den Beinen fortbewegen" → run
  word="laufen", gloss="funktionstüchtig sein" → be running
  word="laufen", gloss="dargeboten oder ausgestrahlt werden" → be showing

Rules:
- Reply with the English EQUIVALENT WORD for this specific sense, not a translation of the definition text
- Use 1-3 words. Single word preferred. Add a parenthetical only to disambiguate (e.g. "bench (sports)")
- Do NOT add articles (a/the) unless essential
- Reply with ONLY the translation, nothing else`;

async function callOpenAI(userMessage) {
  const apiKey = process.env.OPENAI_API_KEY;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL || "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 64,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const usage = data.usage || {};
  return {
    content: data.choices[0].message.content,
    input_tokens: usage.prompt_tokens || 0,
    output_tokens: usage.completion_tokens || 0,
  };
}

async function callAnthropic(userMessage) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL || "claude-3-5-haiku-20241022",
      max_tokens: 64,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
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

async function callLocal(userMessage, baseUrl, defaultModel) {
  const model = MODEL || defaultModel;
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 64,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${PROVIDER} API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const usage = data.usage || {};
  return {
    content: data.choices[0].message.content,
    input_tokens: usage.prompt_tokens || 0,
    output_tokens: usage.completion_tokens || 0,
  };
}

async function callLLM(userMessage) {
  if (PROVIDER === "anthropic") return callAnthropic(userMessage);
  if (PROVIDER === "ollama") return callLocal(userMessage, OLLAMA_URL, "gemma3:4b");
  if (PROVIDER === "lm-studio") return callLocal(userMessage, LM_STUDIO_URL, "default");
  return callOpenAI(userMessage);
}

// ============================================================
// Build prompt and parse response (single item)
// ============================================================

function buildUserPrompt(item) {
  return `word="${item.word}", pos="${item.pos}", gloss="${item.gloss}"`;
}

function parseResponse(content) {
  let cleaned = content.trim();
  // Strip quotes if model wraps in them
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  // Strip markdown fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:\w+)?\n?/, "").replace(/\n?```$/, "").trim();
  }
  // Take only first line if model rambled
  cleaned = cleaned.split("\n")[0].trim();
  // Strip trailing period
  if (cleaned.endsWith(".")) cleaned = cleaned.slice(0, -1).trim();

  if (!cleaned) throw new Error("Empty response");
  return cleaned;
}

// ============================================================
// Write a single translation back to its word file
// ============================================================

function writeTranslation(item, translation) {
  const data = JSON.parse(readFileSync(item.filePath, "utf-8"));
  if (data.senses[item.senseIdx]) {
    data.senses[item.senseIdx].gloss_en = translation;
  }
  writeFileSync(item.filePath, JSON.stringify(data, null, 2) + "\n");
}

// ============================================================
// Main
// ============================================================

async function main() {
  // Check API key (not needed for local providers)
  const isLocal = PROVIDER === "ollama" || PROVIDER === "lm-studio";
  if (!isLocal && !DRY_RUN) {
    const apiKey =
      PROVIDER === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : process.env.OPENAI_API_KEY;

    if (!apiKey) {
      const keyName =
        PROVIDER === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
      console.log(
        `No ${keyName} found. Skipping gloss translation. Set the env var to enable, or use --provider ollama for local.`,
      );
      process.exit(0);
    }
  }

  // Reset all gloss_en if requested
  if (RESET) {
    let resetCount = 0;
    for (const posDir of ["nouns", "verbs", "adjectives"]) {
      const dir = join(WORDS_DIR, posDir);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".json")) continue;
        const filePath = join(dir, file);
        const data = JSON.parse(readFileSync(filePath, "utf-8"));
        let changed = false;
        for (const sense of data.senses || []) {
          if (sense.gloss_en) { sense.gloss_en = null; resetCount++; changed = true; }
        }
        if (changed) writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
      }
    }
    console.log(`Reset ${resetCount} gloss_en fields to null.`);
  }

  // Collect untranslated senses
  const items = collectSenses();

  if (items.length === 0) {
    console.log("All glosses already translated. Nothing to do.");
    return;
  }

  const fileCount = new Set(items.map((i) => i.filePath)).size;
  console.log(`Translating ${items.length} glosses across ${fileCount} word files.`);
  console.log(`Provider: ${PROVIDER}, mode: line-by-line`);

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

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const userPrompt = buildUserPrompt(item);

    let retries = 0;
    const maxRetries = 3;
    let success = false;

    while (retries < maxRetries) {
      try {
        const response = await callLLM(userPrompt);
        totalInputTokens += response.input_tokens;
        totalOutputTokens += response.output_tokens;

        const translation = parseResponse(response.content);
        writeTranslation(item, translation);
        translated++;
        success = true;

        // Progress: print every 10 items or on first/last
        if (i === 0 || (i + 1) % 10 === 0 || i === items.length - 1) {
          const elapsed = ((Date.now() - startAll) / 1000).toFixed(0);
          process.stdout.write(
            `  [${i + 1}/${items.length}] ${item.word}: "${translation}" (${elapsed}s)\n`,
          );
        }

        break;
      } catch (err) {
        retries++;
        if (retries >= maxRetries) {
          console.error(`  [${i + 1}/${items.length}] FAILED: ${item.word} — ${err.message}`);
          errors++;
          break;
        }
        await new Promise((r) => setTimeout(r, 1000 * retries));
      }
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
  if (!isLocal) {
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

main().catch((err) => {
  console.error("Gloss translation failed:", err);
  process.exit(1);
});

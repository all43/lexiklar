import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

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
const BATCH_SIZE = (() => {
  const idx = args.indexOf("--batch-size");
  return idx >= 0 ? parseInt(args[idx + 1], 10) || 10 : 10;
})();
const PROVIDER = (() => {
  const idx = args.indexOf("--provider");
  return idx >= 0 ? args[idx + 1] : "openai";
})();

// ============================================================
// Build disambiguation dictionary from word files
// ============================================================

function buildDisambiguationDict() {
  const dict = new Map(); // key: "lemma|pos" → array of gloss strings

  for (const [posDir, posName] of [
    ["nouns", "noun"],
    ["verbs", "verb"],
    ["adjectives", "adjective"],
  ]) {
    const dir = join(WORDS_DIR, posDir);
    if (!existsSync(dir)) continue;

    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const data = JSON.parse(readFileSync(join(dir, file), "utf-8"));
      const key = `${data.word}|${posName}`;
      const glosses = (data.senses || []).map((s) => s.gloss).filter(Boolean);

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
// LLM API calls
// ============================================================

const SYSTEM_PROMPT = `You are a German-English translation assistant for a dictionary app targeting B2 learners.

For each German sentence, provide:
1. A natural English translation
2. Annotations for content words (nouns, verbs, adjectives ONLY)

For each content word annotation, return:
- "form": the exact word as written in the sentence
- "lemma": dictionary form (infinitive for verbs, nominative singular for nouns, base form for adjectives)
- "pos": one of "noun", "verb", "adjective"
- "gloss_hint": if the DISAMBIGUATION object contains the key "lemma|pos" with multiple glosses, pick a 1-3 word substring from the matching gloss that best identifies the intended meaning. If not in disambiguation or has only one meaning, use null.

Rules:
- Skip articles (der/die/das/ein/eine), prepositions, pronouns, conjunctions, particles
- Skip proper nouns unless they are also common nouns
- For separable verbs, use the full infinitive as lemma (e.g. "kommt...an" → "ankommen")
- Output strict JSON array, no markdown fences, no extra text`;

async function callOpenAI(userMessage) {
  const apiKey = process.env.OPENAI_API_KEY;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.3,
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
      model: "claude-3-5-haiku-20241022",
      max_tokens: 4096,
      temperature: 0.3,
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

async function callLLM(userMessage) {
  if (PROVIDER === "anthropic") return callAnthropic(userMessage);
  return callOpenAI(userMessage);
}

// ============================================================
// Build user prompt for a batch
// ============================================================

function buildUserPrompt(batch, disambig) {
  const items = batch.map(({ id, text }) => ({
    id,
    text,
  }));

  const prompt = {
    examples: items,
    disambiguation: disambig,
  };

  return (
    JSON.stringify(prompt, null, 2) +
    "\n\nRespond with a JSON array of objects, one per example: [{\"id\": \"...\", \"translation\": \"...\", \"annotations\": [...]}]"
  );
}

// ============================================================
// Parse and validate LLM response
// ============================================================

function parseResponse(content) {
  // Strip markdown fences if present
  let cleaned = content.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(cleaned);

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
// Main
// ============================================================

async function main() {
  // Check API key
  const apiKey =
    PROVIDER === "anthropic"
      ? process.env.ANTHROPIC_API_KEY
      : process.env.OPENAI_API_KEY;

  if (!apiKey && !DRY_RUN) {
    const keyName =
      PROVIDER === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    console.log(
      `No ${keyName} found. Skipping translation step. Set the env var to enable.`,
    );
    process.exit(0);
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
    .map(([id, ex]) => ({ id, text: ex.text }));

  if (untranslated.length === 0) {
    console.log(`All ${total} examples already translated. Nothing to do.`);
    return;
  }

  console.log(
    `Translating examples... (${total} total, ${total - untranslated.length} already done, ${untranslated.length} remaining)`,
  );
  console.log(`Provider: ${PROVIDER}, batch size: ${BATCH_SIZE}`);

  // Build disambiguation dict
  const disambigDict = buildDisambiguationDict();

  // Create batches
  const batches = [];
  for (let i = 0; i < untranslated.length; i += BATCH_SIZE) {
    batches.push(untranslated.slice(i, i + BATCH_SIZE));
  }

  if (DRY_RUN) {
    console.log(`\nDry run: would send ${batches.length} batches.`);
    // Show first batch as sample
    const sampleDisambig = getRelevantDisambiguation(batches[0], disambigDict);
    console.log("\nSample batch 1 prompt:");
    console.log(buildUserPrompt(batches[0], sampleDisambig));
    console.log(
      `\nDisambiguation entries for batch 1: ${Object.keys(sampleDisambig).length}`,
    );
    return;
  }

  let translated = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let errors = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const disambig = getRelevantDisambiguation(batch, disambigDict);
    const userPrompt = buildUserPrompt(batch, disambig);

    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      try {
        const startTime = Date.now();
        const response = await callLLM(userPrompt);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        totalInputTokens += response.input_tokens;
        totalOutputTokens += response.output_tokens;

        const results = parseResponse(response.content);

        // Merge results into examples
        for (const result of results) {
          if (examples[result.id]) {
            examples[result.id].translation = result.translation;
            examples[result.id].annotations = result.annotations;
          }
        }

        translated += results.length;
        process.stdout.write(
          `  Batch ${i + 1}/${batches.length}: translated ${results.length} examples [${elapsed}s]\n`,
        );

        // Write after each batch for crash safety
        const sorted = {};
        for (const key of Object.keys(examples).sort()) {
          sorted[key] = examples[key];
        }
        writeFileSync(EXAMPLES_FILE, JSON.stringify(sorted, null, 2));

        break; // Success, exit retry loop
      } catch (err) {
        retries++;
        if (retries >= maxRetries) {
          console.error(
            `  Batch ${i + 1}/${batches.length}: FAILED after ${maxRetries} retries: ${err.message}`,
          );
          errors += batch.length;
          break;
        }
        const delay = Math.pow(4, retries) * 1000; // 4s, 16s
        console.log(
          `  Batch ${i + 1}: retry ${retries}/${maxRetries} in ${delay / 1000}s (${err.message})`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    // Rate limit: 200ms between batches
    if (i < batches.length - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Cost estimate
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
}

main().catch((err) => {
  console.error("Translation failed:", err);
  process.exit(1);
});

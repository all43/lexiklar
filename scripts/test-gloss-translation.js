#!/usr/bin/env node

/**
 * Test harness for gloss translation prompt + model evaluation.
 *
 * Sends one gloss at a time — no JSON arrays, no count mismatches.
 * The model receives a word + gloss and returns a plain text translation.
 *
 * Usage:
 *   node scripts/test-gloss-translation.js --provider ollama
 *   node scripts/test-gloss-translation.js --provider lm-studio --model gemma3:4b
 *   node scripts/test-gloss-translation.js --url http://localhost:1234/v1 --model my-model
 *   node scripts/test-gloss-translation.js --provider ollama --show-prompt
 *   node scripts/test-gloss-translation.js --provider ollama --show-response
 *
 * Providers (shortcuts for --url):
 *   ollama      → http://127.0.0.1:11434/v1
 *   lm-studio   → http://127.0.0.1:1234/v1
 *   openai      → https://api.openai.com/v1  (requires OPENAI_API_KEY)
 *   anthropic   → Anthropic messages API      (requires ANTHROPIC_API_KEY)
 *
 * Flags:
 *   --model <name>      Model to use (default: provider-dependent)
 *   --show-prompt       Print the exact system + user prompt for one example, then exit
 *   --show-response     Print the raw model response alongside results
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ============================================================
// CLI args
// ============================================================

const args = process.argv.slice(2);
function flag(name) {
  return args.includes(`--${name}`);
}
function opt(name, fallback = null) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : fallback;
}

const PROVIDER = opt("provider", "ollama");
const MODEL = opt("model");
const CUSTOM_URL = opt("url");
const SHOW_PROMPT = flag("show-prompt");
const SHOW_RESPONSE = flag("show-response");

// ============================================================
// Test cases: word + gloss → acceptable English translations
// ============================================================

const TEST_CASES = [
  // --- Simple single-meaning words (should be one word) ---
  {
    word: "Arzt",
    pos: "noun",
    gloss: "Heilkundiger, der ein Medizinstudium abgeschlossen hat und nach Erlangung der medizinischen Approbation körperliche und seelische Krankheiten behandelt",
    accept: ["doctor", "physician"],
  },
  {
    word: "Freiheit",
    pos: "noun",
    gloss: "Zustand, bei dem jemand von allen Zwängen und Pflichten frei ist",
    accept: ["freedom", "liberty"],
  },
  {
    word: "Hoffnung",
    pos: "noun",
    gloss: "Glaube beziehungsweise Erwartung eines erwünschten Ereignisses in der Zukunft, ohne dass Gewissheit darüber besteht, ob es auch wirklich eintreten wird",
    accept: ["hope"],
  },
  {
    word: "Tisch",
    pos: "noun",
    gloss: "Möbelstück, das aus einer Platte mit vier oder drei Beinen oder mittigen Standfuß besteht",
    accept: ["table"],
  },
  {
    word: "Kind",
    pos: "noun",
    gloss: "heranwachsender Mensch, aber noch kein Jugendlicher",
    accept: ["child", "kid"],
  },

  // --- Homonym disambiguation (same word, different senses) ---
  {
    word: "Bank",
    pos: "noun",
    gloss: "Sitz- oder Ablagegelegenheit für mehrere Personen oder Dinge nebeneinander",
    accept: ["bench", "seat"],
  },
  {
    word: "Bank",
    pos: "noun",
    gloss: "Geldinstitut für Finanzdienstleistungen",
    accept: ["bank", "bank (finance)"],
  },
  {
    word: "Schloss",
    pos: "noun",
    gloss: "an einen Zugang montierte Schließvorrichtung",
    accept: ["lock", "padlock"],
  },
  {
    word: "Schloss",
    pos: "noun",
    gloss: "prunkvolles und repräsentatives Wohngebäude",
    accept: ["castle", "palace", "château"],
  },

  // --- Tisch polysemy (sense 2 and 3 — previous failure) ---
  {
    word: "Tisch",
    pos: "noun",
    gloss: "um einen Tisch versammelte Gesellschaft",
    accept: ["company", "gathering", "dinner party", "table (company)", "group (at table)"],
  },
  {
    word: "Tisch",
    pos: "noun",
    gloss: "Mahlzeit",
    accept: ["meal"],
  },

  // --- Verb sense disambiguation ---
  {
    word: "laufen",
    pos: "verb",
    gloss: "sich auf den Beinen oder Gliedmaßen fortbewegen",
    accept: ["run", "walk"],
  },
  {
    word: "laufen",
    pos: "verb",
    gloss: "funktionstüchtig oder angeschaltet sein",
    accept: ["operate", "run", "work", "be running", "running", "function"],
  },
  {
    word: "laufen",
    pos: "verb",
    gloss: "dargeboten oder ausgestrahlt werden",
    accept: ["be shown", "be showing", "be broadcast", "be on", "air", "be airing", "be playing", "show"],
  },
  {
    word: "aufheben",
    pos: "verb",
    gloss: "etwas nehmen, aufnehmen (was auf dem Boden liegt)",
    accept: ["pick up", "lift"],
  },
  {
    word: "aufheben",
    pos: "verb",
    gloss: "ein Verbot oder eine Beschränkung abschaffen",
    accept: ["abolish", "repeal", "cancel", "lift", "revoke"],
  },
  {
    word: "aufheben",
    pos: "verb",
    gloss: "etwas behalten beziehungsweise nicht wegwerfen",
    accept: ["keep", "save", "preserve", "store"],
  },
  {
    word: "machen",
    pos: "verb",
    gloss: "herstellen, produzieren, anfertigen",
    accept: ["make", "produce", "manufacture", "create"],
  },
  {
    word: "machen",
    pos: "verb",
    gloss: "tun, tätigen, handeln, ausführen, erledigen",
    accept: ["do", "carry out", "perform"],
  },
  {
    word: "erinnern",
    pos: "verb",
    gloss: "im Gedächtnis behalten haben",
    accept: ["remember", "recall"],
  },
  {
    word: "erinnern",
    pos: "verb",
    gloss: "durch Ähnlichkeit ins Gedächtnis rufen",
    accept: ["resemble", "remind", "be reminiscent"],
  },

  // --- Adjectives ---
  {
    word: "schnell",
    pos: "adjective",
    gloss: "eine hohe Geschwindigkeit habend, das Gegenteil von langsam",
    accept: ["fast", "quick", "rapid", "swift"],
  },
  {
    word: "gut",
    pos: "adjective",
    gloss: "vom Menschen her positiv bewertet, empfunden, gefühlt und dergleichen",
    accept: ["good"],
  },
  {
    word: "gut",
    pos: "adjective",
    gloss: "jemandem freundlich gesinnt, jemandem zugetan",
    accept: ["kind", "benevolent", "kind-hearted", "friendly", "well-disposed"],
  },
  {
    word: "groß",
    pos: "adjective",
    gloss: "eine bestimmte, verhältnismäßig beträchtliche räumliche Ausdehnung (Höhe, Länge, Fläche, Volumen) aufweisend",
    accept: ["big", "large", "tall", "great"],
  },
];

// ============================================================
// System prompt — read from translate-glosses.js to stay in sync
// ============================================================

function readSystemPrompt() {
  const src = readFileSync(resolve(ROOT, "scripts/translate-glosses.js"), "utf-8");
  const match = src.match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/);
  if (match) return match[1];
  console.warn("Warning: could not extract SYSTEM_PROMPT from translate-glosses.js, using fallback");
  return "You are a German-English dictionary translator. Reply with ONLY the English word.";
}

const SYSTEM_PROMPT = readSystemPrompt();

// ============================================================
// Build user prompt (one item)
// ============================================================

function buildUserPrompt(testCase) {
  return `word="${testCase.word}", pos="${testCase.pos}", gloss="${testCase.gloss}"`;
}

// ============================================================
// API call (OpenAI-compatible for all local providers)
// ============================================================

function getBaseUrl() {
  if (CUSTOM_URL) return CUSTOM_URL;
  switch (PROVIDER) {
    case "ollama":
      return process.env.OLLAMA_URL
        ? process.env.OLLAMA_URL + "/v1"
        : "http://127.0.0.1:11434/v1";
    case "lm-studio":
      return process.env.LM_STUDIO_URL || "http://127.0.0.1:1234/v1";
    case "openai":
      return "https://api.openai.com/v1";
    default:
      return "http://127.0.0.1:11434/v1";
  }
}

function getDefaultModel() {
  switch (PROVIDER) {
    case "ollama":
      return "gemma3:4b";
    case "lm-studio":
      return "default";
    case "openai":
      return "gpt-4o-mini";
    case "anthropic":
      return "claude-3-5-haiku-latest";
    default:
      return "default";
  }
}

async function callAnthropic(systemPrompt, userMessage) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL || "claude-3-5-haiku-latest",
      max_tokens: 64,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

async function callOpenAICompatible(systemPrompt, userMessage) {
  const baseUrl = getBaseUrl();
  const model = MODEL || getDefaultModel();

  const headers = { "Content-Type": "application/json" };
  if (PROVIDER === "openai" && process.env.OPENAI_API_KEY) {
    headers["Authorization"] = `Bearer ${process.env.OPENAI_API_KEY}`;
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 64,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${PROVIDER} ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

async function callLLM(systemPrompt, userMessage) {
  if (PROVIDER === "anthropic") return callAnthropic(systemPrompt, userMessage);
  return callOpenAICompatible(systemPrompt, userMessage);
}

// ============================================================
// Parse single-item response
// ============================================================

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
  // If model returned a JSON array with one item, extract it
  if (cleaned.startsWith("[")) {
    try {
      const arr = JSON.parse(cleaned);
      if (Array.isArray(arr) && arr.length >= 1) return String(arr[0]).trim();
    } catch { /* not JSON, use as-is */ }
  }
  // Take only first line if model rambled
  const firstLine = cleaned.split("\n")[0].trim();
  return firstLine;
}

// ============================================================
// Matching logic
// ============================================================

function matches(actual, acceptList) {
  const norm = actual.toLowerCase().trim();

  for (const accepted of acceptList) {
    const normAccepted = accepted.toLowerCase().trim();

    // Exact match
    if (norm === normAccepted) return true;

    // Match "word (qualifier)" against accepted "word"
    const parenIdx = norm.indexOf("(");
    if (parenIdx > 0 && norm.slice(0, parenIdx).trim() === normAccepted) return true;
  }

  return false;
}

// ============================================================
// Main
// ============================================================

async function main() {
  const model = MODEL || getDefaultModel();
  const baseUrl = getBaseUrl();

  console.log(`Provider: ${PROVIDER}`);
  console.log(`Model: ${model}`);
  console.log(`URL: ${PROVIDER === "anthropic" ? "api.anthropic.com" : baseUrl}`);
  console.log(`Test cases: ${TEST_CASES.length}`);
  console.log();

  // --- Show prompt mode ---
  if (SHOW_PROMPT) {
    const example = TEST_CASES[0];
    console.log("=== SYSTEM PROMPT ===");
    console.log(SYSTEM_PROMPT);
    console.log();
    console.log("=== USER PROMPT (one item) ===");
    console.log(buildUserPrompt(example));
    console.log();
    console.log("=== Expected response ===");
    console.log("doctor");
    return;
  }

  // --- Run tests one by one ---
  const startAll = Date.now();
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    const userPrompt = buildUserPrompt(tc);

    let actual;
    try {
      const raw = await callLLM(SYSTEM_PROMPT, userPrompt);
      actual = parseResponse(raw);

      if (SHOW_RESPONSE) {
        process.stdout.write(`  [${i + 1}] raw: "${raw.trim()}"\n`);
      }
    } catch (err) {
      actual = `<<ERROR: ${err.message}>>`;
    }

    const ok = matches(actual, tc.accept);
    const status = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";

    if (ok) {
      passed++;
    } else {
      failed++;
      failures.push({ tc, actual });
    }

    const acceptStr = tc.accept.join(" | ");
    console.log(
      `  ${status}  ${tc.word} (${tc.pos})` +
        `  →  "${actual}"` +
        (ok ? "" : `   expected: [${acceptStr}]`)
    );
  }

  const totalTime = ((Date.now() - startAll) / 1000).toFixed(1);
  console.log();
  console.log(`Results: ${passed} passed, ${failed} failed out of ${TEST_CASES.length}  [${totalTime}s]`);

  if (failures.length > 0) {
    console.log();
    console.log("Failed cases:");
    for (const { tc, actual } of failures) {
      console.log(`  ${tc.word}: "${actual}" — gloss: "${tc.gloss.slice(0, 80)}..."`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

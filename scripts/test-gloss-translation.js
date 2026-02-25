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
 *   node scripts/test-gloss-translation.js --provider ollama --show-prompt
 *   node scripts/test-gloss-translation.js --provider ollama --show-response
 *
 * Providers:
 *   ollama      → http://127.0.0.1:11434  (default)
 *   lm-studio   → http://127.0.0.1:1234
 *   openai      → api.openai.com  (requires OPENAI_API_KEY)
 *   anthropic   → api.anthropic.com (requires ANTHROPIC_API_KEY)
 *
 * Flags:
 *   --model <name>      Model to use (default: provider-dependent)
 *   --show-prompt       Print the exact system + user prompt for one example, then exit
 *   --show-response     Print the raw model response alongside results
 */

import { callLLM, parseProviderArgs, getDefaultModel } from "./lib/llm.js";
import { SYSTEM_PROMPT } from "./translate-glosses.js";

// ============================================================
// CLI args
// ============================================================

const args = process.argv.slice(2);
function flag(name) {
  return args.includes(`--${name}`);
}

const { provider: PROVIDER, model: MODEL } = parseProviderArgs(args);
// Default to ollama for test harness (not openai like the translation script)
const EFFECTIVE_PROVIDER = args.includes("--provider") ? PROVIDER : "ollama";
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
// Build user prompt (one item)
// ============================================================

function buildUserPrompt(testCase) {
  return `word="${testCase.word}", pos="${testCase.pos}", gloss="${testCase.gloss}"`;
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
  const model = MODEL || getDefaultModel(EFFECTIVE_PROVIDER);

  console.log(`Provider: ${EFFECTIVE_PROVIDER}`);
  console.log(`Model: ${model}`);
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
  const llmOptions = { provider: EFFECTIVE_PROVIDER, model: MODEL, maxTokens: 64, temperature: 0.2 };

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    const userPrompt = buildUserPrompt(tc);

    let actual;
    try {
      const response = await callLLM(SYSTEM_PROMPT, userPrompt, llmOptions);
      actual = parseResponse(response.content);

      if (SHOW_RESPONSE) {
        process.stdout.write(`  [${i + 1}] raw: "${response.content.trim()}"\n`);
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

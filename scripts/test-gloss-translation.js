#!/usr/bin/env node

/**
 * Test harness for gloss translation prompt + model evaluation.
 *
 * Sends one gloss at a time — no JSON arrays, no count mismatches.
 * The model receives a word + gloss (+ sibling context) and returns a plain text translation.
 *
 * Usage:
 *   node scripts/test-gloss-translation.js --provider ollama
 *   node scripts/test-gloss-translation.js --provider lm-studio --model gemma3:4b
 *   node scripts/test-gloss-translation.js --provider openai
 *   node scripts/test-gloss-translation.js --provider anthropic
 *   node scripts/test-gloss-translation.js --show-prompt
 *   node scripts/test-gloss-translation.js --show-response
 *
 * Flags:
 *   --model <name>      Model to use (default: provider-dependent)
 *   --show-prompt       Print the exact system + user prompt for one disambiguation example, then exit
 *   --show-response     Print the raw model response alongside results
 */

import { callLLM, parseProviderArgs, getDefaultModel } from "./lib/llm.js";
import { WORD_SYSTEM_PROMPT, buildUserPrompt as buildPromptFromScript } from "./translate-glosses.js";

// Re-export alias for --show-prompt mode
export const SYSTEM_PROMPT = WORD_SYSTEM_PROMPT;

// ============================================================
// CLI args
// ============================================================

const args = process.argv.slice(2);
function flag(name) { return args.includes(`--${name}`); }

const { provider: PROVIDER, model: MODEL } = parseProviderArgs(args);
const EFFECTIVE_PROVIDER = args.includes("--provider") ? PROVIDER : "ollama";
const SHOW_PROMPT   = flag("show-prompt");
const SHOW_RESPONSE = flag("show-response");

// ============================================================
// Helpers for building sibling context in test cases
// ============================================================

/**
 * Build an allSenses array for a group of senses, so each item can see its siblings.
 * Each entry: { gloss, gloss_en } — gloss_en starts null and gets filled in as tests run.
 */
function makeSiblings(senses) {
  // Returns array of { gloss, gloss_en: null } — gloss_en filled at runtime
  return senses.map((s) => ({ gloss: s.gloss, gloss_en: null }));
}

// ============================================================
// Test cases
// ============================================================
//
// Fields:
//   word, pos, gloss      — same as before
//   accept                — list of acceptable translations
//   senseIdx              — index of THIS sense in allSenses (used by buildUserPrompt)
//   allSenses             — full list of { gloss, gloss_en } for the word (enables sibling context)
//   group                 — optional tag, used to check distinctness across senses of same word

// --- laufen: 4 senses that previously all got "run" ---
const laufenSenses = [
  { gloss: "sich auf den Beinen oder Gliedmaßen fortbewegen" },
  { gloss: "sich fortbewegen, fließend irgendwohin bewegen" },
  { gloss: "funktionstüchtig oder angeschaltet sein" },
  { gloss: "dargeboten oder ausgestrahlt werden" },
  { gloss: "sich auf eine bestimmte Art und Weise ereignen, geschehen oder entwickeln" },
  { gloss: "in eine bestimmte Richtung verlaufen, sich erstrecken" },
  { gloss: "Geltung oder Wirkung haben; über einen bestimmten Zeitraum andauern" },
  { gloss: "in Zusammenhang mit einem sportlichen Wettkampf laufen" },
  { gloss: "durch Laufen einen bestimmten Zustand beziehungsweise ein Befinden herbeiführen" },
];

// --- stoßen: push/hit collapse ---
const stoßenSenses = [
  { gloss: "mit Kraft gegen etwas oder jemanden drücken oder schlagen" },
  { gloss: "unabsichtlich gegen etwas treffen" },
  { gloss: "auf etwas oder jemanden treffen" },
  { gloss: "jemanden verletzen, jemandem Schmerzen zufügen" },
  { gloss: "etwas mit einem Gerät zermahlen oder zerkleinern" },
];

// --- Bank: classic homonym ---
const bankSenses = [
  { gloss: "Sitz- oder Ablagegelegenheit für mehrere Personen oder Dinge nebeneinander" },
  { gloss: "Geldinstitut für Finanzdienstleistungen" },
  { gloss: "Auswechselbank im Sport" },
];

const TEST_CASES = [
  // ── Single-sense control cases (no sibling context, must still work) ──────────
  {
    word: "Arzt", pos: "noun",
    gloss: "Heilkundiger, der ein Medizinstudium abgeschlossen hat",
    accept: ["doctor", "physician"],
  },
  {
    word: "Freiheit", pos: "noun",
    gloss: "Zustand, bei dem jemand von allen Zwängen und Pflichten frei ist",
    accept: ["freedom", "liberty"],
  },
  {
    word: "schnell", pos: "adjective",
    gloss: "eine hohe Geschwindigkeit habend, das Gegenteil von langsam",
    accept: ["fast", "quick", "rapid", "swift"],
  },

  // ── Bank disambiguation (should produce distinct labels) ─────────────────────
  {
    word: "Bank", pos: "noun", group: "Bank",
    senseIdx: 0, allSenses: makeSiblings(bankSenses),
    gloss: bankSenses[0].gloss,
    accept: ["bench", "seat"],
  },
  {
    word: "Bank", pos: "noun", group: "Bank",
    senseIdx: 1, allSenses: makeSiblings(bankSenses),
    gloss: bankSenses[1].gloss,
    accept: ["bank", "bank (finance)"],
  },
  {
    word: "Bank", pos: "noun", group: "Bank",
    senseIdx: 2, allSenses: makeSiblings(bankSenses),
    gloss: bankSenses[2].gloss,
    accept: ["bench (sports)", "substitute bench", "bench (substitute)"],
  },

  // ── laufen disambiguation (previously all "run") ──────────────────────────────
  {
    word: "laufen", pos: "verb", group: "laufen",
    senseIdx: 0, allSenses: makeSiblings(laufenSenses),
    gloss: laufenSenses[0].gloss,
    accept: ["run", "walk", "go on foot"],
  },
  {
    word: "laufen", pos: "verb", group: "laufen",
    senseIdx: 2, allSenses: makeSiblings(laufenSenses),
    gloss: laufenSenses[2].gloss,
    accept: ["operate", "run", "work", "be running", "function"],
  },
  {
    word: "laufen", pos: "verb", group: "laufen",
    senseIdx: 3, allSenses: makeSiblings(laufenSenses),
    gloss: laufenSenses[3].gloss,
    accept: ["be shown", "be showing", "be broadcast", "air", "be on", "show"],
  },
  {
    word: "laufen", pos: "verb", group: "laufen",
    senseIdx: 5, allSenses: makeSiblings(laufenSenses),
    gloss: laufenSenses[5].gloss,
    accept: ["extend", "run (direction)", "stretch", "go (direction)", "lead"],
  },
  {
    word: "laufen", pos: "verb", group: "laufen",
    senseIdx: 6, allSenses: makeSiblings(laufenSenses),
    gloss: laufenSenses[6].gloss,
    accept: ["be valid", "run (period)", "last", "apply", "be in effect"],
  },

  // ── stoßen disambiguation ─────────────────────────────────────────────────────
  {
    word: "stoßen", pos: "verb", group: "stoßen",
    senseIdx: 0, allSenses: makeSiblings(stoßenSenses),
    gloss: stoßenSenses[0].gloss,
    accept: ["push", "shove", "thrust"],
  },
  {
    word: "stoßen", pos: "verb", group: "stoßen",
    senseIdx: 1, allSenses: makeSiblings(stoßenSenses),
    gloss: stoßenSenses[1].gloss,
    accept: ["bump into", "knock into", "hit (accidentally)", "bump"],
  },
  {
    word: "stoßen", pos: "verb", group: "stoßen",
    senseIdx: 2, allSenses: makeSiblings(stoßenSenses),
    gloss: stoßenSenses[2].gloss,
    accept: ["encounter", "come across", "meet", "run into"],
  },
];

// ============================================================
// Build user prompt — delegates to translate-glosses.js so we test the real prompt
// ============================================================

function buildUserPrompt(tc) {
  // Mirror the item shape expected by buildUserPromptFromScript
  const item = {
    word: tc.word,
    pos: tc.pos,
    phraseType: tc.phraseType || null,
    gloss: tc.gloss,
    senseIdx: tc.senseIdx ?? 0,
    allSenses: tc.allSenses || [],
  };
  return buildPromptFromScript(item);
}

// ============================================================
// Parse single-item response
// ============================================================

function parseResponse(content) {
  let cleaned = content.trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:\w+)?\n?/, "").replace(/\n?```$/, "").trim();
  }
  return cleaned.split("\n")[0].trim();
}

// ============================================================
// Matching logic
// ============================================================

function matches(actual, acceptList) {
  const norm = actual.toLowerCase().trim();
  for (const accepted of acceptList) {
    const normAccepted = accepted.toLowerCase().trim();
    if (norm === normAccepted) return true;
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
  console.log(`Provider: ${EFFECTIVE_PROVIDER}, Model: ${model}`);
  console.log(`Test cases: ${TEST_CASES.length}\n`);

  if (SHOW_PROMPT) {
    // Show the first disambiguation case (Bank sense 0)
    const example = TEST_CASES.find((tc) => tc.group === "Bank");
    console.log("=== SYSTEM PROMPT ===");
    console.log(WORD_SYSTEM_PROMPT);
    console.log("\n=== USER PROMPT (Bank, sense 0, with sibling context) ===");
    console.log(buildUserPrompt(example));
    console.log("\nExpected: bench / seat");
    return;
  }

  const startAll = Date.now();
  let passed = 0;
  let failed = 0;
  const failures = [];
  // Track results per group for distinctness check
  const groupResults = {}; // group → [translation, ...]
  const llmOptions = { provider: EFFECTIVE_PROVIDER, model: MODEL, maxTokens: 64, temperature: 0.2 };

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];

    // Fill in already-translated siblings for this group (simulates pipeline order)
    if (tc.group && tc.allSenses) {
      const prevResults = groupResults[tc.group] || [];
      // Mark earlier senses as "translated" in the allSenses array
      for (let j = 0; j < prevResults.length; j++) {
        const siblingIdx = TEST_CASES
          .filter((t) => t.group === tc.group)
          .findIndex((t) => t.senseIdx === j);
        if (siblingIdx >= 0 && tc.allSenses[j]) {
          tc.allSenses[j].gloss_en = prevResults[j];
        }
      }
    }

    const userPrompt = buildUserPrompt(tc);

    let actual;
    try {
      const response = await callLLM(WORD_SYSTEM_PROMPT, userPrompt, llmOptions);
      actual = parseResponse(response.content);

      // Store translation as context for subsequent senses of same group
      if (tc.group) {
        if (!groupResults[tc.group]) groupResults[tc.group] = [];
        // Update allSenses for sibling test cases that follow
        for (const sibling of TEST_CASES) {
          if (sibling.group === tc.group && sibling.allSenses && tc.senseIdx != null) {
            if (sibling.allSenses[tc.senseIdx]) {
              sibling.allSenses[tc.senseIdx].gloss_en = actual;
            }
          }
        }
        groupResults[tc.group].push(actual);
      }

      if (SHOW_RESPONSE) {
        process.stdout.write(`  [${i + 1}] raw: "${response.content.trim()}"\n`);
      }
    } catch (err) {
      actual = `<<ERROR: ${err.message}>>`;
    }

    const ok = matches(actual, tc.accept);
    if (ok) passed++; else { failed++; failures.push({ tc, actual }); }

    const status = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
    const groupTag = tc.group ? ` [${tc.group}]` : "";
    console.log(
      `  ${status}${groupTag}  ${tc.word} (${tc.pos})  →  "${actual}"` +
      (ok ? "" : `   expected: [${tc.accept.join(" | ")}]`)
    );
  }

  // ── Distinctness check ──────────────────────────────────────────────────────
  console.log();
  let distinctFailed = 0;
  for (const [group, results] of Object.entries(groupResults)) {
    const unique = new Set(results.map((r) => r.toLowerCase()));
    if (unique.size < results.length) {
      console.log(`  \x1b[31mDUPE\x1b[0m  [${group}] translations not all distinct: ${results.join(", ")}`);
      distinctFailed++;
    } else {
      console.log(`  \x1b[32mDISTINCT\x1b[0m  [${group}]: ${results.join(", ")}`);
    }
  }

  const totalTime = ((Date.now() - startAll) / 1000).toFixed(1);
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${distinctFailed} groups with duplicates  [${totalTime}s]`);

  if (failures.length > 0) {
    console.log("\nFailed cases:");
    for (const { tc, actual } of failures) {
      console.log(`  ${tc.word} [${tc.group || "—"}]: "${actual}" — gloss: "${tc.gloss.slice(0, 80)}"`);
    }
  }

  process.exit(failed > 0 || distinctFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

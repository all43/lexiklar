/**
 * Quality check for whitelisted and top-frequency words.
 *
 * Checks per word:
 *   - gloss_en coverage (per sense)
 *   - gloss_en_full coverage (per sense)
 *   - IPA pronunciation present
 *   - Example translation coverage
 *   - Annotations with unknown lemma (not in our word index)
 *   - gloss_hint values not matching any sense
 *
 * Usage:
 *   node scripts/quality-check.js                    # whitelist + top 500
 *   node scripts/quality-check.js --top 1000         # whitelist + top 1000
 *   node scripts/quality-check.js --whitelist-only
 *   node scripts/quality-check.js --word Tisch
 *   node scripts/quality-check.js --pos verb
 *   node scripts/quality-check.js --no-examples      # skip example checks (faster)
 */

import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadExamplesByIds } from "./lib/examples.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORDS_DIR = join(ROOT, "data", "words");
const WHITELIST_FILE = join(ROOT, "config", "word-whitelist.json");

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const topIdx = args.indexOf("--top");
const TOP_N = topIdx !== -1 ? parseInt(args[topIdx + 1]) : 500;
const WHITELIST_ONLY = args.includes("--whitelist-only");
const wordIdx = args.indexOf("--word");
const WORD_FILTER = wordIdx !== -1 ? args[wordIdx + 1] : null;
const posIdx = args.indexOf("--pos");
const POS_FILTER = posIdx !== -1 ? args[posIdx + 1] : null;
const SKIP_EXAMPLES = args.includes("--no-examples");

// ── Load all word files ───────────────────────────────────────────────────────

console.log("Loading word files...");
const allWords = []; // { file, relPath, data }
const knownLemmas = new Set(); // lowercase lemmas in our index

for (const posDir of readdirSync(WORDS_DIR)) {
  if (posDir.startsWith(".")) continue;
  const dir = join(WORDS_DIR, posDir);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const relPath = `${posDir}/${file.replace(".json", "")}`;
    const data = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    allWords.push({ file, relPath, data });
    knownLemmas.add(data.word.toLowerCase());
  }
}
console.log(`Loaded ${allWords.length} word files.`);

// ── Build target set ──────────────────────────────────────────────────────────

let targets;

if (WORD_FILTER) {
  targets = allWords.filter(
    (w) => w.data.word.toLowerCase() === WORD_FILTER.toLowerCase(),
  );
  if (!targets.length) {
    console.error(`Word "${WORD_FILTER}" not found.`);
    process.exit(1);
  }
} else {
  const whitelistWords = new Set(
    JSON.parse(readFileSync(WHITELIST_FILE, "utf-8"))
      .words.map((e) => e.word.toLowerCase()),
  );

  // Sort all words by zipf descending, take top N
  const byZipf = [...allWords].sort(
    (a, b) => (b.data.zipf ?? 0) - (a.data.zipf ?? 0),
  );
  const topSet = new Set(
    byZipf.slice(0, TOP_N).map((w) => w.data.word.toLowerCase()),
  );

  if (WHITELIST_ONLY) {
    targets = allWords.filter((w) => whitelistWords.has(w.data.word.toLowerCase()));
  } else {
    targets = allWords.filter(
      (w) =>
        whitelistWords.has(w.data.word.toLowerCase()) ||
        topSet.has(w.data.word.toLowerCase()),
    );
  }

  if (POS_FILTER) {
    targets = targets.filter((w) => w.data.pos === POS_FILTER);
  }
}

console.log(`Checking ${targets.length} words...\n`);

// ── Load examples for target words ───────────────────────────────────────────

let examplesById = {};
if (!SKIP_EXAMPLES) {
  const allExampleIds = new Set();
  for (const { data } of targets) {
    for (const sense of data.senses || []) {
      for (const id of sense.example_ids || []) allExampleIds.add(id);
    }
    for (const id of data.expression_ids || []) allExampleIds.add(id);
  }
  if (allExampleIds.size > 0) {
    examplesById = loadExamplesByIds([...allExampleIds]);
  }
}

// ── Score + check each word ───────────────────────────────────────────────────

/**
 * Score breakdown (0–100):
 *   40 pts — gloss_en coverage
 *   20 pts — gloss_en_full coverage
 *   20 pts — example translation coverage
 *   10 pts — IPA present
 *   10 pts — annotation health (unknown lemmas + bad gloss_hints)
 */
function checkWord({ data }) {
  const senses = data.senses || [];
  const issues = [];
  let score = 0;

  // gloss_en (40 pts)
  const sensesWithGlossEn = senses.filter((s) => s.gloss_en).length;
  const glossEnScore = senses.length ? sensesWithGlossEn / senses.length : 1;
  score += Math.round(glossEnScore * 40);
  const missingGlossEn = senses.length - sensesWithGlossEn;
  if (missingGlossEn > 0)
    issues.push(`${missingGlossEn}/${senses.length} senses missing gloss_en`);

  // gloss_en_full (20 pts)
  const sensesWithFull = senses.filter((s) => s.gloss_en_full).length;
  const fullScore = senses.length ? sensesWithFull / senses.length : 1;
  score += Math.round(fullScore * 20);
  const missingFull = senses.length - sensesWithFull;
  if (missingFull > 0)
    issues.push(`${missingFull}/${senses.length} senses missing gloss_en_full`);

  // IPA (10 pts)
  const hasIpa = (data.sounds || []).some((s) => s.ipa);
  if (hasIpa) {
    score += 10;
  } else {
    issues.push("no IPA pronunciation");
  }

  // Example translation coverage (20 pts)
  const exampleIds = senses.flatMap((s) => s.example_ids || []);
  if (!SKIP_EXAMPLES && exampleIds.length > 0) {
    const translated = exampleIds.filter(
      (id) => examplesById[id]?.translation,
    ).length;
    const exScore = translated / exampleIds.length;
    score += Math.round(exScore * 20);
    const untranslated = exampleIds.length - translated;
    if (untranslated > 0)
      issues.push(`${untranslated}/${exampleIds.length} examples untranslated`);
  } else if (exampleIds.length === 0) {
    score += 20; // no examples is not a translation problem
    if (data.pos !== "abbreviation" && data.pos !== "phrase")
      issues.push("no examples");
  } else {
    score += 20; // --no-examples mode
  }

  // Annotation health (10 pts) — unknown lemmas + bad gloss_hints
  if (!SKIP_EXAMPLES) {
    const unknownLemmas = new Set();
    const badHints = [];

    for (const id of exampleIds) {
      const ex = examplesById[id];
      if (!ex?.annotations) continue;
      for (const ann of ex.annotations) {
        if (ann.lemma && !knownLemmas.has(ann.lemma.toLowerCase()))
          unknownLemmas.add(ann.lemma);
        if (ann.gloss_hint) {
          // Check hint matches a sense gloss or gloss_en
          const targetSenses = senses.filter((s) =>
            ann.lemma?.toLowerCase() === data.word.toLowerCase(),
          );
          if (targetSenses.length > 1) {
            const hint = ann.gloss_hint.toLowerCase();
            const matches = targetSenses.some(
              (s) =>
                s.gloss?.toLowerCase().includes(hint) ||
                s.gloss_en?.toLowerCase().includes(hint),
            );
            if (!matches) badHints.push(ann.gloss_hint);
          }
        }
      }
    }

    if (unknownLemmas.size === 0 && badHints.length === 0) {
      score += 10;
    } else {
      const annIssues = unknownLemmas.size + badHints.length;
      score += Math.round(10 * Math.max(0, 1 - annIssues / 5));
      if (unknownLemmas.size > 0)
        issues.push(
          `${unknownLemmas.size} unknown annotation lemma(s): ${[...unknownLemmas].slice(0, 3).join(", ")}${unknownLemmas.size > 3 ? "…" : ""}`,
        );
      if (badHints.length > 0)
        issues.push(
          `${badHints.length} bad gloss_hint(s): ${badHints.slice(0, 3).map((h) => `"${h}"`).join(", ")}`,
        );
    }
  } else {
    score += 10;
  }

  return { score, issues };
}

// ── Run checks ────────────────────────────────────────────────────────────────

const results = targets.map((w) => {
  const { score, issues } = checkWord(w);
  return { word: w.data.word, pos: w.data.pos, zipf: w.data.zipf, score, issues };
});

results.sort((a, b) => a.score - b.score);

// ── Render report ─────────────────────────────────────────────────────────────

const POOR = results.filter((r) => r.score < 50);
const FAIR = results.filter((r) => r.score >= 50 && r.score < 80);
const GOOD = results.filter((r) => r.score >= 80);

function renderGroup(label, items, showAll = false) {
  if (!items.length) return;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${label} (${items.length})`);
  console.log("─".repeat(60));
  const display = showAll ? items : items.slice(0, 30);
  for (const r of display) {
    const zipf = r.zipf != null ? ` zipf ${r.zipf.toFixed(1)}` : "";
    console.log(`  [${r.score.toString().padStart(3)}] ${r.word} (${r.pos}${zipf})`);
    for (const issue of r.issues) {
      console.log(`        • ${issue}`);
    }
  }
  if (!showAll && items.length > 30) {
    console.log(`  … and ${items.length - 30} more`);
  }
}

const SHOW_ALL = WORD_FILTER || targets.length <= 100;

renderGroup("POOR  (score < 50)", POOR, SHOW_ALL);
renderGroup("FAIR  (score 50–79)", FAIR, SHOW_ALL);
renderGroup("GOOD  (score ≥ 80)", GOOD, SHOW_ALL);

// ── Summary ───────────────────────────────────────────────────────────────────

const avg = results.reduce((s, r) => s + r.score, 0) / results.length;
const withIssues = results.filter((r) => r.issues.length > 0);

console.log(`\n${"═".repeat(60)}`);
console.log(`Summary — ${results.length} words checked`);
console.log("═".repeat(60));
console.log(
  `  Good  (≥80): ${GOOD.length.toString().padStart(4)}  (${((GOOD.length / results.length) * 100).toFixed(0)}%)`,
);
console.log(
  `  Fair (50–79): ${FAIR.length.toString().padStart(4)}  (${((FAIR.length / results.length) * 100).toFixed(0)}%)`,
);
console.log(
  `  Poor  (<50): ${POOR.length.toString().padStart(4)}  (${((POOR.length / results.length) * 100).toFixed(0)}%)`,
);
console.log(`  Average score: ${avg.toFixed(1)}/100`);
console.log(`  Words with issues: ${withIssues.length}`);

// Most common issue types
const issueFreq = {};
for (const r of results) {
  for (const issue of r.issues) {
    const key = issue.replace(/\d+/g, "N").replace(/:.*/g, "");
    issueFreq[key] = (issueFreq[key] || 0) + 1;
  }
}
const topIssues = Object.entries(issueFreq)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5);
if (topIssues.length) {
  console.log("\n  Most common issues:");
  for (const [issue, count] of topIssues) {
    console.log(`    ${count.toString().padStart(4)}x  ${issue}`);
  }
}
console.log();

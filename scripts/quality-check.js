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
 *   node scripts/quality-check.js --word-list words.txt   # one word per line (or JSON array)
 *   node scripts/quality-check.js --pos verb
 *   node scripts/quality-check.js --no-examples      # skip example checks (faster)
 *   node scripts/quality-check.js --show-raw         # show raw Wiktionary entry per word
 *   node scripts/quality-check.js --skip-proofread [aspects]  # skip already-verified words
 *   node scripts/quality-check.js --mark-proofread [aspects]  # write _proofread flags after review
 *
 * Proofread aspects:
 *   Word-level:    gloss_en, gloss_en_full, examples_owned
 *   Example-level: ex_translation, ex_annotations  (written to shard files)
 *   Shorthand:     "all" = all five aspects
 *
 * --skip-proofread applies to word-level aspects only (filters out whole words).
 * Example-level aspects suppress annotation health issues inline (words still appear).
 *
 * Workflow:
 *   node scripts/quality-check.js --word-list nouns.txt                    # review
 *   node scripts/quality-check.js --word-list nouns.txt --mark-proofread gloss_en,ex_annotations
 *   node scripts/quality-check.js --skip-proofread gloss_en                # those words skipped
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, openSync, readSync, closeSync } from "fs";
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadExamplesByIds, annotationsHash, patchExamples } from "./lib/examples.js";
import Database from "better-sqlite3";

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
const wordListIdx = args.indexOf("--word-list");
const WORD_LIST_FILE = wordListIdx !== -1 ? args[wordListIdx + 1] : null;
const posIdx = args.indexOf("--pos");
const POS_FILTER = posIdx !== -1 ? args[posIdx + 1] : null;
const SKIP_EXAMPLES = args.includes("--no-examples");
const SHOW_RAW = args.includes("--show-raw");

// --skip-proofread [aspects]  — skip words where listed aspects are marked+valid
// --mark-proofread [aspects]  — after check, write _proofread flags to word files
// aspects: comma-separated subset of: gloss_en,gloss_en_full,examples_owned (or "all")
// Word-level aspects (stored in word file _proofread)
// Example-level aspects (stored in example entry _proofread, written to shards)
const ALL_ASPECTS = ["gloss_en", "gloss_en_full", "examples_owned", "ex_translation", "ex_annotations"];
function parseAspects(flagName) {
  const idx = args.indexOf(flagName);
  if (idx === -1) return null;
  const next = args[idx + 1];
  if (!next || next.startsWith("--")) return ALL_ASPECTS; // flag present, no value → all
  return next === "all" ? ALL_ASPECTS : next.split(",").map((s) => s.trim());
}
const SKIP_PROOFREAD = parseAspects("--skip-proofread");
const MARK_PROOFREAD = parseAspects("--mark-proofread");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fingerprint of a word's owned example IDs (matches transform.js logic). */
function exampleIdsHash(data) {
  const ids = [];
  for (const sense of data.senses || []) {
    for (const id of sense.example_ids || []) ids.push(id);
  }
  for (const id of data.expression_ids || []) ids.push(id);
  ids.sort();
  return createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 8);
}

/**
 * Check whether a word's _proofread flags are still valid for the given aspects.
 * Returns the subset of aspects that are currently valid (marked + data unchanged).
 */
function validProofreadAspects(data) {
  const pr = data._proofread;
  if (!pr) return new Set();
  const valid = new Set();
  if (pr.gloss_en === true) valid.add("gloss_en");
  if (pr.gloss_en_full === true) valid.add("gloss_en_full");
  if (pr.examples_owned != null && pr.examples_owned === exampleIdsHash(data)) {
    valid.add("examples_owned");
  }
  return valid;
}

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
} else if (WORD_LIST_FILE) {
  if (!existsSync(WORD_LIST_FILE)) {
    console.error(`Word list file not found: ${WORD_LIST_FILE}`);
    process.exit(1);
  }
  const raw = readFileSync(WORD_LIST_FILE, "utf-8").trim();
  let wordList;
  if (raw.startsWith("[")) {
    wordList = JSON.parse(raw).map((w) => (typeof w === "string" ? w : w.word));
  } else {
    wordList = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  }
  const wordSet = new Set(wordList.map((w) => w.toLowerCase()));
  targets = allWords.filter((w) => wordSet.has(w.data.word.toLowerCase()));
  const found = new Set(targets.map((w) => w.data.word.toLowerCase()));
  const missing = wordList.filter((w) => !found.has(w.toLowerCase()));
  if (missing.length) {
    console.warn(`Warning: ${missing.length} word(s) not found in index: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}`);
  }
  if (!targets.length) {
    console.error("No matching words found.");
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

// Filter out fully-proofread words when --skip-proofread is active
if (SKIP_PROOFREAD) {
  const before = targets.length;
  targets = targets.filter((w) => {
    const valid = validProofreadAspects(w.data);
    return !SKIP_PROOFREAD.every((aspect) => valid.has(aspect));
  });
  const skipped = before - targets.length;
  if (skipped > 0) console.log(`Skipping ${skipped} fully-proofread words.`);
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

// ── Raw Wiktionary lookup (--show-raw) ───────────────────────────────────────

const RAW_PATH = join(ROOT, "data", "raw", "de-extract.jsonl");
const INDEX_PATH = join(ROOT, "data", "raw", "de-extract.offsets.db");

function lookupRaw(word) {
  if (!existsSync(RAW_PATH)) return null;

  const results = [];
  if (existsSync(INDEX_PATH)) {
    const db = new Database(INDEX_PATH, { readonly: true });
    const rows = db.prepare("SELECT byte_offset FROM offsets WHERE word = ?").all(word);
    db.close();
    if (rows.length) {
      const fd = openSync(RAW_PATH, "r");
      const buf = Buffer.alloc(512 * 1024);
      for (const { byte_offset } of rows) {
        const bytesRead = readSync(fd, buf, 0, buf.length, byte_offset);
        const nl = buf.indexOf(0x0a, 0);
        const line = buf.slice(0, nl === -1 ? bytesRead : nl).toString("utf8");
        try { results.push(JSON.parse(line)); } catch { /* skip */ }
      }
      closeSync(fd);
    }
  } else {
    // Fall back to grep if no index
    try {
      const output = execFileSync("grep", ["-m", "20", `^{"word": "${word}"`, RAW_PATH], {
        maxBuffer: 10 * 1024 * 1024,
      });
      for (const line of output.toString().split("\n").filter(Boolean)) {
        try {
          const entry = JSON.parse(line);
          if (entry.word === word && entry.lang_code === "de") results.push(entry);
        } catch { /* skip */ }
      }
    } catch { /* grep exit 1 = no matches */ }
  }
  return results.filter((e) => e.lang_code === "de");
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
      // Skip annotation issues for examples whose annotations were human-verified
      // and haven't changed since (hash still matches).
      if (
        ex._proofread?.annotations != null &&
        ex._proofread.annotations === annotationsHash(ex.annotations)
      ) continue;
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
  return { word: w.data.word, pos: w.data.pos, zipf: w.data.zipf, score, issues, _w: w };
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
    if (SHOW_RAW) {
      const rawEntries = lookupRaw(r.word);
      if (rawEntries && rawEntries.length) {
        for (const entry of rawEntries) {
          const omit = new Set(["translations", "hyponyms", "hypernyms", "coordinate_terms", "holonyms", "meronyms", "troponyms"]);
          const compact = Object.fromEntries(Object.entries(entry).filter(([k]) => !omit.has(k)));
          console.log(`        ↳ raw [${entry.pos}]: ${JSON.stringify(compact, null, 2).replace(/\n/g, "\n        ")}`);
        }
      } else {
        console.log(`        ↳ raw: not found in de-extract.jsonl`);
      }
    }
  }
  if (!showAll && items.length > 30) {
    console.log(`  … and ${items.length - 30} more`);
  }
}

const SHOW_ALL = WORD_FILTER || WORD_LIST_FILE || targets.length <= 100;

renderGroup("POOR  (score < 50)", POOR, SHOW_ALL);
renderGroup("FAIR  (score 50–79)", FAIR, SHOW_ALL);
renderGroup("GOOD  (score ≥ 80)", GOOD, SHOW_ALL);

// ── Summary ───────────────────────────────────────────────────────────────────

const total = results.length;
const avg = total ? results.reduce((s, r) => s + r.score, 0) / total : 0;
const withIssues = results.filter((r) => r.issues.length > 0);
const pct = (n) => total ? `${((n / total) * 100).toFixed(0)}%` : "—";

console.log(`\n${"═".repeat(60)}`);
console.log(`Summary — ${total} words checked`);
console.log("═".repeat(60));
console.log(`  Good  (≥80): ${GOOD.length.toString().padStart(4)}  (${pct(GOOD.length)})`);
console.log(`  Fair (50–79): ${FAIR.length.toString().padStart(4)}  (${pct(FAIR.length)})`);
console.log(`  Poor  (<50): ${POOR.length.toString().padStart(4)}  (${pct(POOR.length)})`);
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

// ── Mark proofread (--mark-proofread) ─────────────────────────────────────────

if (MARK_PROOFREAD) {
  const wordAspects = MARK_PROOFREAD.filter((a) => !a.startsWith("ex_"));
  const exampleAspects = MARK_PROOFREAD.filter((a) => a.startsWith("ex_"));

  // ── Word-level flags ──
  if (wordAspects.length) {
    let marked = 0;
    for (const r of results) {
      const { _w } = r;
      const actualPath = join(WORDS_DIR, `${_w.relPath}.json`);
      if (!existsSync(actualPath)) continue;
      let fileData;
      try { fileData = JSON.parse(readFileSync(actualPath, "utf-8")); } catch { continue; }

      const proofread = { ...(fileData._proofread || {}) };
      for (const aspect of wordAspects) {
        if (aspect === "gloss_en") proofread.gloss_en = true;
        else if (aspect === "gloss_en_full") proofread.gloss_en_full = true;
        else if (aspect === "examples_owned") proofread.examples_owned = exampleIdsHash(fileData);
      }

      fileData._proofread = proofread;
      writeFileSync(actualPath, JSON.stringify(fileData, null, 2) + "\n");
      marked++;
    }
    console.log(`Marked ${marked} word(s) as proofread (${wordAspects.join(", ")}).`);
  }

  // ── Example-level flags ──
  if (exampleAspects.length && Object.keys(examplesById).length) {
    // Collect only the example IDs that are directly owned by the target words.
    const ownedIds = new Set();
    for (const r of results) {
      const { data } = r._w;
      for (const sense of data.senses || []) {
        for (const id of sense.example_ids || []) ownedIds.add(id);
      }
      for (const id of data.expression_ids || []) ownedIds.add(id);
    }

    const patches = {};
    for (const id of ownedIds) {
      const ex = examplesById[id];
      if (!ex) continue;
      const pr = {};
      if (exampleAspects.includes("ex_translation") && ex.translation) {
        pr.translation = true;
      }
      if (exampleAspects.includes("ex_annotations") && ex.annotations) {
        pr.annotations = annotationsHash(ex.annotations);
      }
      if (Object.keys(pr).length) patches[id] = { _proofread: pr };
    }
    if (Object.keys(patches).length) {
      patchExamples(patches);
      console.log(`Marked ${Object.keys(patches).length} example(s) as proofread (${exampleAspects.join(", ")}).`);
    }
  }
}

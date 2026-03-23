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
 *   node scripts/quality-check.ts                    # whitelist + top 500
 *   node scripts/quality-check.ts --top 1000         # whitelist + top 1000
 *   node scripts/quality-check.ts --whitelist-only
 *   node scripts/quality-check.ts --word Tisch
 *   node scripts/quality-check.ts --word-list words.txt   # one word per line (or JSON array)
 *   node scripts/quality-check.ts --pos verb
 *   node scripts/quality-check.ts --no-examples      # skip example checks (faster)
 *   node scripts/quality-check.ts --show-raw         # show raw Wiktionary entry per word
 *   node scripts/quality-check.ts --skip-proofread [aspects]  # skip already-verified words
 *   node scripts/quality-check.ts --mark-proofread [aspects]  # write _proofread flags after review
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
 *   node scripts/quality-check.ts --word-list nouns.txt                    # review
 *   node scripts/quality-check.ts --word-list nouns.txt --mark-proofread gloss_en,ex_annotations
 *   node scripts/quality-check.ts --skip-proofread gloss_en                # those words skipped
 */

import { readFileSync, writeFileSync, existsSync, openSync, readSync, closeSync } from "fs";
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadExamplesByIds, annotationsHash, patchExamples } from "./lib/examples.js";
import { intArg, stringArg } from "./lib/cli.js";
import { loadAllWordFiles, WORDS_DIR } from "./lib/words.js";
import type { ExamplePatch } from "./lib/examples.js";
import type { Word, Sense, ProofreadFlags } from "../types/index.js";
import type { Example, ExampleMap, Annotation } from "../types/index.js";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WHITELIST_FILE = join(ROOT, "config", "word-whitelist.json");

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const TOP_N = intArg(args, "--top", 500);
const WHITELIST_ONLY = args.includes("--whitelist-only");
const WORD_FILTER = stringArg(args, "--word");
const WORD_LIST_FILE = stringArg(args, "--word-list");
const POS_FILTER = stringArg(args, "--pos");
const SKIP_EXAMPLES = args.includes("--no-examples");
const SHOW_RAW = args.includes("--show-raw");

// --skip-proofread [aspects]  — skip words where listed aspects are marked+valid
// --mark-proofread [aspects]  — after check, write _proofread flags to word files
// aspects: comma-separated subset of: gloss_en,gloss_en_full,synonyms_en,examples_owned (or "all")
// Word-level aspects (stored in word file _proofread)
// Example-level aspects (stored in example entry _proofread, written to shards)
const ALL_ASPECTS = ["gloss_en", "gloss_en_full", "synonyms_en", "examples_owned", "ex_translation", "ex_annotations"] as const;
type ProofreadAspect = typeof ALL_ASPECTS[number];

function parseAspects(flagName: string): ProofreadAspect[] | null {
  const idx = args.indexOf(flagName);
  if (idx === -1) return null;
  const next = args[idx + 1];
  if (!next || next.startsWith("--")) return [...ALL_ASPECTS]; // flag present, no value → all
  return next === "all"
    ? [...ALL_ASPECTS]
    : next.split(",").map((s) => s.trim()) as ProofreadAspect[];
}
const SKIP_PROOFREAD = parseAspects("--skip-proofread");
const MARK_PROOFREAD = parseAspects("--mark-proofread");

// ── Types ─────────────────────────────────────────────────────────────────────

interface WordEntry {
  relPath: string;
  data: Word;
}

interface WhitelistEntry {
  word: string;
}

interface WhitelistFile {
  words: WhitelistEntry[];
}

interface CheckResult {
  score: number;
  issues: string[];
}

interface ScoredWord {
  word: string;
  pos: string;
  zipf: number | undefined;
  score: number;
  issues: string[];
  _w: WordEntry;
}

interface RawWiktionaryEntry {
  word: string;
  lang_code: string;
  pos: string;
  [key: string]: unknown;
}

interface OffsetRow {
  byte_offset: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fingerprint of a word's owned example IDs (matches transform.js logic). */
function exampleIdsHash(data: Word): string {
  const ids: string[] = [];
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
function validProofreadAspects(data: Word): Set<string> {
  const pr = data._proofread;
  if (!pr) return new Set();
  const valid = new Set<string>();
  if (pr.gloss_en === true) valid.add("gloss_en");
  if (pr.gloss_en_full === true) valid.add("gloss_en_full");
  if (pr.synonyms_en === true) valid.add("synonyms_en");
  if (pr.examples_owned != null && pr.examples_owned === exampleIdsHash(data)) {
    valid.add("examples_owned");
  }
  return valid;
}

// ── Load all word files ───────────────────────────────────────────────────────

console.log("Loading word files...");
const allWords: WordEntry[] = [];
const knownLemmas = new Set<string>();

for (const { fileKey, data } of loadAllWordFiles()) {
  allWords.push({ relPath: fileKey, data });
  knownLemmas.add(data.word.toLowerCase());
}
console.log(`Loaded ${allWords.length} word files.`);

// ── Build target set ──────────────────────────────────────────────────────────

let targets: WordEntry[];

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
  let wordList: string[];
  if (raw.startsWith("[")) {
    const parsed = JSON.parse(raw) as Array<string | { word: string }>;
    wordList = parsed.map((w) => (typeof w === "string" ? w : w.word));
  } else {
    wordList = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  }
  const wordSet = new Set(wordList.map((w) => w.toLowerCase()));
  targets = allWords.filter((w) => wordSet.has(w.data.word.toLowerCase()));
  const found = new Set(targets.map((w) => w.data.word.toLowerCase()));
  const missing = wordList.filter((w) => !found.has(w.toLowerCase()));
  if (missing.length) {
    console.warn(`Warning: ${missing.length} word(s) not found in index: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "\u2026" : ""}`);
  }
  if (!targets.length) {
    console.error("No matching words found.");
    process.exit(1);
  }
} else {
  const whitelistData = JSON.parse(readFileSync(WHITELIST_FILE, "utf-8")) as WhitelistFile;
  const whitelistWords = new Set(
    whitelistData.words.map((e) => e.word.toLowerCase()),
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

let examplesById: ExampleMap = {};
if (!SKIP_EXAMPLES) {
  const allExampleIds = new Set<string>();
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

function lookupRaw(word: string): RawWiktionaryEntry[] | null {
  if (!existsSync(RAW_PATH)) return null;

  const results: RawWiktionaryEntry[] = [];
  if (existsSync(INDEX_PATH)) {
    const db = new Database(INDEX_PATH, { readonly: true });
    const rows = db.prepare("SELECT byte_offset FROM offsets WHERE word = ?").all(word) as OffsetRow[];
    db.close();
    if (rows.length) {
      const fd = openSync(RAW_PATH, "r");
      const buf = Buffer.alloc(512 * 1024);
      for (const { byte_offset } of rows) {
        const bytesRead = readSync(fd, buf, 0, buf.length, byte_offset);
        const nl = buf.indexOf(0x0a, 0);
        const line = buf.subarray(0, nl === -1 ? bytesRead : nl).toString("utf8");
        try { results.push(JSON.parse(line) as RawWiktionaryEntry); } catch { /* skip */ }
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
          const entry = JSON.parse(line) as RawWiktionaryEntry;
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
function checkWord({ data }: WordEntry): CheckResult {
  const senses = data.senses || [];
  const issues: string[] = [];
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
    const unknownLemmas = new Set<string>();
    const badHints: string[] = [];

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
          const targetSenses = senses.filter((_s) =>
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
          `${unknownLemmas.size} unknown annotation lemma(s): ${[...unknownLemmas].slice(0, 3).join(", ")}${unknownLemmas.size > 3 ? "\u2026" : ""}`,
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

const results: ScoredWord[] = targets.map((w) => {
  const { score, issues } = checkWord(w);
  return { word: w.data.word, pos: w.data.pos, zipf: w.data.zipf, score, issues, _w: w };
});

results.sort((a, b) => a.score - b.score);

// ── Render report ─────────────────────────────────────────────────────────────

const POOR = results.filter((r) => r.score < 50);
const FAIR = results.filter((r) => r.score >= 50 && r.score < 80);
const GOOD = results.filter((r) => r.score >= 80);

function renderGroup(label: string, items: ScoredWord[], showAll = false): void {
  if (!items.length) return;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${label} (${items.length})`);
  console.log("─".repeat(60));
  const display = showAll ? items : items.slice(0, 30);
  for (const r of display) {
    const zipf = r.zipf != null ? ` zipf ${r.zipf.toFixed(1)}` : "";
    console.log(`  [${r.score.toString().padStart(3)}] ${r.word} (${r.pos}${zipf})`);
    for (const issue of r.issues) {
      console.log(`        \u2022 ${issue}`);
    }
    if (SHOW_RAW) {
      const rawEntries = lookupRaw(r.word);
      if (rawEntries && rawEntries.length) {
        for (const entry of rawEntries) {
          const omit = new Set(["translations", "hyponyms", "hypernyms", "coordinate_terms", "holonyms", "meronyms", "troponyms"]);
          const compact = Object.fromEntries(Object.entries(entry).filter(([k]) => !omit.has(k)));
          console.log(`        \u21b3 raw [${entry.pos}]: ${JSON.stringify(compact, null, 2).replace(/\n/g, "\n        ")}`);
        }
      } else {
        console.log(`        \u21b3 raw: not found in de-extract.jsonl`);
      }
    }
  }
  if (!showAll && items.length > 30) {
    console.log(`  \u2026 and ${items.length - 30} more`);
  }
}

const SHOW_ALL = !!(WORD_FILTER || WORD_LIST_FILE) || targets.length <= 100;

renderGroup("POOR  (score < 50)", POOR, SHOW_ALL);
renderGroup("FAIR  (score 50\u201379)", FAIR, SHOW_ALL);
renderGroup("GOOD  (score \u2265 80)", GOOD, SHOW_ALL);

// ── Summary ───────────────────────────────────────────────────────────────────

const total = results.length;
const avg = total ? results.reduce((s, r) => s + r.score, 0) / total : 0;
const withIssues = results.filter((r) => r.issues.length > 0);
const pct = (n: number): string => total ? `${((n / total) * 100).toFixed(0)}%` : "\u2014";

console.log(`\n${"═".repeat(60)}`);
console.log(`Summary — ${total} words checked`);
console.log("═".repeat(60));
console.log(`  Good  (\u226580): ${GOOD.length.toString().padStart(4)}  (${pct(GOOD.length)})`);
console.log(`  Fair (50\u201379): ${FAIR.length.toString().padStart(4)}  (${pct(FAIR.length)})`);
console.log(`  Poor  (<50): ${POOR.length.toString().padStart(4)}  (${pct(POOR.length)})`);
console.log(`  Average score: ${avg.toFixed(1)}/100`);
console.log(`  Words with issues: ${withIssues.length}`);

// Most common issue types
const issueFreq: Record<string, number> = {};
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
      let fileData: Word;
      try { fileData = JSON.parse(readFileSync(actualPath, "utf-8")) as Word; } catch { continue; }

      const proofread: ProofreadFlags = { ...(fileData._proofread || {}) };
      for (const aspect of wordAspects) {
        if (aspect === "gloss_en") proofread.gloss_en = true;
        else if (aspect === "gloss_en_full") proofread.gloss_en_full = true;
        else if (aspect === "synonyms_en") proofread.synonyms_en = true;
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
    const ownedIds = new Set<string>();
    for (const r of results) {
      const { data } = r._w;
      for (const sense of data.senses || []) {
        for (const id of sense.example_ids || []) ownedIds.add(id);
      }
      for (const id of data.expression_ids || []) ownedIds.add(id);
    }

    const patches: Record<string, ExamplePatch> = {};
    for (const id of ownedIds) {
      const ex = examplesById[id];
      if (!ex) continue;
      const pr: Record<string, unknown> = {};
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

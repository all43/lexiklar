/**
 * Subtitle vocabulary coverage checker.
 *
 * Reads .srt / .vtt subtitle files from a local directory (not committed),
 * tokenizes the German text, and checks each word form against the Lexiklar
 * SQLite DB.  Words not covered by any inflected form are reported as
 * whitelist candidates.
 *
 * Usage:
 *   npx tsx scripts/check-cartoon-vocab.ts [options]
 *
 * Options:
 *   --input  <dir>   Directory of .srt/.vtt files  (default: data/raw/cartoon-subtitles)
 *   --db     <path>  SQLite DB path                (default: data/lexiklar.db)
 *   --min-freq <N>   Min subtitle occurrences to report a form (default: 2)
 *   --output <path>  Write JSON candidate entries to this file
 *   --top    <N>     Number of top uncovered words to show (default: 50)
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, extname } from "path";
import Database from "better-sqlite3";
import { intArg, stringArg } from "./lib/cli.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WhitelistEntry {
  word: string;
  domain: string;
  reason: string;
}

interface WhitelistConfig {
  words: WhitelistEntry[];
}

interface CoverageResult {
  lemma: string;
  pos: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dirname, "..");

// Minimal stopword list — function words that are trivially in the DB.
// The goal is just to avoid noise in the report, not to be exhaustive.
const STOPWORDS = new Set([
  "der", "die", "das", "dem", "den", "des",
  "ein", "eine", "einen", "einem", "einer", "eines",
  "und", "oder", "aber", "denn", "weil", "wenn", "dass", "als",
  "ist", "sind", "war", "waren", "hat", "haben", "wird", "werden",
  "ich", "du", "er", "sie", "wir", "ihr",
  "mir", "dir", "uns", "ihn", "ihm", "ihnen",
  "mein", "dein", "sein", "unser", "euer",
  "nicht", "auch", "noch", "nur", "schon", "mal",
  "hier", "dort", "dann", "jetzt", "immer", "sehr",
  "wie", "was", "wer", "wo", "wann", "warum",
  "auf", "mit", "von", "bei", "aus", "nach", "vor", "über",
  "für", "durch", "ohne", "bis", "seit", "gegen",
  "ja", "nein", "oh", "ach", "aha",
]);

// ---------------------------------------------------------------------------
// Subtitle parsing
// ---------------------------------------------------------------------------

function stripSubtitleMarkup(raw: string): string {
  return (
    raw
      // VTT header line
      .replace(/^WEBVTT.*$/gm, "")
      // Timing lines (SRT: 00:00:01,000 --> 00:00:03,000  |  VTT: 00:00:01.000 --> ...)
      .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}.*/g, "")
      // Cue identifier lines (bare integers in SRT)
      .replace(/^\d+\s*$/gm, "")
      // HTML-like tags
      .replace(/<[^>]+>/g, "")
      // VTT positioning metadata
      .replace(/\{[^}]+\}/g, "")
      // VTT NOTE / STYLE / REGION blocks
      .replace(/^(NOTE|STYLE|REGION).*$/gm, "")
  );
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /[a-zA-ZäöüÄÖÜßẞ]{3,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tok = m[0];
    // Skip pure-ASCII lowercase stopwords
    if (STOPWORDS.has(tok.toLowerCase())) continue;
    tokens.push(tok);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// DB queries
// ---------------------------------------------------------------------------

const QUERY_WORD_FORMS = `
  SELECT w.lemma, w.pos
  FROM words w
  JOIN word_forms wf ON wf.word_id = w.id
  WHERE wf.form = ?
  LIMIT 1
`;

const QUERY_LEMMA_FOLDED = `
  SELECT lemma, pos
  FROM words
  WHERE lemma_folded = ?
  LIMIT 1
`;

function lookupForm(
  db: Database.Database,
  stmtForms: Database.Statement,
  stmtLemma: Database.Statement,
  form: string,
): CoverageResult | null {
  const lower = form.toLowerCase();
  let row = stmtForms.get(lower) as { lemma: string; pos: string } | undefined;
  if (row) return { lemma: row.lemma, pos: row.pos };

  // Umlaut-fold: ä→a, ö→o, ü→u, ß→ss
  const folded = lower
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss");
  row = stmtLemma.get(folded) as { lemma: string; pos: string } | undefined;
  if (row) return { lemma: row.lemma, pos: row.pos };

  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const inputDir = stringArg(args, "--input") ?? join(ROOT, "data", "raw", "cartoon-subtitles");
const dbPath = stringArg(args, "--db") ?? join(ROOT, "data", "lexiklar.db");
const minFreq = intArg(args, "--min-freq", 2);
const outputPath = stringArg(args, "--output");
const topN = intArg(args, "--top", 50);

// --- Validate inputs --------------------------------------------------------

if (!existsSync(inputDir)) {
  console.error(`Input directory not found: ${inputDir}`);
  console.error(`Create it and add .srt or .vtt subtitle files, then re-run.`);
  process.exit(1);
}

if (!existsSync(dbPath)) {
  console.error(`SQLite DB not found: ${dbPath}`);
  console.error(`Run npm run build-index first to generate the DB.`);
  process.exit(1);
}

// --- Load subtitle files ----------------------------------------------------

const files = readdirSync(inputDir).filter((f) =>
  [".srt", ".vtt"].includes(extname(f).toLowerCase()),
);

if (files.length === 0) {
  console.error(`No .srt or .vtt files found in: ${inputDir}`);
  process.exit(1);
}

const srtCount = files.filter((f) => extname(f).toLowerCase() === ".srt").length;
const vttCount = files.filter((f) => extname(f).toLowerCase() === ".vtt").length;

const formFreq = new Map<string, number>(); // lowercase form → count

for (const file of files) {
  const raw = readFileSync(join(inputDir, file), "utf-8");
  const clean = stripSubtitleMarkup(raw);
  const tokens = tokenize(clean);
  for (const tok of tokens) {
    const key = tok.toLowerCase();
    formFreq.set(key, (formFreq.get(key) ?? 0) + 1);
  }
}

// Keep original casing for each lowercase form (pick most-frequent casing)
const origCase = new Map<string, string>(); // lowercase → best-case version
for (const file of files) {
  const raw = readFileSync(join(inputDir, file), "utf-8");
  const clean = stripSubtitleMarkup(raw);
  const tokens = tokenize(clean);
  for (const tok of tokens) {
    const key = tok.toLowerCase();
    if (!origCase.has(key)) origCase.set(key, tok);
    // Prefer the cased version (uppercase first char = likely noun)
    else if (tok[0] !== tok[0].toLowerCase() && origCase.get(key)?.[0] === origCase.get(key)?.[0].toLowerCase()) {
      origCase.set(key, tok);
    }
  }
}

const totalTokens = [...formFreq.values()].reduce((a, b) => a + b, 0);

// Filter by min frequency
const candidateForms = [...formFreq.entries()]
  .filter(([, count]) => count >= minFreq)
  .sort((a, b) => b[1] - a[1]);

// --- Query DB ---------------------------------------------------------------

const db = new Database(dbPath, { readonly: true });
const stmtForms = db.prepare(QUERY_WORD_FORMS);
const stmtLemma = db.prepare(QUERY_LEMMA_FOLDED);

const covered: Array<{ form: string; count: number; lemma: string; pos: string }> = [];
const uncovered: Array<{ form: string; display: string; count: number }> = [];

for (const [form, count] of candidateForms) {
  const result = lookupForm(db, stmtForms, stmtLemma, form);
  if (result) {
    covered.push({ form, count, lemma: result.lemma, pos: result.pos });
  } else {
    uncovered.push({ form, display: origCase.get(form) ?? form, count });
  }
}

db.close();

// --- Load whitelist ---------------------------------------------------------

const whitelistPath = join(ROOT, "config", "word-whitelist.json");
const whitelistWords = new Set<string>();
if (existsSync(whitelistPath)) {
  const wl = JSON.parse(readFileSync(whitelistPath, "utf-8")) as WhitelistConfig;
  for (const entry of wl.words) {
    whitelistWords.add(entry.word.toLowerCase());
  }
}

// --- Load blocklist ---------------------------------------------------------

const blocklistPath = join(ROOT, "config", "cartoon-blocklist.txt");
const blocklistWords = new Set<string>();
if (existsSync(blocklistPath)) {
  readFileSync(blocklistPath, "utf-8")
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean)
    .forEach((w) => blocklistWords.add(w.toLowerCase()));
}

const alreadyWhitelisted = uncovered.filter((u) => whitelistWords.has(u.form));
const newCandidates = uncovered.filter(
  (u) => !whitelistWords.has(u.form) && !blocklistWords.has(u.form),
);

// --- Print report -----------------------------------------------------------

const pct = candidateForms.length > 0
  ? ((covered.length / candidateForms.length) * 100).toFixed(1)
  : "0.0";

console.log(`\nSubtitle Vocabulary Coverage Report`);
console.log(`====================================`);
console.log(`Files processed: ${srtCount} .srt, ${vttCount} .vtt`);
console.log(`Total tokens: ${totalTokens.toLocaleString()} | Unique forms (≥${minFreq} occurrences): ${candidateForms.length.toLocaleString()}`);
console.log();
const blocklisted = uncovered.filter((u) => blocklistWords.has(u.form));
console.log(`DB coverage: ${covered.length.toLocaleString()} / ${candidateForms.length.toLocaleString()} (${pct}%)`);
console.log(`Already whitelisted: ${alreadyWhitelisted.length}`);
console.log(`Blocklisted (noise): ${blocklisted.length}`);
console.log(`New whitelist candidates: ${newCandidates.length} (not in DB, not in whitelist, not blocklisted)`);

if (newCandidates.length > 0) {
  const showN = Math.min(topN, newCandidates.length);
  console.log(`\nTop ${showN} uncovered words by subtitle frequency:`);
  const maxWord = Math.max(...newCandidates.slice(0, showN).map((u) => u.display.length));
  for (const { display, count } of newCandidates.slice(0, showN)) {
    const posGuess = display[0] === display[0].toUpperCase() ? "noun?" : "verb/adj?";
    console.log(`  ${display.padEnd(maxWord + 2)}${posGuess.padEnd(10)} ${count} occurrences`);
  }
}

if (alreadyWhitelisted.length > 0) {
  console.log(`\nAlready in whitelist (not in DB yet): ${alreadyWhitelisted.map((u) => u.display).join(", ")}`);
}

// --- Write output -----------------------------------------------------------

if (outputPath) {
  const entries: WhitelistEntry[] = newCandidates.map(({ display, count }) => ({
    word: display,
    domain: "children",
    reason: `cartoon subtitle frequency: ${count}`,
  }));
  writeFileSync(outputPath, JSON.stringify(entries, null, 2) + "\n", "utf-8");
  console.log(`\nCandidate whitelist entries written to: ${outputPath}`);
}

console.log();

/**
 * compare-corpora.ts — Corpus coverage comparison tool
 *
 * Analyzes how many words from a reference word list appear in each available
 * frequency corpus at different rank cutoffs.
 *
 * Available sources (auto-detected from data/raw/):
 *   - Leipzig news          data/raw/leipzig-words.txt
 *   - OpenSubtitles         data/raw/opensubtitles-words.txt
 *   - wordfreq              data/raw/wordfreq-de.txt
 *   - Leipzig Wikipedia     data/raw/deu_wikipedia_2021_<SIZE>-words.txt
 *
 * Usage:
 *   node scripts/compare-corpora.js
 *   node scripts/compare-corpora.js --words /tmp/my-list.txt   # custom word list (one per line)
 *   node scripts/compare-corpora.js --export-wordfreq          # generate wordfreq-de.txt first
 *   node scripts/compare-corpora.js --download-wikipedia [SIZE] # 100K | 300K | 1M (default: 300K)
 *   node scripts/compare-corpora.js --all                      # download + export + compare
 *   node scripts/compare-corpora.js --fresh                    # ignore cached files, regenerate
 */

import {
  readFileSync, writeFileSync, existsSync, readdirSync, createWriteStream,
} from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execSync, spawnSync } from "child_process";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RAW_DIR = join(ROOT, "data", "raw");
const REPORTS_DIR = join(ROOT, "reports");

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (f: string): boolean => args.includes(f);
const flagVal = (f: string, def: string | null): string | null => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};

const EXPORT_WORDFREQ   = flag("--export-wordfreq") || flag("--all");
const DOWNLOAD_WIKI     = flag("--download-wikipedia") || flag("--all");
const WIKI_SIZE         = flagVal("--download-wikipedia", "300K") ?? "300K";
const CUSTOM_WORDS_FILE = flagVal("--words", null);
const FRESH             = flag("--fresh");

// Rank cutoffs to test
const CUTOFFS = [3000, 5000, 10000, 20000, 50000, 100000] as const;

// ── ANSI colours ──────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD  = "\x1b[1m";
const DIM   = "\x1b[2m";
const C: Record<string, string> = {
  yellow:  "\x1b[33m",
  cyan:    "\x1b[36m",
  magenta: "\x1b[35m",
  green:   "\x1b[32m",
  blue:    "\x1b[34m",
};

// ── Corpus registry ───────────────────────────────────────────────────────────

type CorpusFormat = "leipzig" | "subtitles" | "subtlex";

interface CorpusDef {
  id: string;
  label: string;
  file: string;
  format: CorpusFormat;
  color: string;
}

const CORPUS_DEFS: CorpusDef[] = [
  {
    id: "leipzig-news",
    label: "Leipzig news",
    file: join(RAW_DIR, "leipzig-words.txt"),
    format: "leipzig",
    color: C.yellow,
  },
  {
    id: "opensubtitles",
    label: "OpenSubtitles",
    file: join(RAW_DIR, "opensubtitles-words.txt"),
    format: "subtitles",
    color: C.cyan,
  },
  {
    id: "wordfreq",
    label: "wordfreq (7 sources)",
    file: join(RAW_DIR, "wordfreq-de.txt"),
    format: "leipzig",
    color: C.magenta,
  },
  {
    id: "leipzig-wiki",
    label: `Leipzig Wikipedia ${WIKI_SIZE}`,
    file: join(RAW_DIR, "leipzig-wiki-words.txt"),
    format: "leipzig",
    color: C.green,
  },
  {
    id: "subtlex",
    label: "SUBTLEX-DE",
    file: join(RAW_DIR, "subtlex-de.xlsx"),
    format: "subtlex",
    color: C.blue,
  },
];

// ── Load corpus → Map<word, rank> ─────────────────────────────────────────────

interface XLSXModule {
  readFile(file: string): { Sheets: Record<string, unknown>; SheetNames: string[] };
  utils: {
    sheet_to_json(sheet: unknown, opts: { header: 1 }): unknown[][];
  };
}

function loadCorpus(def: CorpusDef): Map<string, number> | null {
  if (!existsSync(def.file)) return null;

  if (def.format === "subtlex") {
    // xlsx: Word(col0), WFfreqcount(col1), SUBTLEX-FPM(col4)
    // Sort by FPM descending to assign ranks
    let XLSX: XLSXModule;
    try { XLSX = require("xlsx") as XLSXModule; } catch { return null; }
    const wb = XLSX.readFile(def.file);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    const map = new Map<string, number>();

    // Filter and type-narrow rows
    const entries: Array<[string, number]> = [];
    for (const r of rows.slice(1)) {
      if (!Array.isArray(r)) continue;
      const word = r[0];
      const fpm = r[4];
      if (typeof word === "string" && typeof fpm === "number" && fpm > 0) {
        entries.push([word, fpm]);
      }
    }
    entries.sort((a, b) => b[1] - a[1]);

    for (let i = 0; i < entries.length; i++) {
      const word = entries[i][0];
      const rank = i + 1;
      if (!map.has(word)) map.set(word, rank);
      const lower = word.toLowerCase();
      if (!map.has(lower)) map.set(lower, rank);
      const titled = word[0].toUpperCase() + word.slice(1).toLowerCase();
      if (!map.has(titled)) map.set(titled, rank);
    }
    return map;
  }

  const lines = readFileSync(def.file, "utf8").split("\n").filter(Boolean);
  const map = new Map<string, number>();

  if (def.format === "leipzig") {
    // rank<TAB>word<TAB>count
    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length < 2) continue;
      const rank = parseInt(parts[0], 10);
      const word = parts[1];
      if (!word || isNaN(rank)) continue;
      if (!map.has(word)) map.set(word, rank);
      const lower = word.toLowerCase();
      if (!map.has(lower)) map.set(lower, rank);
    }
  } else if (def.format === "subtitles") {
    // word<SPACE>count  (position = rank, lowercase)
    for (let i = 0; i < lines.length; i++) {
      const word = lines[i].split(" ")[0];
      if (!word) continue;
      const rank = i + 1;
      if (!map.has(word)) map.set(word, rank);
      const titled = word[0].toUpperCase() + word.slice(1);
      if (!map.has(titled)) map.set(titled, rank);
    }
  }

  return map;
}

// ── Build combined map: best (lowest) rank across sources ─────────────────────

function buildCombined(maps: Array<Map<string, number>>): Map<string, number> {
  const combined = new Map<string, number>();
  for (const map of maps) {
    for (const [word, rank] of map) {
      const cur = combined.get(word);
      if (cur === undefined || rank < cur) combined.set(word, rank);
    }
  }
  return combined;
}

// ── Coverage analysis ─────────────────────────────────────────────────────────

interface AnalysisResult {
  total: number;
  byRank: Record<number, string[]>;
  missing: string[];
}

function analyze(words: string[], rankMap: Map<string, number>): AnalysisResult {
  const byRank: Record<number, string[]> = {};
  for (const c of CUTOFFS) byRank[c] = [];

  const missing: string[] = [];

  for (const word of words) {
    const rank = rankMap.get(word) ?? rankMap.get(word.toLowerCase());
    if (rank === undefined) { missing.push(word); continue; }
    for (const c of CUTOFFS) {
      if (rank <= c) byRank[c].push(word);
    }
  }

  return { total: words.length, byRank, missing };
}

// ── Download Leipzig Wikipedia ────────────────────────────────────────────────

async function downloadWikipedia(size: string): Promise<void> {
  const wordsFile = join(RAW_DIR, `deu_wikipedia_2021_${size}-words.txt`);
  if (!FRESH && existsSync(wordsFile)) {
    console.log(`Leipzig Wikipedia ${size}: already present, skipping.`);
    return;
  }

  const tarFile = join(RAW_DIR, `deu_wikipedia_2021_${size}.tar.gz`);
  const url = `https://downloads.wortschatz-leipzig.de/corpora/deu_wikipedia_2021_${size}.tar.gz`;

  if (!existsSync(tarFile)) {
    console.log(`Downloading Leipzig Wikipedia ${size} (~67MB for 300K)...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    const ws = createWriteStream(tarFile);
    // Convert web ReadableStream to Node.js Readable
    const nodeStream = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
    await pipeline(nodeStream, ws);
    console.log("  Download complete.");
  }

  console.log("  Extracting words file...");
  // Try to pipe-extract directly (avoids extracting huge corpus files)
  try {
    spawnSync("bash", [
      "-c",
      `tar -xzf "${tarFile}" -C "${RAW_DIR}" --wildcards "*_words.txt" 2>/dev/null || ` +
      `tar -xzf "${tarFile}" -C "${RAW_DIR}"`,
    ], { stdio: "pipe", encoding: "utf8" });

    // Find extracted words file and rename if needed
    const found = execSync(
      `find "${RAW_DIR}" -name "deu_wikipedia*words.txt" ! -path "${wordsFile}" | head -1`,
      { encoding: "utf8" },
    ).trim();
    if (found) execSync(`mv "${found}" "${wordsFile}"`);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("  Extraction error:", message);
  }

  console.log(`  Ready: ${basename(wordsFile)}`);
}

// ── Export wordfreq ───────────────────────────────────────────────────────────

function exportWordfreq(): void {
  const outFile = join(RAW_DIR, "wordfreq-de.txt");
  if (!FRESH && existsSync(outFile)) {
    console.log("wordfreq-de.txt: already present, skipping export.");
    return;
  }

  console.log("Exporting wordfreq German data via Python (~30s)...");
  const result = spawnSync(
    "python3",
    [join(__dirname, "lib", "export-wordfreq.py"), outFile],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error("wordfreq export failed");
  console.log("  Done.");
}

// ── Load reference word list ──────────────────────────────────────────────────

function loadWordList(): string[] {
  if (CUSTOM_WORDS_FILE) {
    const lines = readFileSync(CUSTOM_WORDS_FILE, "utf8")
      .split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    console.log(`Loaded ${lines.length} words from ${CUSTOM_WORDS_FILE}`);
    return lines;
  }

  // Default: B1+B2 gap list (generated by coverage check scripts)
  const gapFile = "/tmp/new-seed-words.json";
  if (existsSync(gapFile)) {
    // Filter to words not yet in DB
    const words: unknown = JSON.parse(readFileSync(gapFile, "utf8"));
    if (!Array.isArray(words)) throw new Error("Gap file is not an array");
    const wordList = words as string[];
    const lemmaSet = buildDbLemmaSet();
    const missing = wordList.filter(w => !lemmaSet.has(w) && !lemmaSet.has(w.toLowerCase()));
    console.log(`Gap list: ${missing.length}/${wordList.length} words missing from database`);
    return missing;
  }

  throw new Error(
    "No word list found. Run the B1/B2 gap analysis first, or pass --words <file>.",
  );
}

function buildDbLemmaSet(): Set<string> {
  function walk(dir: string): string[] {
    let files: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) files = files.concat(walk(full));
      else if (e.name.endsWith(".json")) files.push(full);
    }
    return files;
  }
  const set = new Set<string>();
  for (const f of walk(join(ROOT, "data", "words"))) {
    const base = basename(f, ".json");
    const lemma = base.replace(/_[^_]+$/, "");
    set.add(lemma);
    set.add(lemma.toLowerCase());
    set.add(base);
  }
  return set;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

const pct = (n: number, total: number): string =>
  total === 0 ? "0%" : `${Math.round((n / total) * 100)}%`;

interface TableRow {
  label: string;
  color: string;
  result: AnalysisResult;
}

function printTable(rows: TableRow[], words: string[]): void {
  const COL = 26;
  const NUM = 12;

  // Header
  let header = BOLD + "Source".padEnd(COL) + "Not in corpus".padEnd(NUM);
  for (const c of CUTOFFS) {
    header += `top-${c >= 1000 ? c / 1000 + "K" : c}`.padEnd(NUM);
  }
  console.log(header + RESET);
  console.log("-".repeat(COL + NUM + CUTOFFS.length * NUM));

  for (const { label, color, result } of rows) {
    const notInPct = `${result.missing.length} (${pct(result.missing.length, words.length)})`;
    let line = (color || "") + label.padEnd(COL) + RESET;
    line += DIM + notInPct.padEnd(NUM) + RESET;
    for (const c of CUTOFFS) {
      const n = result.byRank[c]?.length ?? 0;
      line += `${n} (${pct(n, words.length)})`.padEnd(NUM);
    }
    console.log(line);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface LoadedCorpus extends CorpusDef {
  map: Map<string, number>;
}

async function main(): Promise<void> {
  if (DOWNLOAD_WIKI) await downloadWikipedia(WIKI_SIZE);
  if (EXPORT_WORDFREQ) exportWordfreq();

  const words = loadWordList();
  console.log(`\nAnalyzing ${words.length} words across available corpora...\n`);

  // Load corpora
  const loaded: LoadedCorpus[] = [];
  for (const def of CORPUS_DEFS) {
    const map = loadCorpus(def);
    const status = map ? `${map.size.toLocaleString()} entries` : "not available";
    console.log(`  ${def.label}: ${status}`);
    if (map) loaded.push({ ...def, map });
  }
  console.log();

  if (loaded.length === 0) {
    console.error("No corpora loaded. Ensure enrich-frequency.js has been run.");
    process.exit(1);
  }

  // Build combined views
  const newsMap    = loaded.find(c => c.id === "leipzig-news")?.map;
  const osMap      = loaded.find(c => c.id === "opensubtitles")?.map;
  const wfMap      = loaded.find(c => c.id === "wordfreq")?.map;
  const wikiMap    = loaded.find(c => c.id === "leipzig-wiki")?.map;
  const subtlexMap = loaded.find(c => c.id === "subtlex")?.map;

  const combCurrentMaps = [newsMap, osMap].filter((m): m is Map<string, number> => m !== undefined);
  const combNewMaps     = [newsMap, wikiMap, subtlexMap, osMap].filter((m): m is Map<string, number> => m !== undefined);

  const rows: TableRow[] = [];

  for (const c of loaded) {
    rows.push({ label: c.label, color: c.color, result: analyze(words, c.map) });
  }

  if (combCurrentMaps.length >= 2) {
    rows.push({
      label: "- Combined (L+OS) old",
      color: C.yellow,
      result: analyze(words, buildCombined(combCurrentMaps)),
    });
  }
  if (combNewMaps.length >= 3) {
    rows.push({
      label: "- Combined (L+Wiki+SBTLX+OS) new",
      color: C.blue,
      result: analyze(words, buildCombined(combNewMaps)),
    });
  }
  if (wfMap) {
    rows.push({
      label: "- Combined (new + wordfreq)",
      color: C.magenta,
      result: analyze(words, buildCombined([...combNewMaps, wfMap])),
    });
  }

  // Print table
  printTable(rows, words);

  // Words not found anywhere
  const neverFound = words.filter(w =>
    loaded.every(c => c.map.get(w) === undefined && c.map.get(w.toLowerCase()) === undefined),
  );
  console.log(`\n${BOLD}Not found in any loaded corpus (${neverFound.length}):${RESET}`);
  if (neverFound.length > 0) {
    const nouns = neverFound.filter(w => w[0] === w[0].toUpperCase());
    const other = neverFound.filter(w => w[0] !== w[0].toUpperCase());
    if (nouns.length) console.log(`  Nouns (${nouns.length}): ${nouns.join(", ")}`);
    if (other.length) console.log(`  Verbs/Adj (${other.length}): ${other.join(", ")}`);
  }

  // Words newly covered by wordfreq vs current combined
  if (wfMap && combCurrentMaps.length > 0) {
    const currentCombined = buildCombined(combCurrentMaps);
    const newAt50K = words.filter(w => {
      const inCurrent = currentCombined.has(w) || currentCombined.has(w.toLowerCase());
      if (inCurrent) return false;
      const wfRank = wfMap.get(w) ?? wfMap.get(w.toLowerCase());
      return wfRank !== undefined && wfRank <= 50000;
    });
    console.log(`\n${BOLD}Words newly covered at top-50K by wordfreq vs current (${newAt50K.length}):${RESET}`);
    if (newAt50K.length > 0) {
      const nouns = newAt50K.filter(w => w[0] === w[0].toUpperCase());
      const other = newAt50K.filter(w => w[0] !== w[0].toUpperCase());
      if (nouns.length) console.log(`  Nouns (${nouns.length}): ${nouns.join(", ")}`);
      if (other.length) console.log(`  Verbs/Adj (${other.length}): ${other.join(", ")}`);
    }
  }

  // Save markdown report
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const reportFile = join(REPORTS_DIR, `corpus-coverage-${ts}.md`);
  const md = [
    `# Corpus Coverage Report`,
    `Generated: ${new Date().toISOString()}`,
    `Word list: ${words.length} words (B1/B2 gap list)`,
    ``,
    `## Coverage at rank cutoffs`,
    ``,
    `| Source | Not in corpus | top-3K | top-5K | top-10K | top-20K | top-50K | top-100K |`,
    `|--------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|`,
    ...rows.map(({ label, result }) => {
      const miss = `${result.missing.length} (${pct(result.missing.length, words.length)})`;
      const cols = CUTOFFS.map(c => {
        const n = result.byRank[c]?.length ?? 0;
        return `${n} (${pct(n, words.length)})`;
      });
      return `| ${label} | ${miss} | ${cols.join(" | ")} |`;
    }),
    ``,
    neverFound.length > 0 ? `## Not found in any corpus (${neverFound.length})\n\n${neverFound.join(", ")}\n` : "",
  ].join("\n");

  writeFileSync(reportFile, md);
  console.log(`\nReport saved to ${reportFile}`);
}

main().catch(err => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});

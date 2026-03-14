import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  createWriteStream,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { POS_DIRS } from "./lib/pos.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RAW_DIR = join(ROOT, "data", "raw");
const DATA_DIR = join(ROOT, "data");

// ── Leipzig News ──────────────────────────────────────────────
const LEIPZIG_NEWS_TAR = join(RAW_DIR, "deu_news_2024_300K.tar.gz");
const LEIPZIG_NEWS_WORDS = join(RAW_DIR, "leipzig-words.txt");
const LEIPZIG_NEWS_URL =
  "https://downloads.wortschatz-leipzig.de/corpora/deu_news_2024_300K.tar.gz";

// ── Leipzig Wikipedia ─────────────────────────────────────────
const LEIPZIG_WIKI_TAR = join(RAW_DIR, "deu_wikipedia_2021_300K.tar.gz");
const LEIPZIG_WIKI_WORDS = join(RAW_DIR, "leipzig-wiki-words.txt");
const LEIPZIG_WIKI_URL =
  "https://downloads.wortschatz-leipzig.de/corpora/deu_wikipedia_2021_300K.tar.gz";

// ── SUBTLEX-DE ────────────────────────────────────────────────
// "SUBTLEX-DE cleaned version with Zipf values" from OSF (Brysbaert et al. 2011)
const SUBTLEX_FILE = join(RAW_DIR, "subtlex-de.xlsx");
const SUBTLEX_URL = "https://osf.io/download/y6ebr/";

// ── OpenSubtitles (hermitdave) — kept for fallback coverage ───
const OPENSUBTITLES_URL =
  "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_50k.txt";
const OPENSUBTITLES_FILE = join(RAW_DIR, "opensubtitles-words.txt");

// ============================================================
// Download helpers
// ============================================================

async function downloadFile(url, dest, label) {
  if (existsSync(dest)) {
    console.log(`${label} already exists. Skipping download.`);
    return;
  }
  console.log(`Downloading ${label}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  const totalBytes = Number(res.headers.get("content-length") || 0);
  let downloadedBytes = 0;
  let lastPercent = -1;

  const out = createWriteStream(dest);
  const reader = res.body.getReader();
  const nodeStream = new Readable({
    async read() {
      const { done, value } = await reader.read();
      if (done) { this.push(null); return; }
      downloadedBytes += value.byteLength;
      if (totalBytes > 0) {
        const percent = Math.floor((downloadedBytes / totalBytes) * 100);
        if (percent !== lastPercent && percent % 10 === 0) {
          lastPercent = percent;
          const dlMB = (downloadedBytes / 1024 / 1024).toFixed(1);
          const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
          process.stdout.write(`\r  ${dlMB} / ${totalMB} MB (${percent}%)`);
        }
      }
      this.push(value);
    },
  });
  await pipeline(nodeStream, out);
  console.log("\n  Download complete.");
}

async function extractLeipzigWords(tarFile, destFile, label) {
  if (existsSync(destFile)) {
    console.log(`${label} words already extracted. Skipping.`);
    return;
  }
  console.log(`Extracting words file from ${label} archive...`);
  const listing = execSync(`tar tzf "${tarFile}" | grep words.txt`, {
    encoding: "utf-8",
  }).trim();
  if (!listing) throw new Error(`No words.txt found in ${tarFile}`);
  execSync(
    `tar xzf "${tarFile}" -C "${RAW_DIR}" --strip-components=1 "${listing}"`,
  );
  const extractedName = listing.split("/").pop();
  const extractedPath = join(RAW_DIR, extractedName);
  if (existsSync(extractedPath) && extractedPath !== destFile) {
    execSync(`mv "${extractedPath}" "${destFile}"`);
  }
  console.log(`  Extracted to ${destFile}`);
}

// ============================================================
// Corpus loaders → all return Map<word_lowercase, fpm>
// except loadLeipzigFPM which preserves original case
// ============================================================

/** Load a Leipzig words.txt and return Map<word, fpm>.
 *  Leipzig format: linenum TAB word TAB count */
function loadLeipzigFPM(filePath, label) {
  const content = readFileSync(filePath, "utf-8");
  const entries = content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      if (parts.length < 3) return null;
      return { word: parts[1], count: parseInt(parts[2], 10) };
    })
    .filter(Boolean);

  const total = entries.reduce((s, e) => s + e.count, 0);
  const map = new Map();
  for (const e of entries) {
    if (!map.has(e.word)) {
      map.set(e.word, e.count / total * 1_000_000);
    }
  }
  console.log(`Loaded ${map.size.toLocaleString()} words from ${label} (${(total/1e6).toFixed(1)}M tokens).`);
  return map;
}

/** Load OpenSubtitles hermitdave list → Map<word_lowercase, fpm>.
 *  Format: word count (space-separated, already sorted) */
function loadOpensubtitlesFPM() {
  if (!existsSync(OPENSUBTITLES_FILE)) return new Map();
  const lines = readFileSync(OPENSUBTITLES_FILE, "utf-8").split("\n").filter(Boolean);
  let total = 0;
  const entries = lines.map((line) => {
    const idx = line.lastIndexOf(" ");
    if (idx === -1) return null;
    const count = parseInt(line.slice(idx + 1), 10);
    total += count;
    return { word: line.slice(0, idx), count };
  }).filter(Boolean);

  const map = new Map();
  for (const e of entries) {
    if (!map.has(e.word)) map.set(e.word, e.count / total * 1_000_000);
  }
  console.log(`Loaded ${map.size.toLocaleString()} words from OpenSubtitles (${(total/1e6).toFixed(1)}M tokens).`);
  return map;
}

/** Load SUBTLEX-DE xlsx → Map<word, fpm>.
 *  Uses the SUBTLEX column (freq per million from subtitle corpus). */
async function loadSubtlexFPM() {
  if (!existsSync(SUBTLEX_FILE)) return new Map();

  // ESM: use createRequire for the CommonJS xlsx package
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  let XLSX;
  try {
    XLSX = require("xlsx");
  } catch {
    console.warn("  xlsx package not found. Run: npm install xlsx --save-dev");
    return new Map();
  }

  const wb = XLSX.readFile(SUBTLEX_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Columns: Word, WFfreqcount, spell-check OK, CUMfreqcount, SUBTLEX(FPM), ...
  const map = new Map();
  for (const row of rows.slice(1)) {
    const word = row[0];
    const fpm = row[4]; // SUBTLEX column = freq per million
    if (typeof word === "string" && typeof fpm === "number" && fpm > 0) {
      if (!map.has(word)) map.set(word, fpm);
    }
  }
  console.log(`Loaded ${map.size.toLocaleString()} words from SUBTLEX-DE.`);
  return map;
}

// ============================================================
// Zipf helpers
// ============================================================

/** Zipf scale: log10(FPM) + 3. Ranges ~1 (very rare) to ~7 (very common). */
function toZipf(fpm) {
  return fpm > 0 ? Math.log10(fpm) + 3 : null;
}

/** Look up a word in a corpus FPM map.
 *  Tries: original → lowercase → title-case (for pronouns like Ich stored capitalized in SUBTLEX). */
function lookupFPM(map, word) {
  return (
    map.get(word) ??
    map.get(word.toLowerCase()) ??
    map.get(word[0].toUpperCase() + word.slice(1).toLowerCase()) ??
    null
  );
}

/** Compute combined Zipf as arithmetic mean of all non-null corpus Zipf values. */
function combineZipf(values) {
  const defined = values.filter((v) => v !== null);
  if (defined.length === 0) return null;
  return defined.reduce((s, v) => s + v, 0) / defined.length;
}

// ============================================================
// Plural-preferred config
// ============================================================

const PLURAL_PREFERRED_FILE = join(ROOT, "config", "plural-preferred.json");

function loadPluralPreferred() {
  if (!existsSync(PLURAL_PREFERRED_FILE)) return new Set();
  return new Set(JSON.parse(readFileSync(PLURAL_PREFERRED_FILE, "utf-8")).words);
}

// ============================================================
// Enrich: two-pass global ranking
// ============================================================

function enrichFiles(newsMap, wikiMap, subtlexMap, opensubMap) {
  const pluralPreferred = loadPluralPreferred();
  let pluralDominantCount = 0;

  // Collect all word files with their computed Zipf scores
  const allEntries = [];

  for (const dir of POS_DIRS) {
    const fullDir = join(DATA_DIR, "words", dir);
    if (!existsSync(fullDir)) continue;

    for (const file of readdirSync(fullDir)) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(fullDir, file);
      const data = JSON.parse(readFileSync(filePath, "utf-8"));

      const zipfNews    = toZipf(lookupFPM(newsMap, data.word));
      const zipfWiki    = toZipf(lookupFPM(wikiMap, data.word));
      const zipfSubtlex = toZipf(lookupFPM(subtlexMap, data.word));
      const zipfOsub    = toZipf(lookupFPM(opensubMap, data.word));

      const combined = combineZipf([zipfNews, zipfWiki, zipfSubtlex, zipfOsub]);

      allEntries.push({
        filePath,
        data,
        combined,
        sources: { news: zipfNews, wiki: zipfWiki, subtlex: zipfSubtlex, osub: zipfOsub },
      });
    }
  }

  // Write absolute Zipf scores (stable across re-runs)
  let enriched = 0;
  let notFound = 0;
  let unchanged = 0;

  for (const { filePath, data, combined } of allEntries) {
    let changed = false;

    if (combined !== null) {
      const rounded = Math.round(combined * 100) / 100; // 2 decimal places
      if (data.zipf !== rounded) {
        data.zipf = rounded;
        changed = true;
      }
      enriched++;
    } else {
      if (data.zipf != null) {
        delete data.zipf;
        changed = true;
      }
      notFound++;
      console.log(`  No frequency data for: ${data.word} (${data.pos})`);
    }

    // Migrate: remove legacy rank field
    if (data.frequency != null) {
      delete data.frequency;
      changed = true;
    }

    if (pluralPreferred.has(data.word)) {
      if (!data.plural_dominant) {
        data.plural_dominant = true;
        changed = true;
      }
      pluralDominantCount++;
    } else if (data.plural_dominant != null) {
      delete data.plural_dominant;
      changed = true;
    }

    if (changed) {
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    } else {
      unchanged++;
    }
  }

  console.log(
    `\nEnriched ${enriched} files with Zipf scores (${unchanged} unchanged). ${notFound} words not found in any corpus.`,
  );
  if (pluralDominantCount > 0) {
    console.log(`Applied plural_dominant to ${pluralDominantCount} nouns.`);
  }
}

// ============================================================
// Diagnostic: --check table
// ============================================================

const CHECK_WORDS = [
  // Grammar words (highest frequency)
  "die", "der", "und", "sein", "haben",
  // Common conversational verbs (subtitles >> news)
  "ich", "gehen", "kommen", "sagen",
  // Common nouns
  "Haus", "Zeit", "Mann",
  // B1-level words
  "Hoffnung", "ankommen", "erinnern", "Zeitung",
  // Rare
  "Abstellgleis", "Quokka",
];

function printCheckTable(newsMap, wikiMap, subtlexMap, opensubMap) {
  const col = (v, w = 7) =>
    v === null ? " ".repeat(w - 1) + "-" : v.toFixed(2).padStart(w);

  console.log(
    "\n" +
    "Word".padEnd(18) +
    "News".padStart(8) +
    "Wiki".padStart(8) +
    "SUBTLEX".padStart(8) +
    "OSub".padStart(8) +
    "Combined".padStart(10),
  );
  console.log("-".repeat(60));

  for (const word of CHECK_WORDS) {
    const zN = toZipf(lookupFPM(newsMap, word));
    const zW = toZipf(lookupFPM(wikiMap, word));
    const zS = toZipf(lookupFPM(subtlexMap, word));
    const zO = toZipf(lookupFPM(opensubMap, word));
    const zC = combineZipf([zN, zW, zS, zO]);
    console.log(
      word.padEnd(18) +
      col(zN) + col(zW) + col(zS) + col(zO) + col(zC, 10),
    );
  }
  console.log("\n(Zipf scale: 7=very common, 4=uncommon, 1=rare)");
}

// ============================================================
// Main
// ============================================================

async function main() {
  const downloadOnly = process.argv.includes("--download-only");
  const checkOnly = process.argv.includes("--check");

  // Downloads
  await downloadFile(LEIPZIG_NEWS_URL, LEIPZIG_NEWS_TAR, "Leipzig news corpus");
  await extractLeipzigWords(LEIPZIG_NEWS_TAR, LEIPZIG_NEWS_WORDS, "Leipzig news");

  await downloadFile(LEIPZIG_WIKI_URL, LEIPZIG_WIKI_TAR, "Leipzig Wikipedia corpus");
  await extractLeipzigWords(LEIPZIG_WIKI_TAR, LEIPZIG_WIKI_WORDS, "Leipzig Wikipedia");

  await downloadFile(SUBTLEX_URL, SUBTLEX_FILE, "SUBTLEX-DE");
  await downloadFile(OPENSUBTITLES_URL, OPENSUBTITLES_FILE, "OpenSubtitles");

  if (downloadOnly) {
    console.log("Download-only mode: corpora ready, skipping enrichment.");
    return;
  }

  // Load all corpora
  const newsMap    = loadLeipzigFPM(LEIPZIG_NEWS_WORDS, "Leipzig news");
  const wikiMap    = loadLeipzigFPM(LEIPZIG_WIKI_WORDS, "Leipzig Wikipedia");
  const subtlexMap = await loadSubtlexFPM();
  const opensubMap = loadOpensubtitlesFPM();

  if (checkOnly) {
    printCheckTable(newsMap, wikiMap, subtlexMap, opensubMap);
    return;
  }

  enrichFiles(newsMap, wikiMap, subtlexMap, opensubMap);
}

main().catch((err) => {
  console.error("Enrichment failed:", err);
  process.exit(1);
});

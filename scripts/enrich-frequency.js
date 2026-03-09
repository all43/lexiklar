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
const LEIPZIG_TAR = join(RAW_DIR, "deu_news_2024_300K.tar.gz");
const WORDS_FILE = join(RAW_DIR, "leipzig-words.txt");
const LEIPZIG_URL =
  "https://downloads.wortschatz-leipzig.de/corpora/deu_news_2024_300K.tar.gz";

// OpenSubtitles frequency list — better everyday/spoken vocabulary coverage
const SUBTITLE_URL =
  "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_50k.txt";
const SUBTITLE_FILE = join(RAW_DIR, "opensubtitles-words.txt");

// ============================================================
// Step 1: Download Leipzig corpus if needed
// ============================================================

async function downloadLeipzig() {
  if (existsSync(WORDS_FILE)) {
    console.log("leipzig-words.txt already exists. Skipping download.");
    return;
  }

  if (!existsSync(LEIPZIG_TAR)) {
    console.log(`Downloading Leipzig corpus...`);
    const res = await fetch(LEIPZIG_URL);
    if (!res.ok)
      throw new Error(`Download failed: ${res.status} ${res.statusText}`);

    const totalBytes = Number(res.headers.get("content-length") || 0);
    let downloadedBytes = 0;
    let lastPercent = -1;

    const out = createWriteStream(LEIPZIG_TAR);
    const reader = res.body.getReader();
    const nodeStream = new Readable({
      async read() {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
          return;
        }
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

  // Extract words.txt from the tar.gz
  console.log("Extracting words file from archive...");
  // The tar contains a folder like deu_news_2024_300K/deu_news_2024_300K-words.txt
  const listing = execSync(`tar tzf "${LEIPZIG_TAR}" | grep words.txt`, {
    encoding: "utf-8",
  }).trim();

  if (!listing) throw new Error("No words.txt found in Leipzig archive");

  execSync(
    `tar xzf "${LEIPZIG_TAR}" -C "${RAW_DIR}" --strip-components=1 "${listing}"`,
  );

  // Rename to our standard name
  const extractedName = listing.split("/").pop();
  const extractedPath = join(RAW_DIR, extractedName);
  if (existsSync(extractedPath) && extractedPath !== WORDS_FILE) {
    execSync(`mv "${extractedPath}" "${WORDS_FILE}"`);
  }

  console.log(`Extracted to ${WORDS_FILE}`);
}

// ============================================================
// Step 1b: Download OpenSubtitles frequency list if needed
// ============================================================

async function downloadSubtitles() {
  if (existsSync(SUBTITLE_FILE)) {
    console.log("opensubtitles-words.txt already exists. Skipping download.");
    return;
  }
  console.log("Downloading OpenSubtitles frequency list...");
  const res = await fetch(SUBTITLE_URL);
  if (!res.ok)
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  writeFileSync(SUBTITLE_FILE, await res.text());
  console.log("  Download complete.");
}

// ============================================================
// Step 2: Parse frequency data from both corpora
// ============================================================

function loadLeipzigFrequency() {
  const content = readFileSync(WORDS_FILE, "utf-8");
  const lines = content.split("\n").filter(Boolean);

  // Sort by frequency descending to compute rank
  const entries = lines
    .map((line) => {
      const parts = line.split("\t");
      if (parts.length < 3) return null;
      return { word: parts[1], frequency: parseInt(parts[2], 10) };
    })
    .filter(Boolean)
    .sort((a, b) => b.frequency - a.frequency);

  // Build word → rank map (rank 1 = most frequent), case-sensitive (Leipzig preserves case)
  const freqMap = new Map();
  entries.forEach((e, i) => {
    if (!freqMap.has(e.word)) {
      freqMap.set(e.word, { rank: i + 1, count: e.frequency });
    }
  });

  console.log(`Loaded ${freqMap.size} words from Leipzig news corpus.`);
  return freqMap;
}

function loadSubtitleFrequency() {
  if (!existsSync(SUBTITLE_FILE)) return new Map();
  const lines = readFileSync(SUBTITLE_FILE, "utf-8").split("\n").filter(Boolean);

  // Format: "word count" (space-separated, already sorted by frequency, lowercase)
  const freqMap = new Map();
  lines.forEach((line, i) => {
    const spaceIdx = line.lastIndexOf(" ");
    if (spaceIdx === -1) return;
    const word = line.slice(0, spaceIdx);
    const count = parseInt(line.slice(spaceIdx + 1), 10);
    if (!freqMap.has(word)) {
      freqMap.set(word, { rank: i + 1, count });
    }
  });

  console.log(`Loaded ${freqMap.size} words from OpenSubtitles corpus.`);
  return freqMap;
}

// ============================================================
// Step 3: Enrich JSON files with frequency (best rank across both corpora)
// ============================================================

// ============================================================
// Plural-preferred list: manually curated nouns where the plural
// form is more natural/common than the singular.
// ============================================================

const PLURAL_PREFERRED_FILE = join(ROOT, "config", "plural-preferred.json");

function loadPluralPreferred() {
  if (!existsSync(PLURAL_PREFERRED_FILE)) return new Set();
  const data = JSON.parse(readFileSync(PLURAL_PREFERRED_FILE, "utf-8"));
  return new Set(data.words);
}

function enrichFiles(leipzigMap, subtitleMap) {
  let enriched = 0;
  let notFound = 0;
  const pluralPreferred = loadPluralPreferred();
  let pluralDominantCount = 0;

  for (const dir of POS_DIRS) {
    const fullDir = join(DATA_DIR, "words", dir);
    if (!existsSync(fullDir)) continue;

    for (const file of readdirSync(fullDir)) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(fullDir, file);
      const data = JSON.parse(readFileSync(filePath, "utf-8"));

      // Leipzig is case-sensitive; subtitles are lowercase → look up both ways
      const leipzigFreq = leipzigMap.get(data.word);
      const subtitleFreq = subtitleMap.get(data.word.toLowerCase());

      // Use best (lowest = most frequent) rank across both corpora
      let bestRank = null;
      if (leipzigFreq) bestRank = leipzigFreq.rank;
      if (subtitleFreq && (bestRank === null || subtitleFreq.rank < bestRank)) {
        bestRank = subtitleFreq.rank;
      }

      if (bestRank !== null) {
        data.frequency = bestRank;
        enriched++;
      } else {
        notFound++;
        console.log(`  No frequency data for: ${data.word} (${data.pos})`);
      }

      // Apply plural-preferred flag from curated config
      if (pluralPreferred.has(data.word)) {
        data.plural_dominant = true;
        pluralDominantCount++;
      } else {
        delete data.plural_dominant;
      }

      writeFileSync(filePath, JSON.stringify(data, null, 2));
    }
  }

  console.log(
    `\nEnriched ${enriched} files with frequency rank. ${notFound} words not found in corpus.`,
  );
  if (pluralDominantCount > 0) {
    console.log(`Applied plural_dominant to ${pluralDominantCount} nouns.`);
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  const downloadOnly = process.argv.includes("--download-only");

  await downloadLeipzig();
  await downloadSubtitles();

  if (downloadOnly) {
    console.log("Download-only mode: corpora ready, skipping enrichment.");
    return;
  }

  const leipzigMap = loadLeipzigFrequency();
  const subtitleMap = loadSubtitleFrequency();
  enrichFiles(leipzigMap, subtitleMap);
}

main().catch((err) => {
  console.error("Enrichment failed:", err);
  process.exit(1);
});

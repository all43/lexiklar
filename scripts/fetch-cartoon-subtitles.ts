/**
 * Fetch German subtitles for children's cartoons from OpenSubtitles REST API.
 *
 * Credentials are read from .env in the project root:
 *   OPENSUBTITLES_USERNAME, OPENSUBTITLES_PASSWORD, OPENSUBTITLES_API_KEY
 *
 * Downloads .srt files to data/raw/cartoon-subtitles/ (gitignored).
 * Tracks downloaded file_ids in .downloaded.json so the download API is
 * never called for files already on disk, regardless of filename changes.
 *
 * Usage:
 *   npx tsx scripts/fetch-cartoon-subtitles.ts [options]
 *
 * Options:
 *   --max-per-show <N>   Max subtitle files per show per run (default: 3)
 *   --shows <list>       Comma-separated show queries (overrides defaults)
 *   --dry-run            Print what would be downloaded without downloading
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { intArg, stringArg } from "./lib/cli.js";

const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "data", "raw", "cartoon-subtitles");
const STATE_FILE = join(OUT_DIR, ".downloaded.json");
const API_BASE = "https://api.opensubtitles.com/api/v1";

// ---------------------------------------------------------------------------
// Show list
// ---------------------------------------------------------------------------
interface ShowConfig {
  query: string;       // sent to OpenSubtitles API
  keywords: string[];  // ALL must appear (case-insensitive) in the release name
}

const DEFAULT_SHOWS: ShowConfig[] = [
  { query: "Peppa Wutz",           keywords: ["peppa"] },
  { query: "Bluey",                keywords: ["bluey"] },
  { query: "Paw Patrol",           keywords: ["paw", "patrol"] },
  { query: "Dora Abenteuer",       keywords: ["dora"] },
  { query: "Bob the Builder",      keywords: ["bob", "builder"] },
  { query: "Sendung mit der Maus", keywords: ["sendung", "maus"] },
  { query: "Bibi und Tina",        keywords: ["bibi", "tina"] },
  { query: "Benjamin Blümchen",    keywords: ["benjamin"] },
  { query: "Wickie",               keywords: ["wickie"] },
  { query: "Shaun das Schaf",      keywords: ["shaun"] },
  { query: "Feuerwehrmann Sam",    keywords: ["feuerwehrmann"] },
  { query: "Thomas Lokomotive",    keywords: ["thomas", "lokomotive"] },
];

// ---------------------------------------------------------------------------
// State: track downloaded file_ids to skip the download API on re-runs
// ---------------------------------------------------------------------------
function loadState(): Set<number> {
  if (!existsSync(STATE_FILE)) return new Set();
  try {
    const ids = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as number[];
    return new Set(ids);
  } catch {
    return new Set();
  }
}

function saveState(ids: Set<number>): void {
  writeFileSync(STATE_FILE, JSON.stringify([...ids].sort((a, b) => a - b), null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// .env loader
// ---------------------------------------------------------------------------
function loadEnv(): Record<string, string> {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return {};
  return Object.fromEntries(
    readFileSync(envPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .map((l) => {
        const idx = l.indexOf("=");
        return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
      }),
  );
}

// ---------------------------------------------------------------------------
// Fisher-Yates shuffle (in-place)
// ---------------------------------------------------------------------------
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// OpenSubtitles API helpers
// ---------------------------------------------------------------------------
async function apiLogin(apiKey: string, username: string, password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}

interface SubtitleFile {
  file_id: number;
  file_name: string;
}

interface SubtitleResult {
  id: string;
  attributes: {
    release: string;
    language: string;
    files: SubtitleFile[];
  };
}

async function searchSubtitles(apiKey: string, token: string, query: string): Promise<SubtitleResult[]> {
  const params = new URLSearchParams({ query, languages: "de", type: "episode" });
  const res = await fetch(`${API_BASE}/subtitles?${params}`, {
    headers: { "Api-Key": apiKey, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Search failed (${query}): ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { data: SubtitleResult[] };
  return data.data ?? [];
}

function filterByRelevance(results: SubtitleResult[], keywords: string[]): SubtitleResult[] {
  if (keywords.length === 0) return results;
  return results.filter((r) => {
    const release = r.attributes.release.toLowerCase();
    return keywords.every((kw) => release.includes(kw.toLowerCase()));
  });
}

async function getDownloadLink(apiKey: string, token: string, fileId: number): Promise<{ link: string; remaining: number }> {
  const res = await fetch(`${API_BASE}/download`, {
    method: "POST",
    headers: { "Api-Key": apiKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  if (!res.ok) throw new Error(`Download link failed (${fileId}): ${res.status} ${await res.text()}`);
  return (await res.json()) as { link: string; remaining: number };
}

async function downloadFile(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`File download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const maxPerShow = intArg(args, "--max-per-show", 3);
const showsArg = stringArg(args, "--shows");
const dryRun = args.includes("--dry-run");

const shows: ShowConfig[] = showsArg
  ? showsArg.split(",").map((s) => ({ query: s.trim(), keywords: [s.trim().split(/\s+/)[0].toLowerCase()] }))
  : DEFAULT_SHOWS;

const env = loadEnv();
const apiKey = env["OPENSUBTITLES_API_KEY"] ?? process.env["OPENSUBTITLES_API_KEY"];
const username = env["OPENSUBTITLES_USERNAME"] ?? process.env["OPENSUBTITLES_USERNAME"];
const password = env["OPENSUBTITLES_PASSWORD"] ?? process.env["OPENSUBTITLES_PASSWORD"];

if (!apiKey || !username || !password) {
  console.error("Missing OPENSUBTITLES_API_KEY / USERNAME / PASSWORD in .env");
  process.exit(1);
}

if (!dryRun) mkdirSync(OUT_DIR, { recursive: true });

const downloadedIds = loadState();
console.log(`\nFetching German subtitles for ${shows.length} shows (max ${maxPerShow} new per show)`);
console.log(`Already downloaded: ${downloadedIds.size} file(s)`);
if (dryRun) console.log("(dry run — nothing will be downloaded)\n");

console.log("\nLogging in to OpenSubtitles...");
const token = await apiLogin(apiKey, username, password);
console.log("Logged in.\n");

let totalDownloaded = 0;
let totalSkipped = 0;

for (const show of shows) {
  console.log(`\n── ${show.query}`);

  let results: SubtitleResult[] = [];
  try {
    await delay(1500);
    results = await searchSubtitles(apiKey, token, show.query);
  } catch (e) {
    console.error(`  Search error: ${e}`);
    continue;
  }

  results = filterByRelevance(results, show.keywords);

  if (results.length === 0) {
    console.log("  No matching German subtitles found.");
    continue;
  }

  // Shuffle for variety — different episodes each run
  shuffle(results);

  const alreadyDone = results.filter((r) => {
    const file = r.attributes.files[0];
    return file && downloadedIds.has(file.file_id);
  });
  const todo = results.filter((r) => {
    const file = r.attributes.files[0];
    return file && !downloadedIds.has(file.file_id);
  });

  console.log(`  ${results.length} matching (${alreadyDone.length} already downloaded, ${todo.length} new)`);
  if (alreadyDone.length > 0) totalSkipped += alreadyDone.length;

  let downloaded = 0;
  for (const result of todo) {
    if (downloaded >= maxPerShow) break;
    const file = result.attributes.files[0];
    if (!file) continue;

    const safeName = show.query.replace(/[^a-zA-Z0-9äöüÄÖÜß]+/g, "_").replace(/_+/g, "_");
    const safeRelease = result.attributes.release
      .replace(/[^a-zA-Z0-9äöüÄÖÜß._-]+/g, "_")
      .slice(0, 60);
    const outName = `${safeName}_${safeRelease}_${file.file_id}.srt`;

    if (dryRun) {
      console.log(`  ✓ would download: ${outName}`);
      downloaded++;
      continue;
    }

    try {
      const { link, remaining } = await getDownloadLink(apiKey, token, file.file_id);
      const buf = await downloadFile(link);
      writeFileSync(join(OUT_DIR, outName), buf);
      downloadedIds.add(file.file_id);
      saveState(downloadedIds);
      console.log(`  ↓ ${outName} (${(buf.length / 1024).toFixed(0)} KB, quota left: ${remaining})`);
      downloaded++;
      totalDownloaded++;
      await delay(500);
    } catch (e) {
      console.error(`  ✗ ${outName}: ${e}`);
      if (String(e).includes("406") || String(e).includes("quota")) {
        console.error("\nDaily download quota reached. Run again tomorrow.");
        process.exit(0);
      }
    }
  }
}

console.log(`\nDone. Downloaded: ${totalDownloaded}, skipped (already downloaded): ${totalSkipped}`);
console.log(`Subtitles saved to: ${OUT_DIR}`);
console.log(`\nNext step: npx tsx scripts/check-cartoon-vocab.ts`);

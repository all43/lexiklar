/**
 * Database abstraction layer for Lexiklar.
 *
 * Runs SQLite in a Web Worker using sqlite3_deserialize (in-memory in worker).
 * OPFS is used as a byte cache to avoid re-downloading on every page load.
 * Provides async functions for all database operations.
 *
 * Usage:
 *   import { initDb, getWord, searchByLemma, ... } from './db.js';
 *   await initDb();          // call once at startup
 *   const word = await getWord('nouns/Tisch');
 */

import type { SearchResult, WordRow } from "../../types/search.js";
import type { Word } from "../../types/word.js";
import type { Example } from "../../types/example.js";

/**
 * Fold umlauts for accent-insensitive search (mirrors build-index.js).
 * Allows "mutze" to match "Mütze", "strasse" to match "Straße", etc.
 */
function foldUmlauts(str: string): string {
  return str
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss");
}

// Preserve worker state across Vite HMR reloads
let worker: Worker | null = (import.meta.hot?.data?.worker as Worker) ?? null;
let nextId: number = (import.meta.hot?.data?.nextId as number) ?? 0;
const pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }> =
  (import.meta.hot?.data?.pending as typeof pending) ?? new Map();

interface WorkerResponse {
  id: number;
  result?: unknown;
  error?: string;
}

function send(method: string, args: Record<string, unknown> = {}, transfer: Transferable[] = []): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, method, args }, transfer);
  });
}

async function query(sql: string, bind: unknown[] = []): Promise<Record<string, unknown>[]> {
  return send("exec", { sql, bind }) as Promise<Record<string, unknown>[]>;
}

/**
 * Process a search result row into the format expected by SearchPage.
 */
function processSearchRow(row: Record<string, unknown>): SearchResult {
  return {
    id: row.id as number,
    lemma: row.lemma as string,
    pos: row.pos as string,
    gender: (row.gender as string) || null,
    frequency: (row.frequency as number) ?? null,
    pluralDominant: !!(row.plural_dominant as number),
    pluralForm: (row.plural_form as string) || null,
    file: row.file as string,
    glossEn: row.gloss_en ? JSON.parse(row.gloss_en as string) as string[] : [],
  };
}

// ---- Cache API byte cache ----
// Works in Safari, WKWebView, and all modern browsers (unlike OPFS createWritable).

const CACHE_NAME = "lexiklar-db-v1";
const DB_CACHE_KEY = "/cache/lexiklar.db";
const VERSION_CACHE_KEY = "/cache/lexiklar-version.txt";

async function cacheRead(): Promise<ArrayBuffer | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const resp = await cache.match(DB_CACHE_KEY);
    return resp ? await resp.arrayBuffer() : null;
  } catch {
    return null;
  }
}

async function cacheWrite(bytes: ArrayBuffer): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(DB_CACHE_KEY, new Response(bytes));
  } catch {
    // Cache API not available — no caching, but app still works
  }
}

async function cacheVersionRead(): Promise<string | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const resp = await cache.match(VERSION_CACHE_KEY);
    return resp ? (await resp.text()).trim() : null;
  } catch {
    return null;
  }
}

async function cacheVersionWrite(version: string): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(VERSION_CACHE_KEY, new Response(version));
  } catch {
    // Cache API not available
  }
}

// ---- Update manifest URL ----
// GitHub Pages base URL for OTA updates (patches + manifest)
const UPDATE_BASE_URL = "https://evgeniimalikov.github.io/lexiklar-data";

// ---- Public API ----

/**
 * Initialize the database. Must be called before any queries.
 *
 * Flow:
 *   1. Check OPFS cache version vs bundled version
 *   2. If match → read cached bytes from OPFS (fast, no network)
 *   3. If mismatch → fetch .db from static assets, cache to OPFS
 *   4. Send bytes to worker → sqlite3_deserialize into WASM memory
 */
export async function initDb(): Promise<void> {
  worker = new Worker(new URL("./db-worker.js", import.meta.url), {
    type: "module",
  });

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const { id, result, error } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    error ? p.reject(new Error(error)) : p.resolve(result);
  };

  // Step 1: Determine if we need to fetch the DB
  const resp = await fetch("/data/db-version.txt");
  const bundledVersion = (await resp.text()).trim();
  const cachedVersion = await cacheVersionRead();

  let bytes: ArrayBuffer | null = null;

  if (cachedVersion === bundledVersion) {
    // Step 2a: Read from Cache API (no network for .db)
    bytes = await cacheRead();
  }

  if (!bytes) {
    // Step 2b: Fetch from static assets
    const dbResp = await fetch("/data/lexiklar.db");
    bytes = await dbResp.arrayBuffer();

    // Cache for next time (fire-and-forget)
    cacheWrite(bytes.slice(0)).then(() =>
      cacheVersionWrite(bundledVersion),
    );
  }

  // Step 3: Send bytes to worker for deserialization
  await send("init", { bytes }, [bytes]);
}

/**
 * Get a word by its file path (e.g., "nouns/Tisch").
 * Returns the parsed word JSON, or null if not found.
 */
export async function getWord(file: string): Promise<Word | null> {
  const rows = await query("SELECT data FROM words WHERE file = ?", [file]);
  return rows[0] ? JSON.parse(rows[0].data as string) as Word : null;
}

/**
 * Get examples by their IDs.
 * Returns an object mapping id → example data.
 */
export async function getExamples(ids: string[]): Promise<Record<string, Example>> {
  if (!ids.length) return {};
  const placeholders = ids.map(() => "?").join(",");
  const rows = await query(
    `SELECT id, data FROM examples WHERE id IN (${placeholders})`,
    ids,
  );
  const result: Record<string, Example> = {};
  for (const row of rows) {
    result[row.id as string] = JSON.parse(row.data as string) as Example;
  }
  return result;
}

/**
 * Search words by lemma prefix (German word).
 */
export async function searchByLemma(q: string): Promise<SearchResult[]> {
  const folded = foldUmlauts(q);
  const rows = await query(
    `SELECT lemma, pos, gender, frequency, plural_dominant, plural_form, file, gloss_en
     FROM words
     WHERE lemma LIKE ? COLLATE NOCASE
        OR lemma_folded LIKE ?
     ORDER BY
       CASE WHEN lower(lemma) = lower(?) OR lemma_folded = ? THEN 0 ELSE 1 END,
       LENGTH(lemma),
       CASE WHEN frequency IS NULL THEN 999999 ELSE frequency END
     LIMIT 50`,
    [q + "%", folded + "%", q, folded],
  );
  return rows.map(processSearchRow);
}

/**
 * Search words by English gloss (word-boundary aware).
 */
export async function searchByGlossEn(q: string): Promise<SearchResult[]> {
  const rows = await query(
    `SELECT lemma, pos, gender, frequency, plural_dominant, plural_form, file, gloss_en
     FROM words
     WHERE gloss_en LIKE ? COLLATE NOCASE
     ORDER BY
       LENGTH(lemma),
       CASE WHEN frequency IS NULL THEN 999999 ELSE frequency END
     LIMIT 50`,
    ["%" + q + "%"],
  );
  return rows.map(processSearchRow);
}

/**
 * Search words by inflected form — verb conjugations and noun case forms (exact match).
 */
export async function searchByWordForm(q: string): Promise<SearchResult[]> {
  const rows = await query(
    `SELECT w.lemma, w.pos, w.gender, w.frequency, w.file, w.gloss_en
     FROM word_forms wf
     JOIN words w ON w.id = wf.word_id
     WHERE wf.form = ? COLLATE NOCASE
     ORDER BY
       CASE WHEN w.frequency IS NULL THEN 999999 ELSE w.frequency END
     LIMIT 50`,
    [q.toLowerCase()],
  );
  return rows.map(processSearchRow);
}

/**
 * Get display info for related words by their file keys.
 * Returns an array with lemma, pos, gender, file, glossEn for each.
 */
export async function getRelatedWords(fileKeys: string[]): Promise<SearchResult[]> {
  if (!fileKeys.length) return [];
  const placeholders = fileKeys.map(() => "?").join(",");
  const rows = await query(
    `SELECT lemma, pos, gender, plural_dominant, plural_form, file, gloss_en FROM words WHERE file IN (${placeholders})`,
    fileKeys,
  );
  return rows.map(processSearchRow);
}

/**
 * Get all words, ordered by frequency.
 * Used for the initial search page listing.
 */
export async function getAllWords(): Promise<SearchResult[]> {
  const rows = await query(
    `SELECT lemma, pos, gender, frequency, plural_dominant, plural_form, file, gloss_en
     FROM words
     ORDER BY frequency ASC`,
  );
  return rows.map(processSearchRow);
}

// ---- Fuzzy suggestions (Levenshtein) ----

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

let _allLemmas: Record<string, unknown>[] | null = null;

/**
 * Get spelling suggestions for a query with no results.
 * Uses Levenshtein distance against all lemmas (cached after first call).
 * Returns up to 3 matches as processSearchRow objects.
 */
export async function getSuggestions(q: string): Promise<SearchResult[]> {
  if (!_allLemmas) {
    _allLemmas = await query(
      `SELECT lemma, lemma_folded, pos, gender, frequency, plural_dominant, plural_form, file, gloss_en FROM words`,
    );
  }

  const qLower = q.toLowerCase();
  const qFolded = foldUmlauts(q);
  const maxDist = q.length <= 3 ? 1 : 2;
  const scored: { row: Record<string, unknown>; dist: number }[] = [];

  for (const row of _allLemmas) {
    const d = Math.min(
      levenshtein(qLower, (row.lemma as string).toLowerCase()),
      levenshtein(qFolded, row.lemma_folded as string),
    );
    if (d > 0 && d <= maxDist) {
      scored.push({ row, dist: d });
    }
  }

  scored.sort((a, b) =>
    a.dist - b.dist
    || ((a.row.frequency as number) ?? 999999) - ((b.row.frequency as number) ?? 999999),
  );

  return scored.slice(0, 3).map((s) => processSearchRow(s.row));
}

// ---- OTA Update API ----

interface DbVersionInfo {
  version: string | null;
  builtAt: string | null;
}

/**
 * Get the current database version and build date.
 * Returns { version, builtAt } or null if DB not initialized.
 */
export async function getDbVersion(): Promise<DbVersionInfo> {
  const rows = await query("SELECT key, value FROM meta");
  const meta: Record<string, string> = {};
  for (const row of rows) meta[row.key as string] = row.value as string;
  return {
    version: meta.version || null,
    builtAt: meta.built_at || null,
  };
}

export interface UpdateInfo {
  available: boolean;
  type?: "patch" | "full";
  url?: string;
  size?: number;
  targetVersion?: string;
  builtAt?: string;
}

/**
 * Check for available OTA updates.
 * Returns:
 *   { available: false } — already up to date
 *   { available: true, type: 'patch', url, size } — incremental patch
 *   { available: true, type: 'full', url, size } — full DB download
 *   null — check failed (network error, etc.)
 */
export async function checkForUpdates(): Promise<UpdateInfo | null> {
  try {
    const { version: localVersion } = await getDbVersion();
    const resp = await fetch(`${UPDATE_BASE_URL}/manifest.json`, {
      cache: "no-cache",
    });
    if (!resp.ok) return null;
    const manifest = await resp.json();

    if (manifest.current_version === localVersion) {
      return { available: false };
    }

    // Check if a patch exists for our version
    const patch = manifest.patches?.[localVersion as string];
    if (patch) {
      return {
        available: true,
        type: "patch",
        url: `${UPDATE_BASE_URL}/${patch.url}`,
        size: patch.size,
        targetVersion: manifest.current_version,
        builtAt: manifest.built_at,
      };
    }

    // Fall back to full download
    return {
      available: true,
      type: "full",
      url: `${UPDATE_BASE_URL}/${manifest.full_db.url}`,
      size: manifest.full_db.size,
      targetVersion: manifest.current_version,
      builtAt: manifest.built_at,
    };
  } catch {
    return null;
  }
}

interface UpdateResult {
  ok: boolean;
  error?: string;
}

/**
 * Apply an OTA update (patch or full DB replacement).
 * After applying, re-caches the updated DB bytes.
 *
 * @param {Object} update - Result from checkForUpdates() with available: true
 * @returns {{ ok: boolean, error?: string }}
 */
export async function applyUpdate(update: UpdateInfo): Promise<UpdateResult> {
  try {
    const resp = await fetch(update.url!);
    if (!resp.ok) {
      return { ok: false, error: `Download failed: ${resp.status}` };
    }

    if (update.type === "patch") {
      // Apply SQL patch to in-memory DB
      const patchSql = await resp.text();
      await send("exec_batch", { sql: patchSql });
    } else {
      // Full DB replacement — deserialize new bytes
      const bytes = await resp.arrayBuffer();
      await send("init", { bytes }, [bytes]);
    }

    // Re-cache the updated DB
    const updatedBytes = await send("serialize") as ArrayBuffer;
    await cacheWrite(updatedBytes);
    await cacheVersionWrite(update.targetVersion!);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ---- Vite HMR: preserve DB worker across hot reloads ----
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    import.meta.hot!.data.worker = worker;
    import.meta.hot!.data.nextId = nextId;
    import.meta.hot!.data.pending = pending;
  });
}

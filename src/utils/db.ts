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

import { Capacitor } from "@capacitor/core";
import type { SearchResult, WordRow } from "../../types/search.js";
import type { Word } from "../../types/word.js";
import type { Example } from "../../types/example.js";

/**
 * Fold umlauts for accent-insensitive search (mirrors build-index.js).
 * Allows "mutze" to match "Mütze", "strasse" to match "Straße", etc.
 */
export function foldUmlauts(str: string): string {
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

/**
 * Clear all cached DB data (bytes + version).
 * Called when the cached DB is detected as corrupted,
 * or when the user wants to free up storage space.
 */
export async function cacheClear(): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(DB_CACHE_KEY);
    await cache.delete(VERSION_CACHE_KEY);
  } catch {
    // Cache API not available
  }
}

/**
 * Get the size of the cached DB in bytes, or null if not cached.
 */
export async function cacheSize(): Promise<number | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const resp = await cache.match(DB_CACHE_KEY);
    if (!resp) return null;
    // Clone to avoid consuming the response body
    const blob = await resp.clone().blob();
    return blob.size;
  } catch {
    return null;
  }
}

// ---- SQLite validation ----
// SQLite files start with "SQLite format 3\0" (16 bytes).
const SQLITE_MAGIC = "SQLite format 3\0";

function isValidSqlite(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 16) return false;
  const header = new Uint8Array(bytes, 0, 16);
  for (let i = 0; i < 16; i++) {
    if (header[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

// ---- Update manifest URL ----
// Permanent GitHub Release that always holds the latest manifest
export const MANIFEST_URL =
  "https://cdn.lexiklar.app/manifest.json";

// ---- Gzip decompression ----

const supportsDecompressionStream =
  typeof DecompressionStream !== "undefined";

/**
 * Fetch a gzipped URL and decompress to ArrayBuffer.
 * Prefers native DecompressionStream (streaming, zero-cost), falls back to
 * fflate (JS-based, ~8 KB) for browsers without DecompressionStream (iOS < 16.4).
 * Progress is tracked against uncompressedSize.
 */
async function fetchGzipped(
  url: string,
  onProgress?: (loaded: number, total: number) => void,
  uncompressedSize?: number,
): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  if (!resp.ok || !resp.body) throw new Error(`Download failed: ${resp.status}`);

  if (supportsDecompressionStream) {
    // Native streaming decompression
    const decompressed = resp.body.pipeThrough(new DecompressionStream("gzip"));
    const reader = decompressed.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      if (onProgress && uncompressedSize) {
        onProgress(Math.min(loaded, uncompressedSize), uncompressedSize);
      }
    }
    const buf = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      buf.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (onProgress && uncompressedSize) onProgress(uncompressedSize, uncompressedSize);
    return buf.buffer;
  }

  // Fallback: download compressed bytes, then decompress with fflate
  const compressedBuf = await resp.arrayBuffer();
  if (onProgress && uncompressedSize) onProgress(uncompressedSize / 2, uncompressedSize);
  const { gunzipSync } = await import("fflate");
  const decompressed = gunzipSync(new Uint8Array(compressedBuf));
  if (onProgress && uncompressedSize) onProgress(uncompressedSize, uncompressedSize);
  return decompressed.buffer as ArrayBuffer;
}

// ---- Public API ----

/**
 * Ensure the Web Worker is started (idempotent).
 */
function ensureWorker(): void {
  if (worker) return;
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
}

/**
 * Initialize the database. Must be called before any queries.
 *
 * On native: DB is bundled as a static asset → loads immediately.
 * On web: checks Cache API first → if cached, loads silently.
 *         If not cached and DB isn't bundled, throws 'download-needed'
 *         so the UI can prompt the user before downloading ~51 MB.
 */
export async function initDb(): Promise<void> {
  ensureWorker();

  let bytes: ArrayBuffer | null = null;

  if (Capacitor.isNativePlatform() || import.meta.env.DEV) {
    // Native build or dev server — DB is available as a local file.
    // Use db-version.txt for cache validation to avoid re-deserializing on every launch.
    const versionResp = await fetch("/data/db-version.txt");
    const bundledVersion = (await versionResp.text()).trim();
    const cachedVersion = await cacheVersionRead();

    if (cachedVersion === bundledVersion) {
      bytes = await cacheRead();
    }
    if (!bytes) {
      const dbResp = await fetch("/data/lexiklar.db");
      bytes = await dbResp.arrayBuffer();
      // Cache for next time
      cacheWrite(bytes.slice(0)).then(() => cacheVersionWrite(bundledVersion));
    }
  } else {
    // Web/PWA — DB is not bundled (exceeds Cloudflare Pages 25 MB limit).
    // Cached via Cache API after user-confirmed download from R2 CDN.
    bytes = await cacheRead();
  }

  if (!bytes) {
    // DB not bundled and not cached — user confirmation needed before download
    throw new Error("download-needed");
  }

  // Validate SQLite header before sending to worker.
  // Catches corrupted cache (e.g. HTML cached as DB by a stale SW rule).
  if (!isValidSqlite(bytes)) {
    console.error("Cached DB has invalid SQLite header, clearing cache");
    await cacheClear();
    throw new Error("download-needed");
  }

  // Step 3: Send bytes to worker for deserialization + sanity check
  try {
    await send("init", { bytes }, [bytes]);
    // Verify the DB is actually usable (sqlite3_deserialize accepts any bytes,
    // corruption only surfaces on first query)
    await send("exec", { sql: "SELECT 1 FROM meta LIMIT 1", bind: [] });
  } catch (err) {
    // DB is corrupted — clear the bad cache so the user gets a fresh download prompt.
    console.error("Cached DB is corrupted, clearing cache:", err);
    await cacheClear();
    throw new Error("download-needed");
  }
}

/**
 * Fetch gzipped DB as ArrayBuffer with progress tracking.
 */
async function fetchDbBytes(
  gzUrl: string,
  uncompressedSize: number,
  onProgress?: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  return fetchGzipped(gzUrl, onProgress, uncompressedSize);
}

/**
 * Download the DB from GitHub Releases (called after user confirmation).
 * Prefers gzipped download (~51 MB) via DecompressionStream,
 * Always downloads gzipped (~51 MB), decompresses via DecompressionStream
 * or fflate fallback on older browsers.
 */
export async function downloadDb(
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  ensureWorker();

  const manifestResp = await fetch(MANIFEST_URL, { cache: "no-cache" });
  if (!manifestResp.ok) throw new Error("Failed to fetch update manifest. Please check your internet connection.");
  const manifest = await manifestResp.json();
  const db = manifest.db;
  if (!db?.full_db_gz) throw new Error("No database URL found in manifest");

  const bytes = await fetchDbBytes(
    db.full_db_gz.url, db.full_db_size || db.full_db?.size || db.full_db_gz.size, onProgress,
  );

  // Cache before transferring to worker (transfer zeroes the buffer)
  await cacheWrite(bytes.slice(0));
  await cacheVersionWrite(db.current_version);

  // Initialize worker with downloaded bytes
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
 * Search words by English term (via pre-built en_terms table).
 * Matches by prefix so typing "manufact" finds "manufacture".
 *
 * Ranking tiers:
 *   0 — exact gloss_en match (the English term IS a primary translation)
 *   1 — exact en_terms match (synonym or token match)
 *   2 — prefix match only
 * Within each tier, results are ordered by word frequency.
 */
export async function searchByGlossEn(q: string): Promise<SearchResult[]> {
  const term = q.toLowerCase().trim();
  if (!term) return [];
  // JSON-escaped pattern to match exact gloss_en entry: ,"term"] or ["term"
  const glossPattern = `%"${term}"%`;
  const rows = await query(
    `SELECT w.lemma, w.pos, w.gender, w.frequency,
            w.plural_dominant, w.plural_form, w.file, w.gloss_en
     FROM words w
     WHERE w.id IN (SELECT word_id FROM en_terms WHERE term LIKE ? ESCAPE '\\')
     ORDER BY
       CASE
         WHEN w.gloss_en LIKE ? THEN 0
         WHEN w.id IN (SELECT word_id FROM en_terms WHERE term = ?) THEN 1
         ELSE 2
       END,
       CASE WHEN w.frequency IS NULL THEN 999999 ELSE w.frequency END
     LIMIT 50`,
    [term + "%", glossPattern, term],
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

/**
 * Search phrases whose lemma contains ALL of the given words (whole-word match).
 * Uses ' ' || lemma || ' ' to enforce word boundaries in LIKE patterns.
 */
export async function searchPhrasesByWords(words: string[]): Promise<SearchResult[]> {
  if (words.length < 2) return [];
  // Sum boolean matches — require at least 2 words to appear (whole-word boundary)
  const matchExprs = words.map(() => "((' ' || lower(lemma) || ' ') LIKE ? ESCAPE '\\')");
  const params = words.map(w => `% ${w.toLowerCase()} %`);
  const rows = await query(
    `SELECT lemma, pos, gender, frequency, plural_dominant, plural_form, file, gloss_en
     FROM words
     WHERE pos = 'PHRASE' AND (${matchExprs.join(" + ")}) >= 2
     ORDER BY CASE WHEN frequency IS NULL THEN 999999 ELSE frequency END
     LIMIT 10`,
    params,
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
  gzUrl?: string;
  gzSize?: number;
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
    const resp = await fetch(MANIFEST_URL, { cache: "no-cache" });
    if (!resp.ok) return null;
    const manifest = await resp.json();
    const db = manifest.db;
    if (!db) return null;

    if (db.current_version === localVersion) {
      return { available: false };
    }

    // Check if a patch exists for our version (URLs are absolute)
    const patch = db.patches?.[localVersion as string];
    if (patch) {
      return {
        available: true,
        type: "patch",
        url: patch.url,
        size: patch.size,
        targetVersion: db.current_version,
        builtAt: db.built_at,
      };
    }

    // Fall back to full download (URL is absolute)
    return {
      available: true,
      type: "full",
      url: db.full_db_gz?.url || db.full_db?.url,
      size: db.full_db_size || db.full_db?.size || db.full_db_gz?.size,
      gzUrl: db.full_db_gz?.url,
      targetVersion: db.current_version,
      builtAt: db.built_at,
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
export async function applyUpdate(
  update: UpdateInfo,
  onProgress?: (loaded: number, total: number) => void,
  onApplying?: () => void,
): Promise<UpdateResult> {
  try {
    if (update.type === "patch") {
      // Download SQL patch
      const resp = await fetch(update.url!);
      if (!resp.ok) return { ok: false, error: `Download failed: ${resp.status}` };
      const total = update.size || Number(resp.headers.get("content-length")) || 0;
      const patchSql = await resp.text();
      if (onProgress && total) onProgress(total, total);

      // Yield to UI before heavy work
      if (onApplying) {
        onApplying();
        await new Promise((r) => setTimeout(r, 50));
      }

      // Apply patch + re-cache (heavy, runs in worker)
      await send("exec_batch", { sql: patchSql });
    } else {
      // Full DB replacement (always gzipped)
      const bytes = await fetchDbBytes(
        update.gzUrl || update.url!, update.size || 0, onProgress,
      );

      if (onApplying) {
        onApplying();
        await new Promise((r) => setTimeout(r, 50));
      }

      await send("init", { bytes }, [bytes]);
    }

    // Re-cache the updated DB (serialize runs in worker)
    const updatedBytes = await send("serialize") as ArrayBuffer;
    await cacheWrite(updatedBytes);
    await cacheVersionWrite(update.targetVersion!);

    // Clear in-memory caches so queries pick up new data
    _allLemmas = null;

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

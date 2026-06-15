/**
 * Native SQLite backend using lexiklar-sqlite (custom Capacitor plugin).
 *
 * Used on iOS/Android only — web/PWA uses the WASM worker in db.ts.
 * The plugin uses the platform's built-in SQLite (no WASM, no extra dependencies).
 *
 * DB lifecycle:
 *   1. First launch: plugin opens bundled DB read-only (no copy made)
 *   2. Each launch: if bundle timestamp >= Library timestamp, Library is dropped (bundle used)
 *   3. OTA patches: execute() triggers copy-on-write; Library copy receives patches
 *   4. Full DB replacement: importDatabaseFromUrl() writes directly to Library
 */

import { LexiklarSqlite } from "lexiklar-sqlite";
import { DB_BUILT_AT_FILE } from "./db-paths.js";

const DB_FILE = "lexiklar.db";

/**
 * Initialize the native SQLite database.
 *
 * On first launch, the plugin opens the bundled DB directly (read-only, no copy).
 * On each launch, compares bundle build timestamp against the Library DB's timestamp.
 * If bundle is same age or newer, the Library copy is deleted and the bundle is used
 * directly — this reclaims ~122 MB after App Store updates. The Library copy is only
 * kept when it is strictly newer (i.e. OTA patches were applied after the bundle build).
 */
export async function initNativeDb(skipBundledCheck = false): Promise<void> {
  // Open DB (uses Library copy if one exists, otherwise falls back to bundle read-only)
  await LexiklarSqlite.open({ path: DB_FILE, readOnly: false });

  // Compare bundle vs Library timestamps to decide whether to keep the Library copy.
  // Skip when called after an OTA update (Library was just written, always keep it).
  if (!skipBundledCheck) {
    try {
      const bundledBuiltAt = new Date(
        (await (await fetch(DB_BUILT_AT_FILE)).text()).trim()
      ).getTime();

      const result = await LexiklarSqlite.query({
        sql: "SELECT value FROM meta WHERE key = ?",
        params: ["built_at"],
      });
      const libraryBuiltAt = new Date(
        (result.rows[0]?.value as string | undefined) ?? 0
      ).getTime();

      // Bundle is same age or newer → Library copy is redundant, drop it.
      // Library is strictly newer → it has OTA patches post-bundle, keep it.
      if (bundledBuiltAt >= libraryBuiltAt) {
        await LexiklarSqlite.close();
        await LexiklarSqlite.deleteDatabase({ path: DB_FILE });
        await LexiklarSqlite.open({ path: DB_FILE, readOnly: false });
      }
    } catch {
      // Timestamp check failed — continue with whatever DB we have
    }
  }

  // Sanity check
  const check = await LexiklarSqlite.query({ sql: "SELECT 1 FROM meta LIMIT 1" });
  if (!check.rows.length) throw new Error("Native DB sanity check failed");
}

/**
 * Execute a SELECT query and return rows as plain objects.
 */
export async function nativeQuery(sql: string, bind: unknown[]): Promise<Record<string, unknown>[]> {
  const result = await LexiklarSqlite.query({ sql, params: bind });
  return result.rows;
}

/**
 * Execute multi-statement SQL in a transaction (for OTA patches).
 */
export async function nativeExecBatch(sql: string): Promise<void> {
  await LexiklarSqlite.execute({ sql, transaction: true });
}

/**
 * Close the database connection.
 */
export async function nativeClose(): Promise<void> {
  await LexiklarSqlite.close();
}

/**
 * Delete the database file from plugin storage.
 */
export async function nativeDeleteDb(): Promise<void> {
  await LexiklarSqlite.deleteDatabase({ path: DB_FILE });
}

/**
 * Get the filesystem path where the plugin stores databases.
 */
export async function nativeGetDbPath(): Promise<string> {
  const result = await LexiklarSqlite.getDatabasePath();
  return result.path;
}

/**
 * Download a gzipped DB from a URL and write it to the plugin's storage.
 * Runs entirely in native code — avoids the ~500 MB JS memory peak from
 * base64-encoding 128 MB through the Capacitor bridge.
 */
export async function nativeImportDatabaseFromUrl(url: string): Promise<void> {
  await LexiklarSqlite.importDatabaseFromUrl({ url });
}

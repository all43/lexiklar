/**
 * Native SQLite backend using lexiklar-sqlite (custom Capacitor plugin).
 *
 * Used on iOS/Android only — web/PWA uses the WASM worker in db.ts.
 * The plugin uses the platform's built-in SQLite (no WASM, no extra dependencies).
 *
 * DB lifecycle:
 *   1. First launch: plugin copies bundled DB from app assets to its storage
 *   2. App update with newer bundled DB: close → delete → reopen (triggers copy)
 *   3. OTA patches: applied via execute() — writes directly to disk
 *   4. Full DB replacement: close → delete → write via Filesystem → reopen
 */

import { LexiklarSqlite } from "lexiklar-sqlite";

const DB_FILE = "lexiklar.db";

/**
 * Initialize the native SQLite database.
 *
 * On first launch, the plugin copies the bundled DB from app assets.
 * On app update, compares bundled version against installed and replaces if newer.
 */
export async function initNativeDb(): Promise<void> {
  // Open DB (plugin copies from assets on first launch)
  await LexiklarSqlite.open({ path: DB_FILE, readOnly: false });

  // Check if bundled DB is newer than installed
  try {
    const versionResp = await fetch("/data/db-version.txt");
    const bundledVersion = (await versionResp.text()).trim();

    const result = await LexiklarSqlite.query({
      sql: "SELECT value FROM meta WHERE key = ?",
      params: ["version"],
    });
    const installedVersion = result.rows[0]?.value as string | undefined;

    if (installedVersion && bundledVersion && installedVersion !== bundledVersion) {
      // Bundled DB is different (newer) — replace
      await LexiklarSqlite.close();
      await LexiklarSqlite.deleteDatabase({ path: DB_FILE });
      await LexiklarSqlite.open({ path: DB_FILE, readOnly: false });
    }
  } catch {
    // Version check failed — continue with whatever DB we have
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

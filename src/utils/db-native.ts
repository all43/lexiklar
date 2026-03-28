/**
 * Native SQLite backend using @capacitor-community/sqlite.
 *
 * Used on iOS/Android only — web/PWA uses the WASM worker in db.ts.
 * The plugin manages a DB file on disk (no Cache API or in-memory WASM).
 *
 * DB lifecycle:
 *   1. First launch: copyFromAssets copies bundled DB to plugin storage
 *   2. App update with newer bundled DB: overwrite with copyFromAssets
 *   3. OTA patches: applied via execute() — writes directly to disk
 *   4. Full DB replacement: close → delete → write via Filesystem → reopen
 */

import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from "@capacitor-community/sqlite";

const sqlite = new SQLiteConnection(CapacitorSQLite);
const DB_NAME = "lexiklar";
let conn: SQLiteDBConnection | null = null;

/**
 * Initialize the native SQLite database.
 *
 * On first launch, copies the bundled DB from app assets.
 * On app update, compares bundled version against installed and overwrites if newer.
 */
export async function initNativeDb(): Promise<void> {
  // Copy bundled DB to plugin storage (no-op if already exists)
  await sqlite.copyFromAssets(false);

  // Open connection to check installed version
  conn = await sqlite.createConnection(DB_NAME, false, "no-encryption", 1, false);
  await conn.open();

  // Check if bundled DB is newer than installed
  try {
    const versionResp = await fetch("/data/db-version.txt");
    const bundledVersion = (await versionResp.text()).trim();

    const result = await conn.query("SELECT value FROM meta WHERE key = 'version'");
    const rows = normalizeRows(result);
    const installedVersion = rows[0]?.value as string | undefined;

    if (installedVersion && bundledVersion && installedVersion !== bundledVersion) {
      // Bundled DB is different (newer) — overwrite
      await conn.close();
      await sqlite.closeConnection(DB_NAME, false);
      conn = null;

      await sqlite.copyFromAssets(true);

      conn = await sqlite.createConnection(DB_NAME, false, "no-encryption", 1, false);
      await conn.open();
    }
  } catch {
    // Version check failed — continue with whatever DB we have
  }

  // Sanity check
  const check = await conn!.query("SELECT 1 FROM meta LIMIT 1");
  const checkRows = normalizeRows(check);
  if (!checkRows.length) throw new Error("Native DB sanity check failed");
}

/**
 * Execute a SELECT query and return rows as plain objects.
 */
export async function nativeQuery(sql: string, bind: unknown[]): Promise<Record<string, unknown>[]> {
  if (!conn) throw new Error("Native DB not initialized");
  const result = await conn.query(sql, bind as any[]);
  return normalizeRows(result);
}

/**
 * Execute multi-statement SQL in a transaction (for OTA patches).
 */
export async function nativeExecBatch(sql: string): Promise<void> {
  if (!conn) throw new Error("Native DB not initialized");
  await conn.execute(sql, true);
}

/**
 * Close the database connection.
 * Used before full DB replacement.
 */
export async function nativeClose(): Promise<void> {
  if (conn) {
    await conn.close();
    await sqlite.closeConnection(DB_NAME, false);
    conn = null;
  }
}

/**
 * Delete the database file from plugin storage.
 * Used before writing a new full DB.
 */
export async function nativeDeleteDb(): Promise<void> {
  await CapacitorSQLite.deleteDatabase({ database: DB_NAME });
}

// ---- Internal ----

/**
 * Normalize query results.
 * On iOS, the first row may be { ios_columns: [...] } — detect and strip.
 */
function normalizeRows(result: { values?: any[] }): Record<string, unknown>[] {
  const rows = result.values ?? [];
  if (rows.length > 0 && rows[0]?.ios_columns) {
    return rows.slice(1);
  }
  return rows;
}

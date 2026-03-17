/**
 * Web Worker for SQLite database access.
 *
 * Loads the database into WASM memory via sqlite3_deserialize.
 * Cache API is used as a byte cache for persistence.
 *
 * Message protocol:
 *   init(bytes)       → load sqlite3 module, deserialize DB from bytes
 *   exec(sql,bind)    → run SQL query, return result rows
 *   exec_batch(sql)   → run multi-statement SQL in a transaction (for OTA patches)
 *   serialize()       → export DB bytes via sqlite3_serialize (for re-caching after patch)
 */

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import type { Sqlite3Static, Database, SqlValue, BindingSpec } from "@sqlite.org/sqlite-wasm";

let sqlite3: Sqlite3Static | null = null;
let db: Database | null = null;

interface WorkerMessage {
  id: number;
  method: string;
  args: Record<string, unknown>;
}

/**
 * Execute SQL and return result rows as plain objects.
 */
function exec(sql: string, bind: BindingSpec): Record<string, SqlValue>[] {
  const rows: Record<string, SqlValue>[] = [];
  db!.exec({
    sql,
    bind,
    rowMode: "object",
    callback: (row: Record<string, SqlValue>) => { rows.push(row); },
  });
  return rows;
}

async function handleMessage(method: string, args: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "init": {
      // locateFile is an Emscripten option not in the official types
      sqlite3 = await (sqlite3InitModule as (opts?: Record<string, unknown>) => Promise<Sqlite3Static>)({
        locateFile: (file: string) => `/sqlite3/${file}`,
      });

      const bytes = new Uint8Array(args.bytes as ArrayBuffer);

      // Open an in-memory DB and deserialize the bytes into it
      db = new sqlite3.oo1.DB(":memory:");
      const pData = sqlite3.wasm.allocFromTypedArray(bytes);
      const rc = sqlite3.capi.sqlite3_deserialize(
        db.pointer!,
        "main",
        pData,
        bytes.byteLength,
        bytes.byteLength,
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
          sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
      );
      if (rc !== 0) throw new Error("sqlite3_deserialize failed: rc=" + rc);

      return { ok: true };
    }

    case "exec": {
      if (!db) throw new Error("Database not initialized");
      return exec(args.sql as string, (args.bind as BindingSpec) || []);
    }

    case "exec_batch": {
      if (!db) throw new Error("Database not initialized");
      // Run multi-statement SQL (OTA patch) inside a transaction
      db.exec("BEGIN TRANSACTION");
      try {
        db.exec(args.sql as string);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return { ok: true };
    }

    case "serialize": {
      if (!db) throw new Error("Database not initialized");
      // Export the in-memory DB as bytes for re-caching after patch
      const exportedBytes = sqlite3!.capi.sqlite3_js_db_export(db.pointer!);
      return exportedBytes.buffer;
    }

    default:
      throw new Error("Unknown method: " + method);
  }
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { id, method, args } = e.data;
  try {
    const result = await handleMessage(method, args);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message });
  }
};

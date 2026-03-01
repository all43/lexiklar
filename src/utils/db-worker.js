/**
 * Web Worker for SQLite database access.
 *
 * Loads the database into WASM memory via sqlite3_deserialize.
 * OPFS is used only as a byte cache (not as the VFS) for persistence.
 *
 * Message protocol:
 *   init(bytes)    → load sqlite3 module, deserialize DB from bytes
 *   exec(sql,bind) → run SQL query, return result rows
 */

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

let sqlite3 = null;
let db = null;

/**
 * Execute SQL and return result rows as plain objects.
 */
function exec(sql, bind) {
  const rows = [];
  db.exec({
    sql,
    bind,
    rowMode: "object",
    callback: (row) => rows.push(row),
  });
  return rows;
}

async function handleMessage(method, args) {
  switch (method) {
    case "init": {
      sqlite3 = await sqlite3InitModule({
        locateFile: (file) => `/sqlite3/${file}`,
      });

      const bytes = new Uint8Array(args.bytes);

      // Open an in-memory DB and deserialize the bytes into it
      db = new sqlite3.oo1.DB(":memory:");
      const pData = sqlite3.wasm.alloc(bytes.byteLength);
      sqlite3.wasm.heap8u().set(bytes, pData);
      const rc = sqlite3.capi.sqlite3_deserialize(
        db.pointer,
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
      return exec(args.sql, args.bind || []);
    }

    default:
      throw new Error("Unknown method: " + method);
  }
}

self.onmessage = async (e) => {
  const { id, method, args } = e.data;
  try {
    const result = await handleMessage(method, args);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};

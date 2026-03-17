/**
 * Copy production data files into public/ for Vite to serve as static assets.
 *
 * Copies:
 *   - data/lexiklar.db       → public/data/lexiklar.db
 *   - data/db-version.txt    → public/data/db-version.txt
 *   - sqlite3.wasm           → public/sqlite3/sqlite3.wasm
 *
 * Usage: node scripts/copy-data.ts
 */

import { cpSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname: string = dirname(fileURLToPath(import.meta.url));
const ROOT: string = join(__dirname, "..");
const SRC: string = join(ROOT, "data");
const DEST: string = join(ROOT, "public", "data");

// Ensure destination exists
mkdirSync(DEST, { recursive: true });

// Copy SQLite database
if (existsSync(join(SRC, "lexiklar.db"))) {
  cpSync(join(SRC, "lexiklar.db"), join(DEST, "lexiklar.db"));
}

// Copy version hash
if (existsSync(join(SRC, "db-version.txt"))) {
  cpSync(join(SRC, "db-version.txt"), join(DEST, "db-version.txt"));
}

// Copy sqlite3 WASM binary (needed by the worker)
const wasmSrc: string = join(
  ROOT,
  "node_modules",
  "@sqlite.org",
  "sqlite-wasm",
  "dist",
  "sqlite3.wasm",
);
const wasmDest: string = join(ROOT, "public", "sqlite3");
mkdirSync(wasmDest, { recursive: true });
cpSync(wasmSrc, join(wasmDest, "sqlite3.wasm"));

console.log("Copied lexiklar.db, db-version.txt, sqlite3.wasm → public/");

/**
 * Copy data files into public/data/ for Vite to serve as static assets.
 * Source of truth remains in data/; this creates a serving copy.
 *
 * Usage: node scripts/copy-data.js
 */

import { cpSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "data");
const DEST = join(ROOT, "public", "data");

// Ensure destination exists
mkdirSync(DEST, { recursive: true });

// Copy word files, rules, and examples
cpSync(join(SRC, "words"), join(DEST, "words"), { recursive: true });
cpSync(join(SRC, "rules"), join(DEST, "rules"), { recursive: true });

if (existsSync(join(SRC, "examples.json"))) {
  cpSync(join(SRC, "examples.json"), join(DEST, "examples.json"));
}

console.log("Copied data/ → public/data/");

/**
 * Generate an OTA update package for the Lexiklar dictionary.
 *
 * Compares old and new SQLite databases using row-level content hashes,
 * generates SQL patches for incremental updates, and writes a manifest.
 *
 * Assets (DB, patches) are uploaded to GitHub Releases by the CI workflow.
 * The manifest references them via absolute release download URLs.
 *
 * Usage:
 *   npx tsx scripts/publish-update.ts --out <dir>                                    # full DB only
 *   npx tsx scripts/publish-update.ts --old <old.db> --out <dir>                     # with patch
 *   npx tsx scripts/publish-update.ts --old <old.db> --out <dir> --keep-patches 3
 *   npx tsx scripts/publish-update.ts --out <dir> --release-url <base>               # absolute URLs in manifest
 */

import Database from "better-sqlite3";
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { pipeline } from "stream/promises";
import { createGzip } from "zlib";
import { join } from "path";
import { stringArg, intArg } from "./lib/cli.js";

// ---- Types ----

interface DbManifest {
  current_version: string;
  built_at: string;
  patches: Record<string, { url: string; size: number }>;
  full_db_size: number;
  full_db_gz: { url: string; size: number };
}

interface UnifiedManifest {
  db: DbManifest;
  bundle?: {
    current_version: string;
    url: string;
    size: number;
  };
}

interface WordRow {
  id: number;
  lemma: string;
  lemma_folded: string;
  pos: string;
  gender: string | null;
  frequency: number | null;
  plural_dominant: number | null;
  plural_form: string | null;
  file: string;
  gloss_en: string | null;
  data: string;
  hash: string;
}

interface WordFormRow {
  form: string;
  word_id: number;
}

interface EnTermRow {
  term: string;
  word_id: number;
}

interface ExampleRow {
  id: string;
  data: string;
  hash: string;
}

interface MetaRow {
  key: string;
  value: string;
}

// ---- SQL escaping ----

function esc(s: string | null): string {
  if (s === null) return "NULL";
  return `'${s.replace(/'/g, "''")}'`;
}

function escNum(n: number | null): string {
  return n === null ? "NULL" : String(n);
}

// ---- Patch generation ----

function generatePatch(oldDb: Database.Database, newDb: Database.Database): string {
  const stmts: string[] = [];

  // --- Words diff ---
  const oldWords = new Map<string, { id: number; hash: string }>();
  for (const row of oldDb.prepare("SELECT id, file, hash FROM words").all() as { id: number; file: string; hash: string }[]) {
    oldWords.set(row.file, { id: row.id, hash: row.hash });
  }

  const newWords = newDb.prepare(
    "SELECT id, lemma, lemma_folded, pos, gender, frequency, plural_dominant, plural_form, file, gloss_en, data, hash FROM words",
  ).all() as WordRow[];

  // Collect old word_forms and en_terms keyed by word_id for diffing
  const oldWordForms = new Map<number, WordFormRow[]>();
  for (const row of oldDb.prepare("SELECT form, word_id FROM word_forms").all() as WordFormRow[]) {
    let arr = oldWordForms.get(row.word_id);
    if (!arr) { arr = []; oldWordForms.set(row.word_id, arr); }
    arr.push(row);
  }
  const oldEnTerms = new Map<number, EnTermRow[]>();
  for (const row of oldDb.prepare("SELECT term, word_id FROM en_terms").all() as EnTermRow[]) {
    let arr = oldEnTerms.get(row.word_id);
    if (!arr) { arr = []; oldEnTerms.set(row.word_id, arr); }
    arr.push(row);
  }

  const newWordFiles = new Set<string>();

  for (const nw of newWords) {
    newWordFiles.add(nw.file);
    const old = oldWords.get(nw.file);

    if (!old) {
      // Inserted word
      stmts.push(
        `INSERT INTO words (lemma, lemma_folded, pos, gender, frequency, plural_dominant, plural_form, file, gloss_en, data, hash) VALUES (${esc(nw.lemma)}, ${esc(nw.lemma_folded)}, ${esc(nw.pos)}, ${esc(nw.gender)}, ${escNum(nw.frequency)}, ${escNum(nw.plural_dominant)}, ${esc(nw.plural_form)}, ${esc(nw.file)}, ${esc(nw.gloss_en)}, ${esc(nw.data)}, ${esc(nw.hash)});`,
      );
      // word_forms and en_terms for new word — use subquery for word_id
      appendFormsAndTerms(stmts, newDb, nw.id, nw.file);
    } else if (old.hash !== nw.hash) {
      // Updated word
      stmts.push(
        `UPDATE words SET lemma = ${esc(nw.lemma)}, lemma_folded = ${esc(nw.lemma_folded)}, pos = ${esc(nw.pos)}, gender = ${esc(nw.gender)}, frequency = ${escNum(nw.frequency)}, plural_dominant = ${escNum(nw.plural_dominant)}, plural_form = ${esc(nw.plural_form)}, gloss_en = ${esc(nw.gloss_en)}, data = ${esc(nw.data)}, hash = ${esc(nw.hash)} WHERE file = ${esc(nw.file)};`,
      );
      // Rebuild word_forms and en_terms
      stmts.push(`DELETE FROM word_forms WHERE word_id = (SELECT id FROM words WHERE file = ${esc(nw.file)});`);
      stmts.push(`DELETE FROM en_terms WHERE word_id = (SELECT id FROM words WHERE file = ${esc(nw.file)});`);
      appendFormsAndTerms(stmts, newDb, nw.id, nw.file);
    }
    // unchanged words: skip
  }

  // Deleted words
  for (const [file] of oldWords) {
    if (!newWordFiles.has(file)) {
      stmts.push(`DELETE FROM word_forms WHERE word_id = (SELECT id FROM words WHERE file = ${esc(file)});`);
      stmts.push(`DELETE FROM en_terms WHERE word_id = (SELECT id FROM words WHERE file = ${esc(file)});`);
      stmts.push(`DELETE FROM words WHERE file = ${esc(file)};`);
    }
  }

  // --- Examples diff ---
  const oldExamples = new Map<string, string>();
  for (const row of oldDb.prepare("SELECT id, hash FROM examples").all() as { id: string; hash: string }[]) {
    oldExamples.set(row.id, row.hash);
  }

  const newExamples = newDb.prepare("SELECT id, data, hash FROM examples").all() as ExampleRow[];
  const newExampleIds = new Set<string>();

  for (const ne of newExamples) {
    newExampleIds.add(ne.id);
    const oldHash = oldExamples.get(ne.id);

    if (oldHash === undefined) {
      stmts.push(`INSERT INTO examples (id, data, hash) VALUES (${esc(ne.id)}, ${esc(ne.data)}, ${esc(ne.hash)});`);
    } else if (oldHash !== ne.hash) {
      stmts.push(`UPDATE examples SET data = ${esc(ne.data)}, hash = ${esc(ne.hash)} WHERE id = ${esc(ne.id)};`);
    }
  }

  for (const [id] of oldExamples) {
    if (!newExampleIds.has(id)) {
      stmts.push(`DELETE FROM examples WHERE id = ${esc(id)};`);
    }
  }

  // --- Meta table ---
  const newMeta = newDb.prepare("SELECT key, value FROM meta").all() as MetaRow[];
  for (const m of newMeta) {
    stmts.push(`UPDATE meta SET value = ${esc(m.value)} WHERE key = ${esc(m.key)};`);
  }

  return stmts.join("\n");
}

/**
 * Append INSERT statements for word_forms and en_terms for a given word.
 * Uses subquery `(SELECT id FROM words WHERE file = ?)` for the word_id
 * since the client DB has different autoincrement IDs.
 */
function appendFormsAndTerms(stmts: string[], newDb: Database.Database, wordId: number, file: string): void {
  const fileSubquery = `(SELECT id FROM words WHERE file = ${esc(file)})`;

  const forms = newDb.prepare("SELECT form FROM word_forms WHERE word_id = ?").all(wordId) as { form: string }[];
  for (const f of forms) {
    stmts.push(`INSERT OR IGNORE INTO word_forms (form, word_id) VALUES (${esc(f.form)}, ${fileSubquery});`);
  }

  const terms = newDb.prepare("SELECT term FROM en_terms WHERE word_id = ?").all(wordId) as { term: string }[];
  for (const t of terms) {
    stmts.push(`INSERT OR IGNORE INTO en_terms (term, word_id) VALUES (${esc(t.term)}, ${fileSubquery});`);
  }
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const oldPath = stringArg(args, "--old");
  const outDir = stringArg(args, "--out");
  const keepPatches = intArg(args, "--keep-patches", 3);
  const releaseUrl = stringArg(args, "--release-url"); // e.g. https://github.com/user/repo/releases/download/data-20260324

  if (!outDir) {
    console.error("Usage: npx tsx scripts/publish-update.ts --out <dir> [--old <old.db>] [--keep-patches 3] [--release-url <url>]");
    process.exit(1);
  }

  const newDbPath = join(process.cwd(), "data", "lexiklar.db");
  if (!existsSync(newDbPath)) {
    console.error(`Current DB not found at ${newDbPath}. Run 'npm run build-index' first.`);
    process.exit(1);
  }

  // Read version info from new DB
  const newDb = new Database(newDbPath, { readonly: true });
  const meta: Record<string, string> = {};
  for (const row of newDb.prepare("SELECT key, value FROM meta").all() as MetaRow[]) {
    meta[row.key] = row.value;
  }
  const newVersion = meta.version;
  const builtAt = meta.built_at;

  if (!newVersion) {
    console.error("No version found in new DB meta table.");
    newDb.close();
    process.exit(1);
  }

  console.log(`New DB version: ${newVersion} (built ${builtAt})`);

  // Ensure output directory exists
  mkdirSync(outDir, { recursive: true });

  // Load existing manifest to preserve older patches and bundle section
  let existingManifest: UnifiedManifest | null = null;
  const manifestPath = join(outDir, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      existingManifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as UnifiedManifest;
    } catch {
      // corrupt manifest — start fresh
    }
  }

  // Generate patch if old DB provided
  const patches: Record<string, { url: string; size: number }> = {};

  if (oldPath && existsSync(oldPath)) {
    const oldDb = new Database(oldPath, { readonly: true });
    const oldMeta: Record<string, string> = {};
    for (const row of oldDb.prepare("SELECT key, value FROM meta").all() as MetaRow[]) {
      oldMeta[row.key] = row.value;
    }
    const oldVersion = oldMeta.version;

    if (!oldVersion) {
      console.warn("No version in old DB — skipping patch generation.");
    } else if (oldVersion === newVersion) {
      console.log("Old and new DB have the same version — no patch needed.");
    } else {
      console.log(`Generating patch: ${oldVersion} → ${newVersion}`);
      const patchSql = generatePatch(oldDb, newDb);
      const patchFileName = `${oldVersion}_to_${newVersion}.sql`;
      const patchPath = join(outDir, patchFileName);
      writeFileSync(patchPath, patchSql + "\n");
      const patchSize = statSync(patchPath).size;
      const patchUrl = releaseUrl ? `${releaseUrl}/${patchFileName}` : patchFileName;
      patches[oldVersion] = { url: patchUrl, size: patchSize };

      // Count changes for logging
      const lines = patchSql.split("\n").filter(Boolean);
      console.log(`Patch: ${lines.length} SQL statements, ${(patchSize / 1024).toFixed(1)} KB`);
    }
    oldDb.close();
  } else if (oldPath) {
    console.warn(`Old DB not found at ${oldPath} — generating manifest without patch.`);
  }

  newDb.close();

  // Carry forward older patches from existing manifest (up to keepPatches)
  if (existingManifest?.db?.patches) {
    for (const [ver, patch] of Object.entries(existingManifest.db.patches)) {
      if (ver === newVersion) continue; // skip self-referencing
      if (!patches[ver]) {
        patches[ver] = patch; // already absolute URL from prior run
      }
    }
  }

  // Trim to keepPatches most recent
  const patchEntries = Object.entries(patches);
  const prunedPatches: Record<string, { url: string; size: number }> = {};
  const toKeep = patchEntries.slice(-keepPatches);
  for (const [ver, patch] of toKeep) {
    prunedPatches[ver] = patch;
  }

  // Copy current DB to output
  const outDbPath = join(outDir, "lexiklar.db");
  copyFileSync(newDbPath, outDbPath);
  const fullDbSize = statSync(outDbPath).size;
  console.log(`Copied DB: ${(fullDbSize / (1024 * 1024)).toFixed(1)} MB`);

  // Generate gzipped DB
  const outDbGzPath = join(outDir, "lexiklar.db.gz");
  await pipeline(createReadStream(outDbPath), createGzip({ level: 9 }), createWriteStream(outDbGzPath));
  const fullDbGzSize = statSync(outDbGzPath).size;
  console.log(`Gzipped DB: ${(fullDbGzSize / (1024 * 1024)).toFixed(1)} MB (${((1 - fullDbGzSize / fullDbSize) * 100).toFixed(0)}% reduction)`);

  // Build DB manifest section
  const fullDbGzUrl = releaseUrl ? `${releaseUrl}/lexiklar.db.gz` : "lexiklar.db.gz";
  const dbManifest: DbManifest = {
    current_version: newVersion,
    built_at: builtAt,
    patches: prunedPatches,
    full_db_size: fullDbSize,
    full_db_gz: { url: fullDbGzUrl, size: fullDbGzSize },
  };

  // Write unified manifest — preserve existing bundle section
  const manifest: UnifiedManifest = {
    db: dbManifest,
    bundle: existingManifest?.bundle,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Manifest written: ${Object.keys(prunedPatches).length} patch(es), full DB ${(fullDbSize / (1024 * 1024)).toFixed(1)} MB`);

  // Prune unreferenced local patch files
  const referencedFiles = new Set(
    Object.values(prunedPatches).map(p => {
      // Extract filename from URL (may be absolute or relative)
      const parts = p.url.split("/");
      return parts[parts.length - 1];
    }),
  );
  for (const file of readdirSync(outDir)) {
    if (file.endsWith(".sql") && !referencedFiles.has(file)) {
      unlinkSync(join(outDir, file));
      console.log(`Pruned old patch: ${file}`);
    }
  }

  console.log("Done.");
}

main();

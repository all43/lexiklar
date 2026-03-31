/**
 * Generate an OTA update package for the Lexiklar dictionary.
 *
 * Compares old and new SQLite databases using row-level content hashes,
 * generates SQL patches for incremental updates, and writes a manifest.
 *
 * Usage:
 *   npx tsx scripts/publish-update.ts --out <dir>                                    # full DB only
 *   npx tsx scripts/publish-update.ts --old <old.db> --out <dir>                     # with patch from old DB
 *   npx tsx scripts/publish-update.ts --old-hashes <hashes.json> --out <dir>         # with patch from hash snapshot
 *   npx tsx scripts/publish-update.ts --old-hashes <hashes.json> --out <dir> --keep-patches 3
 *   npx tsx scripts/publish-update.ts --out <dir> --release-url <base>               # absolute URLs in manifest
 */

import Database from "better-sqlite3";
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { pipeline } from "stream/promises";
import { createGzip } from "zlib";
import { join } from "path";
import { stringArg, intArg } from "./lib/cli.js";
import type { WordRow, WordFormRow, EnTermRow, ExampleRow, MetaRow } from "./lib/db-schemas.js";

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

/**
 * Compact snapshot of row hashes from a published DB.
 * Stored as db-hashes.json in the output dir and uploaded to R2.
 * Used as the "old state" for patch generation on the next publish run,
 * replacing the need to persist or download the full DB (121 MB).
 */
export interface DbHashes {
  version: string;
  words: Record<string, string>;    // file → hash
  examples: Record<string, string>; // id → hash
  forms?: Record<string, string>;   // file → sorted comma-joined word_forms fingerprint
}

// ---- Manifest patch merging ----

/**
 * Merge a newly generated patch entry with existing manifest patches, then trim
 * to `keepPatches` most-recently-added entries.
 *
 * @param existing   - patches from the current manifest on disk (may be undefined)
 * @param newEntry   - patch just generated for this run, or null if skipped
 * @param newVersion - the DB version just published (excluded from carry-forward to avoid self-ref)
 * @param keepPatches - max number of patch entries to retain (default 3)
 */
export function mergeManifestPatches(
  existing: Record<string, { url: string; size: number }> | undefined,
  newEntry: { fromVersion: string; url: string; size: number } | null,
  newVersion: string,
  keepPatches = 3,
): Record<string, { url: string; size: number }> {
  const patches: Record<string, { url: string; size: number }> = {};

  // Carry forward existing entries first (older), then append new entry (newest last)
  if (existing) {
    for (const [ver, patch] of Object.entries(existing)) {
      if (ver === newVersion) continue;    // don't carry forward self-referential entry
      patches[ver] = patch;
    }
  }

  if (newEntry) {
    // New entry wins over any stale carry-forward with the same key
    patches[newEntry.fromVersion] = { url: newEntry.url, size: newEntry.size };
  }

  // Trim to keepPatches most recent (insertion order)
  const entries = Object.entries(patches);
  const pruned: Record<string, { url: string; size: number }> = {};
  for (const [ver, patch] of entries.slice(-keepPatches)) {
    pruned[ver] = patch;
  }
  return pruned;
}

// ---- SQL escaping ----

function esc(s: string | null): string {
  if (s === null) return "NULL";
  return `'${s.replace(/'/g, "''")}'`;
}

function escNum(n: number | null): string {
  return n === null ? "NULL" : String(n);
}

// ---- Hash extraction ----

/** Extract a DbHashes snapshot from a live SQLite DB. */
export function extractHashes(db: Database.Database): DbHashes {
  const meta: Record<string, string> = {};
  for (const row of db.prepare("SELECT key, value FROM meta").all() as MetaRow[]) {
    meta[row.key] = row.value;
  }
  const words: Record<string, string> = {};
  for (const row of db.prepare("SELECT file, hash FROM words").all() as { file: string; hash: string }[]) {
    words[row.file] = row.hash;
  }
  const examples: Record<string, string> = {};
  for (const row of db.prepare("SELECT id, hash FROM examples").all() as { id: string; hash: string }[]) {
    examples[row.id] = row.hash;
  }
  const formsRaw = db.prepare(
    "SELECT w.file, wf.form FROM word_forms wf JOIN words w ON w.id = wf.word_id ORDER BY w.file, wf.form",
  ).all() as { file: string; form: string }[];
  const formsMap = new Map<string, string[]>();
  for (const row of formsRaw) {
    if (!formsMap.has(row.file)) formsMap.set(row.file, []);
    formsMap.get(row.file)!.push(row.form);
  }
  const forms: Record<string, string> = {};
  for (const [file, flist] of formsMap) {
    forms[file] = flist.join(","); // already sorted by ORDER BY
  }
  return { version: meta.version, words, examples, forms };
}

// ---- Patch generation ----

/**
 * Generate a SQL patch from a hash snapshot to the new DB.
 * Returns null if more than 50% of rows changed (full download is cheaper).
 */
export function generatePatchFromHashes(oldHashes: DbHashes, newDb: Database.Database): string | null {
  const newWords = newDb.prepare(
    "SELECT id, lemma, lemma_folded, pos, gender, frequency, plural_dominant, plural_form, superlative, file, gloss_en, data, hash FROM words",
  ).all() as WordRow[];

  const newExamples = newDb.prepare("SELECT id, data, hash FROM examples").all() as ExampleRow[];

  // 50% change-ratio check — if most rows differ, full download is cheaper than a patch.
  // Mirrors the original ATTACH-based query: counts old rows that are missing or changed in new.
  const oldWordCount = Object.keys(oldHashes.words).length;
  const oldExCount = Object.keys(oldHashes.examples).length;
  const totalOld = oldWordCount + oldExCount;

  const newWordFilesSet = new Set(newWords.map(w => w.file));
  const newExampleIdsSet = new Set(newExamples.map(e => e.id));

  if (totalOld > 0) {
    let changedWords = 0;
    for (const nw of newWords) {
      const oldHash = oldHashes.words[nw.file];
      if (oldHash !== undefined && oldHash !== nw.hash) changedWords++;
    }
    for (const file of Object.keys(oldHashes.words)) {
      if (!newWordFilesSet.has(file)) changedWords++;
    }

    let changedEx = 0;
    for (const ne of newExamples) {
      const oldHash = oldHashes.examples[ne.id];
      if (oldHash !== undefined && oldHash !== ne.hash) changedEx++;
    }
    for (const id of Object.keys(oldHashes.examples)) {
      if (!newExampleIdsSet.has(id)) changedEx++;
    }

    const changeRatio = (changedWords + changedEx) / totalOld;
    console.log(`Changed: ${changedWords}/${oldWordCount} words, ${changedEx}/${oldExCount} examples (${(changeRatio * 100).toFixed(0)}%)`);

    if (changeRatio > 0.5) {
      return null;
    }
  }

  const stmts: string[] = [];

  // Reuse sets already built for the ratio check
  const newWordFiles = newWordFilesSet;
  const newExampleIds = newExampleIdsSet;

  // --- Words diff ---
  for (const nw of newWords) {
    const oldHash = oldHashes.words[nw.file];

    if (oldHash === undefined) {
      // Inserted word
      stmts.push(
        `INSERT INTO words (lemma, lemma_folded, pos, gender, frequency, plural_dominant, plural_form, superlative, file, gloss_en, data, hash) VALUES (${esc(nw.lemma)}, ${esc(nw.lemma_folded)}, ${esc(nw.pos)}, ${esc(nw.gender)}, ${escNum(nw.frequency)}, ${escNum(nw.plural_dominant)}, ${esc(nw.plural_form)}, ${esc(nw.superlative)}, ${esc(nw.file)}, ${esc(nw.gloss_en)}, ${esc(nw.data)}, ${esc(nw.hash)});`,
      );
      appendFormsAndTerms(stmts, newDb, nw.id, nw.file);
    } else if (oldHash !== nw.hash) {
      // Updated word
      stmts.push(
        `UPDATE words SET lemma = ${esc(nw.lemma)}, lemma_folded = ${esc(nw.lemma_folded)}, pos = ${esc(nw.pos)}, gender = ${esc(nw.gender)}, frequency = ${escNum(nw.frequency)}, plural_dominant = ${escNum(nw.plural_dominant)}, plural_form = ${esc(nw.plural_form)}, superlative = ${esc(nw.superlative)}, gloss_en = ${esc(nw.gloss_en)}, data = ${esc(nw.data)}, hash = ${esc(nw.hash)} WHERE file = ${esc(nw.file)};`,
      );
      stmts.push(`DELETE FROM word_forms WHERE word_id = (SELECT id FROM words WHERE file = ${esc(nw.file)});`);
      stmts.push(`DELETE FROM en_terms WHERE word_id = (SELECT id FROM words WHERE file = ${esc(nw.file)});`);
      appendFormsAndTerms(stmts, newDb, nw.id, nw.file);
    } else if (oldHashes.forms) {
      // Word data unchanged — but check if word_forms changed (e.g. indexing logic update)
      const newForms = newDb.prepare("SELECT form FROM word_forms WHERE word_id = ? ORDER BY form").all(nw.id) as { form: string }[];
      const newFingerprint = newForms.map(f => f.form).join(",");
      const oldFingerprint = oldHashes.forms[nw.file] ?? "";
      if (newFingerprint !== oldFingerprint) {
        stmts.push(`DELETE FROM word_forms WHERE word_id = (SELECT id FROM words WHERE file = ${esc(nw.file)});`);
        const fileSubquery = `(SELECT id FROM words WHERE file = ${esc(nw.file)})`;
        for (const f of newForms) {
          stmts.push(`INSERT OR IGNORE INTO word_forms (form, word_id) VALUES (${esc(f.form)}, ${fileSubquery});`);
        }
      }
    }
  }

  // Deleted words
  for (const file of Object.keys(oldHashes.words)) {
    if (!newWordFiles.has(file)) {
      stmts.push(`DELETE FROM word_forms WHERE word_id = (SELECT id FROM words WHERE file = ${esc(file)});`);
      stmts.push(`DELETE FROM en_terms WHERE word_id = (SELECT id FROM words WHERE file = ${esc(file)});`);
      stmts.push(`DELETE FROM words WHERE file = ${esc(file)};`);
    }
  }

  // --- Examples diff ---
  for (const ne of newExamples) {
    const oldHash = oldHashes.examples[ne.id];

    if (oldHash === undefined) {
      stmts.push(`INSERT INTO examples (id, data, hash) VALUES (${esc(ne.id)}, ${esc(ne.data)}, ${esc(ne.hash)});`);
    } else if (oldHash !== ne.hash) {
      stmts.push(`UPDATE examples SET data = ${esc(ne.data)}, hash = ${esc(ne.hash)} WHERE id = ${esc(ne.id)};`);
    }
  }

  for (const id of Object.keys(oldHashes.examples)) {
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
  const oldHashesPath = stringArg(args, "--old-hashes");
  const outDir = stringArg(args, "--out");
  const keepPatches = intArg(args, "--keep-patches", 3);
  const releaseUrl = stringArg(args, "--release-url");

  if (!outDir) {
    console.error("Usage: npx tsx scripts/publish-update.ts --out <dir> [--old <old.db>|--old-hashes <hashes.json>] [--keep-patches 3] [--release-url <url>]");
    process.exit(1);
  }

  const newDbPath = join(process.cwd(), "data", "lexiklar.db");
  if (!existsSync(newDbPath)) {
    console.error(`Current DB not found at ${newDbPath}. Run 'npm run build-index' first.`);
    process.exit(1);
  }

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

  // Resolve old state: full DB or hash snapshot
  let oldHashes: DbHashes | null = null;

  if (oldPath && existsSync(oldPath)) {
    const oldDb = new Database(oldPath, { readonly: true });
    oldHashes = extractHashes(oldDb);
    oldDb.close();
  } else if (oldPath) {
    console.warn(`Old DB not found at ${oldPath} — generating manifest without patch.`);
  } else if (oldHashesPath && existsSync(oldHashesPath)) {
    oldHashes = JSON.parse(readFileSync(oldHashesPath, "utf-8")) as DbHashes;
  } else if (oldHashesPath) {
    console.warn(`Old hashes file not found at ${oldHashesPath} — generating manifest without patch.`);
  }

  // Generate patch
  const patches: Record<string, { url: string; size: number }> = {};

  if (oldHashes) {
    const oldVersion = oldHashes.version;
    if (!oldVersion) {
      console.warn("No version in old hashes — skipping patch generation.");
    } else if (oldVersion === newVersion) {
      console.log("Old and new DB have the same version — no patch needed.");
    } else {
      console.log(`Generating patch: ${oldVersion} → ${newVersion}`);
      const patchSql = generatePatchFromHashes(oldHashes, newDb);

      if (patchSql === null) {
        console.log("More than 50% changed — skipping patch (full download is cheaper)");
      } else {
        const patchFileName = `${oldVersion}_to_${newVersion}.sql.gz`;
        const patchPath = join(outDir, patchFileName);
        await pipeline(
          (async function* () { yield Buffer.from(patchSql + "\n"); })(),
          createGzip({ level: 9 }),
          createWriteStream(patchPath),
        );
        const patchSize = statSync(patchPath).size;
        const uncompressedSize = Buffer.byteLength(patchSql + "\n");
        const lines = patchSql.split("\n").filter(Boolean);
        console.log(`Patch: ${lines.length} SQL statements, ${(uncompressedSize / 1024).toFixed(1)} KB → ${(patchSize / 1024).toFixed(1)} KB gzipped`);

        const fullDbSize = statSync(newDbPath).size;
        if (patchSize > fullDbSize * 0.5) {
          console.log(`Patch too large (${(patchSize / (1024 * 1024)).toFixed(1)} MB > 50% of ${(fullDbSize / (1024 * 1024)).toFixed(1)} MB DB) — skipping`);
          unlinkSync(patchPath);
        } else {
          const patchUrl = releaseUrl ? `${releaseUrl}/patches/${patchFileName}` : patchFileName;
          patches[oldVersion] = { url: patchUrl, size: patchSize };
        }
      }
    }
  }

  // Carry forward older patches from existing manifest and trim to keepPatches
  const [[newFromVersion, newPatchEntry] = []] = Object.entries(patches);
  const newEntry = newFromVersion ? { fromVersion: newFromVersion, ...newPatchEntry } : null;
  const prunedPatches = mergeManifestPatches(existingManifest?.db?.patches, newEntry, newVersion, keepPatches);

  // Copy current DB to output and gzip
  const outDbPath = join(outDir, "lexiklar.db");
  copyFileSync(newDbPath, outDbPath);
  const fullDbSize = statSync(outDbPath).size;
  console.log(`Copied DB: ${(fullDbSize / (1024 * 1024)).toFixed(1)} MB`);

  const outDbGzPath = join(outDir, "lexiklar.db.gz");
  await pipeline(createReadStream(outDbPath), createGzip({ level: 9 }), createWriteStream(outDbGzPath));
  const fullDbGzSize = statSync(outDbGzPath).size;
  console.log(`Gzipped DB: ${(fullDbGzSize / (1024 * 1024)).toFixed(1)} MB (${((1 - fullDbGzSize / fullDbSize) * 100).toFixed(0)}% reduction)`);

  // Write manifest
  const fullDbGzUrl = releaseUrl ? `${releaseUrl}/lexiklar.db.gz` : "lexiklar.db.gz";
  const dbManifest: DbManifest = {
    current_version: newVersion,
    built_at: builtAt,
    patches: prunedPatches,
    full_db_size: fullDbSize,
    full_db_gz: { url: fullDbGzUrl, size: fullDbGzSize },
  };
  const manifest: UnifiedManifest = {
    db: dbManifest,
    bundle: existingManifest?.bundle,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Manifest written: ${Object.keys(prunedPatches).length} patch(es), full DB ${(fullDbSize / (1024 * 1024)).toFixed(1)} MB`);

  // Write hash snapshot for next run
  const dbHashes = extractHashes(newDb);
  writeFileSync(join(outDir, "db-hashes.json"), JSON.stringify(dbHashes) + "\n");
  console.log("db-hashes.json written.");

  newDb.close();

  // Prune unreferenced local patch files
  const referencedFiles = new Set(
    Object.values(prunedPatches).map(p => {
      const parts = p.url.split("/");
      return parts[parts.length - 1];
    }),
  );
  for (const file of readdirSync(outDir)) {
    if ((file.endsWith(".sql") || file.endsWith(".sql.gz")) && !referencedFiles.has(file)) {
      unlinkSync(join(outDir, file));
      console.log(`Pruned old patch: ${file}`);
    }
  }

  console.log("Done.");
}

import { fileURLToPath } from "url";
if (fileURLToPath(import.meta.url) === process.argv[1]) main();

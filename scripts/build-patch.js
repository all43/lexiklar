/**
 * Generate an OTA SQL patch between two Lexiklar database versions.
 *
 * Compares old and new databases row-by-row using content hashes,
 * emits minimal SQL (INSERT/UPDATE/DELETE) to transform old → new.
 *
 * Usage:
 *   node scripts/build-patch.js <old.db> <new.db>
 *   node scripts/build-patch.js data/lexiklar-published.db data/lexiklar.db
 *
 * Output:
 *   patches/<old_version>-<new_version>.sql
 *   Updates patches/manifest.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PATCHES_DIR = join(ROOT, "patches");

/**
 * Escape a string for safe inclusion in SQL.
 * Doubles single quotes: O'Brien → O''Brien
 */
function sqlEscape(str) {
  if (str === null || str === undefined) return "NULL";
  return "'" + str.replace(/'/g, "''") + "'";
}

function main() {
  const [oldPath, newPath] = process.argv.slice(2);

  if (!oldPath || !newPath) {
    console.error("Usage: node scripts/build-patch.js <old.db> <new.db>");
    process.exit(1);
  }

  if (!existsSync(oldPath)) {
    console.error(`Old database not found: ${oldPath}`);
    process.exit(1);
  }
  if (!existsSync(newPath)) {
    console.error(`New database not found: ${newPath}`);
    process.exit(1);
  }

  const oldDb = new Database(oldPath, { readonly: true });
  const newDb = new Database(newPath, { readonly: true });

  // Read versions
  const oldVersion = oldDb.prepare("SELECT value FROM meta WHERE key = 'version'").get()?.value;
  const newVersion = newDb.prepare("SELECT value FROM meta WHERE key = 'version'").get()?.value;
  const newBuiltAt = newDb.prepare("SELECT value FROM meta WHERE key = 'built_at'").get()?.value;

  if (!oldVersion || !newVersion) {
    console.error("Both databases must have a version in the meta table.");
    process.exit(1);
  }

  if (oldVersion === newVersion) {
    console.log("Databases have the same version. No patch needed.");
    process.exit(0);
  }

  console.log(`Generating patch: ${oldVersion} → ${newVersion}`);

  const statements = [];

  // --------------------------------------------------------
  // 1. Diff words table (keyed by `file`)
  // --------------------------------------------------------

  const oldWords = new Map();
  for (const row of oldDb.prepare("SELECT id, file, hash FROM words").all()) {
    oldWords.set(row.file, { id: row.id, hash: row.hash });
  }

  const newWords = new Map();
  for (const row of newDb.prepare("SELECT id, file, hash, lemma, lemma_folded, pos, gender, frequency, plural_dominant, plural_form, gloss_en, data FROM words").all()) {
    newWords.set(row.file, row);
  }

  const changedWordFiles = [];
  const newWordFiles = [];
  let deletedWords = 0;

  // Deleted words (in old, not in new)
  for (const [file, old] of oldWords) {
    if (!newWords.has(file)) {
      statements.push(`DELETE FROM word_forms WHERE word_id = (SELECT id FROM words WHERE file = ${sqlEscape(file)});`);
      statements.push(`DELETE FROM words WHERE file = ${sqlEscape(file)};`);
      deletedWords++;
    }
  }

  // New and changed words
  for (const [file, row] of newWords) {
    const old = oldWords.get(file);

    if (!old) {
      // New word
      newWordFiles.push(file);
      statements.push(
        `INSERT INTO words (lemma, lemma_folded, pos, gender, frequency, plural_dominant, plural_form, file, gloss_en, data, hash) VALUES (${sqlEscape(row.lemma)}, ${sqlEscape(row.lemma_folded)}, ${sqlEscape(row.pos)}, ${sqlEscape(row.gender)}, ${row.frequency ?? "NULL"}, ${row.plural_dominant ?? "NULL"}, ${sqlEscape(row.plural_form)}, ${sqlEscape(row.file)}, ${sqlEscape(row.gloss_en)}, ${sqlEscape(row.data)}, ${sqlEscape(row.hash)});`,
      );
    } else if (old.hash !== row.hash) {
      // Changed word
      changedWordFiles.push(file);
      statements.push(
        `UPDATE words SET lemma = ${sqlEscape(row.lemma)}, lemma_folded = ${sqlEscape(row.lemma_folded)}, pos = ${sqlEscape(row.pos)}, gender = ${sqlEscape(row.gender)}, frequency = ${row.frequency ?? "NULL"}, plural_dominant = ${row.plural_dominant ?? "NULL"}, plural_form = ${sqlEscape(row.plural_form)}, gloss_en = ${sqlEscape(row.gloss_en)}, data = ${sqlEscape(row.data)}, hash = ${sqlEscape(row.hash)} WHERE file = ${sqlEscape(row.file)};`,
      );
    }
  }

  // --------------------------------------------------------
  // 2. Rebuild word_forms for new/changed words
  // --------------------------------------------------------

  const affectedFiles = [...changedWordFiles, ...newWordFiles];

  for (const file of affectedFiles) {
    // Delete old forms
    statements.push(
      `DELETE FROM word_forms WHERE word_id = (SELECT id FROM words WHERE file = ${sqlEscape(file)});`,
    );

    // Insert new forms from new DB
    const forms = newDb.prepare(
      `SELECT wf.form FROM word_forms wf JOIN words w ON w.id = wf.word_id WHERE w.file = ?`,
    ).all(file);

    for (const { form } of forms) {
      statements.push(
        `INSERT OR IGNORE INTO word_forms (form, word_id) VALUES (${sqlEscape(form)}, (SELECT id FROM words WHERE file = ${sqlEscape(file)}));`,
      );
    }
  }

  // --------------------------------------------------------
  // 3. Diff examples table (keyed by `id`)
  // --------------------------------------------------------

  const oldExamples = new Map();
  for (const row of oldDb.prepare("SELECT id, hash FROM examples").all()) {
    oldExamples.set(row.id, row.hash);
  }

  const newExamples = new Map();
  for (const row of newDb.prepare("SELECT id, hash, data FROM examples").all()) {
    newExamples.set(row.id, row);
  }

  let changedExamples = 0;
  let newExamplesCount = 0;
  let deletedExamples = 0;

  // Deleted examples
  for (const [id] of oldExamples) {
    if (!newExamples.has(id)) {
      statements.push(`DELETE FROM examples WHERE id = ${sqlEscape(id)};`);
      deletedExamples++;
    }
  }

  // New and changed examples
  for (const [id, row] of newExamples) {
    const oldHash = oldExamples.get(id);

    if (oldHash === undefined) {
      newExamplesCount++;
      statements.push(
        `INSERT INTO examples (id, data, hash) VALUES (${sqlEscape(id)}, ${sqlEscape(row.data)}, ${sqlEscape(row.hash)});`,
      );
    } else if (oldHash !== row.hash) {
      changedExamples++;
      statements.push(
        `UPDATE examples SET data = ${sqlEscape(row.data)}, hash = ${sqlEscape(row.hash)} WHERE id = ${sqlEscape(id)};`,
      );
    }
  }

  // --------------------------------------------------------
  // 4. Update meta
  // --------------------------------------------------------

  statements.push(`UPDATE meta SET value = ${sqlEscape(newVersion)} WHERE key = 'version';`);
  if (newBuiltAt) {
    statements.push(
      `INSERT OR REPLACE INTO meta (key, value) VALUES ('built_at', ${sqlEscape(newBuiltAt)});`,
    );
  }

  // --------------------------------------------------------
  // 5. Write patch file
  // --------------------------------------------------------

  if (statements.length <= 2) {
    // Only meta updates, no actual data changes
    console.log("No data changes detected (only version differs). No patch generated.");
    oldDb.close();
    newDb.close();
    return;
  }

  mkdirSync(PATCHES_DIR, { recursive: true });

  const patchFileName = `${oldVersion}-${newVersion}.sql`;
  const patchPath = join(PATCHES_DIR, patchFileName);
  const patchContent = statements.join("\n") + "\n";
  writeFileSync(patchPath, patchContent);

  const patchSize = statSync(patchPath).size;

  console.log(`\nPatch summary:`);
  console.log(`  Words:    ${changedWordFiles.length} changed, ${newWordFiles.length} new, ${deletedWords} deleted`);
  console.log(`  Examples: ${changedExamples} changed, ${newExamplesCount} new, ${deletedExamples} deleted`);
  console.log(`  Forms:    ${affectedFiles.length} words had forms rebuilt`);
  console.log(`  Size:     ${(patchSize / 1024).toFixed(1)} KB`);
  console.log(`\nWrote ${patchPath}`);

  // --------------------------------------------------------
  // 6. Update manifest
  // --------------------------------------------------------

  const manifestPath = join(PATCHES_DIR, "manifest.json");
  let manifest = { current_version: newVersion, built_at: newBuiltAt, patches: {}, full_db: {} };

  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch {
      // Start fresh
    }
  }

  manifest.current_version = newVersion;
  manifest.built_at = newBuiltAt;
  manifest.patches[oldVersion] = {
    url: `patches/${patchFileName}`,
    size: patchSize,
  };

  // Keep only the last 5 patches
  const patchKeys = Object.keys(manifest.patches);
  if (patchKeys.length > 5) {
    const toRemove = patchKeys.slice(0, patchKeys.length - 5);
    for (const key of toRemove) {
      delete manifest.patches[key];
    }
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Updated ${manifestPath}`);

  oldDb.close();
  newDb.close();
}

main();

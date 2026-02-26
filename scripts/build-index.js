import {
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  existsSync,
} from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const DB_PATH = join(DATA_DIR, "index.db");

function findJsonFiles() {
  const results = [];
  for (const dir of ["nouns", "verbs", "adjectives"]) {
    const fullDir = join(DATA_DIR, "words", dir);
    if (!existsSync(fullDir)) continue;
    for (const file of readdirSync(fullDir)) {
      if (file.endsWith(".json")) {
        results.push(join(fullDir, file));
      }
    }
  }
  return results;
}

function main() {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

  const db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE search_index (
      id              INTEGER PRIMARY KEY,
      lemma           TEXT NOT NULL,
      pos             TEXT NOT NULL,
      gender          TEXT,
      frequency       INTEGER,
      gender_rule_id  TEXT,
      is_exception    INTEGER,
      file_path       TEXT NOT NULL,
      gloss_en        TEXT
    );
    CREATE INDEX idx_lemma       ON search_index(lemma);
    CREATE INDEX idx_frequency   ON search_index(frequency);
    CREATE INDEX idx_gender      ON search_index(gender);
    CREATE INDEX idx_gender_rule ON search_index(gender_rule_id);
  `);

  const insert = db.prepare(`
    INSERT INTO search_index (lemma, pos, gender, frequency, gender_rule_id, is_exception, file_path, gloss_en)
    VALUES (@lemma, @pos, @gender, @frequency, @gender_rule_id, @is_exception, @file_path, @gloss_en)
  `);

  const files = findJsonFiles();
  const entries = [];

  // Manifest for app-side search (JSON, no sql.js dependency needed)
  const manifest = [];

  for (const filePath of files) {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    const relPath = relative(DATA_DIR, filePath);
    // relPath is like "words/nouns/Tisch.json"
    const parts = relPath.split("/"); // ["words", "nouns", "Tisch.json"]
    const posDir = parts[1];          // "nouns" | "verbs" | "adjectives"
    const file   = parts[2].replace(".json", "");

    // Collect all English translations across senses
    const glossEn = (data.senses || [])
      .map((s) => s.gloss_en)
      .filter(Boolean);

    entries.push({
      lemma: data.word,
      pos: data.pos.toUpperCase(),
      gender: data.gender || null,
      frequency: data.frequency || null,
      gender_rule_id: data.gender_rule?.rule_id || null,
      is_exception: data.gender_rule?.is_exception ? 1 : 0,
      file_path: relPath,
      gloss_en: glossEn.join(", ") || null,
    });

    manifest.push({
      lemma: data.word,
      pos: data.pos.toUpperCase(),
      gender: data.gender || null,
      posDir,
      file,
      glossEn,
    });
  }

  // Sort manifest by frequency (lower rank = more common) then alphabetically
  manifest.sort((a, b) => {
    const fa = entries.find((e) => e.lemma === a.lemma)?.frequency ?? Infinity;
    const fb = entries.find((e) => e.lemma === b.lemma)?.frequency ?? Infinity;
    if (fa !== fb) return fa - fb;
    return a.lemma.localeCompare(b.lemma, "de");
  });

  const insertAll = db.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });
  insertAll(entries);

  db.close();
  console.log(`Built index.db with ${entries.length} entries.`);

  // Write search manifest
  const manifestPath = join(DATA_DIR, "search-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  console.log(`Wrote search-manifest.json with ${manifest.length} entries.`);
}

main();

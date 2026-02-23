import {
  readFileSync,
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
      file_path       TEXT NOT NULL
    );
    CREATE INDEX idx_lemma       ON search_index(lemma);
    CREATE INDEX idx_frequency   ON search_index(frequency);
    CREATE INDEX idx_gender      ON search_index(gender);
    CREATE INDEX idx_gender_rule ON search_index(gender_rule_id);
  `);

  const insert = db.prepare(`
    INSERT INTO search_index (lemma, pos, gender, frequency, gender_rule_id, is_exception, file_path)
    VALUES (@lemma, @pos, @gender, @frequency, @gender_rule_id, @is_exception, @file_path)
  `);

  const files = findJsonFiles();
  const entries = [];

  for (const filePath of files) {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    entries.push({
      lemma: data.word,
      pos: data.pos.toUpperCase(),
      gender: data.gender || null,
      frequency: data.frequency || null,
      gender_rule_id: data.gender_rule?.rule_id || null,
      is_exception: data.gender_rule?.is_exception ? 1 : 0,
      file_path: relative(DATA_DIR, filePath),
    });
  }

  const insertAll = db.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });
  insertAll(entries);

  db.close();
  console.log(`Built index.db with ${entries.length} entries.`);
}

main();

/**
 * Stage 2: Generate feminine counterpart noun files from approved review.
 *
 * Reads the review file produced by check-feminine-gaps.ts, generates
 * feminine noun JSON files for entries marked generate=true.
 *
 * All feminine -in nouns follow a completely regular declension:
 *   singular: all cases = word
 *   plural:   all cases = word + "nen"  (word already ends in -in)
 *
 * Generated files use _meta.source = "auto-feminine" to distinguish
 * from Wiktionary-sourced and manual entries.
 *
 * Usage:
 *   npx tsx scripts/generate-feminine-counterparts.ts [--input <file>] [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORDS_DIR = join(ROOT, "data", "words");

const inputIdx = process.argv.indexOf("--input");
const inputPath = inputIdx !== -1 ? process.argv[inputIdx + 1] : join(ROOT, "data/feminine-gaps.json");
const dryRun = process.argv.includes("--dry-run");

interface GapEntry {
  masculine_file: string;
  masculine_word: string;
  feminine_word: string;
  source: string;
  zipf: number;
  senses: Array<{
    gloss: string;
    gloss_en: string | null;
    gloss_en_full?: string | null;
    tags: string[];
  }>;
  generate: boolean;
}

if (!existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  console.error("Run check-feminine-gaps.ts first to generate the review file.");
  process.exit(1);
}

/** Strip "(male)" and add "(female)" to an English gloss. */
function formatFeminineGlossEn(en: string): string {
  // Remove existing gender markers
  const cleaned = en
    .replace(/\s*\(male\)/gi, "")
    .replace(/\s*\(female\)/gi, "")
    .trim();
  return `${cleaned} (female)`;
}

const gaps: GapEntry[] = JSON.parse(readFileSync(inputPath, "utf-8"));
const toGenerate = gaps.filter((g) => g.generate);
console.log(`${toGenerate.length} entries marked for generation (${gaps.length - toGenerate.length} skipped)`);

const today = new Date().toISOString().slice(0, 10);
let created = 0;
let skipped = 0;

for (const entry of toGenerate) {
  const femWord = entry.feminine_word;
  const outPath = join(WORDS_DIR, "nouns", `${femWord}.json`);

  if (existsSync(outPath)) {
    console.log(`  SKIP (exists): ${femWord}`);
    skipped++;
    continue;
  }

  // Build feminine declension
  // -in nouns: plural = word + "nen" (Lehrerin → Lehrerinnen)
  // -frau compounds: plural = word with "frau" → "frauen" (Wachfrau → Wachfrauen)
  let plural: string;
  if (femWord.endsWith("frau")) {
    plural = femWord + "en"; // Wachfrau → Wachfrauen
  } else if (femWord.endsWith("mädchen")) {
    plural = femWord; // Schulmädchen → Schulmädchen (no change)
  } else {
    plural = femWord + "nen"; // Lehrerin → Lehrerinnen
  }

  const femData: Record<string, unknown> = {
    word: femWord,
    pos: "noun",
    etymology_number: null,
    gender: "F",
    article: "die",
    plural_form: plural,
    gender_rule: null,
    case_forms: {
      singular: { nom: femWord, acc: femWord, dat: femWord, gen: femWord },
      plural: { nom: plural, acc: plural, dat: plural, gen: plural },
    },
    senses: entry.senses.map((s) => ({
      gloss: `weibliche Person: ${s.gloss}`,
      gloss_en: s.gloss_en ? formatFeminineGlossEn(s.gloss_en) : null,
      tags: s.tags,
      example_ids: [],
      synonyms: [],
      antonyms: [],
    })),
    sounds: [],
    _gender_counterpart: entry.masculine_word,
    _meta: {
      source_hash: "auto-feminine",
      generated_at: today,
      source: "auto-feminine",
    },
    zipf: entry.zipf, // inherit from masculine
  };

  if (dryRun) {
    console.log(`  DRY RUN: would create ${femWord} (from ${entry.masculine_word})`);
  } else {
    writeFileSync(outPath, JSON.stringify(femData, null, 2) + "\n");
    console.log(`  CREATED: ${femWord} (from ${entry.masculine_word}, zipf=${entry.zipf})`);
  }
  created++;
}

// Update _gender_counterpart on masculine files that are missing it
let mascUpdated = 0;
if (!dryRun) {
  for (const entry of toGenerate) {
    const mascPath = join(WORDS_DIR, `${entry.masculine_file}.json`);
    if (!existsSync(mascPath)) continue;
    const mascData = JSON.parse(readFileSync(mascPath, "utf-8")) as Record<string, unknown>;
    if (!mascData._gender_counterpart) {
      mascData._gender_counterpart = entry.feminine_word;
      writeFileSync(mascPath, JSON.stringify(mascData, null, 2) + "\n");
      mascUpdated++;
    }
  }
}

console.log(`\n${dryRun ? "Would create" : "Created"}: ${created}, Skipped: ${skipped}`);
if (mascUpdated > 0) console.log(`Updated _gender_counterpart on ${mascUpdated} masculine files`);
if (!dryRun && created > 0) {
  console.log("\nNext steps:");
  console.log("  1. Run: npx tsx scripts/translate-glosses.ts  (to get proper gloss_en/gloss_en_full)");
  console.log("  2. Run: npx tsx scripts/build-index.ts  (to index new words)");
}

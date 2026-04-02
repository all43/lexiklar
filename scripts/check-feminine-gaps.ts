/**
 * Stage 1: Identify masculine person nouns missing feminine counterparts.
 *
 * Scans all masculine nouns in data/words/nouns/ and checks whether a
 * corresponding feminine -in file exists. Outputs a review JSON file
 * listing candidates for auto-generation.
 *
 * Sources checked (in priority order):
 *   1. _gender_counterpart tag from Wiktionary (most reliable)
 *   2. word+"in" exists as feminine noun in Wiktionary dump
 *   3. Morphological inference (suffix-based, least reliable)
 *
 * Usage:
 *   npx tsx scripts/check-feminine-gaps.ts [--out <file>] [--min-zipf N]
 *
 * Output: JSON array of candidates for review before generation.
 */

import { readFileSync, writeFileSync, existsSync, createReadStream } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import { iterWordFiles, WORDS_DIR } from "./lib/words.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RAW_FILE = join(ROOT, "data/raw/de-extract.jsonl");

const outIdx = process.argv.indexOf("--out");
const outPath = outIdx !== -1 ? process.argv[outIdx + 1] : join(ROOT, "data/feminine-gaps.json");
const minZipfIdx = process.argv.indexOf("--min-zipf");
const minZipf = minZipfIdx !== -1 ? parseFloat(process.argv[minZipfIdx + 1]) : 0;

interface GapEntry {
  masculine_file: string;
  masculine_word: string;
  feminine_word: string;
  source: "gender_counterpart" | "wiktionary_dump" | "morphological";
  zipf: number;
  senses: Array<{
    gloss: string;
    gloss_en: string | null;
    gloss_en_full?: string | null;
    tags: string[];
  }>;
  generate: boolean;
}

// Step 1: Collect all existing feminine nouns in our data
console.log("Scanning existing word files...");
const existingFeminine = new Set<string>();
const masculineNouns: Array<{
  fileKey: string;
  word: string;
  zipf: number;
  genderCounterpart: string | null;
  senses: Array<{
    gloss: string;
    gloss_en: string | null;
    gloss_en_full?: string | null;
    tags: string[];
  }>;
}> = [];

for (const entry of iterWordFiles()) {
  if (entry.posDir !== "nouns") continue;
  const d = entry.data as Record<string, unknown>;
  if (d.gender === "F") {
    existingFeminine.add(d.word as string);
  }
  if (d.gender === "M") {
    const senses = (d.senses as Array<Record<string, unknown>>) || [];
    masculineNouns.push({
      fileKey: entry.fileKey,
      word: d.word as string,
      zipf: (d.zipf as number) || 0,
      genderCounterpart: (d._gender_counterpart as string) || null,
      senses: senses.map((s) => ({
        gloss: (s.gloss as string) || "",
        gloss_en: (s.gloss_en as string) || null,
        gloss_en_full: (s.gloss_en_full as string) || null,
        tags: (s.tags as string[]) || [],
      })),
    });
  }
}
console.log(`  ${masculineNouns.length} masculine nouns, ${existingFeminine.size} existing feminine nouns`);

// Step 2: Scan Wiktionary dump for feminine noun entries (word → true)
console.log("Scanning Wiktionary dump for feminine nouns...");
const feminineInWiki = new Set<string>();
if (existsSync(RAW_FILE)) {
  const rl = createInterface({ input: createReadStream(RAW_FILE, "utf-8"), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try {
      const d = JSON.parse(line) as { word: string; pos: string; tags?: string[] };
      if (d.pos === "noun" && (d.tags || []).includes("feminine")) {
        feminineInWiki.add(d.word);
      }
    } catch {
      // skip malformed lines
    }
  }
  console.log(`  ${feminineInWiki.size} feminine noun entries in Wiktionary`);
} else {
  console.log("  WARNING: Wiktionary dump not found, skipping dump check");
}

// Step 3: Find gaps
console.log("Finding gaps...");
const gaps: GapEntry[] = [];

for (const m of masculineNouns) {
  if (minZipf > 0 && m.zipf < minZipf) continue;

  let feminineWord: string | null = null;
  let source: GapEntry["source"] = "morphological";

  // Priority 1: _gender_counterpart from Wiktionary
  if (m.genderCounterpart) {
    if (existingFeminine.has(m.genderCounterpart)) continue; // already have it
    feminineWord = m.genderCounterpart;
    source = "gender_counterpart";
  }

  // Priority 2: word+"in" exists in Wiktionary dump
  if (!feminineWord) {
    const candidate = m.word + "in";
    if (existingFeminine.has(candidate)) continue; // already have it
    if (feminineInWiki.has(candidate)) {
      feminineWord = candidate;
      source = "wiktionary_dump";
    }
  }

  if (!feminineWord) continue; // no evidence of a feminine form

  // Skip non-person nouns: if the _gender_counterpart points to something
  // obviously not a person form, flag it but default generate=false
  const isLikelyPerson = isPersonNoun(m.word, m.senses, feminineWord);

  gaps.push({
    masculine_file: m.fileKey,
    masculine_word: m.word,
    feminine_word: feminineWord,
    source,
    zipf: m.zipf,
    senses: m.senses,
    generate: isLikelyPerson,
  });
}

// Sort by zipf descending (most common first)
gaps.sort((a, b) => b.zipf - a.zipf);

console.log(`\nFound ${gaps.length} gaps:`);
console.log(`  ${gaps.filter((g) => g.source === "gender_counterpart").length} from _gender_counterpart`);
console.log(`  ${gaps.filter((g) => g.source === "wiktionary_dump").length} from Wiktionary dump`);
console.log(`  ${gaps.filter((g) => g.generate).length} flagged for generation`);
console.log(`  ${gaps.filter((g) => !g.generate).length} flagged as non-person (review needed)`);

writeFileSync(outPath, JSON.stringify(gaps, null, 2) + "\n");
console.log(`\nWritten to ${outPath}`);
console.log("Review the file, set generate=false for non-person nouns, then run generate-feminine-counterparts.ts");

/**
 * Heuristic: is this masculine noun a person (not an object/animal/concept)?
 *
 * Checks gloss_en for person-related keywords and filters out known
 * non-person patterns.
 */
function isPersonNoun(
  word: string,
  senses: Array<{ gloss: string; gloss_en: string | null; tags: string[] }>,
  feminineWord: string,
): boolean {
  // Object nouns that Wiktionary wrongly tags with feminine counterparts
  const objectSuffixes = [
    "apparat", "automat", "computer", "drucker", "fehler", "fernseher",
    "filter", "hammer", "hubschrauber", "keller", "kocher", "lautsprecher",
    "messer", "motor", "ordner", "rechner", "schalter", "sender", "server",
    "speicher", "stecker", "teller", "timer", "wecker", "zähler",
  ];
  const lowerWord = word.toLowerCase();
  if (objectSuffixes.some((s) => lowerWord === s || lowerWord.endsWith(s))) return false;

  // Animal nouns
  const animalPatterns = ["tiger", "elefant", "fuchs", "igel", "pfau", "welpe", "wolf"];
  if (animalPatterns.some((p) => lowerWord === p || lowerWord.endsWith(p))) return false;

  // Months, seasons, abstract concepts
  if (/^(januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember|sommer|winter|herbst|frühling)/i.test(word)) return false;

  // Check glosses for person indicators
  const allGlosses = senses.map((s) => `${s.gloss} ${s.gloss_en || ""}`).join(" ").toLowerCase();
  const personKeywords = [
    "person", "beruf", "mensch", "angehörig", "bewohner", "einwohner",
    "mitglied", "anhänger", "vertreter", "spieler", "arbeiter",
    "practitioner", "professional", "specialist", "expert", "worker",
    "member", "follower", "supporter", "resident", "inhabitant",
    "citizen", "player", "athlete", "artist", "musician", "politician",
    "official", "officer", "employee", "manager", "leader", "teacher",
    "driver", "operator", "technician", "engineer", "doctor", "nurse",
  ];
  if (personKeywords.some((kw) => allGlosses.includes(kw))) return true;

  // Profession suffixes that are almost always person nouns
  const personSuffixes = ["-ist", "-eur", "-ant", "-ent", "-oge", "-at", "-ier"];
  if (personSuffixes.some((s) => word.endsWith(s.slice(1)))) return true;

  // If _gender_counterpart was set by Wiktionary and word ends in -er,
  // it's likely a person (but could be an agent noun for objects)
  // Default to true for tagged counterparts, false for morphological
  return true;
}

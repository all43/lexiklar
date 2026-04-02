/**
 * Remove redundant "(female)" from gloss_en where the English word
 * is already inherently feminine (sister-in-law, empress, actress, etc.)
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { iterWordFiles } from "./lib/words.js";

const WORDS_DIR = join("/Users/evgeniimalikov/projects/lexiklar", "data", "words");

// English words that are already inherently feminine — no need for "(female)"
const FEMININE_WORDS = new Set([
  // Family / kinship
  "sister", "half-sister", "sister-in-law", "stepsister",
  "daughter", "daughter-in-law", "stepdaughter", "granddaughter", "goddaughter",
  "mother", "mother-in-law", "stepmother", "grandmother", "great-grandmother", "godmother",
  "aunt", "great-aunt", "niece",
  "wife", "bride", "widow", "fiancée",
  // Gendered nouns (always female)
  "woman", "girl", "goddess", "lady", "madam", "madame", "mistress", "maiden",
  "mom", "mommy", "mummy", "mama", "mum", "granny", "nanny", "grandma",
  "empress", "queen", "princess", "duchess", "baroness", "countess", "marchioness",
  "actress", "waitress", "stewardess", "hostess", "priestess", "poetess", "governess",
  "nun", "midwife", "heroine", "superheroine",
  "blonde", "brunette",
  // Animals
  "mare", "hen", "cow", "doe", "ewe", "vixen", "lioness", "tigress",
  // Compounds
  "mermaid", "milkmaid", "chambermaid",
  "abbess", "prioress", "deaconess",
  "seamstress", "songstress", "enchantress", "sorceress", "huntress", "henchwoman",
  "journeywoman", "spokeswoman", "businesswoman", "policewoman", "chairwoman",
  "congresswoman", "sportswoman",
]);

function isInherentlyFeminine(base: string): boolean {
  const lower = base.toLowerCase();
  // Exact match
  if (FEMININE_WORDS.has(lower)) return true;
  // Check if base ends with a feminine word (for compounds like "war heroine", "lead actress")
  for (const fw of FEMININE_WORDS) {
    if (lower.endsWith(fw)) return true;
    if (lower.endsWith("'s " + fw) || lower.endsWith("'s " + fw)) return true;
  }
  // Patterns: *'s wife, *'s widow
  if (/['']s\s+wife$/i.test(lower)) return true;
  if (/['']s\s+widow$/i.test(lower)) return true;
  // "X's wife" without apostrophe variants
  if (/\bwife$/i.test(lower)) return true;
  return false;
}

let fixed = 0;
let filesModified = 0;

for (const entry of iterWordFiles()) {
  if (entry.posDir !== "nouns") continue;
  const d = entry.data as any;
  if (d.gender !== "F") continue;
  if (!d._gender_counterpart) continue;

  let modified = false;

  for (const sense of d.senses) {
    const en = sense.gloss_en as string | null;
    if (!en || !/\(female\b/.test(en)) continue;

    // Extract base (everything before the parenthetical)
    // Handle: "actress (female)" and "actress (female, deceptive)" and "queen (female, chess)"
    const base = en.replace(/\s*\(female\b[^)]*\)\s*$/, "").trim();

    if (isInherentlyFeminine(base)) {
      // Remove "(female" from the parenthetical, keeping other disambiguators
      const parenMatch = en.match(/\(female(?:,\s*(.+))?\)\s*$/);
      if (parenMatch && parenMatch[1]) {
        // Has other disambiguator: "queen (female, chess)" → "queen (chess)"
        sense.gloss_en = `${base} (${parenMatch[1]})`;
      } else {
        // Just "(female)": "actress (female)" → "actress"
        sense.gloss_en = base;
      }
      modified = true;
      fixed++;
      console.log(`  ${entry.fileKey}: "${en}" → "${sense.gloss_en}"`);
    }
  }

  if (modified) {
    const filePath = join(WORDS_DIR, `${entry.fileKey}.json`);
    writeFileSync(filePath, JSON.stringify(d, null, 2) + "\n");
    filesModified++;
  }
}

console.log(`\nCleaned: ${fixed} senses, ${filesModified} files`);

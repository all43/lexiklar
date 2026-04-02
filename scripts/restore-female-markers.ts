/**
 * Ensure all feminine person nouns (with _gender_counterpart) have "(female)"
 * in gloss_en. Merges with existing disambiguators:
 *   "pilot" → "pilot (female)"
 *   "pilot (aviation)" → "pilot (female, aviation)"
 *   "pilot (female)" → no change
 *   "pilot (female, aviation)" → no change
 *   "sister-in-law (spouse's sister)" → "sister-in-law (female, spouse's sister)"
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { iterWordFiles } from "./lib/words.js";

const WORDS_DIR = join("/Users/evgeniimalikov/projects/lexiklar", "data", "words");

let fixed = 0;
let alreadyOk = 0;
let filesModified = 0;

for (const entry of iterWordFiles()) {
  if (entry.posDir !== "nouns") continue;
  const d = entry.data as any;
  if (d.gender !== "F") continue;
  if (!d._gender_counterpart) continue;

  let modified = false;

  for (const sense of d.senses) {
    const en = sense.gloss_en as string | null;
    if (!en) continue;

    // Already has "(female" anywhere — ok
    if (/\bfemale\b/i.test(en)) {
      alreadyOk++;
      continue;
    }

    // Inherently feminine English words — still add "(female)" for learner clarity
    // (sister-in-law, empress, etc. — learner should know this is the feminine German form)

    // Check for existing parenthetical disambiguator
    const match = en.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (match) {
      // Merge: "pilot (aviation)" → "pilot (female, aviation)"
      sense.gloss_en = `${match[1]} (female, ${match[2]})`;
    } else {
      // Simple: "pilot" → "pilot (female)"
      sense.gloss_en = `${en} (female)`;
    }
    modified = true;
    fixed++;
  }

  if (modified) {
    const filePath = join(WORDS_DIR, `${entry.fileKey}.json`);
    writeFileSync(filePath, JSON.stringify(d, null, 2) + "\n");
    filesModified++;
  }
}

console.log(`Fixed: ${fixed} senses, Already ok: ${alreadyOk}, Files modified: ${filesModified}`);

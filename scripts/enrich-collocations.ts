/**
 * Enrich adjective word files with collocation nouns for declension examples.
 *
 * Scans each adjective's example sentences, extracts nouns from annotations,
 * looks up their gender, and picks the best noun per gender (M/F/N).
 * Inanimate nouns are preferred over animate ones to avoid semantically
 * weird combinations ("ein totes Kind"), but animate nouns are still used
 * when no inanimate alternative exists (e.g. "schwangere Frau").
 *
 * Usage:
 *   npx tsx scripts/enrich-collocations.ts              # all adjectives
 *   npx tsx scripts/enrich-collocations.ts --words klar  # specific words
 *   npx tsx scripts/enrich-collocations.ts --dry-run     # preview only
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadExamplesByIds } from "./lib/examples.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ADJ_DIR = join(ROOT, "data", "words", "adjectives");
const NOUNS_DIR = join(ROOT, "data", "words", "nouns");

// ── Config ──────────────────────────────────────────────────────

/** Nouns to skip entirely — nominalized pronouns, proper names, number words, etc. */
const SKIP_NOUNS = new Set([
  // Nominalized pronouns/particles
  "Ich", "Nichts", "Niemand", "Er", "Sie", "Es", "Du", "Mehr", "Viel",
  // Too short for useful examples
  "Ei", "Öl", "H", "VW",
  // Number words
  "Zwei", "Drei", "10.", "20.", "50.000", "60",
  // Proper names that appear as noun files
  "Horst", "Lori", "Newton", "Wagner", "Breivik", "Jolie", "Heike",
  // Nominalized adjectives/colors (poor collocation nouns)
  "Rot", "Schwere",
  // Gender-ambiguous
  "Couch",
  // Slurs
  "Nigger",
  // Vulgar/awkward body parts
  "Fresse", "Arsch", "Busen", "Hintern",
  // Too long/obscure
  "Mindesthaltbarkeitsdatum",
  // Poor standalone examples (abstract nominalizations)
  "Unheil",
  // English words leaked from annotations
  "Thing", "German",
]);

/** Animate nouns get a penalty score but are NOT excluded. */
const ANIMATE_NOUNS = new Set([
  "Mann", "Frau", "Kind", "Junge", "Mädchen", "Mensch", "Person",
  "Leute", "Herr", "Dame", "Freund", "Freundin", "Vater", "Mutter",
  "Bruder", "Schwester", "Sohn", "Tochter", "Baby", "Tier", "Hund",
  "Katze", "Arzt", "Schüler", "Schülerin", "Lehrer", "Lehrerin",
  "Kollege", "Kollegin", "Nachbar", "Nachbarin", "Patient", "Patientin",
]);

/** Fallback nouns when no collocation found for a gender. */
const FALLBACK: Record<string, string> = {
  M: "Tag",
  F: "Sache",
  N: "Ergebnis",
};
const FALLBACK_PLURAL = "Dinge";

// ── Noun gender cache ───────────────────────────────────────────

interface NounInfo {
  gender: string;
  plural_nom?: string;
}

const nounCache = new Map<string, NounInfo | null>();

function lookupNoun(lemma: string): NounInfo | null {
  if (nounCache.has(lemma)) return nounCache.get(lemma)!;

  // Try capitalized form (nouns are always capitalized in German)
  const cap = lemma.charAt(0).toUpperCase() + lemma.slice(1);
  const path = join(NOUNS_DIR, cap + ".json");

  if (!existsSync(path)) {
    nounCache.set(lemma, null);
    return null;
  }

  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    // Skip acronym collisions: file says "RUF" but annotation says "Ruf"
    const fileWord = data.word as string;
    if (fileWord && fileWord === fileWord.toUpperCase() && cap !== fileWord) {
      nounCache.set(lemma, null);
      return null;
    }
    const info: NounInfo = {
      gender: data.gender, // "M" | "F" | "N"
      plural_nom: data.case_forms?.plural?.nom,
    };
    nounCache.set(lemma, info);
    return info;
  } catch {
    nounCache.set(lemma, null);
    return null;
  }
}

// ── Collocation extraction ──────────────────────────────────────

interface Candidate {
  lemma: string;
  gender: string;
  score: number; // higher = better
  plural_nom?: string;
}

function extractCollocations(
  adjWord: string,
  exampleIds: string[],
): Record<string, string> | null {
  if (!exampleIds.length) return null;

  const examples = loadExamplesByIds(exampleIds);
  const candidates: Candidate[] = [];

  for (const id of exampleIds) {
    const ex = examples[id];
    if (!ex?.annotations?.length) continue;

    // Find the adjective form position in the actual text
    const adjAnn = ex.annotations.find(
      (a) => a.pos === "adjective" && a.lemma.toLowerCase() === adjWord.toLowerCase(),
    );
    const adjTextPos = adjAnn ? ex.text.toLowerCase().indexOf(adjAnn.form.toLowerCase()) : -1;

    // Find noun annotations
    for (let i = 0; i < ex.annotations.length; i++) {
      const ann = ex.annotations[i];
      if (ann.pos !== "noun") continue;

      const cap = ann.lemma.charAt(0).toUpperCase() + ann.lemma.slice(1);
      if (SKIP_NOUNS.has(cap)) continue;

      const nounInfo = lookupNoun(ann.lemma);
      if (!nounInfo?.gender) continue;
      if (!["M", "F", "N"].includes(nounInfo.gender)) continue;

      // Score based on text proximity and position relative to adjective.
      // In German, attributive adjectives precede their noun: "der klare Himmel".
      // Nouns AFTER the adjective within a short window are likely the modified noun.
      // Nouns BEFORE the adjective or far away are likely unrelated.
      let score = 0;

      if (adjTextPos >= 0) {
        const nounTextPos = ex.text.indexOf(ann.form);
        if (nounTextPos >= 0) {
          const offset = nounTextPos - adjTextPos; // positive = noun after adj
          if (offset > 0 && offset <= 20) {
            // Noun directly after adjective — very likely attributive
            score += 10;
          } else if (offset > 0 && offset <= 40) {
            // Noun after adjective but a bit further — possible
            score += 4;
          } else if (offset < 0 && Math.abs(offset) <= 15) {
            // Noun just before adjective — possible in some constructions
            score += 2;
          }
          // Nouns far away or well before the adjective get score 0
        }
      } else {
        // Adjective not annotated in this example — give base score
        score = 1;
      }

      // Inanimate bonus
      if (!ANIMATE_NOUNS.has(cap)) {
        score += 3;
      }

      candidates.push({
        lemma: cap,
        gender: nounInfo.gender,
        score,
        plural_nom: nounInfo.plural_nom,
      });
    }
  }

  if (!candidates.length) return null;

  // Group by gender, pick highest-scoring noun per gender
  const byGender: Record<string, Candidate[]> = { M: [], F: [], N: [] };
  for (const c of candidates) {
    byGender[c.gender]?.push(c);
  }

  // Aggregate scores by lemma within each gender
  const result: Record<string, string> = {};
  let bestPlural: { noun: string; score: number } | null = null;

  for (const gender of ["M", "F", "N"]) {
    const genderCandidates = byGender[gender];
    if (!genderCandidates.length) continue;

    // Sum scores per lemma
    const scoreByLemma = new Map<string, { total: number; plural_nom?: string }>();
    for (const c of genderCandidates) {
      const existing = scoreByLemma.get(c.lemma);
      if (existing) {
        existing.total += c.score;
      } else {
        scoreByLemma.set(c.lemma, { total: c.score, plural_nom: c.plural_nom });
      }
    }

    // Pick best
    let best: { lemma: string; score: number; plural_nom?: string } | null = null;
    for (const [lemma, { total, plural_nom }] of scoreByLemma) {
      if (!best || total > best.score) {
        best = { lemma, score: total, plural_nom };
      }
    }

    if (best) {
      result[gender] = best.lemma;
      // Track plural candidates — prefer nouns with a visibly different plural
      for (const [lemma, { total, plural_nom }] of scoreByLemma) {
        if (!plural_nom) continue;
        const distinct = plural_nom !== lemma;
        const score = total + (distinct ? 5 : 0); // bonus for distinct plural
        if (!bestPlural || score > bestPlural.score) {
          bestPlural = { noun: plural_nom, score };
        }
      }
    }
  }

  // Fill missing genders with fallbacks
  for (const [gender, fallback] of Object.entries(FALLBACK)) {
    if (!result[gender]) result[gender] = fallback;
  }

  // Add plural: prefer derived from best example noun, fall back to FALLBACK_PLURAL.
  // Distinct plurals get a +5 bonus above, but identical ones (Sportler/Sportler)
  // are still used — the template context (die ... -en) makes plural clear.
  result.Pl = bestPlural?.noun || FALLBACK_PLURAL;

  return result;
}

// ── Main ────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const wordsIdx = args.indexOf("--words");
  const wordFilter = wordsIdx >= 0 ? args[wordsIdx + 1]?.split(",") : null;

  const files = readdirSync(ADJ_DIR).filter((f) => f.endsWith(".json"));
  let processed = 0;
  let enriched = 0;
  let fallbackOnly = 0;

  for (const file of files) {
    const filePath = join(ADJ_DIR, file);
    const data = JSON.parse(readFileSync(filePath, "utf-8"));

    // Skip if not matching word filter
    if (wordFilter && !wordFilter.includes(data.word)) continue;

    // Skip indeclinable or irregular adjectives
    if (data.is_indeclinable || !data.declension_regular) continue;

    // Skip if manual override exists (takes precedence)
    if (data._overrides?.collocation_nouns) {
      if (dryRun) console.log(`${data.word}: (manual override, skipped)`);
      continue;
    }

    processed++;

    // Collect all example IDs
    const exampleIds: string[] = [];
    for (const sense of data.senses || []) {
      if (sense.example_ids) exampleIds.push(...sense.example_ids);
    }

    const collocations = extractCollocations(data.word, exampleIds);
    enriched++;

    if (dryRun) {
      console.log(`${data.word}: ${JSON.stringify(collocations)}`);
    } else {
      data.collocation_nouns = collocations;
      writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
    }
  }

  console.log(`\nProcessed ${processed} regular adjectives, ${enriched} enriched`);
  if (dryRun) console.log("(dry run — no files written)");
}

main();

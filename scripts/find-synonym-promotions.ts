/**
 * Discover synonyms_en entries worth promoting to synonyms_en_primary.
 *
 * Approach: for each single-word English synonym across all senses,
 * check how many German words already have that term in their gloss_en
 * (tier-0). When a common synonym has 0 tier-0 matches, promoting it
 * on the highest-frequency German word gives that term a proper top result.
 *
 * Usage:
 *   npx tsx scripts/find-synonym-promotions.ts [options]
 *
 * Options:
 *   --db <path>        SQLite DB path (default: dist/data/lexiklar.db)
 *   --top <N>          Number of results to show (default: 100)
 *   --max-rank <N>     Only consider words with frequency rank ≤ N (default: 5000)
 *   --max-competitors  Only show terms with ≤ N tier-0 competitors (default: 1)
 *   --content-pos      Only consider nouns, verbs, adjectives, adverbs
 *
 * Output: TSV to stdout, grouped by English term
 */

import { join } from "path";
import Database from "better-sqlite3";
import { intArg, stringArg } from "./lib/cli.js";

const ROOT = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const dbPath = stringArg(args, "--db") ?? join(ROOT, "data/lexiklar.db");
const topN = intArg(args, "--top", 100);
const maxRank = intArg(args, "--max-rank", 5000);
const maxCompetitors = intArg(args, "--max-competitors", 1);
const contentPosOnly = args.includes("--content-pos");

const db = new Database(dbPath, { readonly: true });

const CONTENT_POS = new Set(["NOUN", "VERB", "ADJECTIVE", "ADVERB"]);

interface WordRow {
  file: string;
  lemma: string;
  pos: string;
  frequency: number | null;
  gloss_en: string | null;
  data: string;
}

interface Sense {
  gloss_en?: string | null;
  synonyms_en?: string[];
  synonyms_en_primary?: string[];
}

interface WordData {
  senses?: Sense[];
}

// Load all words
const rows = db.prepare(
  `SELECT file, lemma, pos, frequency, gloss_en, data FROM words`,
).all() as WordRow[];

// Build tier-0 index: lowercased term → count of words that have it in gloss_en
const tier0Counts = new Map<string, number>();
for (const row of rows) {
  if (!row.gloss_en) continue;
  try {
    const glosses = JSON.parse(row.gloss_en) as string[];
    for (const g of glosses) {
      const key = g.toLowerCase().trim();
      tier0Counts.set(key, (tier0Counts.get(key) ?? 0) + 1);
    }
  } catch { /* skip */ }
}

// Collect: for each English synonym term, track the best German word (highest frequency)
interface SynonymOccurrence {
  lemma: string;
  file: string;
  pos: string;
  senseGlossEn: string;
  frequencyRank: number;
}

// term → best occurrence (lowest frequency rank = most common word)
const termBestWord = new Map<string, SynonymOccurrence>();

for (const row of rows) {
  if (row.frequency == null || row.frequency > maxRank) continue;
  if (contentPosOnly && !CONTENT_POS.has(row.pos)) continue;

  let data: WordData;
  try { data = JSON.parse(row.data); } catch { continue; }
  if (!data.senses) continue;

  const ownGlossEn = new Set<string>();
  if (row.gloss_en) {
    try {
      for (const g of JSON.parse(row.gloss_en) as string[]) {
        ownGlossEn.add(g.toLowerCase().trim());
      }
    } catch { /* skip */ }
  }

  for (const sense of data.senses) {
    if (!sense.synonyms_en?.length || !sense.gloss_en) continue;

    const alreadyPromoted = new Set(
      (sense.synonyms_en_primary ?? []).map(s => s.toLowerCase()),
    );

    for (const syn of sense.synonyms_en) {
      const synLower = syn.toLowerCase().trim();
      if (synLower.includes(" ") || synLower.length < 3) continue;
      if (ownGlossEn.has(synLower)) continue;
      if (alreadyPromoted.has(synLower)) continue;

      const existing = termBestWord.get(synLower);
      if (!existing || row.frequency! < existing.frequencyRank) {
        termBestWord.set(synLower, {
          lemma: row.lemma,
          file: row.file,
          pos: row.pos,
          senseGlossEn: sense.gloss_en,
          frequencyRank: row.frequency!,
        });
      }
    }
  }
}

// Build result: only terms with few tier-0 competitors
interface Result {
  term: string;
  tier0Competitors: number;
  bestLemma: string;
  bestFile: string;
  bestPos: string;
  bestGlossEn: string;
  bestRank: number;
}

const results: Result[] = [];
for (const [term, occ] of termBestWord) {
  const competitors = tier0Counts.get(term) ?? 0;
  if (competitors > maxCompetitors) continue;

  results.push({
    term,
    tier0Competitors: competitors,
    bestLemma: occ.lemma,
    bestFile: occ.file,
    bestPos: occ.pos,
    bestGlossEn: occ.senseGlossEn,
    bestRank: occ.frequencyRank,
  });
}

// Sort: 0 competitors first, then by best word's frequency rank (most common first)
results.sort((a, b) => {
  if (a.tier0Competitors !== b.tier0Competitors)
    return a.tier0Competitors - b.tier0Competitors;
  return a.bestRank - b.bestRank;
});

const output = results.slice(0, topN);
console.log(
  ["en_term", "tier0_competitors", "best_lemma", "best_file", "pos", "gloss_en", "frequency_rank"].join("\t"),
);
for (const r of output) {
  console.log(
    [r.term, r.tier0Competitors, r.bestLemma, r.bestFile, r.bestPos, r.bestGlossEn, r.bestRank].join("\t"),
  );
}

console.error(`\n${results.length} unique English terms with ≤${maxCompetitors} tier-0 competitors`);
console.error(`Showing top ${output.length} (sorted by tier-0 count, then word frequency)`);

db.close();

/**
 * Pure sense-merging logic extracted from mergeWithExisting() in transform.ts.
 *
 * Exported so it can be unit-tested without the filesystem dependency that
 * mergeWithExisting() carries (it reads the existing JSON from disk).
 */

import type { Sense } from "../../types/word.js";

/** LLM fields that are carried per-sense and can become orphaned. */
export interface OrphanEntry {
  gloss: string;
  gloss_en?: string | null;
  gloss_en_model?: string | null;
  gloss_en_full?: string | null;
  gloss_en_full_model?: string | null;
  synonyms_en?: string[] | null;
  synonyms_en_model?: string | null;
}

export interface MergeSensesResult {
  /** New senses with LLM fields restored from matching old senses / orphans. */
  senses: Sense[];
  /** Old senses whose gloss no longer appears in newSenses. Carries forward any
   *  previously-accumulated orphans whose gloss still hasn't reappeared. */
  orphans: OrphanEntry[];
}

/** Whether a source has useful translation data to carry over.
 *  Only checks gloss_en / gloss_en_full — synonyms_en is a search index
 *  field and does not block the translation fallback path. */
function hasData(s: Sense | OrphanEntry): boolean {
  return s.gloss_en != null || s.gloss_en_full != null;
}

/** Copy LLM translation fields from `source` onto a shallow clone of `target`.
 *  Also carries forward any `example_ids` from the old sense that aren't already
 *  present in the new sense — prevents translated examples from becoming orphaned
 *  when Wiktionary removes an example from a sense on re-transform. */
function applySenseData(target: Sense, source: Sense | OrphanEntry): Sense {
  const merged = { ...target };
  if (source.gloss_en != null)            merged.gloss_en            = source.gloss_en;
  if (source.gloss_en_model != null)      merged.gloss_en_model      = source.gloss_en_model!;
  if (source.gloss_en_full != null)       merged.gloss_en_full       = source.gloss_en_full;
  if (source.gloss_en_full_model != null) merged.gloss_en_full_model = source.gloss_en_full_model!;
  if ((source as Sense).synonyms_en?.length)       merged.synonyms_en       = (source as Sense).synonyms_en;
  if ((source as Sense).synonyms_en_model != null) merged.synonyms_en_model = (source as Sense).synonyms_en_model;
  // Carry forward old example_ids not already in the new sense.
  const oldIds = (source as Sense).example_ids;
  if (oldIds?.length) {
    const newSet = new Set(merged.example_ids ?? []);
    const extras = oldIds.filter((id) => !newSet.has(id));
    if (extras.length) merged.example_ids = [...(merged.example_ids ?? []), ...extras];
  }
  return merged;
}

/** Minimum Jaccard word-overlap to accept a fuzzy gloss match.
 *  0.4 is chosen to survive German inflection changes (eigengewichts→eigengewicht,
 *  befestigt→befestigen) which cause ~20% word divergence on typical rewording. */
const FUZZY_THRESHOLD = 0.4;

/**
 * Tokenise a German gloss into a set of lowercase words (≥3 chars, no punct).
 * Used for fuzzy sense matching when the exact German text changed slightly.
 */
function glossWords(gloss: string): Set<string> {
  return new Set(
    gloss
      .toLowerCase()
      .replace(/[[\]().,;:!?„""»«‹›]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/**
 * Match LLM-generated sense fields (gloss_en, gloss_en_full, synonyms_en, …)
 * from old senses to new senses by German gloss text.
 *
 * Matching order:
 *   1. Exact German gloss match (safe, always preferred)
 *   2. Fuzzy word-overlap fallback (Jaccard ≥ 0.5) for minor Wiktionary
 *      rewording — e.g. "[wegen des Eigengewichts]" → "(durch das Eigengewicht"
 *   3. Orphan recovery — if a previously-orphaned gloss reappears exactly
 *
 * Why text-matching instead of position-matching:
 *   Position-based merging silently maps translations to the wrong meaning when
 *   senses reorder (Wiktionary edits) or a file is re-transformed with senses
 *   that belong to a different homonym. Text-matching is safe: if the German
 *   gloss changed or moved to another file, gloss_en stays null (triggering
 *   re-translation) rather than pointing to the wrong meaning.
 */
export function mergeSenses(
  newSenses: Sense[],
  existingSenses: Sense[],
  existingOrphans: OrphanEntry[],
): MergeSensesResult {
  // Build gloss→sense lookup from existing file (first occurrence wins)
  const glossToOldSense = new Map<string, Sense>();
  for (const oldSense of existingSenses) {
    if (oldSense.gloss && !glossToOldSense.has(oldSense.gloss)) {
      glossToOldSense.set(oldSense.gloss, oldSense);
    }
  }

  // Secondary lookup from previously-saved orphans
  const glossToOrphan = new Map<string, OrphanEntry>();
  for (const orphan of existingOrphans) {
    if (orphan.gloss && !glossToOrphan.has(orphan.gloss)) {
      glossToOrphan.set(orphan.gloss, orphan);
    }
  }

  // Precompute word sets for old senses AND orphans (for fuzzy matching)
  const oldSenseWords: Array<[Sense, Set<string>]> = existingSenses
    .filter((s) => s.gloss)
    .map((s) => [s, glossWords(s.gloss)]);
  const orphanWords: Array<[OrphanEntry, Set<string>]> = existingOrphans
    .filter((o) => o.gloss)
    .map((o) => [o, glossWords(o.gloss)]);

  // Track which old senses / orphans were already consumed
  const consumedOldGlosses = new Set<string>();
  const consumedOrphanGlosses = new Set<string>();

  // Pool for empty-gloss senses: text matching is impossible, so use positional order.
  // Senses with gloss==="" from existing file (then orphans) are consumed in sequence.
  const emptyGlossPool: Array<Sense | OrphanEntry> = [
    ...existingSenses.filter((s) => s.gloss === "" && hasData(s)),
    ...existingOrphans.filter((o) => o.gloss === "" && hasData(o)),
  ];
  let emptyGlossIdx = 0;

  const mergedSenses = newSenses.map((newSense) => {
    const g = newSense.gloss;

    // Empty-gloss senses can't be matched by text — use positional pool.
    if (g === "") {
      if (emptyGlossIdx < emptyGlossPool.length) {
        return applySenseData(newSense, emptyGlossPool[emptyGlossIdx++]);
      }
      return newSense;
    }

    if (!g) return newSense;

    // 1. Exact match against existing senses
    const exactSense = glossToOldSense.get(g);
    let source: Sense | OrphanEntry | undefined = exactSense;
    let fromOrphan = false;

    // 2. If exact match found but has no data, or no exact match at all:
    //    try fuzzy match across existing senses and orphans.
    if (!source || !hasData(source)) {
      const newWords = glossWords(g);
      let bestSim = FUZZY_THRESHOLD - 0.001; // must strictly exceed threshold
      let bestMatch: Sense | OrphanEntry | null = null;
      let bestIsOrphan = false;

      for (const [oldSense, oldWords] of oldSenseWords) {
        if (consumedOldGlosses.has(oldSense.gloss)) continue;
        if (!hasData(oldSense)) continue; // skip senses with no data
        const sim = jaccardSimilarity(newWords, oldWords);
        if (sim > bestSim) { bestSim = sim; bestMatch = oldSense; bestIsOrphan = false; }
      }
      for (const [orphan, oWords] of orphanWords) {
        if (consumedOrphanGlosses.has(orphan.gloss)) continue;
        const sim = jaccardSimilarity(newWords, oWords);
        if (sim > bestSim) { bestSim = sim; bestMatch = orphan; bestIsOrphan = true; }
      }

      if (bestMatch) {
        source = bestMatch;
        fromOrphan = bestIsOrphan;
      }
    }

    // 3. Exact orphan recovery (only if still no data source)
    if ((!source || !hasData(source)) && glossToOrphan.has(g)) {
      source = glossToOrphan.get(g)!;
      fromOrphan = true;
    }

    if (!source || !hasData(source)) return newSense;

    // Track consumption
    if (exactSense && source === exactSense) {
      consumedOldGlosses.add(exactSense.gloss);
    } else if (!fromOrphan) {
      consumedOldGlosses.add((source as Sense).gloss);
    } else {
      consumedOrphanGlosses.add((source as OrphanEntry).gloss);
    }
    if (fromOrphan) consumedOrphanGlosses.add((source as OrphanEntry).gloss);

    return applySenseData(newSense, source);
  });

  // Senses that couldn't be matched (exactly or fuzzily) → orphans
  const newlyLost: OrphanEntry[] = existingSenses
    .filter((s) => s.gloss_en != null && s.gloss && !consumedOldGlosses.has(s.gloss))
    .map((s) => ({
      gloss: s.gloss,
      ...(s.gloss_en != null && { gloss_en: s.gloss_en }),
      ...(s.gloss_en_model != null && { gloss_en_model: s.gloss_en_model }),
      ...(s.gloss_en_full != null && { gloss_en_full: s.gloss_en_full }),
      ...(s.gloss_en_full_model != null && { gloss_en_full_model: s.gloss_en_full_model }),
      ...(s.synonyms_en?.length && { synonyms_en: s.synonyms_en }),
      ...(s.synonyms_en_model != null && { synonyms_en_model: s.synonyms_en_model }),
    }));

  // Carry forward orphans not consumed in this run, deduplicate by gloss
  const survivingOrphans = existingOrphans.filter((o) => !consumedOrphanGlosses.has(o.gloss));
  const survivingGlosses = new Set(survivingOrphans.map((o) => o.gloss));
  const addedOrphans = newlyLost.filter((o) => !survivingGlosses.has(o.gloss));
  const orphans = [...survivingOrphans, ...addedOrphans];

  return { senses: mergedSenses, orphans };
}

// ============================================================
// Cross-file homonym merge
// ============================================================

/** A translation that was found in one homonym file and applied to another. */
export interface CrossFileMatch {
  /** Filename key of the old file that held the translation */
  oldFile: string;
  /** German gloss of the old sense that was matched */
  oldGloss: string;
  /** Filename key of the new file that received the translation */
  newFile: string;
  /** German gloss of the new sense (same for exact; slightly different for fuzzy) */
  newGloss: string;
}

/**
 * Cross-file sense merge for homonym groups.
 *
 * After per-file `mergeSenses()` runs (inside `mergeWithExisting()`), some new
 * senses may still have no gloss_en because the matching old sense lived in a
 * DIFFERENT homonym file (e.g. Wiktionary reorganised which file a sense belongs
 * to between two transform runs).
 *
 * This function scans all old sibling files for those still-null senses and
 * transfers any translations found, using the same exact + fuzzy matching logic
 * as `mergeSenses()`.  It never overwrites an existing gloss_en.
 *
 * @param newFiles  New senses per file key, AFTER per-file merge
 *                  (senses already translated are left untouched).
 * @param oldFiles  All old sibling files for this word+POS, loaded before
 *                  the transform run — used as the cross-file pool.
 */
export function mergeHomonymGroup(
  newFiles: Map<string, Sense[]>,
  oldFiles: Map<string, { senses: Sense[]; orphans: OrphanEntry[] }>,
): { files: Map<string, Sense[]>; crossFileMatches: CrossFileMatch[] } {
  // Build the global cross-file pool: old senses + orphans with data, tagged by file
  interface PoolEntry {
    sourceFile: string;
    source: Sense | OrphanEntry;
    words: Set<string>;
  }
  const pool: PoolEntry[] = [];
  for (const [filename, { senses, orphans }] of oldFiles) {
    for (const s of senses) {
      if (s.gloss && hasData(s)) pool.push({ sourceFile: filename, source: s, words: glossWords(s.gloss) });
    }
    for (const o of orphans) {
      if (o.gloss && hasData(o)) pool.push({ sourceFile: filename, source: o, words: glossWords(o.gloss) });
    }
  }

  // Global consumed key: "sourceFile::gloss" — each old sense matched at most once
  const consumed = new Set<string>();
  const crossFileMatches: CrossFileMatch[] = [];
  const resultFiles = new Map<string, Sense[]>();

  for (const [newFilename, newSenses] of newFiles) {
    const updatedSenses = newSenses.map((newSense) => {
      // Already has translation from per-file merge → skip
      if (!newSense.gloss || hasData(newSense)) return newSense;

      const newWords = glossWords(newSense.gloss);

      // 1. Exact cross-file match (excluding own file's old senses)
      for (const entry of pool) {
        if (entry.sourceFile === newFilename) continue;
        const key = `${entry.sourceFile}::${entry.source.gloss}`;
        if (consumed.has(key)) continue;
        if (entry.source.gloss !== newSense.gloss) continue;
        consumed.add(key);
        crossFileMatches.push({ oldFile: entry.sourceFile, oldGloss: entry.source.gloss, newFile: newFilename, newGloss: newSense.gloss });
        return applySenseData(newSense, entry.source);
      }

      // 2. Fuzzy cross-file match
      let bestSim = FUZZY_THRESHOLD - 0.001;
      let bestEntry: PoolEntry | null = null;
      for (const entry of pool) {
        if (entry.sourceFile === newFilename) continue;
        const key = `${entry.sourceFile}::${entry.source.gloss}`;
        if (consumed.has(key)) continue;
        const sim = jaccardSimilarity(newWords, entry.words);
        if (sim > bestSim) { bestSim = sim; bestEntry = entry; }
      }
      if (bestEntry) {
        const key = `${bestEntry.sourceFile}::${bestEntry.source.gloss}`;
        consumed.add(key);
        crossFileMatches.push({ oldFile: bestEntry.sourceFile, oldGloss: bestEntry.source.gloss, newFile: newFilename, newGloss: newSense.gloss });
        return applySenseData(newSense, bestEntry.source);
      }

      return newSense;
    });
    resultFiles.set(newFilename, updatedSenses);
  }

  return { files: resultFiles, crossFileMatches };
}

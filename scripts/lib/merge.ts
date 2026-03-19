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

/**
 * Match LLM-generated sense fields (gloss_en, gloss_en_full, synonyms_en, …)
 * from old senses to new senses by German gloss text.
 *
 * Why text-matching instead of position-matching:
 *   Position-based merging silently maps translations to the wrong meaning when
 *   senses reorder (Wiktionary edits) or a file is re-transformed with senses
 *   that belong to a different homonym. Text-matching is safe: if the German
 *   gloss changed or moved to another file, gloss_en stays null (triggering
 *   re-translation) rather than pointing to the wrong meaning.
 *
 * Orphan recovery: if a sense whose gloss_en was previously saved as an orphan
 * reappears in newSenses, its translation is restored and the orphan consumed.
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

  const consumedOrphanGlosses = new Set<string>();
  const mergedSenses = newSenses.map((newSense) => {
    const g = newSense.gloss;
    if (!g) return newSense;

    const fromOrphan = !glossToOldSense.has(g) && glossToOrphan.has(g);
    const source = glossToOldSense.get(g) ?? glossToOrphan.get(g);
    if (!source) return newSense;

    if (fromOrphan) consumedOrphanGlosses.add(g);

    const merged = { ...newSense };
    if (source.gloss_en != null)            merged.gloss_en            = source.gloss_en;
    if (source.gloss_en_model != null)      merged.gloss_en_model      = source.gloss_en_model!;
    if (source.gloss_en_full != null)       merged.gloss_en_full       = source.gloss_en_full;
    if (source.gloss_en_full_model != null) merged.gloss_en_full_model = source.gloss_en_full_model!;
    if ((source as Sense).synonyms_en?.length)       merged.synonyms_en       = (source as Sense).synonyms_en;
    if ((source as Sense).synonyms_en_model != null) merged.synonyms_en_model = (source as Sense).synonyms_en_model;
    return merged;
  });

  // Senses that couldn't be matched → orphans
  const newGlossSet = new Set(newSenses.map((s) => s.gloss).filter(Boolean));
  const newlyLost: OrphanEntry[] = existingSenses
    .filter((s) => s.gloss_en != null && s.gloss && !newGlossSet.has(s.gloss))
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

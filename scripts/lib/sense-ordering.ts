/**
 * Sense ordering rules for build-index.ts.
 *
 * Determines display order of senses in the DB. Source files are never modified.
 * Override per-word via `_overrides.first_sense` in the word file.
 */

import type { Sense, WordOverrides } from "../../types/word.js";

/** Tags that demote a sense in Strategy C (nouns only) */
const DEMOTED_TAGS = new Set(["derogatory", "vulgar", "slang"]);

function isDemoted(s: Sense): number {
  return s.tags?.some((t) => DEMOTED_TAGS.has(t)) ? 1 : 0;
}

/**
 * Compute display order for a word's senses. Returns index permutation (new → old).
 * E.g. [2, 0, 1] means: display original sense 2 first, then 0, then 1.
 *
 * Rules (in priority order):
 * - `_overrides.sense_order`: array of gloss_en values → full custom order
 * - `_overrides.first_sense`: string gloss_en → move that sense to position 0
 * - Nouns: Strategy C — demote vulgar/derog/slang, reorder if margin ≥ 3 and min ≤ 2
 * - Everything else: Wiktionary order (identity)
 */
export function computeSenseOrder(
  senses: Sense[],
  pos: string,
  overrides?: WordOverrides,
): number[] {
  const identity = senses.map((_, i) => i);
  if (senses.length < 2) return identity;

  // Full custom order: array of gloss_en values
  const senseOrder = overrides?.sense_order as string[] | undefined;
  if (Array.isArray(senseOrder) && senseOrder.length > 0) {
    const order: number[] = [];
    const used = new Set<number>();
    for (const gloss of senseOrder) {
      const idx = senses.findIndex((s, i) => s.gloss_en === gloss && !used.has(i));
      if (idx >= 0) { order.push(idx); used.add(idx); }
    }
    // Append any senses not mentioned in the override
    for (let i = 0; i < senses.length; i++) {
      if (!used.has(i)) order.push(i);
    }
    return order;
  }

  // Move one sense to first position
  const firstSense = overrides?.first_sense as string | undefined;
  if (firstSense) {
    const idx = senses.findIndex((s) => s.gloss_en === firstSense);
    if (idx > 0) {
      const order = [...identity];
      order.splice(idx, 1);
      order.unshift(idx);
      return order;
    }
  }

  // Strategy C for nouns only
  if (pos === "noun" || pos === "proper noun") {
    const indexed = senses.map((s, i) => ({ s, i }));
    indexed.sort((a, b) => {
      const dA = isDemoted(a.s), dB = isDemoted(b.s);
      if (dA !== dB) return dA - dB;
      const exA = a.s.example_ids?.length ?? 0, exB = b.s.example_ids?.length ?? 0;
      const margin = Math.abs(exA - exB), minEx = Math.min(exA, exB);
      if (margin >= 3 && minEx <= 2) return exB - exA;
      return 0;
    });
    return indexed.map((e) => e.i);
  }

  return identity;
}

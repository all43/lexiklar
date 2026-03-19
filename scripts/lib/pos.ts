/**
 * Shared POS (part-of-speech) configuration.
 *
 * Single source of truth for the mapping between Wiktionary POS keys,
 * directory names under data/words/, and display labels in word files.
 *
 * Consumed by: transform.ts, build-index.ts, enrich-frequency.ts,
 *              translate-examples.ts, translate-glosses.ts
 */

import type { PosKey, PosConfig, PosConfigMap } from "../../types/pos.js";

export const POS_CONFIG: PosConfigMap = {
  noun: { dir: "nouns", label: "noun" },
  verb: { dir: "verbs", label: "verb" },
  adj: { dir: "adjectives", label: "adjective" },
  phrase: { dir: "phrases", label: "phrase" },
  adv: { dir: "adverbs", label: "adverb" },
  prep: { dir: "prepositions", label: "preposition" },
  postp: { dir: "postpositions", label: "postposition" },
  conj: { dir: "conjunctions", label: "conjunction" },
  particle: { dir: "particles", label: "particle" },
  intj: { dir: "interjections", label: "interjection" },
  pron: { dir: "pronouns", label: "pronoun" },
  det: { dir: "determiners", label: "determiner" },
  num: { dir: "numerals", label: "numeral" },
  name: { dir: "names", label: "proper noun" },
  abbrev: { dir: "abbreviations", label: "abbreviation" },
};

/** Array of directory names: ["nouns", "verbs", "adjectives", ...] */
export const POS_DIRS: string[] = Object.values(POS_CONFIG).map((c: PosConfig) => c.dir);

/**
 * Mapping from Wiktionary POS key to directory name.
 * { noun: "nouns", verb: "verbs", adj: "adjectives", ... }
 */
export const SUPPORTED_POS: Record<string, string> = Object.fromEntries(
  Object.entries(POS_CONFIG).map(([k, v]) => [k, v.dir]),
);

export type { PosKey, PosConfig, PosConfigMap };

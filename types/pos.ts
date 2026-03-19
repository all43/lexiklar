/** POS configuration types. */

export interface PosConfig {
  dir: string;
  label: string;
}

export type PosKey =
  | "noun"
  | "verb"
  | "adj"
  | "phrase"
  | "adv"
  | "prep"
  | "conj"
  | "particle"
  | "intj"
  | "pron"
  | "det"
  | "num"
  | "name"
  | "abbrev"
  | "postp";

export type PosConfigMap = Record<PosKey, PosConfig>;

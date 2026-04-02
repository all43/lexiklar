/** Core word data types — shared between pipeline scripts and frontend. */

// --- Common building blocks ---

export interface Sense {
  gloss: string;
  gloss_en: string | null;
  gloss_en_model?: string;
  gloss_en_full?: string | null;
  gloss_en_full_model?: string;
  tags: string[];
  example_ids: string[];
  synonyms: string[];
  antonyms: string[];
  synonyms_en?: string[];
  synonyms_en_model?: string;
}

export interface Sound {
  ipa: string;
  tags: string[];
}

export interface WordMeta {
  source_hash: string;
  generated_at: string;
  /** Present only on entries not sourced from Wiktionary. */
  source?: "manual" | "auto-feminine";
}

export interface FalseFriendMeaning {
  /** English gloss of this meaning (e.g. "current, up-to-date") */
  en: string;
  /** German lemmas for this meaning — empty array means this word itself is correct */
  de: string[];
}

export interface FalseFriendEn {
  /** The English word this German word is commonly confused with (e.g. "actual") */
  en_word: string;
  /** Curated meaning rows mapping English senses to German alternatives */
  meanings: FalseFriendMeaning[];
}

export interface WordAntonym {
  /** Lemma of the opposite adjective (e.g. "schlecht" for "gut") */
  word: string;
  /**
   * true = antonym is the inferior/negative pole (schlecht, krank, dumm).
   * false/absent = neutral dimensional opposite (klein, langsam, kalt).
   */
  negative?: boolean;
}

export interface ConfusablePairEntry {
  /** Shared English translation that causes confusion (e.g. "remember") */
  en_word: string;
  /** Lemma of the other confusable word (e.g. "merken") */
  other: string;
  /**
   * Short usage note for the other word — not stored in source files.
   * Resolved at build-index time from the counterpart's own this_note.
   */
  other_note: string;
}

export interface ConfusablePairs {
  /** Short usage note for THIS word — shared across all pairs (e.g. "recall from the past") */
  this_note: string;
  pairs: ConfusablePairEntry[];
}

export interface WordOverrides {
  /** Move this gloss_en sense to first position in display order (build-index only) */
  first_sense?: string;
  /** Full custom sense display order as array of gloss_en values (build-index only) */
  sense_order?: string[];
  /** False-friend annotation for English speakers (promoted to top-level by build-index) */
  false_friend_en?: FalseFriendEn;
  /** German–German confusable pairs (promoted to top-level by build-index) */
  confusable_pairs?: ConfusablePairs;
  /** Curated antonym for adjective comparison scale (promoted to top-level by build-index) */
  antonym?: WordAntonym;
  /** Any other field overrides (applied by transform's mergeWithExisting) */
  [key: string]: unknown;
}

export interface ProofreadFlags {
  gloss_en?: true;
  gloss_en_full?: true;
  synonyms_en?: true;
  examples_owned?: string;
  examples_ref?: string;
}

export interface GenderRule {
  rule_id: string;
  is_exception: boolean;
  is_false_match?: boolean;
}

export interface CaseRow {
  nom: string;
  acc: string;
  dat: string;
  gen: string;
}

export interface CaseForms {
  singular: CaseRow;
  plural: CaseRow;
}

// Alternative forms for case cells that have more than one valid form (e.g. gen sg "Tischs" / "Tisches")
export type CaseFormsAlt = {
  singular?: Partial<Record<keyof CaseRow, string[]>>;
  plural?: Partial<Record<keyof CaseRow, string[]>>;
};

// --- Conjugation types ---

export interface PersonForms {
  ich: string;
  du: string;
  er: string;
  wir: string;
  ihr: string;
  sie: string;
}

export interface ImperativeForms {
  du: string;
  ihr: string;
  Sie: string;
}

export interface ConjugationTable {
  present: PersonForms;
  preterite: PersonForms;
  subjunctive1: PersonForms;
  subjunctive2: PersonForms;
  imperative: ImperativeForms;
  participle1: string;
  participle2: string;
}

export interface VerbStems {
  present: string;
  past: string;
  present_du_er?: string;
  subj2?: string;
  imperative_du?: string;
}

export interface PrincipalParts {
  infinitive: string;
  past_stem: string;
  past_participle: string;
}

// --- Adjective declension ---

export interface GenderedCaseRows {
  masc: CaseRow;
  fem: CaseRow;
  neut: CaseRow;
  plural: CaseRow;
}

export interface FullDeclension {
  strong: GenderedCaseRows;
  weak: GenderedCaseRows;
  mixed: GenderedCaseRows;
}

// --- Base word interface ---

export interface WordBase {
  word: string;
  pos: string;
  etymology_number: number | null;
  senses: Sense[];
  sounds: Sound[];
  expression_ids?: string[];
  _derived?: string[];
  _hyponyms?: string[];
  _antonyms?: string[];
  _synonyms?: string[];
  _meta: WordMeta;
  _proofread?: ProofreadFlags;
  _overrides?: WordOverrides;
  zipf?: number;
  /** Promoted from _overrides by build-index; present only in DB blobs */
  false_friend_en?: FalseFriendEn;
  /** Promoted from _overrides by build-index; present only in DB blobs */
  confusable_pairs?: ConfusablePairs;
  // Runtime fields added by build-index.ts (stored in SQLite data blob)
  frequency?: number;
  oscillating_verb?: boolean;
  related?: { file: string; type: string }[];
  compound_parts?: string[];
  compound_of?: { file: string; type: string }[];
  feminine_form?: string;
  masculine_form?: string;
  // POS-specific fields surfaced on WordBase for Vue template access
  // (Vue templates cannot narrow discriminated unions via v-if)
  gender?: "M" | "F" | "N";
  article?: "der" | "die" | "das";
  plural_form?: string | null;
  plural_dominant?: boolean;
  plural_only_note?: string;
  separable?: boolean;
  prefix?: string | null;
}

// --- POS-specific word types ---

export interface NounWord extends WordBase {
  pos: "noun";
  gender: "M" | "F" | "N";
  article: "der" | "die" | "das";
  plural_form: string | null;
  gender_rule: GenderRule | null;
  case_forms: CaseForms;
  case_forms_alt?: CaseFormsAlt;
  plural_dominant?: boolean;
  is_plural_only?: boolean;
  is_singular_only?: boolean;
}

export interface VerbWord extends WordBase {
  pos: "verb";
  auxiliary: "haben" | "sein" | "both" | null;
  separable: boolean;
  prefix: string | null;
  reflexive: "none" | "optional" | "mandatory";
  conjugation_class: "strong" | "weak" | "mixed" | "irregular" | null;
  stems?: VerbStems;
  past_participle: string | null;
  conjugation?: ConjugationTable;
  principal_parts?: PrincipalParts;
  _oscillating?: boolean;
}

export interface AdjectiveWord extends WordBase {
  pos: "adjective";
  is_indeclinable: boolean;
  comparative: string | null;
  superlative: string | null;
  umlaut_in_comparison: boolean;
  declension_stem: string;
  declension_regular: boolean;
  declension?: FullDeclension;
  collocation_nouns?: { M: string | null; F: string | null; N: string | null; Pl: string | null };
  antonym?: WordAntonym | null;
}

export interface AbbreviationWord extends WordBase {
  pos: "abbreviation";
}

export interface PhraseWord extends WordBase {
  pos: "phrase";
}

export interface NameWord extends WordBase {
  pos: "name";
  gender?: "M" | "F" | "N";
  article?: "der" | "die" | "das";
}

/** Generic word for POS types without special fields (adverb, preposition, etc.). */
export interface GenericWord extends WordBase {
  pos: "adverb" | "preposition" | "conjunction" | "particle" | "interjection"
    | "pronoun" | "determiner" | "numeral" | "proper noun";
}

/** Discriminated union of all word types. */
export type Word =
  | NounWord
  | VerbWord
  | AdjectiveWord
  | AbbreviationWord
  | PhraseWord
  | NameWord
  | GenericWord;

// --- Rule types ---

export interface NounGenderRuleEntry {
  id: string;
  type: "suffix" | "nominalized_infinitive";
  pattern: string;
  predicted_gender: "M" | "F" | "N";
  reliability: "always" | "nearly_always" | "high" | "moderate";
  description_en: string;
  description_de: string;
  examples: string[];
  known_exceptions: string[];
  false_matches?: string[];
}

export interface NounGenderRules {
  description: string;
  rules: NounGenderRuleEntry[];
}

export interface AdjEndingsTable {
  description?: string;
  strong: GenderedCaseRows;
  weak: GenderedCaseRows;
  mixed: GenderedCaseRows;
}

export interface VerbEndingsFile {
  description: string;
  persons: string[];
  imperative_persons: string[];
  present: string[];
  subjunctive1: string[];
  weak: { preterite: string[]; subjunctive2: string[]; imperative: string[] };
  strong: { preterite: string[]; subjunctive2: string[]; imperative: string[] };
  mixed: { preterite: string[]; subjunctive2: string[]; imperative: string[] };
}

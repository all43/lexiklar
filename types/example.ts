/** Example and annotation types — shared between pipeline and frontend. */

export interface Annotation {
  form: string;
  lemma: string;
  pos: string;
  gloss_hint: string | null;
}

export interface ExampleProofread {
  translation?: true;
  annotations?: string;
}

export interface Example {
  text: string;
  text_linked?: string;
  translation: string | null;
  translation_model?: string;
  source: string;
  lemmas: string[];
  annotations?: Annotation[];
  type?: "expression" | "proverb";
  ref?: string;
  _proofread?: ExampleProofread;
}

/** A shard is a map from example ID (10 hex chars) to Example. */
export type ExampleShard = Record<string, Example>;

/** All examples loaded into memory. */
export type ExampleMap = Record<string, Example>;

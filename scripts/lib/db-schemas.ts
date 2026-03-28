/** Row from the `meta` table. */
export interface MetaRow {
  key: string;
  value: string;
}

/** Full row from the `words` table (with hash). */
export interface WordRow {
  id: number;
  lemma: string;
  lemma_folded: string;
  pos: string;
  gender: string | null;
  frequency: number | null;
  plural_dominant: number | null;
  plural_form: string | null;
  file: string;
  gloss_en: string | null;
  data: string;
  hash: string;
}

/** Row from the `examples` table. */
export interface ExampleRow {
  id: string;
  data: string;
  hash: string;
}

/** Row from the `word_forms` table. */
export interface WordFormRow {
  form: string;
  word_id: number;
}

/** Row from the `en_terms` table. */
export interface EnTermRow {
  term: string;
  word_id: number;
}

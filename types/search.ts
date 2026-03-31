/** Search and DB result types — used by frontend. */

export interface SearchResult {
  id: number;
  lemma: string;
  pos: string;
  gender: string | null;
  frequency: number | null;
  pluralDominant: boolean;
  pluralForm: string | null;
  superlative: string | null;
  file: string;
  glossEn: string[] | null;
  formMatch?: boolean;
}

export interface WordRow {
  id: number;
  lemma: string;
  lemma_folded: string;
  pos: string;
  gender: string | null;
  frequency: number | null;
  plural_dominant: number | null;
  plural_form: string | null;
  superlative: string | null;
  file: string;
  gloss_en: string | null;
  data: string;
}

export interface ExampleRow {
  id: string;
  data: string;
}

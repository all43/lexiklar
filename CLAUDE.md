# German Dictionary App — Project Context

This file captures all architectural decisions made during initial planning. Drop it in your project root so Claude Code always has full context.

---

## Project Goal

A **fully offline** German dictionary app targeting learners up to **B2 level** (~3,500–5,000 most common words). The key differentiator from existing apps is grammar depth: articles, noun declensions, full verb conjugations, adjective declension tables, and article gender rules with exceptions.

---

## App Name

**Lexiklar**

A coined blend of *Lexikon* (German/English: lexicon/dictionary) + *klar* (German: clear). Transparent meaning in both languages — a German speaker reads it as "clear dictionary", an English speaker intuits it from *lexi-* (lexicon, lexical) + the clean suffix *-klar*.

- No existing brand, product, app, or website uses this name
- No negative connotations in English or German
- Domains (lexiklar.com, lexiklar.de, lexiklar.app) almost certainly available
- Clean SEO slate — any search result will be yours from day one
- Fully ownable as a trademark

---

## Data Source

**Primary: Kaikki.org / wiktextract (Wiktionary structured dump)**
- Machine-readable JSONL export of Wiktionary, updated weekly
- Includes: noun genders, plural forms, all verb conjugations, case declensions
- License: CC BY-SA (free, no purchase required)
- Download URL: https://kaikki.org/dictionary/rawdata.html
- Use the raw wiktextract data (NOT the deprecated postprocessed JSONL files)
- Filter entries by `"lang_code": "de"` in your import script

**Critical format note — gender is not an explicit field:**
The `pos` field (e.g. `"noun"`, `"verb"`, `"adj"`) is a top-level field on every entry. However, **gender is not a structured field** — it must be extracted from `head_templates[].expansion`, which contains strings like `"Schreibtisch m (genitive Schreibtisches...)"`. Parse `m`, `f`, or `n` after the word form using a regex. Example entry structure:
```json
{
  "word": "Schreibtisch",
  "lang": "German",
  "lang_code": "de",
  "pos": "noun",
  "forms": [
    { "form": "Schreibtisches", "tags": ["genitive", "singular"] },
    { "form": "Schreibtische",  "tags": ["plural"] },
    { "form": "Schreibtisch",   "source": "declension", "tags": ["nominative", "singular"] }
  ],
  "head_templates": [
    { "name": "de-noun", "expansion": "Schreibtisch m (genitive Schreibtisches, plural Schreibtische)" }
  ],
  "senses": [
    { "glosses": ["desk"] }
  ]
}
```

**Frequency filtering: Leipzig Corpora Collection**
- Free word frequency data for filtering down to B2 level
- Lets you rank entries by how common they are

**Example sentence enrichment: LLM generation (optional)**
- For words lacking good Wiktionary examples
- Cost estimate: under $1 for 5,000 sentences using Claude Haiku or GPT-4o mini
- Low risk: a slightly imperfect example sentence is not a critical error

**Do NOT use LLMs for grammar data** (articles, conjugations) — hallucination risk is too high for a reference tool.

---

## Linguistic Data Model

Three-layer model separating form, grammar, and meaning:

```
Lemma  →  Lexeme  →  Sense
(form)    (word+POS)  (meaning)
```

- **Lemma**: the written string (`"Bank"`)
- **Lexeme**: lemma + part of speech (`"Bank" [NOUN]`)
- **Sense**: one distinct meaning of a lexeme (`"Bank" → bench` vs `"Bank" → financial institution`)

### Homonym vs Polysemy Decision Rules

| Situation | Decision |
|---|---|
| Same form, same POS, related meanings (*Schloss*: lock / castle) | One lexeme, two senses |
| Same form, same POS, unrelated etymology (*Bank*: bench / institution) | Two separate lexemes |
| Same form, different POS (*laufen* verb / *das Laufen* noun) | Two lexemes, same lemma |
| Verb with drastically different meanings per prefix (*aufheben*) | Separate lexemes per full form |

When in doubt, follow Wiktionary's editorial decision — they've already resolved most cases.

### Synonyms and Antonyms
Link at the **Sense level**, not the Lexeme level. *Schnell* and *rasch* are synonyms in their "speed" sense only.

---

## Grammar Subtypes

### NounGrammar
```json
{
  "gender": "M | F | N",
  "article": "der | die | das",
  "plural_form": "Bänke",
  "plural_rule_id": "optional FK to ArticleRule",
  "is_rule_exception": false,
  "declension_class": "strong | weak | mixed",
  "case_forms": {
    "singular": { "nom": "", "acc": "", "dat": "", "gen": "" },
    "plural":   { "nom": "", "acc": "", "dat": "", "gen": "" }
  }
}
```

### VerbGrammar
```json
{
  "auxiliary": "haben | sein | both",
  "separable": true,
  "prefix": "an",
  "reflexive": "none | mandatory | optional",
  "principal_parts": {
    "infinitive": "ankommen",
    "past_stem": "ankam",
    "past_participle": "angekommen"
  },
  "conjugation": {
    "present":      { "ich": "", "du": "", "er": "", "wir": "", "ihr": "", "sie": "" },
    "preterite":    { "ich": "", "du": "", "er": "", "wir": "", "ihr": "", "sie": "" },
    "subjunctive1": { "ich": "", "du": "", "er": "", "wir": "", "ihr": "", "sie": "" },
    "subjunctive2": { "ich": "", "du": "", "er": "", "wir": "", "ihr": "", "sie": "" },
    "imperative":   { "du": "", "ihr": "", "Sie": "" },
    "participle1": "",
    "participle2": ""
  }
}
```

### AdjGrammar
```json
{
  "is_indeclinable": false,
  "comparative": "schneller",
  "superlative": "schnellst",
  "umlaut_in_comparison": false,
  "declension": {
    "strong": {
      "masc":  { "nom": "", "acc": "", "dat": "", "gen": "" },
      "fem":   { "nom": "", "acc": "", "dat": "", "gen": "" },
      "neut":  { "nom": "", "acc": "", "dat": "", "gen": "" },
      "plural":{ "nom": "", "acc": "", "dat": "", "gen": "" }
    },
    "weak":  "...",
    "mixed": "..."
  }
}
```

### ArticleRule (lookup table)
```json
{
  "id": "rule_ung",
  "pattern": "-ung",
  "description": "Nouns ending in -ung are always feminine",
  "examples": ["Bedeutung", "Hoffnung", "Zeitung"]
}
```

---

## Storage Architecture

**JSON files as source of truth + SQLite as the generated query index.**

### Directory Structure
```
/data
  /nouns/
    Bank_bench.json
    Bank_finance.json
    Tisch.json
  /verbs/
    laufen.json
    ankommen.json
  /adjectives/
    schnell.json
  /index.db          ← generated, not hand-edited
```

### Why JSON files as source of truth
- Flexible per-POS structure — no NULL columns, no forced schema
- Native git version tracking — human-readable diffs per word
- Easy manual corrections and potential community contributions
- Mirrors Kaikki/Wiktionary source structure closely, simplifying import
- Each file is fully self-contained and independently deployable

### SQLite Index Schema (generated at build time)
```sql
CREATE TABLE search_index (
  id          INTEGER PRIMARY KEY,
  lemma       TEXT NOT NULL,
  pos         TEXT NOT NULL,       -- NOUN | VERB | ADJ | ADV
  gender      TEXT,                -- M | F | N, nouns only
  frequency   INTEGER,             -- from Leipzig corpus
  file_path   TEXT NOT NULL        -- pointer to full JSON file
);

CREATE INDEX idx_lemma     ON search_index(lemma);
CREATE INDEX idx_frequency ON search_index(frequency);
CREATE INDEX idx_gender    ON search_index(gender);
```

### Runtime Query Pattern
```
User types "Bank"
  → query search_index WHERE lemma = 'Bank'
  → returns 2 rows (two lexemes), each with file_path
  → load Bank_bench.json and Bank_finance.json for display
```

The SQLite index handles all searching and filtering. The JSON files handle all display rendering. Never query inside the JSON at runtime.

### Build Step
A script (~100 lines) that:
1. Walks all JSON files in `/data`
2. Extracts indexable fields (lemma, pos, gender, frequency)
3. Populates `index.db`
4. Ships both the JSON files and `index.db` bundled in the app

---

## Open Questions to Resolve

**Platform/Language** — not yet decided. This affects the SQLite wrapper, bundling approach, and whether to consider Isar (Flutter) or LokiJS (React Native) as alternatives.

**Adjective declension storage** — 3 declension types × 4 genders × 4 cases = 48 cells per adjective. Consider storing only the stem + declension class and computing forms at runtime to save space, since German adjective endings are largely rule-based.

**Separable verbs** — *aufmachen*, *anrufen* etc. need special handling: the prefix separates in main clauses (*ich mache auf*) but not in subordinate clauses. Decide whether to store separated forms explicitly or derive them from prefix + base verb.

**Reflexive pronouns in examples** — *sich erinnern* requires *ich erinnere mich* in examples. Example sentence structure may need a `reflexive_pronoun_shown` flag.

**Verbal nouns / nominalized infinitives** — *das Laufen* is extremely common in German. Decide: derived entry linked to parent verb, or standalone lexeme?

**Update mechanism** — if the JSON files live in the app bundle, updates require a new app release. Alternative: ship the SQLite index only and allow JSON file packs to be downloaded as optional offline content updates.

---

## Cost Reference (LLM generation, if needed)

| Model | ~Cost for 5,000 example sentences |
|---|---|
| Claude Haiku 3.5 | ~$0.50 |
| GPT-4o mini | ~$0.15 |
| Claude Sonnet | ~$1.80 |

Estimates based on ~150 tokens input / ~100 tokens output per sentence.

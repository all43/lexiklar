---
paths:
  - "scripts/**"
  - "config/**"
---

# Pipeline & Scripts

## Import Pipeline

Five-stage pipeline, each a standalone TypeScript script (run via `npx tsx`):

```
download → transform → enrich → translate → build-index
```

### Scripts

| Script | Command | Purpose |
|---|---|---|
| `scripts/download.ts` | `npm run download` | Downloads and decompresses `de-extract.jsonl.gz` from Kaikki |
| `scripts/transform.ts` | `npm run transform` | Parses JSONL, extracts grammar, writes per-word JSON files (default: B2 filter). Use `--words` to limit scope (see below) |
| `scripts/enrich-frequency.ts` | `npm run enrich` | Downloads 4 frequency corpora, computes Zipf scores, writes absolute `zipf` to word files |
| `scripts/translate-glosses.ts` | `npm run translate-glosses` | LLM-translates German glosses → `gloss_en` (short) and `gloss_en_full` |
| `scripts/translate-examples.ts` | `npm run translate-examples` | LLM-translates examples and adds word annotations |
| `scripts/build-index.ts` | `npm run build-index` | Generates SQLite search index from JSON files |
| `scripts/search-examples.ts` | — | Search example shards by form, lemma, owner, or text |
| `scripts/apply-proofread-results.ts` | — | Apply proofreading results (flags, fixes) from a results JSON file |
| `scripts/lib/sense-ordering.ts` | — | Sense display order rules (`computeSenseOrder`): per-word overrides, Strategy C for nouns, Wiktionary for rest |
| `scripts/lib/corpus.ts` | — | Shared corpus loaders (`loadLeipzigFPM`, `loadSubtlexFPM`, `loadOpensubtitlesFPM`, `toZipf`, `combineZipf`, `loadAllCorpora`) |
| `scripts/generate-synonyms-en.ts` | — | LLM-generates English search synonyms (`synonyms_en`) for reverse lookup |
| `scripts/benchmark-frequency.ts` | — | Benchmark corpus weights against LLM reference scores (Spearman correlation, grid search) |
| `scripts/enrich-collocations.ts` | `npm run enrich-collocations` | Extracts contextual noun collocations from adjective examples for condensed declension view |
| `scripts/publish-update.ts` | — | Generates OTA update manifest + gzipped SQL patches + gzipped DB by diffing old/new DBs (see OTA Updates section) |
| `scripts/fetch-cartoon-subtitles.ts` | — | Downloads German cartoon subtitle files from OpenSubtitles REST API to `data/raw/cartoon-subtitles/` (gitignored). Tracks downloaded `file_id`s in `.downloaded.json` to avoid quota reuse. Credentials: `OPENSUBTITLES_*` in `.env` |
| `scripts/check-cartoon-vocab.ts` | — | Checks subtitle vocabulary coverage against SQLite DB; reports uncovered words as whitelist candidates. Filters noise via `config/cartoon-blocklist.txt`. CLI: `--input`, `--db`, `--min-freq`, `--output`, `--top` |

**IMPORTANT: Do not run a full transform (`npm run transform`) just to re-process a few words.** Use `--words` to scope to specific entries — a full transform touches thousands of files and causes massive git churn:

```bash
# Single word (always re-processes, bypasses hash check)
npx tsx scripts/transform.ts --words schaffen

# Multiple words (comma-separated)
npx tsx scripts/transform.ts --words schaffen,scheren,starten

# From a file (one word per line)
npx tsx scripts/transform.ts --words words.txt

# Combined with --force-pos
npx tsx scripts/transform.ts --words schaffen --force-pos verb

# After changing extraction rules — re-process all existing verbs without pulling in new words
npx tsx scripts/transform.ts --force-pos verb
```

`--words` always bypasses the hash check (explicitly targeted words are always re-processed).
`--force-pos` only re-processes entries already in the dataset (skips words not yet tracked in `.import-state.json`), so it will not introduce new files.

### Frequency Corpora (4 sources)

All four are used by `enrich-frequency.ts` to compute a combined Zipf score. Downloaded automatically via `npm run download-corpus`.

| Corpus | File in `data/raw/` | URL |
|---|---|---|
| Leipzig news (`deu_news_2024_300K`) | `leipzig-words.txt` | `https://downloads.wortschatz-leipzig.de/corpora/deu_news_2024_300K.tar.gz` |
| Leipzig Wikipedia (`deu_wikipedia_2021_300K`) | `leipzig-wiki-words.txt` | `https://downloads.wortschatz-leipzig.de/corpora/deu_wikipedia_2021_300K.tar.gz` |
| SUBTLEX-DE (Brysbaert et al. 2011) | `subtlex-de.xlsx` | `https://osf.io/download/y6ebr/` |
| OpenSubtitles (hermitdave) | `opensubtitles-words.txt` | `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_50k.txt` |

SUBTLEX-DE requires the `xlsx` npm package (already a dependency).

**Use `scripts/lookup.ts` to inspect word data** — never read JSON files directly with `cat`/`Read` when you need to understand a word's full picture (senses, examples, conjugation). The lookup script cross-references word files, examples, and the index.

**IMPORTANT: Never delete word files, example shards, or run `git checkout` on data files without first verifying that no non-derived data will be lost.** Word files contain manually-added data (`_overrides`, `_proofread`, `gloss_en`, `synonyms_en`, `stems`) and example shards contain proofread translations, annotation fixes, and gloss_hint corrections — none of which can be regenerated from the pipeline. Always check `git diff` before discarding changes.

> **Always use existing scripts for data tasks — never write ad-hoc Python scripts or one-time custom code.** The project is TypeScript-first.

---

## Regeneration Safety

The transform step preserves manually-added data when re-running:

- **`_meta.source_hash`** — if source data hasn't changed, the entry is skipped entirely
- **`zipf`** — added by the enrich step, preserved by transform's merge logic
- **`plural_dominant`** — added by the enrich step, preserved by transform's merge logic
- **`collocation_nouns`** — added by `enrich-collocations.ts`, preserved by transform's merge logic. Can be overridden via `_overrides.collocation_nouns` (deep-merged one level)
- **`gloss_en` / `gloss_en_full` / `synonyms_en`** — LLM translations and curated English synonyms in senses, preserved by position-matching merge. Corresponding `*_model` fields are also preserved
- **`data/examples/`** — existing entries with translations and annotations are preserved. Transform keeps the full example object when `translation` is truthy
- **Transform write skip** — word files are not rewritten if content is identical (ignoring `generated_at`). Prevents spurious git churn on incremental re-runs.
- **`_overrides`** (`WordOverrides` interface in `types/word.ts`) — manual corrections to Wiktionary source data. Applied last in `mergeWithExisting()`, after all other merges. Values in `_overrides` win over anything the pipeline produces. For nested objects (e.g. `principal_parts`), merges one level deep; for scalars and arrays, replaces entirely. Never cleared by transform. Special fields read only by `build-index.ts` (not transform): `first_sense`, `sense_order`, `false_friend_en`, `confusable_pairs`. Example: `"_overrides": { "past_participle": "gesehen" }` or `"_overrides": { "first_sense": "with" }`.

`confusable_pairs` schema — `this_note` at top level; counterpart entries have only `en_word` and `other`. `other_note` is NOT stored in source files — `build-index.ts` resolves it from the counterpart's own `this_note` via `lemmaMap` at build time. For homonyms (e.g. `mögen_etwas` / `mögen_jemanden`), the correct file is found by reverse-pair lookup (pairs are always symmetric):
```json
"_overrides": {
  "confusable_pairs": {
    "this_note": "bring — carry toward the destination",
    "pairs": [
      { "en_word": "bring / fetch", "other": "holen" },
      { "en_word": "take / bring", "other": "nehmen" }
    ]
  }
}
```

**Known limitation**: `gloss_en` is merged by sense position. If Wiktionary source adds or removes a sense, `gloss_en` can silently shift to the wrong sense. Only affects entries whose `source_hash` changed.

---

## Manual Word Entries

Words not in the Wiktionary dump can be authored by hand and placed directly in `data/words/{pos}/`. They are identified by `_meta.source: "manual"` and `_meta.source_hash: "manual"`. Use `data/words/nouns/Flusskreuzfahrt.json` as the template.

```json
{
  "word": "Flusskreuzfahrt",
  "pos": "noun",
  ...
  "_meta": {
    "source_hash": "manual",
    "generated_at": "YYYY-MM-DD",
    "source": "manual"
  },
  "zipf": 2.5
}
```

**Pipeline behaviour with manual words:**
- `transform.ts` — never touches manual files. If a manual word later appears in Wiktionary, `mergeWithExisting()` runs and prints a `[manual-word] WIKTIONARY MERGE` warning.
- `enrich-frequency.ts` — skips manual words; their author-set `zipf` is preserved.
- `translate-glosses.ts` / `translate-examples.ts` / `generate-synonyms-en.ts` — process manual words exactly like Wiktionary words.
- `build-index.ts` — indexes manual words exactly like Wiktionary words. Nouns need complete `case_forms`; verbs need `conjugation_class + stems` or a full `conjugation` table.

Also add a `"manual": true` entry to `config/word-whitelist.json` for documentation (no script reads this flag).

---

## Noun Gender Rules

`data/rules/noun-gender.json` — 17 rules predicting noun gender from morphological patterns.

Each rule has:
```json
{
  "id": "suffix_ung",
  "type": "suffix",
  "pattern": "ung",
  "predicted_gender": "F",
  "reliability": "always",
  "description_en": "Nouns ending in -ung are always feminine",
  "description_de": "Substantive auf -ung sind immer feminin",
  "examples": ["Hoffnung", "Zeitung", "Bedeutung"],
  "known_exceptions": []
}
```

### Reliability tiers

| Tier | Meaning | Rules |
|---|---|---|
| `always` | 100%, no exceptions | -ung, -heit, -keit (F); -chen, -lein (N); nominalized infinitives (N) |
| `nearly_always` | ~99%, very rare exceptions | -schaft, -tion, -sion, -tät (F); -ismus, -ist, -ling (M) |
| `high` | 95%+, known exceptions listed | -tum (N, exc: Reichtum, Irrtum); -or (M, exc: Labor); -ei (F, exc: Ei); -anz, -enz (F) |
| `moderate` | 80–90%, not used for matching | -ment, -um (N); -ie, -ik, -ur (F); -eur (M) |

### Matching algorithm (in transform.ts)

1. Check **nominalized infinitive** first — heuristic: uppercase, ends in -en/-eln/-ern, neuter, no plural
2. Check **suffix rules** longest-first — compare predicted vs actual gender
3. Return `null` if no rule matches

Only rules at 95%+ reliability are included. Lower-reliability rules (-ment, -um, -ie, -ik, -ur, -e, -er, Ge- prefix) are excluded but the schema supports adding them later.

---

## Frequency Scoring

Two-phase system: **enrich** writes absolute Zipf scores to word files, **build-index** computes relative ranks at index time.

**Zipf scale**: `log10(FPM) + 3` — normalizes across corpora of different sizes. ~1 = very rare, ~7 = extremely common. FPM (freq per million tokens) is the common denominator.

**Corpus weights**: not all corpora are equally informative. Weights (in `scripts/lib/corpus.ts`): news=1.0, wiki=0.5, subtlex=0.8, osub=0.8. Benchmarked against a 448-word LLM reference set (Spearman rho=0.88).

**Combined Zipf**: weighted mean of Zipf values across corpora. **Missing-corpus penalty**: absent corpora contribute a floor value (1.0 Zipf) at 50% weight — prevents words appearing only in news/wiki from outranking everyday spoken words.

**Storage**: `enrich-frequency.ts` writes the absolute `zipf` score (2 decimal places) to each word JSON file. This is stable — adding/removing words doesn't change existing scores.

**Rank computation**: `build-index.ts` sorts all words by `zipf` descending and assigns rank 1…N into the SQLite `frequency` column at index build time. Ranks are ephemeral and recomputed on every build.

Approximate corpus sizes: Leipzig news ~5.4M tokens, Leipzig Wikipedia ~5.3M, SUBTLEX-DE ~20.9M, OpenSubtitles ~151.7M.

**Word whitelist**: `config/word-whitelist.json` — ~651 entries force-included by the frequency filter regardless of corpus rank.

**Cartoon subtitle noise blocklist**: `config/cartoon-blocklist.txt` — words excluded from whitelist candidate output: inflected pronouns/determiners, inflected adjective forms, filler sounds, character/show names, English/Spanish lyrics, OTT artifacts.

**Diagnostic**: `npx tsx scripts/enrich-frequency.ts --check` prints a comparison table of Zipf per corpus for a set of test words.

**Benchmark**: `npx tsx scripts/benchmark-frequency.ts` — stratified word selection (by POS and Zipf band, skips feminine -in derivatives), loads reference scores from `data/raw/llm-reference-scores.json`, computes per-corpus Spearman correlation, and grid-searches optimal corpus weights (6,561 combinations). Writes markdown reports to `reports/`.

---

## Subagent Proofreading

High-frequency words are verified using Claude Code's built-in model as a subagent (no API credits). The workflow:

1. **Pre-filter examples**: when generating the word list, collect each word's `example_ids` and check shards for `_proofread` status. Only include unproofread example IDs as `check_examples` per word entry.
2. Launch subagent with prompt from `prompts/proofread-subagent.md`, replacing the word list at the bottom
3. Subagent writes `data/proofread-results.json`
4. Apply: `npx tsx scripts/apply-proofread-results.ts --results data/proofread-results-bNN.json --cleanup`

`grammar_override` issues in the results are automatically written as `_overrides` by the apply script, so corrections survive re-transform.

### Text-linked verification

Separate from general proofreading, `text_linked` cross-references can be verified using focused subagents with `prompts/verify-text-linked.md`. Batch files are generated in `data/text-linked-batches/` (gitignored). Each batch contains ~50 examples with flagged links (homonym ambiguity, stale gloss_hints, multi-sense words). Subagent results are applied via `/tmp/apply-text-linked-fixes.ts`.

### quality-check.ts

Proofread filtering: `--skip-proofread` with word-level aspects (`gloss_en`, `gloss_en_full`, `examples_owned`) filters whole words. Example-level aspects (`ex_translation`, `ex_annotations`) don't skip words — they suppress annotation health issues for examples whose `_proofread.annotations` hash still matches.

Workflow:
```bash
npx tsx scripts/quality-check.ts --word-list my-nouns.txt         # review
npx tsx scripts/quality-check.ts --word-list my-nouns.txt --mark-proofread gloss_en,gloss_en_full
npx tsx scripts/quality-check.ts --skip-proofread gloss_en,gloss_en_full  # those words skipped
```

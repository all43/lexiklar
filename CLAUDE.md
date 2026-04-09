# Lexiklar — Project Context

Architectural decisions and implementation reference for the Lexiklar project.
Detailed docs are in `.claude/rules/` (loaded on demand by path).

---

## Project Goal

A **fully offline** German dictionary app targeting learners up to **B2 level** (~3,500–5,000 most common words). The key differentiator from existing apps is grammar depth: articles, noun declensions, full verb conjugations, adjective declension tables, and article gender rules with exceptions.

---

## Tech Stack

- **Language**: TypeScript (Node.js, ESM modules, run via `npx tsx`)
- **Database**: better-sqlite3 for search index generation; native SQLite on iOS/Android via custom Capacitor plugin (`plugins/lexiklar-sqlite/`); sqlite3-wasm in Web Worker on web/PWA
- **Data format**: JSON files as source of truth, SQLite as query index
- **App framework**: Vue 3 + Framework7 + Capacitor
  - **Framework7** (v9) — mobile UI components with adaptive iOS/Material Design theming, built-in router, Virtual List, Searchbar. Chosen over Ionic: regular DOM (not Shadow DOM) makes custom CSS styling easier
  - **Capacitor** — native runtime wrapping the web app for iOS and Android
- **PWA**: `vite-plugin-pwa` (Workbox) for service worker generation, manifest, and offline app shell caching
- **Hosting**: Cloudflare Pages (`lexiklar.app`), R2 (`cdn.lexiklar.app`), Workers (`reports.lexiklar.app`); GitHub Releases for archival

---

## Data Sources

### Primary: Kaikki.org / wiktextract (German Wiktionary dump)

- Machine-readable JSONL export of **German-language Wiktionary** (de.wiktionary.org)
- Download: `https://kaikki.org/dictionary/downloads/de/de-extract.jsonl.gz` (~2.8 GB uncompressed)
- License: CC BY-SA
- Treated as static — download once, re-run pipeline if a newer dump is needed

**Critical: German Wiktionary format differs from English Wiktionary.**
- **No `head_templates`** — gender is in the top-level `tags` array (`["masculine"]`, `["feminine"]`, `["neuter"]`)
- **Two-tier forms** — forms without a `source` field are compact; forms with `source: "Flexion:..."` are from conjugation tables (pronouns embedded in the string)
- **Glosses are in German** — `senses[].glosses` contains German definitions, not English

### Secondary: Frequency Corpora (4 sources)

| Corpus | File in `data/raw/` |
|---|---|
| Leipzig news (`deu_news_2024_300K`) | `leipzig-words.txt` |
| Leipzig Wikipedia (`deu_wikipedia_2021_300K`) | `leipzig-wiki-words.txt` |
| SUBTLEX-DE (Brysbaert et al. 2011) | `subtlex-de.xlsx` |
| OpenSubtitles (hermitdave) | `opensubtitles-words.txt` |

All four used by `enrich-frequency.ts` to compute a combined Zipf score. Downloaded via `npm run download-corpus`.

### LLM-generated content

- **`gloss_en` translations**: short English translations — `scripts/translate-glosses.ts`
- **`gloss_en_full` translations**: longer natural-language English glosses — `scripts/translate-glosses.ts --full`
- **Example translations + annotations**: `scripts/translate-examples.ts`
- **Do NOT use LLMs to generate grammar data** (articles, conjugations) — hallucination risk is too high. Proofreading may correct individual errors via `_overrides`

---

## Key Constraints & Warnings

**IMPORTANT: Do not run a full transform (`npm run transform`) just to re-process a few words.** Use `--words` to scope to specific entries — a full transform touches thousands of files and causes massive git churn.

**IMPORTANT: Never delete word files, example shards, or run `git checkout` on data files without first verifying that no non-derived data will be lost.** Word files contain manually-added data (`_overrides`, `_proofread`, `gloss_en`, `synonyms_en`, `stems`) and example shards contain proofread translations, annotation fixes, and gloss_hint corrections — none of which can be regenerated from the pipeline. Always check `git diff` before discarding changes.

**Use `scripts/lookup.ts` to inspect word data** — never read JSON files directly with `cat`/`Read` when you need to understand a word's full picture.

**Always use existing scripts for data tasks — never write ad-hoc Python scripts or one-time custom code.** The project is TypeScript-first.

---

## Pipeline Overview

Five-stage pipeline, each a standalone TypeScript script (run via `npx tsx`):

```
download → transform → enrich → translate → build-index
```

See `.claude/rules/pipeline.md` for full script reference, `--words` usage, regeneration safety, and `_overrides`.

---

## Detailed Documentation

| Topic | File | Loaded when |
|---|---|---|
| Data model, JSON formats, examples, proofreading | `.claude/rules/data-model.md` | Editing `data/**`, `types/**` |
| Pipeline scripts, regeneration safety, _overrides | `.claude/rules/pipeline.md` | Editing `scripts/**`, `config/**` |
| SQLite schema, search queries, sense ordering | `.claude/rules/schema-and-search.md` | Editing `build-index.ts`, `db.ts`, `SearchPage.vue` |
| App runtime, deep links, PWA, OTA, i18n | `.claude/rules/app-runtime.md` | Editing `src/**`, `plugins/**`, `workers/**` |

---

## Open Questions

**Reflexive pronouns in examples** — *sich erinnern* requires *ich erinnere mich* in examples. Example sentence structure may need a `reflexive_pronoun_shown` flag.

**Empty glosses** — 124 senses across abbreviations, determiners, adverbs, names, phrases have `gloss: ""` in Wiktionary — `gloss_en` stays null. Decide what to show in UI (hide sense? show dash? show word form only?).

See README → LLM Model Reference for the benchmark table. Use `--provider anthropic` (haiku-4.5) for best quality/cost ratio.

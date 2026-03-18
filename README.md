# Lexiklar

**Offline German dictionary for learners up to B2 level.**

Lexiklar = *Lexikon* (lexicon) + *klar* (clear). The differentiator from existing dictionary apps is **grammar depth**: full declension tables, conjugation paradigms, article gender rules with exceptions, and annotated example sentences — all available offline.

---

## Screenshots

<!-- TODO: search results -->
<!-- TODO: noun detail view (declension table) -->
<!-- TODO: verb detail view (conjugation table) -->
<!-- TODO: adjective detail view -->
<!-- TODO: example sentence with word annotations -->

---

## Features

### Vocabulary
- ~21,500 words filtered to B2 level (~3,500–5,000 most common words)
- ~9,800 nouns · ~2,700 verbs · ~1,900 adjectives
- Frequency-ranked using four corpora (Leipzig news, Leipzig Wikipedia, SUBTLEX-DE, OpenSubtitles)
- ~87,500 example sentences with English translations

### Grammar depth
- **Nouns**: article, all 8 case forms (singular + plural), gender rule with exceptions
- **Verbs**: auxiliary (*haben*/*sein*), separability, reflexivity, principal parts, full conjugation (present, preterite, subjunctive I/II, imperative, participles)
- **Adjectives**: comparative, superlative, full 48-cell declension table (strong / weak / mixed × 4 genders × 4 cases)
- **Gender rules**: 17 morphological rules (suffix, nominalized infinitive) with reliability tiers — shown inline so learners understand *why* a word has its gender
- Homonym disambiguation — *Bank* (bench) and *Bank* (financial institution) are separate entries

### Search
- Instant search by lemma, with umlaut-folded accent-insensitive matching (typing `u` finds `ü`)
- Inflected form search — searching *kam* finds *kommen*
- "Did you mean?" suggestions for near-misses

### Example sentences
- Each example annotated with lemma, POS, and gloss hint for every content word
- Tapping an annotated word navigates directly to its dictionary entry
- Sense disambiguation via `gloss_hint` — robust to Wiktionary re-imports

### Fully offline
- Entire dictionary shipped as a single SQLite file (~10 MB)
- No network requests at runtime
- DB cached via Cache API — survives app restarts without re-fetching
- PWA-installable — works offline after first visit, with automatic update prompts

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI framework | Vue 3 + Framework7 v9 |
| Native runtime | Capacitor (iOS, Android) |
| PWA | vite-plugin-pwa (Workbox service worker + manifest) |
| In-app database | SQLite WASM (`@sqlite.org/sqlite-wasm`) |
| Build-time index | better-sqlite3 (Node.js) |
| Data source | Kaikki.org / German Wiktionary dump |
| Persistent settings | `@capacitor/preferences` (UserDefaults / SharedPreferences) |
| Bundler | Vite |

**Why Framework7 over Ionic**: Framework7 uses regular DOM (not Shadow DOM), which makes custom CSS for grammar tables and declension grids significantly easier.

**Why Cache API over OPFS**: `createWritable()` doesn't work in Safari/WKWebView. The Cache API works everywhere.

---

## Architecture

### Data pipeline

```
Kaikki JSONL dump (2.8 GB)
        ↓  transform.ts         parse grammar, filter B2 vocab → per-word JSON files
        ↓  enrich-frequency.ts  compute Zipf scores from 4 corpora
        ↓  translate-glosses.ts LLM: German gloss → short + full English gloss
        ↓  translate-examples.ts LLM: example translations + word annotations
        ↓  build-index.ts       SQLite index (lemmas, forms, frequency ranks, JSON blobs)
```

All scripts are standalone TypeScript modules run via `npx tsx`. The pipeline is crash-safe and incremental — unchanged entries are skipped via SHA-256 content hashing.

### Linguistic data model

Three-layer model separating form, grammar, and meaning:

```
Lemma  →  Lexeme  →  Sense
(form)    (word+POS)  (meaning)
```

Homonyms with unrelated etymology (e.g. *Bank*) get separate lexeme files. Synonyms and antonyms are linked at the sense level, not the lexeme level.

### Frequency scoring

Zipf scale: `log10(FPM) + 3` — normalises across corpora of different sizes. Absolute Zipf scores are written to word files by the enrich step; frequency ranks are computed at index-build time so adding/removing words doesn't churn existing files.

### Runtime query flow

```
User types "Bank"
  → SQLite: WHERE lemma LIKE 'Bank%' OR lemma_folded LIKE 'bank%'
  → also checks word_forms table for inflected form matches
  → returns full word JSON blob from data column
```

The SQLite DB is self-contained — word JSON is stored as blobs so the app needs only the `.db` file at runtime.

### App startup sequence

```
initStorage()   →  preload Preferences keys into sync cache
initDb()        →  load SQLite DB (Cache API → static asset fallback)
Vue.mount()
```

---

## Data Sources

| Source | Used for |
|---|---|
| [Kaikki.org / German Wiktionary](https://kaikki.org/dictionary/downloads/de/) | Grammar, definitions, examples |
| Leipzig news corpus | Frequency scoring |
| Leipzig Wikipedia corpus | Frequency scoring |
| SUBTLEX-DE (Brysbaert et al. 2011) | Frequency scoring |
| OpenSubtitles (hermitdave) | Frequency scoring |

LLM-generated content (English glosses, example translations) uses Claude Haiku 4.5 or GPT-4o-mini. Grammar data is never LLM-generated — hallucination risk is too high.

---

## Running Locally

### Prerequisites

- Node.js 20+
- ~4 GB disk space for raw corpora

### Install

```bash
npm install
```

### Dev (seed words only — fast)

```bash
npm run pipeline:seed   # ~20 curated words covering edge cases
npm run dev
```

### Full pipeline

```bash
npm run pipeline        # download → transform → enrich → translate → build-index
npm run dev
```

### Individual pipeline steps

```bash
npm run download              # download Kaikki JSONL (~2.8 GB)
npm run download-corpus       # download 4 frequency corpora
npm run transform             # parse + filter (B2: --max-frequency 8000)
npm run enrich                # compute Zipf scores
npm run translate-glosses     # LLM → gloss_en (short)
npm run translate-glosses:full # LLM → gloss_en_full (long)
npm run translate-examples    # LLM → translations + annotations
npm run build-index           # generate SQLite DB
```

Requires `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` for translation steps.

### iOS

```bash
npm run build
npx cap sync
npx cap open ios     # opens Xcode
```

### Release

```bash
npm run release:patch   # 0.9.0 → 0.9.1 (bug fixes)
npm run release:minor   # 0.9.0 → 0.10.0 (new features)
npm run release:major   # 0.9.0 → 1.0.0 (public release)
```

---

## Project Structure

```
/
├── src/                    Vue app
│   ├── utils/
│   │   ├── db.ts           SQLite WASM loader + Cache API caching
│   │   └── storage.ts      @capacitor/preferences wrapper with sync cache
│   └── js/
│       ├── i18n.ts         UI localisation (EN + DE)
│       └── theme.ts        Theme utilities
├── scripts/
│   ├── lib/
│   │   ├── llm.ts          LLM abstraction (OpenAI / Anthropic / local)
│   │   └── pos.ts          POS config (dirs, labels)
│   ├── transform.ts
│   ├── enrich-frequency.ts
│   ├── translate-glosses.ts
│   ├── translate-examples.ts
│   └── build-index.ts
├── data/
│   ├── words/              Per-word JSON files (nouns / verbs / adjectives / …)
│   ├── examples/           Shared example sentences (256 shards: 00.json … ff.json)
│   └── rules/              adj-endings.json · noun-gender.json · verb-endings.json
├── config/
│   ├── seed-words.json     ~20 curated words for fast dev iteration
│   └── word-whitelist.json ~430+ force-included words (civic, transport, A1–B2 gaps)
├── public/
│   ├── privacy.html        Privacy policy (served with app build)
│   ├── icon.svg            App icon source (generates PWA PNGs)
│   └── pwa-*.png           Generated PWA icons (192, 512, apple-touch)
└── capacitor.config.json
```

---

## Developer Scripts

> **Always use existing scripts for data tasks — never write ad-hoc Python scripts or one-time custom code.** The project is TypeScript-first; all tooling is in `scripts/`.

### Translation scripts

```bash
# translate-glosses.ts — translate German glosses to English
npx tsx scripts/translate-glosses.ts                          # GPT-4o-mini → gloss_en
npx tsx scripts/translate-glosses.ts --full                   # → gloss_en_full
npx tsx scripts/translate-glosses.ts --provider anthropic     # Claude Haiku 4.5
npx tsx scripts/translate-glosses.ts --provider ollama        # local Ollama (free, offline)
npx tsx scripts/translate-glosses.ts --dry-run                # preview without API calls
npx tsx scripts/translate-glosses.ts --reset --provider ...   # clear all gloss_en, re-translate

# translate-examples.ts — translate examples + annotate words
npx tsx scripts/translate-examples.ts                         # GPT-4o-mini
npx tsx scripts/translate-examples.ts --provider anthropic    # Claude Haiku 4.5
npx tsx scripts/translate-examples.ts --dry-run
npx tsx scripts/translate-examples.ts --batch-size 5
```

### Raw Wiktionary lookup

```bash
npm run lookup -- Tisch              # substring search
npm run lookup -- Tisch --exact      # fast exact match via byte-offset index
npm run lookup -- Tisch --exact --full  # include translations/hyponyms
npm run lookup -- Tisch --pos noun   # filter by POS
```

### Quality check

```bash
npx tsx scripts/quality-check.ts                      # whitelist + top 500 words
npx tsx scripts/quality-check.ts --top 1000
npx tsx scripts/quality-check.ts --word Tisch
npx tsx scripts/quality-check.ts --word-list words.txt
npx tsx scripts/quality-check.ts --pos verb
npx tsx scripts/quality-check.ts --no-examples        # faster, skip example checks
npx tsx scripts/quality-check.ts --show-raw           # print raw Wiktionary entry
npx tsx scripts/quality-check.ts --skip-proofread [aspects]
npx tsx scripts/quality-check.ts --mark-proofread [aspects]
```

Score breakdown (0–100): gloss_en 40 pts · gloss_en_full 20 pts · example translation 20 pts · IPA 10 pts · annotation health 10 pts.

### Search examples

```bash
npx tsx scripts/search-examples.ts --annotation-form nehme --annotation-lemma nehmen
npx tsx scripts/search-examples.ts --owned-by annehmen
npx tsx scripts/search-examples.ts --text "Bahnhof"
npx tsx scripts/search-examples.ts --id 0d8a4f98f3
```

Options: `--annotation-form`, `--annotation-lemma`, `--owned-by`, `--text`, `--id`, `--no-proofread`, `--limit <n>`, `--full`.

### Manual content fixes

`data/manual-fixes.json` is the canonical file for manual corrections:

```bash
npx tsx scripts/apply-proofread-results.ts --results data/manual-fixes.json
```

Supported fix types in the `fixes` array:
- `gloss_fix` — patch a word sense field: `{ type, word, sense, field, value }` (field defaults to `gloss_en`)
- `translation_fix` — patch example translation: `{ type, id, value }`
- `word_field_fix` — patch top-level word field: `{ type, word, field, value }`
- `annotation_replace` — replace full annotations array: `{ type, id, annotations }`
- `annotation_update` — update fields of one annotation by form: `{ type, id, form, updates }`
- `annotation_remove` — remove annotation by form: `{ type, id, form }`

---

## LLM Model Reference

Benchmarked on 37 German idioms using BLEU-1 against human reference translations (`npm run compare-models`).

### Cloud models

| Model | BLEU-1 | ~Cost / 5k items | Notes |
|---|---|---|---|
| anthropic/claude-sonnet-4-5 | 0.823 | ~$5–10 | Best quality |
| openai/gpt-4.1 | 0.810 | ~$5–10 | |
| openai/gpt-4.1-mini | 0.809 | ~$0.50 | Best quality/cost |
| **anthropic/claude-haiku-4-5** | **0.800** | **~$0.50** | **Recommended default** |
| openai/gpt-4.1-nano | 0.740 | ~$0.10 | Budget option |
| openai/gpt-4o-mini | 0.715 | ~$0.15 | Script default (legacy) |

### Local models (free, offline)

| Model | BLEU-1 | Notes |
|---|---|---|
| lm-studio/tower | 0.742 | Translation-specialized |
| lm-studio/sauerkraut | 0.726 | German-tuned |

**Recommendation**: `--provider anthropic` (haiku-4.5) for best quality/cost ratio. Default `gpt-4o-mini` is kept for backwards compatibility.

---

## License

**Code**: MIT — see [LICENSE](LICENSE)

**Dictionary data**: derived from German Wiktionary (via Kaikki.org), licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

**Frequency data**:
- Leipzig Corpora (Uni Leipzig Wortschatz) — CC BY 4.0
- SUBTLEX-DE (Brysbaert et al. 2011) — CC BY 4.0
- OpenSubtitles frequency list (hermitdave) — CC BY 4.0

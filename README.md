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

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI framework | Vue 3 + Framework7 v9 |
| Native runtime | Capacitor (iOS, Android, PWA) |
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
│   └── privacy.html        Privacy policy (served with app build)
└── capacitor.config.json
```

---

## License

**Code**: MIT — see [LICENSE](LICENSE)

**Dictionary data**: derived from German Wiktionary (via Kaikki.org), licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

**Frequency data**:
- Leipzig Corpora (Uni Leipzig Wortschatz) — CC BY 4.0
- SUBTLEX-DE (Brysbaert et al. 2011) — CC BY 4.0
- OpenSubtitles frequency list (hermitdave) — CC BY 4.0

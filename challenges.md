# Lexiklar — Significant Challenges & Solutions

A retrospective of the hardest problems we solved building a fully offline German dictionary app from a Wiktionary data dump to a production-ready PWA/iOS app. 328 commits, ~22,800 word files, ~96K examples.

---

## 1. Parsing German Wiktionary (de-extract.jsonl)

**Problem:** All existing tutorials and tooling target the *English* Wiktionary dump. The German dump (`de-extract.jsonl`, 2.8 GB) has a completely different structure — no `head_templates`, gender buried in top-level `tags`, two-tier form system (compact vs Flexion-sourced), pronouns embedded in form strings, and glosses in German.

**What made it hard:** No documentation existed for the German format. We had to reverse-engineer the structure from raw JSONL lines. Compact forms omit some persons; sourced forms embed pronouns in the string (`"ich laufe"` instead of a clean `"laufe"` + `pronouns: ["ich"]`). Verb entries could have both tiers with contradictory data.

**Solution:** Built a two-pass extraction in `transform.ts` — first pass indexes all entries by byte offset (memory-efficient for 670K lines), second pass reads lazily via `readSync()`. Prioritizes compact forms when available, falls back to sourced forms with pronoun stripping. Gender extracted from `tags` array pattern matching (`["masculine"]` → `"M"`).

---

## 2. Transform Memory Exhaustion

**Problem:** The initial transform loaded all ~670K JSONL lines into memory to group homonyms and resolve gender across entries. Node.js would run out of heap space.

**Solution:** Switched to storing byte offsets instead of full objects. The `genderBuffer` and entry groups Map store only file offsets, reading entries lazily via `readSync()` when needed. Kept memory under 2 GB while processing the full dump.

---

## 3. Dual-Paradigm Verb Extraction

**Problem:** Some German verbs (e.g. *schaffen*) have two conjugation paradigms — strong (*schuf/geschaffen* = "to create") and weak (*schaffte/geschafft* = "to manage"). The Wiktionary dump mixes both paradigms in a single entry's `forms` array with no reliable separator.

**Solution:** Detected paradigm mixing by checking for conflicting past stems (strong vs weak patterns) and split into separate lexeme files with disambiguators. Commit `ec5f17393c` resolved this after multiple iterations.

---

## 4. Frequency Scoring Across 4 Corpora

**Problem:** No single frequency corpus accurately represents what a German learner encounters. News corpora overweight politics/sports; Wikipedia overweights academic terms; subtitle corpora overweight colloquial speech. Combining them naively caused words like *Weltcup* to outrank *Tasse* (cup).

**What made it hard:** The corpora have different sizes (5M to 152M tokens), different coverage rates, and different biases. Simply averaging Zipf scores gave unintuitive rankings.

**Solution:**
- Normalized all corpora to Zipf scale (`log10(FPM) + 3`)
- Benchmarked against a 448-word reference set scored by Claude Opus (Spearman ρ = 0.88)
- Grid-searched 6,561 weight combinations → news=1.0, wiki=0.5, subtlex=0.8, osub=0.8
- Key insight: **missing-corpus penalty** — when a word is absent from a corpus, contribute a floor value (1.0 Zipf) at 50% weight. This correctly penalizes words that only appear in written corpora.
- Result: *Weltcup* dropped from 4.01 → 2.96; *Tasse* rose from 3.76 → 3.84

---

## 5. B2 Word Selection & Coverage Gaps

**Problem:** Filtering by raw frequency missed essential learner vocabulary. Transport words (*Regionalbahn*, *Schienenersatzverkehr*), civic/Einbürgerungstest vocabulary, modern professions (*Fachinformatiker*), device UI terms, and common abbreviations/contractions fell outside the top-8000 frequency cutoff.

**Solution:** Built a curated whitelist (`config/word-whitelist.json`, 430+ entries) spanning transport, civic, education, device UI, app-ui grammar terms, abbreviations, contractions, and modern professions. Whitelist entries bypass the frequency filter entirely. Evolved through multiple rounds of gap analysis.

---

## 6. Safari/WKWebView Storage Compatibility

**Problem:** The initial approach used OPFS (Origin Private File System) with `createWritable()` to cache the SQLite database. This doesn't work in Safari or WKWebView (iOS Capacitor), which was a blocking issue for iOS deployment.

**Solution:** Replaced OPFS with the **Cache API** (`caches.open()`), which works across Safari, WKWebView, and all modern browsers. A version check (`db-version.txt`) determines cache staleness. Falls back to re-fetching from static assets on cache miss.

---

## 7. COOP/COEP Headers and SharedArrayBuffer

**Problem:** sql.js/SQLite WASM typically requires `SharedArrayBuffer`, which needs `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers. GitHub Pages (our deployment target) cannot set custom headers.

**Solution:** Used `sqlite3_deserialize` with plain `ArrayBuffer` instead of `SharedArrayBuffer`. No special headers needed in production. COOP/COEP headers are only set in `vite.config.ts` for local dev.

---

## 8. Search Ranking — Exact vs Prefix vs Inflected vs English

**Problem:** A simple frequency-ordered search gave terrible results. Typing "Bank" would show inflected forms of other words before the exact match. Typing "cup" (English) returned *Weltcup* before *Tasse*.

**What made it hard:** Four search dimensions (German lemma, inflected forms, umlaut-folded, English reverse) needed unified ranking without making the SQLite schema unwieldy.

**Solution:** Multi-tier ranking system evolved over several iterations:
- German search: exact lemma > exact form match > prefix match, frequency-ordered within tiers
- Umlaut folding: `ä→a, ö→o, ü→u, ß→ss` for accent-insensitive matching
- English reverse search (3 tiers): exact `gloss_en` match → exact `en_terms` match → prefix match on `en_terms`
- `en_terms` table (~75K terms) extracted from `gloss_en` + `synonyms_en`, with stopwords and parentheticals stripped
- `gloss_en_full` intentionally excluded from tokenization — compound words like "cupboard" would pollute results

---

## 9. LLM Translation at Scale (87K Examples)

**Problem:** Translating ~87,000 German example sentences to English with word-level annotations and sense-disambiguating `gloss_hint` values. Local models produced unreliable JSON; cloud APIs had rate limits and cost constraints.

**What made it hard:** Each example needed not just a translation but structured annotations — every content word tagged with `form`, `lemma`, `pos`, and `gloss_hint` (for words with multiple senses). LLMs would annotate the English translation instead of the German text, use English lemmas for German nouns, or produce gloss_hints that didn't match any actual sense.

**Solution:**
- JSON Schema structured output for reliable parsing across providers
- Batch processing with configurable chunk sizes (5 for local, larger for cloud)
- `parseResponse` handles both bare arrays and `{ examples: [...] }` wrapping
- Disambiguation dictionary sent alongside each batch (glosses for multi-sense lemmas only)
- Response validation with `looksEnglish` filter (DE_MARKERS + 3-word minimum)
- Completed 99.9% coverage with gpt-4.1-nano at acceptable cost

---

## 10. Stale gloss_hints (38% Breakage)

**Problem:** After proofreading updated `gloss_en` translations, ~38% of `gloss_hint` values in annotations no longer substring-matched any sense. The hints were correct when generated but became stale.

**What made it hard:** gloss_hints are the disambiguation mechanism for cross-references. Breaking them means `text_linked` cross-references in the UI point to wrong senses or fail silently.

**Solution:** Multi-layer fallback in `resolveWordFile()`:
1. Exact substring match against German `gloss`, then `gloss_en`
2. English stemming fallback — strips `-ies/-ied/-ing/-ed/-es/-en/-s` (min stem length 4)
3. Word-level fallback for homonyms — matches hint words against any sense gloss to pick the correct file
- Stemming alone recovered ~17K broken hints
- Remaining synonym mismatches (e.g. hint says "occupation" but gloss now says "profession") are unfixable without regenerating annotations

---

## 11. Proofreading at Scale (54 Batches, 1,123 Words)

**Problem:** LLM-generated translations, glosses, and grammar data needed human-level verification but the dataset was too large for manual review.

**What made it hard:** Subagent output formats were inconsistent — some wrote word paths in `verified`/`translation_ok`, some used note-based fixes, some wrapped objects in arrays. Grammar corrections needed to survive pipeline re-runs (transform regenerates conjugations from source data).

**Solution:**
- Built a subagent proofreading workflow using Claude Code's built-in model (no API credits)
- Standardized prompt (`prompts/proofread-subagent.md`) with replaceable word lists
- Built `apply-proofread-results.ts` to handle all fix types: `gloss_fix`, `translation_fix`, `word_field_fix`, `annotation_replace`, `annotation_update`, `annotation_remove`
- `grammar_override` issues automatically written as `_overrides` (survive re-transform)
- `_proofread` flags track what's been verified; stale flags auto-cleared when source changes
- Completed 54 batches covering 1,123 word files and ~5,531 examples

---

## 12. text_linked Cross-Reference Verification

**Problem:** Auto-generated `text_linked` markup pointed to wrong homonym files (~50 cases), wrong sense numbers (~350 cases), or wrong POS (~20 cases). Example: *Mensch* consistently linked to `Mensch_junge` (young person) instead of `Mensch_lebewesen` (human being).

**What made it hard:** The errors were semantic — you needed to understand the sentence context to know which sense of *sein* (copula vs auxiliary vs "exist") was intended. Automated testing couldn't catch these.

**Solution:**
- Generated verification batches (`data/text-linked-batches/`) targeting high-priority proofread examples
- 19 subagent batches verified 940 examples → 523 fixes applied, 562 confirmed correct
- Added **proofread skip guard** in `build-index.ts` — skips `text_linked` recomputation for examples with `_proofread.annotations` set, preventing verified corrections from being overwritten on rebuild

---

## 13. Homonym File Collisions

**Problem:** When two etymologically unrelated words share the same form and POS (e.g. *Bank* = bench vs financial institution), the file naming scheme `{Word}.json` collides. The disambiguator (first meaningful gloss word) could also collide if glosses were similar.

**Solution:** Disambiguator extraction from the primary German gloss (`Bank_geldinstitut.json` vs `Bank_sitz.json`). Collision detection added to transform — when two entries would produce the same filename, it falls back to deeper gloss analysis. Commit `cea723f156` fixed remaining edge cases.

---

## 14. Separable Verb Display & Oscillating Verbs

**Problem:** German separable verbs (*ankommen* → *ich komme an*) need special treatment everywhere: display, search, conjugation tables, zu-infinitive forms. Some verbs (*übersetzen*) exist in both separable ("to ferry across") and inseparable ("to translate") forms — oscillating verbs.

**Solution:**
- `VerbSepPipe.vue` component — visual separator with directional arrows
- Separable detection from present tense forms (space in conjugated form matching prefix)
- `verb-forms.js` generates zu-infinitives for search index (*anzukommen*)
- `_oscillating` flag set by `build-index.ts` for verbs with opposite-separable siblings
- `⇄` badge and explanatory notes in UI for oscillating pairs

---

## 15. Orphan Example Explosion

**Problem:** The initial pipeline kept all Wiktionary examples, even for words outside the B2 filter. This bloated `examples.json` to ~393K entries, most untranslated and unreferenced.

**Solution:** Identified and removed 306,636 orphan examples (not referenced by any B2 word file). Reduced to ~87K entries. Later sharded into 256 files (`data/examples/<xx>.json`) for better git performance and editor handling.

---

## 16. Expression Deduplication False Positives

**Problem:** German proverbs/expressions with shared consequence clauses were being deduplicated incorrectly. "Wo Frösche sind, da ist auch Wasser" and "Wo Weiden sind, da ist auch Wasser" were merged because comma-stripping canonicalization made them look identical.

**Solution:** Replaced canonicalization with word-level Jaccard similarity (threshold ≥ 0.82). Two expressions must share 82%+ of their words to be considered duplicates, preventing false merges of distinct proverbs that share only a clause.

---

## 17. Regeneration Safety — Preserving Manual Work

**Problem:** Re-running the transform pipeline would overwrite manually-added data: LLM translations (`gloss_en`, `gloss_en_full`), English synonyms (`synonyms_en`), proofreading flags (`_proofread`), manual corrections (`_overrides`), and frequency scores (`zipf`).

**What made it hard:** The merge had to be position-aware for senses (gloss_en is matched by sense position), preserve fields the pipeline doesn't own, apply `_overrides` last (winning over everything), and skip writing entirely when content is unchanged (preventing git churn).

**Solution:** `mergeWithExisting()` in `transform.ts` — reads existing file before overwriting, copies over non-pipeline fields, position-matches sense-level data, applies `_overrides` last. Content-equality check (ignoring `generated_at`) prevents spurious rewrites. `source_hash` change detection skips unchanged entries entirely.

---

## 18. Pluraletantum & Singularetantum Nouns

**Problem:** Some German nouns exist only in plural (*Eltern*, *Leute*) or only in singular (*Milch*, *Hunger*). The declension table rendering and word data model assumed all nouns have both forms.

**Solution:** Detected Pluraletantum (plural-only) and Singularetantum (singular-only) from Wiktionary form data. Added special handling in the declension table UI — showing "kein Plural" / "kein Singular" labels and Wiktionary's explanatory notes when available.

---

## 19. TypeScript Migration

**Problem:** The entire codebase (~30+ scripts, shared libraries, type definitions) was JavaScript. As complexity grew, lack of type safety caused subtle bugs in the pipeline — wrong field access, missing null checks, incorrect function signatures.

**Solution:** Migrated everything to TypeScript in a single commit (`f6a518eb5`). All scripts run via `npx tsx`. Added `types/word.ts` for the word data model. The migration caught several latent bugs through type checking.

---

## 20. PWA on GitHub Pages Without Custom Headers

**Problem:** Making the app work as an installable PWA on GitHub Pages — which doesn't support custom response headers, service worker scope configuration, or server-side routing.

**Solution:** `vite-plugin-pwa` with Workbox `generateSW` mode. Precaches app shell (~2.3 MB), excludes large assets (DB, WASM) handled by runtime caching strategies. `NavigateFallback` to `index.html` for SPA routing. `PwaUpdatePrompt.vue` shows non-intrusive update toast. DB versioning (`db-version.txt`) independent of app version for granular cache invalidation.

---

## 21. LLM Model Quality — Finding the Right Model for Each Task

**Problem:** Different LLM tasks (gloss translation, example sentence translation, idiom translation, annotation generation) have different quality requirements, and models vary wildly in performance. We needed to figure out which model to use where — balancing quality, cost, speed, and offline capability.

**What made it hard:** BLEU-1 scores don't tell the full story — a model can score well on literal sentences but butcher idioms. Local models are free but slow and unreliable with structured output. Cloud APIs have costs that add up across 87K examples. And the "best" model differs by task type.

**Evaluation methodology:** Built `scripts/compare-models.ts` to systematically benchmark models. Three test modes:
- **Fixtures** (37 curated idioms/proverbs) — tests idiomatic understanding
- **Random** — tests general sentence translation
- **Glosses** (30+ German definitions → English) — tests concise definition writing

Reports generated to `reports/` with per-item breakdowns, most-contested examples, and hardest-to-translate items.

**Results across 7 cloud models + local models:**

| Model | BLEU-1 (idioms) | Strength | Weakness |
|:---|---:|:---|:---|
| Sonnet 4.5 | 0.823 | Best overall, natural phrasing | Most expensive |
| GPT-4.1 | 0.810 | Strong idiom sense | Overkill for simple sentences |
| GPT-4.1-mini | 0.809 | Best cost/quality ratio | Slightly weaker on rare idioms |
| Haiku 4.5 | 0.800 | Cheap, reliable, fast | Occasionally too literal |
| GPT-5-mini | 0.798 | Good reasoning | Expensive, temperature=1 only |
| GPT-4.1-nano | 0.740 | Cheapest cloud option | Quality drop on complex items |
| GPT-4o-mini | 0.715 | Legacy baseline | Outdated, not recommended |
| LM Studio Tower 9B | 0.742 | Free, offline | 81s runtime, 1/37 parse fail |

**Concrete quality differences on idioms:**

*"wie aus der Pistole geschossen"* (like a shot):
- GPT-4.1-nano: "Shoot from the hip" (wrong meaning entirely — BLEU 0.00)
- GPT-4o-mini: "like a shot from a gun" (too literal — BLEU 0.50)
- Sonnet 4.5: "quick as a flash" (natural English idiom — BLEU 1.00)

*"Nägel mit Köpfen machen"* (go the whole hog / do a thorough job):
- Every cloud model failed to find the right English idiom — all produced "get down to business/brass tacks" (related but wrong nuance)
- Hardest item across all benchmarks (avg BLEU 0.04)

*"unter einen Hut bringen"* (reconcile competing demands):
- Local Tower 9B: "to get under one's hat" (literal translation, meaningless in English — BLEU 0.20)
- Cloud models: "reconcile" / "bring together" (correct abstract meaning)

**Gloss translation disagreements** revealed model personality differences. For *Bank* (geological formation: "Ablagerung von Material in einem Gewässer"):
- GPT-4.1-mini: "sediment deposit" (descriptive)
- Haiku 4.5: "sandbank" (concise, natural)
- Local Sauerkraut 14B: "sediment deposit" (matched GPT)

Only 45% agreement across models on nuanced gloss translations — showing that even "simple" definition translation has significant subjective variation.

**Final model selection by task:**
- **Bulk example translation (87K sentences):** GPT-4.1-nano — acceptable quality at lowest cost
- **Gloss translation (definitions):** GPT-4.1-mini or Haiku 4.5 — need precision for short labels
- **Idiom/expression translation:** GPT-4.1 — better idiomatic sense, worth the premium
- **Proofreading/verification:** Sonnet (via Claude Code subagent) — highest quality, free via subscription
- **Offline/development:** Local models with JSON Schema enforcement — functional but ~10x slower

**Provider-specific workarounds we had to build:**
- OpenAI: `max_completion_tokens` vs `max_tokens` — sending both causes 400 errors
- Anthropic: ignores JSON Schema, uses tool-use for structured output instead
- Local models: special token leakage (`<|im_start|>`), function-call wrapper confusion, Python dict syntax (single quotes), need smaller batch sizes (3–5 vs 10+)
- JSON extraction cascade: direct parse → markdown fence → function-call wrapper → bracket extraction → Python dict conversion

---

## 22. Multi-Sense Words — Disambiguation Without Stable IDs

**Problem:** German is rich in polysemy — *sein* has 4+ senses (copula, auxiliary, "exist", "be located"), *Bank* has 8+ senses (bench, financial institution, geological formation, sports bench, gambling house...), *Schloss* means both "lock" and "castle". When example sentences reference these words, the system needs to know *which* sense is intended — but Wiktionary provides no stable sense identifiers.

**What made it hard:** Three possible approaches, all flawed:
- `sense_index: 0` — fragile, breaks if Wiktionary reorders senses on re-import
- `sense_id` — requires adding stable IDs to all senses, cascading schema changes
- `gloss_hint` (substring match) — robust to minor wording changes but breaks when translations are updated

We chose `gloss_hint` — a short substring that identifies the intended sense (e.g. `"Möbelstück"` for *Bank* = bench). But 38% of hints went stale after proofreading updated the English translations they originally matched against.

**Solution:** Multi-layer resolution in `resolveWordFile()`:
1. Substring match against German `gloss`, then `gloss_en` (English)
2. English stemming fallback (strips `-ies/-ied/-ing/-ed/-es/-en/-s`, min stem 4 chars) — recovered ~17K stale hints
3. Word-level fallback for homonyms — matches individual hint words against any sense gloss

For the LLM pipeline: `translate-examples.ts` builds a **disambiguation dictionary** from word files (glosses for multi-sense lemmas only) and sends it alongside each batch so the LLM picks the correct `gloss_hint`. This is why hints match at generation time but drift when glosses are later corrected.

The `_proofread.annotations` guard in `build-index.ts` prevents verified sense resolutions from being overwritten on rebuild — critical because the stale hints would re-break the links every time.

---

## 23. Idioms and Cultural Knowledge — Translating the Untranslatable

**Problem:** German idioms, proverbs, and fixed expressions require cultural context that even strong LLMs frequently get wrong. These aren't just translation problems — they're cultural mapping problems where a literal German phrase maps to a completely different English metaphor.

**Examples of systematic failures:**

*"Nägel mit Köpfen machen"* (literally: "make nails with heads") — means "do a thorough job / go the whole hog". Every model (including Sonnet 4.5) translated it as "get down to business/brass tacks" — a related but distinctly different English idiom (starting work vs doing work properly). BLEU-1 avg: 0.04 across all models.

*"jemandem auf den Zahn fühlen"* (literally: "feel someone's tooth") — means "grill/probe someone". Results spanned the full spectrum:
- GPT-4.1-nano: "Pick someone's brain" (wrong — that means seeking knowledge, not interrogating)
- GPT-4.1: "give someone the third degree" (close but overly harsh)
- Haiku/Sonnet: "sound someone out" (correct nuance)

*"doppelt und dreifach"* — models split between literal ("double and triple"), idiomatic ("over and over again"), and creative ("multiple times over"). Only 3/7 models matched any accepted alternative.

**What made it hard:** Reference translations for idioms are inherently subjective — there are often 3–5 valid English equivalents with different registers. BLEU-1 scoring can't capture semantic equivalence ("sweat bullets" vs "be terrified" — same meaning, zero word overlap).

**Solution:**
- **Multi-reference evaluation**: each fixture has a primary translation plus 3–5 accepted alternatives. BLEU-1 is computed against *all* alternatives and takes the max score
- **Idiom-specific model routing**: expressions and proverbs are routed to GPT-4.1 (better idiomatic sense) while regular sentences use the cheaper default model
- **37-item curated idiom benchmark** — hand-picked to cover German-specific cultural references, false friends, and metaphors with no direct English equivalent
- **Human proofreading via subagent** — for the highest-frequency idioms, Claude Sonnet verified translations where automated metrics couldn't judge quality
- **`type: "expression" | "proverb"`** flag on examples — lets the pipeline and UI treat these differently from regular sentences

# Known Issues

Tracking open bugs, design limitations, and pending decisions. Each entry has a severity tag:
`[critical]` · `[medium]` · `[low]` · `[pending-decision]`

---

## Pipeline / Data

### ~~`[medium]` Translated examples orphaned on re-transform/word removal~~ FIXED (2026-03-20)

Two separate causes; both fixed:

**1. Intra-word (Wiktionary changes a sense's examples)**: `mergeSenses()` only carried forward
LLM fields (`gloss_en`, `gloss_en_full`) — not `example_ids`. When Wiktionary removed an example
from a sense, the old translated example became orphaned on re-transform.
**Fix**: `applySenseData()` now appends old `example_ids` absent from the new sense.

**2. Inter-word (owning word removed from dataset)**: `translate-examples.ts` translated ALL
untranslated examples in shards, including those whose owning word was deleted (frequency filter
change, `git clean`, manual removal). The freq filter's fallback `if (!info) return true` kept
unknown-lemma examples, so examples for removed words consumed translation credits and became
translated orphans.
**Fix**: Ownership filter added before translation — skips any example not currently referenced
by a word file's `example_ids` or `expression_ids`. Freq filter fallback changed from keep to
skip for lemmas not in the current dataset.

**Remaining debt**: ~506 translated examples already orphaned before the fix. 169 re-linked in
cleanup (2026-03-20); 80 multi-sense cases need manual sense assignment.

---

### `[medium]` Stale gloss_hints (~38% of annotated examples)

After `gloss_en` translations were updated by proofreading, many `gloss_hint` values in
example annotations no longer substring-match any sense. English stemming fallback in
`build-index.ts` recovers ~17 K; the rest are synonym mismatches (e.g. hint says
`"occupation"` but `gloss_en` now says `"profession"`).

**Impact**: Annotation cross-references (`text_linked`) resolve to no sense or the wrong
sense for affected examples. The UI still shows the example, but the sense link is broken.

**Workaround**: Build-index has a proofread skip guard — if `_proofread.annotations` is set
the stale `text_linked` is frozen and not overwritten by the broken resolver.

**Fix path**: Re-run `translate-examples.ts` to regenerate annotations for affected examples
with the current `gloss_en` values as the disambiguation dict. Expensive (LLM cost).

**See**: CLAUDE.md §Sense disambiguation via `gloss_hint`

---

### `[medium]` `gloss_en` merging is text-based but falls back to nothing when gloss changes

`mergeSenses()` in `scripts/lib/merge.ts` matches old translations to new senses by German
gloss text (exact + Jaccard fuzzy at threshold 0.4). When Wiktionary rewrites a gloss
significantly, the match fails, the translation is orphaned (`_orphaned_translations`), and
`gloss_en` becomes `null` — correct behavior, but silent.

**Edge cases that surface this**:
- Wiktionary splits a single sense into two separate glosses → one inherits the translation,
  one gets `null`
- Wiktionary substantially rewrites a gloss (word-level Jaccard < 0.4) → orphaned even if
  the meaning didn't change
- A sense previously extracted with non-empty gloss now extracts as `""` (no-gloss tag) →
  positional empty-gloss pool applies but only if OLD file also had `""` for that position

**See**: CLAUDE.md §Regeneration Safety; `scripts/lib/merge.ts`

---

### `[medium]` stateKey collision for multiple Wiktionary entries per word+POS

The import state key is `word|pos|etymology_number`. Multiple Wiktionary JSONL entries for
the same word+POS (e.g. two separate "gedacht" verb entries — one form of *denken*, one form
of *gedenken*) share a single stateKey. The last-written entry's hash wins, so on every
subsequent full transform run the other entry's hash mismatches and it gets re-processed.

**Impact**: One of the two files is re-processed on every full transform run (just updating
`generated_at`, no meaningful change). Files for such pairs cannot be permanently skipped via
the state mechanism.

**Known instance**: `gedacht_partizip.json` / `gedacht_perfekt.json` — on each full run one
of them will be re-processed. `gedacht_perfekt.json` in particular cannot be deleted
permanently; it will be recreated by the next `npm run transform`.

**Fix path**: Make stateKey unique per Wiktionary source entry (e.g. include source hash in
the key). Requires careful migration of the existing state file.

---

### `[low]` Empty-gloss sense translation relies on positional order

`mergeSenses()` preserves `gloss_en` for senses with `gloss: ""` by matching them in order
(first old empty-gloss sense → first new empty-gloss sense, etc.). If Wiktionary adds or
removes empty-gloss senses, translations can shift to the wrong position.

**Impact**: Low in practice — entries with multiple empty-gloss senses that all have `gloss_en`
are rare. Broken entries would show visually wrong translations and need manual correction.

---

### `[low]` `_proofread` flags cleared on any source hash change

When `_meta.source_hash` changes (any Wiktionary edit to the source line), both
`_proofread.gloss_en` and `_proofread.gloss_en_full` are cleared, even if the senses
themselves didn't meaningfully change (e.g. only examples or etymology text changed in
Wiktionary). This causes false-positive re-queueing for proofreading.

**Impact**: Minor extra work when reviewing; no data is lost.

---

## Search / Index

### `[low]` `gloss_en_full` not indexed in `en_terms`

Full English glosses (`gloss_en_full`) are intentionally excluded from the `en_terms` reverse
lookup table to avoid noisy single-token matches (e.g. "cupboard" → "cup"). This means
searches for words appearing only in the full gloss don't find the entry.

**See**: CLAUDE.md §SQLite Index Schema

---

## App / UI

### `[pending-decision]` Empty glosses — 124 senses with no UI strategy

124 senses across abbreviations, determiners, adverbs, names, and phrases have `gloss: ""`
in Wiktionary. `gloss_en` stays `null` for these. No decision on what to show in the UI:
hide the sense entirely, show a dash, show the word form only, or show a grammatical label.

---

### `[pending-decision]` Reflexive pronouns in example sentences

Verbs like *sich erinnern* require a reflexive pronoun in usage (*ich erinnere mich*). Example
sentences may or may not include the pronoun depending on the source. No `reflexive_pronoun_shown`
flag exists to let the UI handle this consistently.

---

## Missing Scripts / Infrastructure

### `[low]` `scripts/generate-synonyms-en.ts` not yet built

The `synonyms_en` field and `en_terms` table infrastructure are in place (field added to
`Sense` type, indexed by `build-index.ts`, used in 3-tier reverse search). The script to
populate `synonyms_en` via LLM has not been written yet. Most words have `synonyms_en: null`.

**Partial coverage**: Some high-frequency words (pronouns, function words, determiners) have
`synonyms_en` manually added.

**See**: CLAUDE.md §`synonyms_en` field

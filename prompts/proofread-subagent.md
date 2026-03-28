# Proofreading Subagent Prompt

Used with Claude Code subagents (no API calls, uses built-in model subscription).
Launch via Agent tool with `run_in_background: true`.

---

You are proofreading German dictionary entries for the Lexiklar project. Use your own German knowledge — do NOT make any API calls or use external services.

## How to read data

- **Word files**: use the Read tool on `data/words/{pos}/{word}.json`
- **Examples**: use the Read tool on `data/examples/{xx}.json` (first 2 hex chars of example ID), then search for the ID in the output. **Do NOT use cat/grep/bash to read example shards** — always use the Read tool.
- **Multiple examples**: you can also run `npx tsx scripts/search-examples.ts --id id1,id2,id3 --full` to look up several examples at once.
- **Patching examples**: to fix annotations or translations, use `npx tsx scripts/patch-example.ts <id> [options]` — do NOT write ad-hoc Python scripts. Examples:
  - `npx tsx scripts/patch-example.ts <id> --annotation <lemma> --set-gloss-hint "new hint"`
  - `npx tsx scripts/patch-example.ts <id> --annotation <lemma> --set-lemma "newLemma"`
  - `npx tsx scripts/patch-example.ts <id> --annotation <lemma> --remove`
  - `npx tsx scripts/patch-example.ts <id> --remove-non-content`
  - `npx tsx scripts/patch-example.ts <id> --clean-translation`
  - `npx tsx scripts/patch-example.ts <id> --set-translation "Fixed text"`
  - `npx tsx scripts/patch-example.ts <id> --set-annotations '[{"form":"Hut","lemma":"Hut","pos":"noun","gloss_hint":null}]'`

## What to verify

For each word, read its JSON file from `data/words/{pos}/{word}.json` and referenced example shards.

**IMPORTANT: Only check examples listed in the word list below.** Each word entry may include `check_examples: [id1, id2, ...]` — these are the unproofread example IDs. Only read shard files for these IDs. Skip all other examples owned by the word (they are already proofread). If `check_examples` is absent or not provided, check all examples from `senses[].example_ids`.

For each example that needs verification:
1. **Translation**: Is the English translation accurate and natural?
2. **Annotations**: For each annotation:
   - `form`: word as it appears in the German sentence?
   - `lemma`: correct German dictionary form?
   - `pos`: correct (noun/verb/adjective)?
   - `gloss_hint`: valid substring of `gloss_en` OR `gloss` (German)? English hints matching `gloss_en` are fine. Null is correct for unambiguous single-sense words.

For each word's senses:
3. **Gloss quality**: Is `gloss_en` (1–4 word label) accurate? Is `gloss_en_full` accurate?

For grammatical data (verbs: past_participle, conjugation, principal_parts, separable, auxiliary; nouns: gender, article, case_forms):
4. **Grammar correctness**: Flag as `grammar_override` with `field` + `value` if wrong.

## Results format

Write to `data/proofread-results.json` (overwrite existing):

```json
{
  "verified": ["exId1"],
  "translation_ok": ["exId2"],
  "word_glosses_ok": ["verbs/sagen"],
  "issues": [
    {"id": "exId", "type": "translation", "detail": "..."},
    {"id": "exId", "type": "annotation", "detail": "..."},
    {"word": "verbs/sagen", "type": "gloss", "sense": 0, "detail": "..."},
    {"word": "verbs/stehen", "type": "grammar_override", "field": "past_participle", "value": "gestanden", "detail": "..."}
  ]
}
```

Rules:
- `verified`: BOTH translation AND annotations correct
- `translation_ok`: translation correct but annotation issues
- `word_glosses_ok`: ALL senses have accurate `gloss_en` AND `gloss_en_full`
- Only content words (nouns, verbs, adjectives) are annotated — pronouns/articles/prepositions not expected
- English gloss_hints are fine — they match `gloss_en` at runtime
- `grammar_override` issues carry `field` (dot-notation e.g. `"past_participle"` or `"stems.past"`) and `value` (correct value); applied automatically as `_overrides` by the apply script

## Words to proofread

Replace this section with the current batch of word paths. When `check_examples` is provided, only read and verify those example IDs (others are already proofread). Example:

1. `verbs/sagen` — check_examples: `ff9c6017fd`, `a1b2c3d4e5`
2. `nouns/Kind` — check_examples: `d3e4f5a6b7`
3. `adjectives/groß` (all examples need checking)

Start reading the first word file, then proceed through the list.

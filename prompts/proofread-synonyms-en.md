# Synonyms-en Proofreading Subagent Prompt

Used with Claude Code subagents (no API calls, uses built-in model subscription).
Launch via Agent tool with `run_in_background: true`.

---

You are proofreading English search synonyms (`synonyms_en`) for German dictionary entries in the Lexiklar project. Use your own knowledge — do NOT make any API calls.

## Context

`synonyms_en` is a `string[]` on each sense, containing English search terms for reverse English→German lookup. These were LLM-generated and may have errors:
- **Wrong sense**: synonym belongs to a different sense of the same word or a homonym sibling
- **Wrong meaning**: synonym doesn't accurately describe the sense
- **Missing**: an obvious English search term is absent
- **Redundant**: near-duplicate of another synonym or identical to `gloss_en`

## What to verify

For each word in the list below, read its JSON file from `data/words/{pos}/{word}.json`.

For each sense that has `synonyms_en`:
1. Read `gloss_en` (short label) and `gloss_en_full` (longer description) to understand the sense
2. Check each synonym in `synonyms_en`: does it accurately describe THIS specific sense?
3. Flag synonyms that belong to a different sense or are wrong
4. Note obviously missing search terms (limit to 1-2 per sense, don't over-generate)

**You do NOT need to check glosses, examples, grammar, or annotations.** Only `synonyms_en`.

**Homonym awareness**: If a word has disambiguation suffixes in the filename (e.g. `Bank_geldinstitut`, `Bank_sitz`), be extra careful — synonyms from sibling homonyms often leak across files.

## Results format

Write to the results file specified in the task (e.g. `data/proofread-synonyms-s1.json`):

```json
{
  "word_glosses_ok": ["nouns/Tisch", "verbs/laufen"],
  "fixes": [
    {
      "type": "synonyms_en_fix",
      "word": "nouns/Bank_geldinstitut",
      "sense": 0,
      "value": ["bank", "financial institution"],
      "detail": "removed 'bench' (belongs to Bank_sitz)"
    },
    {
      "type": "synonyms_en_fix",
      "word": "nouns/Kraft",
      "sense": 1,
      "value": ["employee", "worker", "staff member"],
      "detail": "added 'employee' — sense means worker but had no employment-related term"
    }
  ],
  "issues": []
}
```

Rules:
- `word_glosses_ok`: word paths where ALL senses have correct `synonyms_en`. These get `_proofread.synonyms_en: true`
- `fixes` with `type: "synonyms_en_fix"`: carries `word`, `sense` (0-based index), `value` (the COMPLETE corrected array), and `detail`. Applied automatically by the apply script
- `issues`: informational notes that can't be auto-fixed (should be empty in most cases)
- Be conservative with additions — only add truly obvious gaps
- Short common terms are more valuable than long phrases for search
- Only flag issues you're confident about — when unsure, mark word as ok

## Words to proofread

Replace this section with the current batch of word paths.

Start reading the first word file, then proceed through the list.

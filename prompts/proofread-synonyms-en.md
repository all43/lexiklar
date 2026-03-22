# Synonyms-EN Proofreading Subagent Prompt

Used with Claude Code subagents (no API calls, uses built-in model subscription).
Launch via Agent tool with `run_in_background: true`.

---

You are reviewing English search synonyms (`synonyms_en`) for German dictionary entries in the Lexiklar project. These synonyms power English→German reverse search. Use your own German and English knowledge — do NOT make any API calls.

## What to verify

For each word, read its JSON file from `data/words/{pos}/{word}.json`.

Each sense may have a `synonyms_en` array — short English terms/phrases that a learner might type to find this German word. Check:

1. **Accuracy**: Does each synonym genuinely match this specific sense? A synonym for "Bank" (bench) should NOT include "financial institution".
2. **Relevance**: Are synonyms useful search terms a language learner would actually type?
3. **No false friends**: Remove terms that look like synonyms but have different meanings (e.g. "Gift" in German means "poison", not "gift").
4. **No duplicates of gloss_en**: Synonyms should add terms NOT already covered by `gloss_en`. If a synonym is identical to or a substring of `gloss_en`, it's redundant.
5. **Completeness**: Are obvious common synonyms missing? Only flag if a very common alternative is absent.
6. **Related-word contamination**: Wiktionary sometimes lists semantically related but non-synonymous words as synonyms. For example, "table" is related to "chair" but NOT a synonym. Remove these.

Also verify `gloss_en` and `gloss_en_full` if not already proofread (check `_proofread` flags).

## Results format

Write to `data/proofread-results.json` (overwrite existing):

```json
{
  "word_glosses_ok": ["verbs/sagen", "nouns/Tisch"],
  "issues": [
    {"word": "nouns/Bank_sitz", "type": "synonyms_en_fix", "sense": 0, "value": ["bench", "seat", "park bench"], "detail": "removed 'banking' (wrong sense), added 'park bench'"},
    {"word": "nouns/Tisch", "type": "gloss", "sense": 0, "detail": "gloss_en should be 'table' not 'desk'"}
  ]
}
```

Rules:
- `word_glosses_ok`: word paths where ALL synonyms_en, gloss_en, and gloss_en_full are correct
- `synonyms_en_fix`: carries `sense` (0-based), `value` (corrected array), and `detail` (what changed)
- Only flag issues you're confident about — when unsure, mark as ok
- Null `synonyms_en` is fine (not all senses need synonyms)

## Words to proofread

Replace this section with the current batch of word paths. Example:

1. `verbs/sagen`
2. `nouns/Tisch`
3. `adjectives/groß`

Start reading the first word file, then proceed through the list.

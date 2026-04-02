# Gloss Translation Proofreading

Verify English translations (`en`) of German dictionary definitions (`de`). Use your German knowledge — no API calls.

## Input format

Each word has numbered senses with:
- `de` — German definition (Wiktionary, source of truth)
- `en` — short English translation (1-4 words, used for search)
- `en_full` — longer English description (optional, may be null)

## What to check

For each sense:
1. Does `en` accurately capture the core meaning of `de`?
2. Is `en` concise (1-4 words, suitable as a search term)?
3. Are senses that are distinct in German also distinct in English? (avoid duplicate `en` values across senses of the same word)
4. Is `en_full` accurate and natural? (if present)

Common issues:
- Wrong meaning ("to cut" for "schneiden" sense meaning "to intersect")
- Too vague ("thing" for a specific object)
- Duplicate `en` across senses that should be differentiated
- Missing nuance (both "bench" and "financial institution" translated as "bank")

## Output format

Write results to the specified output file:

```json
{
  "ok": ["file1", "file2"],
  "fixes": [
    {
      "file": "nouns/Bank_sitz",
      "sense": 2,
      "field": "en",
      "old": "bank",
      "new": "bench",
      "reason": "This sense is about seating, not finance"
    }
  ]
}
```

- `ok` — files where ALL senses are correct. List the file path.
- `fixes` — individual sense corrections. `field` is `"en"` or `"en_full"`.
- Only flag genuine errors. Minor style differences ("to run" vs "run") are fine — don't fix those.
- If `en` is null, skip it (needs initial translation, not proofreading).

## Batch

REPLACE_WITH_BATCH

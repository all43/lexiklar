# Text-Linked Verification Subagent

Verify cross-reference links in German dictionary example sentences. Use your own German knowledge — do NOT make API calls.

## Context

Each example has `text_linked` containing wiki-style links: `[[form|posDir/file#senseNumber]]`.
- `form` — the word as it appears in the sentence
- `posDir/file` — path to the word file (e.g., `nouns/Idee`, `verbs/gehen`)
- `#N` — optional 1-based sense number within that word file

## What to verify

For each example in the batch, you'll be given:
- The German sentence (`text`)
- The current `text_linked` markup
- A list of **flagged links** — links that may be incorrect, with the reason

For each flagged link, read the referenced word file at `data/words/{posDir}/{file}.json` and check:

1. **Correct file?** Does the link point to the right word? For homonyms (e.g., `Bank_geldinstitut` vs `Bank_sitz`), check which meaning fits the sentence context.
2. **Correct sense number?** If `#N` is present, check that sense N's `gloss`/`gloss_en` matches the meaning used in the sentence. If the `#N` is wrong, provide the correct sense number.
3. **Missing sense number?** If the link has no `#N` but the word has multiple senses, determine which sense fits and provide it.

## Results format

Write to `data/proofread-results-text-linked.json`:

```json
{
  "verified": ["exId1", "exId2"],
  "issues": [
    {
      "id": "exId",
      "type": "text_linked_fix",
      "form": "Idee",
      "old_ref": "nouns/Idee",
      "new_ref": "nouns/Idee#2",
      "detail": "Sense 2 (gloss_en: 'idea') matches the sentence context"
    },
    {
      "id": "exId",
      "type": "text_linked_fix",
      "form": "Bank",
      "old_ref": "nouns/Bank_sitz",
      "new_ref": "nouns/Bank_geldinstitut#1",
      "detail": "Sentence is about financial institution, not bench"
    }
  ]
}
```

Rules:
- `verified`: ALL flagged links in this example are correct as-is
- Only report issues for flagged links — don't check unflagged links
- For sense numbers, count from 1 (first sense = #1)
- If a link points to the wrong file entirely, provide the correct `posDir/file#N`
- If a link just needs a sense number added or corrected, keep the same file path

## Examples to verify


# Golden Fixture Verification

Verify which text_linked variant is correct for each divergent example. Use your German language knowledge.

## Context

Each item has a German sentence with two competing `text_linked` variants:
- **proofread**: previously human-verified (but may be stale if word files changed)
- **resolver**: current programmatic output from annotations

Each conflict shows:
- `form` — the word in the sentence
- `proofread` / `resolver` — the two link variants
- `type` — `sense` (different #N), `path` (different file), `extra` (resolver added a link), `missing` (resolver dropped a link)
- `context.senses` — list of available senses for the target word

## Your task

For each conflict, determine:
1. Read the German sentence and understand how the word is used
2. Check which sense/path matches the meaning in context
3. Decide: `"proofread"`, `"resolver"`, or provide a custom correct link

Also check if the annotation's `gloss_hint` is correct — if it doesn't match the meaning in the sentence, note what it should be.

## Output format

Write results to `data/golden-verification-results.json`:

```json
[
  {
    "id": "exampleId",
    "verdicts": [
      {
        "form": "malte",
        "winner": "proofread",
        "correct_link": "[[malte|verbs/malen#3]]",
        "reason": "In context 'ob sie malte' means drawing/painting pictures, sense 3 (draw) fits better than sense 1 (paint walls)",
        "fix_gloss_hint": null
      },
      {
        "form": "hantierte",
        "winner": "resolver",
        "correct_link": "[[hantierte|verbs/hantieren]]",
        "reason": "Single-sense word, link is correct. Proofread omitted it.",
        "fix_gloss_hint": null
      }
    ]
  }
]
```

Fields:
- `winner`: `"proofread"` | `"resolver"` | `"custom"`
- `correct_link`: the correct `[[form|path#N]]` string
- `reason`: brief explanation of why this sense/path fits the sentence
- `fix_gloss_hint`: if the annotation's `gloss_hint` should be changed, provide the new value; `null` if it's fine or absent

## Important notes

- For `sense` conflicts: read ALL senses in `context.senses` and pick the one matching the sentence meaning
- For `path` conflicts: check if `proofread_path_exists` is false — if so, the proofread is stale and resolver is likely correct
- For `extra` conflicts: if the word exists in the dictionary and the link is valid, the resolver is usually correct (word was added after proofreading)
- For `missing` conflicts: check if the proofread link target still exists — if not, it was removed
- When in doubt between two close senses, prefer the more specific one

## Batch

REPLACE_WITH_BATCH

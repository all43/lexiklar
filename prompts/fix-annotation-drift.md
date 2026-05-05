# Annotation Drift Fix Subagent

Fix cross-reference link divergences in German dictionary example sentences. Use your own German knowledge — do NOT make API calls.

## Context

Each example has annotations that are resolved into `text_linked` markup: `[[form|posDir/file#senseNumber]]`. The resolver uses `gloss_hint` on each annotation to pick the correct sense.

You are given examples where the resolver produces a DIFFERENT result than the proofread baseline. For each divergent link, determine the correct fix.

## Divergence types

### wrong_sense
Same word file, different sense number. Example: proofread says `verbs/wirken#1` but resolver produces `verbs/wirken#3`.

Possible causes:
- **gloss_hint is missing or too vague** → the resolver can't pick the right sense → fix: provide a better gloss_hint
- **gloss_hint matches the wrong sense** → fix: change gloss_hint to match the correct sense's `gloss_en`
- **Proofread baseline is wrong** → the resolver is actually correct → mark as `resolver_correct`

### wrong_path
Different word file entirely (homonyms). Example: proofread says `nouns/Kredit_meist` but resolver produces `nouns/Kredit_konto`.

Possible causes:
- **gloss_hint doesn't disambiguate between homonyms** → fix: provide a gloss_hint that matches the correct file
- **Proofread baseline picked the wrong homonym** → mark as `resolver_correct`

## How to decide

For each divergent link, you are given:
- The German sentence and its English translation
- The word form in context
- The expected (proofread) path + sense
- The actual (resolver) path + sense
- The current `gloss_hint` on the annotation
- All senses from the referenced word file(s) with their `gloss` (German) and `gloss_en` (English)

**Step 1**: Read the sentence and determine which meaning of the word is being used.

**Step 2**: Look at the expected file's senses. Does the expected sense number match the meaning in the sentence?
- If YES → the proofread is correct, the resolver is wrong. Provide a `gloss_hint` fix.
- If NO → check if the resolver's sense matches better. If it does → `resolver_correct`.

**Step 3**: For `gloss_hint` fixes, pick a substring from the correct sense's `gloss_en` that uniquely identifies it among all senses of that word. Keep it short (1-3 words).

## Input format

Each case has:
```json
{
  "id": "example_id",
  "text": "German sentence",
  "translation": "English translation",
  "annotations": [...],
  "expected_text_linked": "[[...]]",
  "actual_text_linked": "[[...]]",
  "divergent_links": [
    {
      "form": "word as it appears",
      "category": "wrong_sense" | "wrong_path",
      "expected_path": "posDir/file",
      "expected_sense": 2,
      "actual_path": "posDir/file",
      "actual_sense": 1,
      "current_gloss_hint": "current hint or null",
      "expected_file": { "path": "...", "senses": [...] },
      "actual_file": { "path": "...", "senses": [...] }
    }
  ]
}
```

## Output format

Write results to `data/annotation-fix-results.json`:

```json
{
  "fixes": [
    {
      "type": "gloss_hint_fix",
      "id": "example_id",
      "form": "word form",
      "new_gloss_hint": "the correct hint",
      "target_path": "posDir/file",
      "target_sense": 2,
      "reason": "brief explanation"
    }
  ],
  "resolver_correct": [
    {
      "id": "example_id",
      "form": "word form",
      "reason": "brief explanation of why resolver is correct"
    }
  ],
  "uncertain": [
    {
      "id": "example_id",
      "form": "word form",
      "reason": "why this case is unclear"
    }
  ]
}
```

### Rules for `new_gloss_hint`:
- Must be a substring (case-insensitive) of the target sense's `gloss_en`
- Keep it short: 1-3 words, enough to uniquely identify the sense
- For wrong_path: the hint must also disambiguate between homonym files
- If `gloss_en` is null, use a substring from `gloss` (German)

### When to use `resolver_correct`:
- The proofread baseline has the wrong sense number (e.g., "Band" meaning ribbon tagged as #3 "girlfriend" when #2 "ribbon" fits)
- The proofread baseline points to the wrong homonym file
- The sentence meaning clearly matches what the resolver produced

### When to use `uncertain`:
- Sentence is ambiguous — multiple senses could apply
- Neither the expected nor the actual sense clearly fits
- Not enough context to determine the correct meaning

## Examples to fix


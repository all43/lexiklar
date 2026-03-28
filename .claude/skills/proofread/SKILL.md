---
name: proofread
description: Launch proofreading subagent batches for unproofread word files
---

# Proofread Batches

Launch proofreading subagent batches for unproofread word files.

## Arguments

- `$ARGUMENTS` — optional: number of batches to launch (default: 8), or "apply" to apply pending results

## Workflow

### Generating batch word lists

Use `scripts/proofread-batches.ts` to find unproofread words (sorted by zipf descending), generate check_examples, and write batch files:

```bash
# Write 10 batch files to /tmp, starting at batch 170, skipping first 300 words (already done)
npx tsx scripts/proofread-batches.ts --start-batch 170 --count 10 --skip 300 --out /tmp

# Or print to stdout for review
npx tsx scripts/proofread-batches.ts --start-batch 170 --count 1 --skip 300
```

To find the right `--skip` value: count already-processed batches × 30 (e.g., b160–b179 = 20 batches × 30 = skip 600).

### Launching subagent batches

For each batch, launch a background Agent with the proofread prompt from `prompts/proofread-subagent.md`, replacing the "Words to proofread" section with the generated word list. Key parameters:

- `subagent_type: "general-purpose"`
- `model: "sonnet"`
- `run_in_background: true`
- Batch naming: `b{N}` where N continues from the last batch number (check existing `data/proofread-results-b*.json` files)
- Results file: `data/proofread-results-b{N}.json`
- Launch ALL batches in a single message (parallel)

### Applying results

When batches complete (or when invoked with "apply"), run:

```bash
npx tsx scripts/apply-proofread-results.ts --results data/proofread-results-b{N}.json --cleanup
```

`--cleanup` deletes the results file if there are no unresolved issues.

### Batch number tracking

To find the next batch number:
```bash
ls data/proofread-results-b*.json 2>/dev/null | sort -t b -k2 -n | tail -1
```
If no files exist, check git log for the last batch mentioned in commit messages.

### Verifying grammar overrides against source data

**Before accepting `grammar_override` issues**, verify against Wiktionary source data. The source is generally correct — most "grammar errors" found by subagents are actually pipeline extraction bugs (already fixed) or valid regional variants.

Use the lookup script to check:
```bash
npx tsx scripts/lookup.ts <word> --exact --pos <pos> --raw > /tmp/lookup.json
```

Then inspect the relevant forms:
```python
import json
with open('/tmp/lookup.json') as f:
    data = json.load(f)
for i, e in enumerate(data):
    tags = e.get('tags', [])
    forms = [f for f in e.get('forms', []) if not f.get('source')
             and any(t in (f.get('tags') or []) for t in ['participle-2', 'past', 'genitive', 'singular'])]
    print(f'[{i}] tags={tags}, forms={[(f["form"], f["tags"]) for f in forms[:10]]}')
```

**Only add grammar overrides when the source data itself is wrong** (rare — Wiktionary is crowdsourced and well-maintained). If the source has the correct form but our pipeline extracted it wrong, fix the pipeline instead.

## Important notes

- **Never run full transform** just to re-process a few words
- Each batch should have ~30 words to stay within subagent context limits
- Default is 8 parallel batches (240 words) — adjust based on available usage
- The subagent prompt tells agents to use their own German knowledge — NO API calls
- After applying, update memory with new batch numbers and stats
- **Grammar overrides**: verify against raw Wiktionary data before accepting (see above)

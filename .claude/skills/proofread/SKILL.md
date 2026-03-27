---
name: proofread
description: Launch proofreading subagent batches for unproofread word files
---

# Proofread Batches

Launch proofreading subagent batches for unproofread word files.

## Arguments

- `$ARGUMENTS` — optional: number of batches to launch (default: 8), or "apply" to apply pending results

## Workflow

### Finding unproofread words

1. Find all word files in `data/words/{nouns,verbs,adjectives}/` that do NOT have `_proofread.gloss_en: true`
2. Sort by `zipf` descending (highest frequency first)
3. Split into batches of 30 words each

### Generating batch word lists

For each word in a batch:
1. Read the word file, collect all `example_ids` from `senses[]`
2. For each example ID, check the shard file (`data/examples/{first 2 hex chars}.json`)
3. If the example does NOT have both `_proofread.translation` and `_proofread.annotations`, include it as `check_examples`
4. If all examples are proofread, mark as "(glosses/grammar only)"

Use Python for this — it's faster than shell for reading JSON shards. See the pattern used in previous sessions (search `/tmp/next-words` in conversation history or use this template):

```python
import json, os, glob

unproofread = []
for pos_dir in ['nouns', 'verbs', 'adjectives']:
    for fpath in sorted(glob.glob(f'data/words/{pos_dir}/*.json')):
        with open(fpath) as f:
            d = json.load(f)
        pr = d.get('_proofread', {})
        if not pr.get('gloss_en'):
            basename = os.path.splitext(os.path.basename(fpath))[0]
            zipf = d.get('zipf', 0)
            unproofread.append((zipf, f'{pos_dir}/{basename}'))

unproofread.sort(key=lambda x: -x[0])
```

Then for each batch word, generate the check_examples list:

```python
for path in batch_words:
    pos, word = path.split('/')
    fpath = f'data/words/{pos}/{word}.json'
    with open(fpath) as f:
        d = json.load(f)
    all_ids = []
    for s in d.get('senses', []):
        all_ids.extend(s.get('example_ids', []))

    unproofread_ids = []
    for eid in all_ids:
        shard_file = f'data/examples/{eid[:2]}.json'
        if os.path.exists(shard_file):
            with open(shard_file) as f:
                sd = json.load(f)
            ex = sd.get(eid, {})
            pr = ex.get('_proofread', {})
            if not (pr.get('translation') and pr.get('annotations')):
                unproofread_ids.append(eid)

    if unproofread_ids:
        print(f'{path} — check_examples: {", ".join(unproofread_ids)}')
    else:
        print(f'{path} (glosses/grammar only)')
```

### Launching subagent batches

For each batch, launch a background Agent with the proofread prompt from `prompts/proofread-subagent.md`, replacing the "Words to proofread" section with the generated word list. Key parameters:

- `subagent_type: "general-purpose"`
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

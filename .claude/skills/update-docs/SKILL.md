---
name: update-docs
description: Review changed code for CLAUDE.md and memory updates, then apply if warranted
---

# Update Docs & Memory

Review recent code changes and update CLAUDE.md and/or memory files if the changes warrant documentation.

## When to run

After implementing a feature, fix, or architectural change — especially changes to:
- Search behavior, DB schema, query patterns
- Pipeline scripts or data model
- App runtime architecture (storage, i18n, PWA, OTA)
- New utilities, components, or conventions
- CI/CD, deployment, or infrastructure

## Workflow

1. **Read recent changes**: Run `git diff HEAD~1` (or `HEAD~N` if multiple commits were made in this session) to understand what changed.

2. **Evaluate CLAUDE.md relevance**: Check whether the change affects sections documented in `CLAUDE.md`. Common sections to check:
   - Runtime Query Pattern (search behavior)
   - SQLite Index Schema (DB changes)
   - App Runtime Architecture (new utils, components)
   - Import Pipeline (script changes)
   - Output File Formats (data model changes)
   - Phrase Discovery (search term tracking)
   - OTA Updates / PWA (deployment changes)

   **Update CLAUDE.md** if:
   - A documented behavior changed (e.g., search now handles articles)
   - A new architectural pattern was introduced
   - A new script, component, or utility was added that others would need to know about

   **Skip CLAUDE.md** if:
   - The change is a simple bug fix with no architectural impact
   - The change is already obvious from reading the code
   - The change is purely cosmetic (CSS tweaks, copy changes)

3. **Evaluate memory relevance**: Read `MEMORY.md` to check if any section needs updating.

   **Update memory** if:
   - A new milestone was completed that future conversations should know about
   - A key file location changed or was added
   - An architecture note needs updating
   - A dataset stat changed significantly
   - A new unresolved issue was discovered

   **Skip memory** if:
   - The change is small and self-contained
   - It doesn't affect how future conversations should approach work
   - It's already covered by CLAUDE.md updates

4. **Apply updates**: Edit the relevant files. Keep entries concise — one line in MEMORY.md, focused paragraphs in CLAUDE.md.

## Guidelines

- Don't document every small change — only things that would save a future conversation from having to re-discover the behavior
- CLAUDE.md is checked into the repo (for all developers); memory is personal (for Claude across conversations)
- When updating MEMORY.md, keep entries under 150 chars and link to detail files if needed
- Don't duplicate between CLAUDE.md and memory — CLAUDE.md for architectural docs, memory for project state and preferences

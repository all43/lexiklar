# Release Notes Guidelines

## File structure

Both platforms use numbered changelogs for history. iOS also keeps `release_notes.txt` as a copy of the latest entry (required by Fastlane/App Store Connect).

```
store/
  ios/
    en-US/
      release_notes.txt   ← always a copy of the latest changelogs/N.txt
      changelogs/
        1.txt, 2.txt, …, N.txt
    de-DE/
      release_notes.txt
      changelogs/
        1.txt, 2.txt, …, N.txt
  android/
    en-US/changelogs/1.txt … N.txt
    de-DE/changelogs/1.txt … N.txt
```

When writing a new release: create `N+1.txt` in all four changelogs dirs, then copy `ios/.../changelogs/N+1.txt` → `ios/.../release_notes.txt`.

## Content rules

**Platform scope** — only mention fixes/changes relevant to that platform. Android-specific fixes (e.g. database compatibility, back button, edge-to-edge display) go in Android only. iOS-specific fixes go in iOS only. Feature additions are shared across both.

**Language** — write for a non-technical user who doesn't know how the app works internally. Avoid technical terms. Use plain user-facing descriptions:
- SQL / SQLite → "word database"
- OTA update / patch / diff → skip entirely or say "faster updates" only if significant
- Wasm / Worker / plugin names → never mention

**Format** — bullet points (`•`) for all entries, no section headers. Short, one line per item.

**Locales** — always write EN and DE versions together. The DE version must be a faithful translation, not paraphrased differently.

**Tone** — describe what the user gets, not what was implemented. "Verb pages now show preposition badges" not "added preposition badge rendering to VerbConjugation.vue".

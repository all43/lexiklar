# App Store Optimisation (ASO) Notes

## Keyword rules — iOS

- 100 characters max per locale, comma-separated, no spaces
- App Store indexes **name + subtitle + keywords** automatically — never waste keyword slots repeating words already in the name or subtitle
- Keywords are indexed **per storefront**, not per device language — a user in Germany with an English-language phone still sees German storefront keywords
- Keywords are **not combined across locales** — "offline" in en-US and "Wörterbuch" in de-DE will not rank for "offline Wörterbuch"
- **The primary locale (en-US) is indexed in all storefronts worldwide** — any term in en-US keywords is already covered globally; never repeat it in another locale
- Each word is counted only once even if it appears in multiple locales for the same storefront — true zero overlap is required to maximise coverage

## Cross-localization — Germany storefront

English (U.K.) is the display localization for **all British-English storefronts** (UK, Australia, Ireland, New Zealand, India…) **and** the secondary fallback for the Germany storefront. So `en-GB` keywords are indexed in every one of those storefronts, *additively on top of* the globally-indexed `en-US` primary. In Germany specifically a user's search is matched against three localizations: de-DE + en-GB + en-US. en-GB is therefore not mere "overflow" — it is the second-most-valuable English surface, so it should hold genuinely good terms (its only constraint is zero overlap with en-US, since en-US is already indexed everywhere en-GB is).

**Setup:** `store/ios/en-GB/` was created as a copy of en-US with:
- `keywords.txt` — entirely different terms from en-US and de-DE (no overlap)
- `description.txt` — British spelling (`favourites`)

To activate: add the en-GB localisation in App Store Connect and copy content from `store/ios/en-GB/`.

## Current keyword strings (iOS)

All three locales have zero keyword overlap to maximise total coverage.

**en-US (98/100)** — targets English-speaking learners (US, UK, Australia…)
```
offline,declension,conjugation,vocabulary,verbs,learn,nouns,gender,translation,adjectives,cases,B1
```

**de-DE (100/100)** — German terms only; en-US primary already covers English terms globally
```
Deklination,Konjugation,Vokabeln,Verben,lernen,Nomen,Genus,Adjektive,Phrasen,Aussprache,Kasus,Sätze
```

**en-GB (97/100)** — also indexed across all British-English storefronts (UK, AU, IE, NZ, IN) **and** Germany; all terms absent from en-US
```
language,study,phrases,trainer,pronunciation,articles,examples,sentences,fluency,wiktionary,A2,B2
```

## What was changed and why (2026-06-03)

**Round 1:** en-US and de-DE both wasted slots on words already covered by the subtitle ("German", "dictionary", "grammar" / "Wörterbuch", "Deutsch", "Grammatik"). Both also included low-signal terms: `B2`, `articles`, `der`, `die`, `das`. Created en-GB for Germany cross-localization.

**Round 2:** Discovered that en-US primary is indexed in all storefronts globally. This meant:
- de-DE had 4 redundant English terms already covered by en-US: `offline`, `dictionary` (in subtitle), `verbs`, `nouns` — replaced with unique German terms: `Phrasen`, `Aussprache`, `Kasus`, `Sätze`
- en-GB had 9 of 11 terms redundant with en-US — rebuilt entirely with terms absent from en-US: `language`, `study`, `phrases`, `learner`, `pronunciation`, `articles`, `examples`, `sentences`, `fluency`, `wiktionary`, `IPA`, `B2`

**Round 3 (level terms + dead-slot cleanup):**
- en-US: `word` (generic, low-signal, sits in the global-primary slot) → `B1`. CEFR level terms are proven high-volume — competitors put `A1`/`A2`/`B1` directly in their app *names* (e.g. "B1-Deutsch", "Learn German Vocab A1 A2 B1"). `B1` is the highest-intent level (Germany integration/citizenship exam + UK learners) and at 2 chars fits without dropping any other term. Placed in en-US so it's indexed in every storefront globally.
- en-GB: `learner` → `trainer` (`learn` in en-US already covers `learner`/`learning` via Apple's stemmer, so that slot was redundant; "german trainer" is a real search). `IPA` (too niche — `pronunciation` already covers the intent) → `A2`.
- Net level coverage: A2 (en-GB) · B1 (en-US, global) · B2 (en-GB). `A1` deliberately skipped — highest raw volume but most saturated and the weakest fit for a declension/conjugation reference. `GCSE` rejected — UK-only, revision-platform intent, no German dictionary/grammar apps target it.

**Total unique keyword coverage: 295 chars across 3 locales with zero overlap.**

## How to verify keyword volume

Per-term search volume is not visible in App Store Connect's metadata editor. The authoritative source is **Apple Search Ads → Search Popularity** (0–100 score per term, free with an ASA account) or a third-party tool (AppTweak, Sensor Tower, MobileAction). Check `b1`, `a2`, `a1`, `trainer`, `gcse` there before any future swaps.

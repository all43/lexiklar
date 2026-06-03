# App Store Optimisation (ASO) Notes

## Keyword rules — iOS

- 100 characters max per locale, comma-separated, no spaces
- App Store indexes **name + subtitle + keywords** automatically — never waste keyword slots repeating words already in the name or subtitle
- Keywords are indexed **per storefront**, not per device language — a user in Germany with an English-language phone still sees German storefront keywords
- Keywords are **not combined across locales** — "offline" in en-US and "Wörterbuch" in de-DE will not rank for "offline Wörterbuch"
- **The primary locale (en-US) is indexed in all storefronts worldwide** — any term in en-US keywords is already covered globally; never repeat it in another locale
- Each word is counted only once even if it appears in multiple locales for the same storefront — true zero overlap is required to maximise coverage

## Cross-localization — Germany storefront

Germany storefront (de-DE) indexes **two locales**: German (de-DE) primary + English UK (en-GB) secondary. Adding an en-GB localization gives a free extra 100 keyword chars indexed in Germany — with zero cost and no visible change to users.

**Setup:** `store/ios/en-GB/` was created as a copy of en-US with:
- `keywords.txt` — entirely different terms from en-US and de-DE (no overlap)
- `description.txt` — British spelling (`favourites`)

To activate: add the en-GB localisation in App Store Connect and copy content from `store/ios/en-GB/`.

## Current keyword strings (iOS)

All three locales have zero keyword overlap to maximise total coverage.

**en-US (100/100)** — targets English-speaking learners (US, UK, Australia…)
```
offline,declension,conjugation,vocabulary,verbs,learn,nouns,gender,translation,adjectives,cases,word
```

**de-DE (100/100)** — German terms only; en-US primary already covers English terms globally
```
Deklination,Konjugation,Vokabeln,Verben,lernen,Nomen,Genus,Adjektive,Phrasen,Aussprache,Kasus,Sätze
```

**en-GB (98/100)** — secondary locale for Germany storefront cross-indexing; all terms absent from en-US
```
language,study,phrases,learner,pronunciation,articles,examples,sentences,fluency,wiktionary,IPA,B2
```

## What was changed and why (2026-06-03)

**Round 1:** en-US and de-DE both wasted slots on words already covered by the subtitle ("German", "dictionary", "grammar" / "Wörterbuch", "Deutsch", "Grammatik"). Both also included low-signal terms: `B2`, `articles`, `der`, `die`, `das`. Created en-GB for Germany cross-localization.

**Round 2:** Discovered that en-US primary is indexed in all storefronts globally. This meant:
- de-DE had 4 redundant English terms already covered by en-US: `offline`, `dictionary` (in subtitle), `verbs`, `nouns` — replaced with unique German terms: `Phrasen`, `Aussprache`, `Kasus`, `Sätze`
- en-GB had 9 of 11 terms redundant with en-US — rebuilt entirely with terms absent from en-US: `language`, `study`, `phrases`, `learner`, `pronunciation`, `articles`, `examples`, `sentences`, `fluency`, `wiktionary`, `IPA`, `B2`

**Total unique keyword coverage: 298 chars across 3 locales with zero overlap.**

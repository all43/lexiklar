# Lexiklar — Roadmap

## App Store Release
- [ ] Publish to App Store (iOS)
- [ ] Publish to Google Play (Android)
- [ ] Add smart app banners for PWA → native redirection
- [ ] App Store description: highlight bundled DB (no download wait), persistent storage (no 7-day eviction risk)

## Native Features
- [ ] Spotlight / system search integration (index words for home screen search)
- [ ] Widget — word of the day or recent lookups

## Data & Content
- [ ] Populate `synonyms_en` at scale (`generate-synonyms-en.ts`)
- [ ] Resolve empty glosses (124 senses with `gloss: ""`)
- [ ] Continue proofreading (216 priority words remaining)

## Accessibility
- [ ] VoiceOver / TalkBack support — label grammar tables and declension cells
- [ ] Adjustable font size — respect iOS Dynamic Type / Android font scale
- [ ] High contrast mode — ensure sufficient contrast ratios for all text and UI elements
- [ ] Fill in App Store Connect accessibility section

## UX
- [ ] Welcome tour — swipeable intro slides (F7 Swiper) for first-time users: key features, grammar depth, offline usage
- [ ] Offline indicator when network unavailable
- [ ] Download progress — show MB downloaded, not just percentage

## Infrastructure
- [ ] Admin dashboard for viewing user reports
- [ ] Monitoring / alerting for R2 and Workers

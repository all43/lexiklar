# Frequency Benchmark Report

- **Model**: openai/claude-sonnet-4-5-20251001
- **Words**: 481 selected, 399 scored
- **Seed**: 42
- **Date**: 2026-03-18

## Word Selection by POS

| POS | Count |
|-----|-------|
| nouns | 294 |
| verbs | 80 |
| adjectives | 56 |
| adverbs | 12 |
| prepositions | 6 |
| conjunctions | 6 |
| particles | 6 |
| pronouns | 6 |
| numerals | 6 |
| interjections | 5 |
| determiners | 4 |

## Corpus Coverage

| Corpus | Words Found | Coverage |
|--------|-------------|----------|
| News | 372/399 | 93.2% |
| Wiki | 373/399 | 93.5% |
| SUBTLEX | 390/399 | 97.7% |
| OSub | 378/399 | 94.7% |

## Per-Corpus Correlation with LLM Reference

| Corpus | Spearman ρ | Pearson r | N |
|--------|-----------|-----------|---|
| News | 0.8293 | 0.8137 | 372 |
| Wiki | 0.7541 | 0.7323 | 373 |
| SUBTLEX | 0.8203 | 0.8283 | 390 |
| OSub | 0.8178 | 0.8395 | 378 |

## Current Production Weights

| news=1 | wiki=0.5 | subtlex=0.8 | osub=0.8 | **ρ = 0.8800** |

## Grid Search — Top 10 Weight Combinations

| # | News | Wiki | SUBTLEX | OSub | Spearman ρ |
|---|------|------|---------|------|-----------|
| 1 | 1.2 | 0 | 0.2 | 1 | 0.8839 |
| 2 | 1 | 0 | 0.2 | 0.8 | 0.8837 |
| 3 | 0.8 | 0 | 0.2 | 0.6 | 0.8836 |
| 4 | 1.5 | 0 | 0 | 1.5 | 0.8836 |
| 5 | 0.2 | 0 | 0 | 0.2 | 0.8836 |
| 6 | 0.4 | 0 | 0 | 0.4 | 0.8836 |
| 7 | 0.6 | 0 | 0 | 0.6 | 0.8836 |
| 8 | 0.8 | 0 | 0 | 0.8 | 0.8836 |
| 9 | 1 | 0 | 0 | 1 | 0.8836 |
| 10 | 1.2 | 0 | 0 | 1.2 | 0.8836 |

## Outliers (LLM score vs current combined Zipf, |Δ| > 1.5)

| Word | POS | LLM | Combined | Δ | News | Wiki | SUBTLEX | OSub |
|------|-----|-----|----------|---|------|------|---------|------|
| Me | nouns | 1.0 | 4.21 | -3.2 | 3.75 | 4.07 | 4.51 | 4.58 |
| norden | verbs | 2.0 | 4.67 | -2.7 | 4.77 | 5.11 | 4.48 | 4.47 |
| Mach | nouns | 2.0 | 4.62 | -2.6 | 3.35 | 3.42 | 5.78 | 5.79 |
| Kate | nouns | 2.0 | 4.43 | -2.4 | 4.34 | 3.83 | 4.71 | 4.62 |
| Lloyd | nouns | 1.5 | 3.89 | -2.4 | 3.57 | 3.86 | 4.20 | 4.02 |
| typen | verbs | 2.0 | 4.21 | -2.2 | 3.57 | 2.57 | 5.16 | 5.08 |
| uni | adjectives | 2.0 | 4.13 | -2.1 | 4.24 | 3.53 | 4.24 | 4.26 |
| söhnen | verbs | 1.5 | 3.50 | -2.0 | 3.47 | 4.11 | 3.29 | 3.38 |
| Eagle | nouns | 1.5 | 3.47 | -2.0 | 3.27 | 3.64 | 3.52 | 3.57 |
| müttern | verbs | 1.5 | 3.42 | -1.9 | 3.47 | 3.42 | 3.36 | 3.41 |
| Arbeitsblatt | nouns | 3.0 | 1.25 | +1.8 | — | — | 1.60 | — |
| Police | nouns | 2.0 | 3.67 | -1.7 | 3.44 | 3.57 | 3.80 | 3.87 |
| Bora | nouns | 1.2 | 2.82 | -1.6 | 2.75 | 2.57 | 2.74 | 3.14 |
| Pierrot | nouns | 1.0 | 2.61 | -1.6 | — | 2.88 | 2.80 | 3.28 |
| Einbürgerungstest | nouns | 2.8 | 1.25 | +1.6 | — | — | 1.60 | — |

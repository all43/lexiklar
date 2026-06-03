/**
 * Client-side search over the static grammar topic list.
 *
 * Matches the query against each topic's title (in BOTH locales) and its
 * curated bilingual keywords, so an English-UI user can find "Akkusativ" and a
 * German-UI user can find "subjunctive". Pure and synchronous — no DB.
 *
 * Matching is TOKEN-aware (not raw substring) so word fragments don't bleed:
 * "wer" must not match inside "be-wer-ben", and a bare preposition in one
 * topic's keywords must not match every phrase that happens to contain it.
 */

import { t, tIn } from "../js/i18n.js";
import { grammarTopics } from "../data/grammar-topics.js";
import { foldUmlauts } from "./text.js";

export interface GrammarHit {
  slug: string;
  /** Title in the current UI locale, for display */
  title: string;
  /** The keyword that matched (for an optional footer hint); omitted for title matches */
  matched?: string;
}

const MAX_HITS = 5;

// Rank tiers — lower sorts first.
const RANK_EXACT = 0;
const RANK_PREFIX = 1;
const RANK_PHRASE = 2;
const NO_MATCH = Infinity;

/** Fold umlauts, then split into lowercase alphanumeric tokens. */
function tokenize(s: string): string[] {
  return foldUmlauts(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Rank how well a query (token array) matches a candidate string's tokens.
 * Returns a tier (lower = better) or NO_MATCH.
 */
function matchTier(qt: string[], ct: string[]): number {
  if (qt.length === 0 || ct.length === 0) return NO_MATCH;

  // Exact: same token sequence.
  if (qt.length === ct.length && qt.every((tok, i) => tok === ct[i])) return RANK_EXACT;

  // Prefix: candidate continues the query (user still typing). All but the last
  // query token match exactly; the last is a prefix of the corresponding token.
  if (ct.length >= qt.length) {
    let ok = true;
    for (let i = 0; i < qt.length - 1; i++) {
      if (qt[i] !== ct[i]) { ok = false; break; }
    }
    if (ok && ct[qt.length - 1].startsWith(qt[qt.length - 1])) return RANK_PREFIX;
  }

  // Phrase: the candidate appears as a whole-token run inside a longer query
  // (e.g. "sich freuen über" contains the keyword "freuen über"). Only multi-
  // token candidates qualify, so a single short keyword can't flood matches.
  if (ct.length >= 2 && ct.length < qt.length) {
    for (let i = 0; i + ct.length <= qt.length; i++) {
      let ok = true;
      for (let j = 0; j < ct.length; j++) {
        if (qt[i + j] !== ct[j]) { ok = false; break; }
      }
      if (ok) return RANK_PHRASE;
    }
  }

  return NO_MATCH;
}

export function searchGrammarTopics(query: string): GrammarHit[] {
  const qt = tokenize(query);
  if (qt.join("").length < 2) return [];

  const scored: { hit: GrammarHit; rank: number; titleHit: boolean }[] = [];

  for (const topic of grammarTopics) {
    let best = NO_MATCH;
    let bestTitle = false;
    let matched: string | undefined;

    // Titles (both locales) — a title hit at the same tier outranks a keyword hit.
    for (const loc of ["en", "de"] as const) {
      const tier = matchTier(qt, tokenize(tIn(loc, topic.titleKey)));
      if (tier < best) { best = tier; bestTitle = true; matched = undefined; }
    }

    for (const kw of [...topic.keywords.en, ...topic.keywords.de]) {
      const tier = matchTier(qt, tokenize(kw));
      if (tier < best || (tier === best && !bestTitle)) {
        best = tier;
        bestTitle = false;
        matched = kw;
      }
    }

    if (best !== NO_MATCH) {
      scored.push({ hit: { slug: topic.slug, title: t(topic.titleKey), matched }, rank: best, titleHit: bestTitle });
    }
  }

  // Sort by tier, then title hits before keyword hits, then keep declared order.
  scored.sort((a, b) => a.rank - b.rank || Number(b.titleHit) - Number(a.titleHit));
  return scored.slice(0, MAX_HITS).map((s) => s.hit);
}

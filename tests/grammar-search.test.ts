import { describe, it, expect } from "vitest";
import { searchGrammarTopics } from "../src/utils/grammar-search.js";

/** Helper: slugs of the hits, in rank order. */
function slugs(q: string): string[] {
  return searchGrammarTopics(q).map((h) => h.slug);
}

describe("searchGrammarTopics", () => {
  it("matches German keywords (Akkusativ → cases)", () => {
    expect(slugs("Akkusativ")[0]).toBe("cases");
  });

  it("matches English keywords (accusative → cases)", () => {
    expect(slugs("accusative")[0]).toBe("cases");
  });

  it("maps subjunctive → konjunktiv", () => {
    expect(slugs("subjunctive")).toContain("konjunktiv");
  });

  it("maps a connector word (weil → connectors)", () => {
    expect(slugs("weil")).toContain("connectors");
  });

  it("maps a modal verb (müssen → modal-verbs)", () => {
    expect(slugs("müssen")).toContain("modal-verbs");
  });

  it("folds umlauts so 'muessen'/'mussen' still hits modal-verbs", () => {
    expect(slugs("mussen")).toContain("modal-verbs");
  });

  it("matches the page title in either locale", () => {
    expect(slugs("reflexive")).toContain("reflexive");
  });

  it("returns nothing for an ordinary word", () => {
    expect(slugs("Tisch")).toHaveLength(0);
  });

  it("matches verb+preposition pairs (warten auf → verb-prepositions)", () => {
    expect(slugs("warten auf")).toEqual(["verb-prepositions"]);
  });

  it("matches abbreviations (K2 → konjunktiv, Partizip II → tenses)", () => {
    expect(slugs("K2")).toContain("konjunktiv");
    expect(slugs("Partizip II")).toContain("tenses");
  });

  it("does not match word fragments — 'bewerben um' must not hit cases via 'wer'", () => {
    // token-aware: 'wer' (a cases keyword) is NOT a token inside 'bewerben'
    const hits = slugs("bewerben um");
    expect(hits).toContain("verb-prepositions");
    expect(hits).not.toContain("cases");
  });

  it("a bare keyword does not bleed into longer queries ('über' only on its own)", () => {
    expect(slugs("über")).toContain("oscillating-verbs");
    expect(slugs("sich freuen über")).not.toContain("oscillating-verbs");
  });

  it("'accusative'/'dative' resolve to cases, not reflexive", () => {
    expect(slugs("accusative")).toEqual(["cases"]);
    expect(slugs("dative")).toEqual(["cases"]);
  });

  it("ignores queries shorter than 2 chars", () => {
    expect(searchGrammarTopics("a")).toHaveLength(0);
    expect(searchGrammarTopics("")).toHaveLength(0);
  });

  it("caps results at 5", () => {
    // "preposition" appears in several topics; result set must stay bounded.
    expect(searchGrammarTopics("preposition").length).toBeLessThanOrEqual(5);
  });

  it("is locale-independent: both the German and English keyword resolve to cases", () => {
    // searchGrammarTopics matches keywords + titles in BOTH locales regardless
    // of the active UI language, so these hold no matter the current locale.
    expect(slugs("Akkusativ")[0]).toBe("cases");
    expect(slugs("accusative")[0]).toBe("cases");
  });

  it("carries the matched keyword for keyword hits", () => {
    const hit = searchGrammarTopics("Akkusativ")[0];
    expect(hit.matched?.toLowerCase()).toBe("akkusativ");
  });
});

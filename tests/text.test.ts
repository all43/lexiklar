import { describe, it, expect } from "vitest";
import { stripOuterQuotes } from "../src/utils/text.js";

// Unicode constants for readability
const LOW9  = "\u201E"; // „  German opening quote
const LEFT6 = "\u201C"; // "  German closing quote
const RAQUO = "\u00BB"; // »  right-pointing guillemet
const LAQUO = "\u00AB"; // «  left-pointing guillemet

describe("stripOuterQuotes", () => {
  // --- Balanced pairs ---

  it("strips German outer quotes when no inner quotes", () => {
    expect(stripOuterQuotes(`${LOW9}Toures Schwagerin betrat den Raum.${LEFT6}`))
      .toBe("Toures Schwagerin betrat den Raum.");
  });

  it("strips where dot precedes closing quote", () => {
    expect(stripOuterQuotes(`${LOW9}Das ist ein Satz.${LEFT6}`))
      .toBe("Das ist ein Satz.");
  });

  it("does NOT strip when inner text contains the same opening quote char", () => {
    // LOW9 ... LOW9 ... LEFT6  — inner LOW9 present
    const text = `${LOW9}pepper${LEFT6} und ${LOW9}butter${LEFT6}`;
    // This string starts with LOW9 and ends with LEFT6, inner has both → no strip
    expect(stripOuterQuotes(text)).toBe(text);
  });

  it("does NOT strip when inner text contains the same closing quote char", () => {
    const text = `${LOW9}Er kaufte ${LOW9}pfeffer${LEFT6}.${LEFT6}`;
    expect(stripOuterQuotes(text)).toBe(text);
  });

  it("strips but preserves inner guillemets of a different type", () => {
    // outer German „…", inner »…« — different pair, safe to strip
    expect(stripOuterQuotes(`${LOW9}Er rief: ${RAQUO}Komm her!${LAQUO}${LEFT6}`))
      .toBe(`Er rief: ${RAQUO}Komm her!${LAQUO}`);
  });

  it("strips right-pointing guillemets when no inner quotes", () => {
    expect(stripOuterQuotes(`${RAQUO}Wenn mir mein Bauchgefuehl sagt, das passt.${LAQUO}`))
      .toBe("Wenn mir mein Bauchgefuehl sagt, das passt.");
  });

  it("strips left-pointing guillemets when no inner quotes", () => {
    expect(stripOuterQuotes(`${LAQUO}Es ist ein flacher Strand.${RAQUO}`))
      .toBe("Es ist ein flacher Strand.");
  });

  it("strips ASCII double quotes when no inner quotes", () => {
    expect(stripOuterQuotes('"A simple sentence."')).toBe("A simple sentence.");
  });

  it("works on text_linked markup — strips outer, keeps [[...|...]] tokens", () => {
    expect(stripOuterQuotes(`${LOW9}Der [[Tisch|nouns/Tisch]] steht in der [[Ecke|nouns/Ecke]].${LEFT6}`))
      .toBe("Der [[Tisch|nouns/Tisch]] steht in der [[Ecke|nouns/Ecke]].");
  });

  // --- Orphaned opening quote ---

  it("strips orphaned opening German quote (no matching close)", () => {
    // Wiktionary truncation artefact — real case from example 5481788565
    expect(stripOuterQuotes(`${LOW9}Trotzdem geraet sein Inneres in Aufruhr.`))
      .toBe("Trotzdem geraet sein Inneres in Aufruhr.");
  });

  it("strips orphaned opening guillemet (no matching close)", () => {
    expect(stripOuterQuotes(`${RAQUO}Text ohne schliessende Guillemet.`))
      .toBe("Text ohne schliessende Guillemet.");
  });

  it("strips orphaned opening ASCII quote (no matching close)", () => {
    expect(stripOuterQuotes(`"Text without closing quote.`))
      .toBe("Text without closing quote.");
  });

  // --- Orphaned closing quote ---

  it("strips orphaned closing German quote (no matching open)", () => {
    expect(stripOuterQuotes(`Text ohne oeffnende Anfuehrungszeichen.${LEFT6}`))
      .toBe("Text ohne oeffnende Anfuehrungszeichen.");
  });

  it("strips orphaned closing guillemet (no matching open)", () => {
    expect(stripOuterQuotes(`Text ohne oeffnende Guillemet.${LAQUO}`))
      .toBe("Text ohne oeffnende Guillemet.");
  });

  // --- False positives — must remain unchanged ---

  it("does not strip when text has no outer quotes", () => {
    expect(stripOuterQuotes("Normaler Satz ohne Anfuehrungszeichen."))
      .toBe("Normaler Satz ohne Anfuehrungszeichen.");
  });

  it("returns empty string unchanged", () => {
    expect(stripOuterQuotes("")).toBe("");
  });

  it("does NOT strip balanced outer with inner quotes even when orphaned check could fire", () => {
    // Starts with LOW9, ends with LEFT6 — balanced check runs first and bails (inner quotes)
    // The orphaned opening check must not run as a fallback
    const text = `${LOW9}Er kaufte ${LOW9}Pfeffer${LEFT6} und ${LOW9}Salz${LEFT6}.${LEFT6}`;
    expect(stripOuterQuotes(text)).toBe(text);
  });

  it("does NOT strip a quote character appearing mid-sentence", () => {
    // No leading/trailing quote — neither balanced nor orphaned check fires
    const text = `Er sagte ${LOW9}Ja${LEFT6} und ging.`;
    expect(stripOuterQuotes(text)).toBe(text);
  });

  it("strips mismatched pair (open from one pair, close from another) when no inner quotes", () => {
    // „...« — opener and closer from different pairs but clearly meant as a pair
    expect(stripOuterQuotes(`${LOW9}Gemischte Zeichen.${LAQUO}`))
      .toBe("Gemischte Zeichen.");
  });

  it("does NOT strip mismatched pair when inner text contains the closer", () => {
    // „Er rief »Ja!«.« — the inner « prevents stripping
    const text = `${LOW9}Er rief ${RAQUO}Ja!${LAQUO}.${LAQUO}`;
    expect(stripOuterQuotes(text)).toBe(text);
  });
});

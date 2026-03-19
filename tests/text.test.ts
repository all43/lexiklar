import { describe, it, expect } from "vitest";
import { stripOuterQuotes } from "../src/utils/text.js";

// Unicode constants for readability
const LOW9  = "\u201E"; // „  German opening quote
const LEFT6 = "\u201C"; // "  German closing quote
const RAQUO = "\u00BB"; // »  right-pointing guillemet
const LAQUO = "\u00AB"; // «  left-pointing guillemet

describe("stripOuterQuotes", () => {
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

  it("does not strip when text has no outer quotes", () => {
    expect(stripOuterQuotes("Normaler Satz ohne Anfuehrungszeichen."))
      .toBe("Normaler Satz ohne Anfuehrungszeichen.");
  });

  it("returns empty string unchanged", () => {
    expect(stripOuterQuotes("")).toBe("");
  });

  it("works on text_linked markup — strips outer, keeps [[...|...]] tokens", () => {
    expect(stripOuterQuotes(`${LOW9}Der [[Tisch|nouns/Tisch]] steht in der [[Ecke|nouns/Ecke]].${LEFT6}`))
      .toBe("Der [[Tisch|nouns/Tisch]] steht in der [[Ecke|nouns/Ecke]].");
  });
});

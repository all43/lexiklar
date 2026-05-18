import { describe, it, expect } from "vitest";
import { findUmlaut, splitUmlaut, splitIrregularPlural } from "../src/utils/umlaut.js";

describe("findUmlaut", () => {
  // ── a → ä ──
  it("detects a→ä (Wald → Wälder)", () => {
    expect(findUmlaut("Wald", "Wälder")).toEqual({ index: 1, length: 1 });
  });

  it("detects a→ä (Arzt → Ärzte)", () => {
    expect(findUmlaut("Arzt", "Ärzte")).toEqual({ index: 0, length: 1 });
  });

  it("detects a→ä (Garten → Gärten)", () => {
    expect(findUmlaut("Garten", "Gärten")).toEqual({ index: 1, length: 1 });
  });

  it("detects a→ä (Schatz → Schätze)", () => {
    expect(findUmlaut("Schatz", "Schätze")).toEqual({ index: 3, length: 1 });
  });

  // ── o → ö ──
  it("detects o→ö (Koch → Köche)", () => {
    expect(findUmlaut("Koch", "Köche")).toEqual({ index: 1, length: 1 });
  });

  it("detects o→ö (Tochter → Töchter)", () => {
    expect(findUmlaut("Tochter", "Töchter")).toEqual({ index: 1, length: 1 });
  });

  it("detects o→ö (Boden → Böden)", () => {
    expect(findUmlaut("Boden", "Böden")).toEqual({ index: 1, length: 1 });
  });

  // ── u → ü ──
  it("detects u→ü (Buch → Bücher)", () => {
    expect(findUmlaut("Buch", "Bücher")).toEqual({ index: 1, length: 1 });
  });

  it("detects u→ü (Mutter → Mütter)", () => {
    expect(findUmlaut("Mutter", "Mütter")).toEqual({ index: 1, length: 1 });
  });

  it("detects u→ü (Stuhl → Stühle)", () => {
    expect(findUmlaut("Stuhl", "Stühle")).toEqual({ index: 2, length: 1 });
  });

  it("detects u→ü (Kuss → Küsse)", () => {
    expect(findUmlaut("Kuss", "Küsse")).toEqual({ index: 1, length: 1 });
  });

  // ── au → äu digraph ──
  it("detects au→äu (Haus → Häuser)", () => {
    expect(findUmlaut("Haus", "Häuser")).toEqual({ index: 1, length: 2 });
  });

  it("detects au→äu (Baum → Bäume)", () => {
    expect(findUmlaut("Baum", "Bäume")).toEqual({ index: 1, length: 2 });
  });

  it("detects au→äu (Lauf → Läufe)", () => {
    expect(findUmlaut("Lauf", "Läufe")).toEqual({ index: 1, length: 2 });
  });

  it("detects au→äu (Traum → Träume)", () => {
    expect(findUmlaut("Traum", "Träume")).toEqual({ index: 2, length: 2 });
  });

  // ── Compound nouns (umlaut in last component) ──
  it("detects umlaut in compound (Krankenhaus → Krankenhäuser)", () => {
    expect(findUmlaut("Krankenhaus", "Krankenhäuser")).toEqual({ index: 8, length: 2 });
  });

  it("detects umlaut in compound (Hauptstadt → Hauptstädte)", () => {
    expect(findUmlaut("Hauptstadt", "Hauptstädte")).toEqual({ index: 7, length: 1 });
  });

  it("detects umlaut in compound (Bahnhof → Bahnhöfe)", () => {
    expect(findUmlaut("Bahnhof", "Bahnhöfe")).toEqual({ index: 5, length: 1 });
  });

  it("detects umlaut in compound (Rathaus → Rathäuser)", () => {
    expect(findUmlaut("Rathaus", "Rathäuser")).toEqual({ index: 4, length: 2 });
  });

  it("detects umlaut in compound (Apfelbaum → Apfelbäume)", () => {
    expect(findUmlaut("Apfelbaum", "Apfelbäume")).toEqual({ index: 6, length: 2 });
  });

  // ── No umlaut (should return null) ──
  it("returns null for simple suffix plural (Hund → Hunde)", () => {
    expect(findUmlaut("Hund", "Hunde")).toBeNull();
  });

  it("returns null for -en plural (Frau → Frauen)", () => {
    expect(findUmlaut("Frau", "Frauen")).toBeNull();
  });

  it("returns null for -er plural without umlaut (Kind → Kinder)", () => {
    expect(findUmlaut("Kind", "Kinder")).toBeNull();
  });

  it("returns null for -s plural (Auto → Autos)", () => {
    expect(findUmlaut("Auto", "Autos")).toBeNull();
  });

  it("returns null for no-change plural (Lehrer → Lehrer)", () => {
    expect(findUmlaut("Lehrer", "Lehrer")).toBeNull();
  });

  it("returns null for -n plural (Junge → Jungen)", () => {
    expect(findUmlaut("Junge", "Jungen")).toBeNull();
  });

  // ── Irregular / foreign plurals (should return null) ──
  it("returns null for Latin plural (Museum → Museen)", () => {
    expect(findUmlaut("Museum", "Museen")).toBeNull();
  });

  it("returns null for foreign plural (Firma → Firmen)", () => {
    expect(findUmlaut("Firma", "Firmen")).toBeNull();
  });

  it("returns null for foreign plural (Thema → Themen)", () => {
    expect(findUmlaut("Thema", "Themen")).toBeNull();
  });

  // ── Edge: uppercase initial ──
  it("detects uppercase A→Ä (Apfel → Äpfel)", () => {
    expect(findUmlaut("Apfel", "Äpfel")).toEqual({ index: 0, length: 1 });
  });
});

describe("splitUmlaut", () => {
  it("splits Häuser correctly", () => {
    expect(splitUmlaut("Haus", "Häuser")).toEqual({
      before: "H",
      umlaut: "äu",
      after: "ser",
    });
  });

  it("splits Wälder correctly", () => {
    expect(splitUmlaut("Wald", "Wälder")).toEqual({
      before: "W",
      umlaut: "ä",
      after: "lder",
    });
  });

  it("splits Bücher correctly", () => {
    expect(splitUmlaut("Buch", "Bücher")).toEqual({
      before: "B",
      umlaut: "ü",
      after: "cher",
    });
  });

  it("splits Äpfel correctly (initial umlaut)", () => {
    expect(splitUmlaut("Apfel", "Äpfel")).toEqual({
      before: "",
      umlaut: "Ä",
      after: "pfel",
    });
  });

  it("splits compound Krankenhäuser correctly", () => {
    expect(splitUmlaut("Krankenhaus", "Krankenhäuser")).toEqual({
      before: "Krankenh",
      umlaut: "äu",
      after: "ser",
    });
  });

  it("returns null for non-umlaut plural", () => {
    expect(splitUmlaut("Hund", "Hunde")).toBeNull();
  });
});

describe("splitIrregularPlural", () => {
  // ── Genuine irregular plurals ──
  it("detects -um → -en (Zentrum → Zentren)", () => {
    expect(splitIrregularPlural("Zentrum", "Zentren")).toEqual({
      prefix: "Zentr", oldEnding: "um", newEnding: "en",
    });
  });

  it("detects -um → -a (Visum → Visa)", () => {
    expect(splitIrregularPlural("Visum", "Visa")).toEqual({
      prefix: "Vis", oldEnding: "um", newEnding: "a",
    });
  });

  it("detects -um → -en (Museum → Museen)", () => {
    expect(splitIrregularPlural("Museum", "Museen")).toEqual({
      prefix: "Muse", oldEnding: "um", newEnding: "en",
    });
  });

  it("detects -us → -en (Rhythmus → Rhythmen)", () => {
    expect(splitIrregularPlural("Rhythmus", "Rhythmen")).toEqual({
      prefix: "Rhythm", oldEnding: "us", newEnding: "en",
    });
  });

  it("detects -us → -i (Bonus → Boni)", () => {
    expect(splitIrregularPlural("Bonus", "Boni")).toEqual({
      prefix: "Bon", oldEnding: "us", newEnding: "i",
    });
  });

  it("detects -a → -en (Firma → Firmen)", () => {
    expect(splitIrregularPlural("Firma", "Firmen")).toEqual({
      prefix: "Firm", oldEnding: "a", newEnding: "en",
    });
  });

  it("detects -a → -en (Thema → Themen)", () => {
    expect(splitIrregularPlural("Thema", "Themen")).toEqual({
      prefix: "Them", oldEnding: "a", newEnding: "en",
    });
  });

  it("detects -is → -en (Praxis → Praxen)", () => {
    expect(splitIrregularPlural("Praxis", "Praxen")).toEqual({
      prefix: "Prax", oldEnding: "is", newEnding: "en",
    });
  });

  it("detects -o → -en (Konto → Konten)", () => {
    expect(splitIrregularPlural("Konto", "Konten")).toEqual({
      prefix: "Kont", oldEnding: "o", newEnding: "en",
    });
  });

  it("detects -on → -en (Stadion → Stadien)", () => {
    expect(splitIrregularPlural("Stadion", "Stadien")).toEqual({
      prefix: "Stadi", oldEnding: "on", newEnding: "en",
    });
  });

  it("detects -on → -a (Lexikon → Lexika)", () => {
    expect(splitIrregularPlural("Lexikon", "Lexika")).toEqual({
      prefix: "Lexik", oldEnding: "on", newEnding: "a",
    });
  });

  it("detects -mann → -leute (Geschäftsmann → Geschäftsleute)", () => {
    expect(splitIrregularPlural("Geschäftsmann", "Geschäftsleute")).toEqual({
      prefix: "Geschäfts", oldEnding: "mann", newEnding: "leute",
    });
  });

  it("detects compound -um → -en (Einkaufszentrum → Einkaufszentren)", () => {
    expect(splitIrregularPlural("Einkaufszentrum", "Einkaufszentren")).toEqual({
      prefix: "Einkaufszentr", oldEnding: "um", newEnding: "en",
    });
  });

  it("detects -o → -i (Cello → Celli)", () => {
    expect(splitIrregularPlural("Cello", "Celli")).toEqual({
      prefix: "Cell", oldEnding: "o", newEnding: "i",
    });
  });

  it("detects -ex → -izes (Index → Indizes)", () => {
    expect(splitIrregularPlural("Index", "Indizes")).toEqual({
      prefix: "Ind", oldEnding: "ex", newEnding: "izes",
    });
  });

  // ── Should NOT detect (umlaut handled separately) ──
  it("returns null for umlaut plural (Haus → Häuser)", () => {
    expect(splitIrregularPlural("Haus", "Häuser")).toBeNull();
  });

  it("returns null for umlaut plural (Arzt → Ärzte)", () => {
    expect(splitIrregularPlural("Arzt", "Ärzte")).toBeNull();
  });

  it("returns null for umlaut plural (Saal → Säle)", () => {
    expect(splitIrregularPlural("Saal", "Säle")).toBeNull();
  });

  // ── Should NOT detect (regular suffix addition) ──
  it("returns null for regular -e suffix (Hund → Hunde)", () => {
    expect(splitIrregularPlural("Hund", "Hunde")).toBeNull();
  });

  it("returns null for regular -en suffix (Frau → Frauen)", () => {
    expect(splitIrregularPlural("Frau", "Frauen")).toBeNull();
  });

  it("returns null for regular -er suffix (Kind → Kinder)", () => {
    expect(splitIrregularPlural("Kind", "Kinder")).toBeNull();
  });

  it("returns null for no-change plural (Lehrer → Lehrer)", () => {
    expect(splitIrregularPlural("Lehrer", "Lehrer")).toBeNull();
  });

  // ── Should NOT detect (substantivized adjectives) ──
  it("returns null for substantivized -r drop (Beamter → Beamte)", () => {
    expect(splitIrregularPlural("Beamter", "Beamte")).toBeNull();
  });

  it("returns null for substantivized -s drop (Dunkles → Dunkle)", () => {
    expect(splitIrregularPlural("Dunkles", "Dunkle")).toBeNull();
  });

  it("returns null for substantivized -r dative (Beamter → Beamten)", () => {
    expect(splitIrregularPlural("Beamter", "Beamten")).toBeNull();
  });

  // ── Should NOT detect (garbage data) ──
  it("returns null for garbage plural (? marker)", () => {
    expect(splitIrregularPlural("Alf", "?")).toBeNull();
  });

  it("returns null for empty strings", () => {
    expect(splitIrregularPlural("", "")).toBeNull();
  });
});

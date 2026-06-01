import { describe, it, expect } from "vitest";
import { detectInsepPrefix } from "../scripts/lib/verb-extract.js";

describe("detectInsepPrefix", () => {
  // ── True positives: must be tagged ──

  it("be-: bekommen → bekommen", () => {
    expect(detectInsepPrefix("bekommen", "bekommen", false, false)).toBe("be");
  });

  it("be-: besuchen → besucht", () => {
    expect(detectInsepPrefix("besuchen", "besucht", false, false)).toBe("be");
  });

  it("be-: beginnen → begonnen", () => {
    expect(detectInsepPrefix("beginnen", "begonnen", false, false)).toBe("be");
  });

  it("ver-: vergessen → vergessen", () => {
    expect(detectInsepPrefix("vergessen", "vergessen", false, false)).toBe("ver");
  });

  it("ver-: verlieren → verloren", () => {
    expect(detectInsepPrefix("verlieren", "verloren", false, false)).toBe("ver");
  });

  it("er-: erklären → erklärt", () => {
    expect(detectInsepPrefix("erklären", "erklärt", false, false)).toBe("er");
  });

  it("er-: erlauben → erlaubt", () => {
    expect(detectInsepPrefix("erlauben", "erlaubt", false, false)).toBe("er");
  });

  it("er-: erzählen → erzählt", () => {
    expect(detectInsepPrefix("erzählen", "erzählt", false, false)).toBe("er");
  });

  it("ent-: entscheiden → entschieden", () => {
    expect(detectInsepPrefix("entscheiden", "entschieden", false, false)).toBe("ent");
  });

  it("ent-: entdecken → entdeckt", () => {
    expect(detectInsepPrefix("entdecken", "entdeckt", false, false)).toBe("ent");
  });

  it("emp-: empfangen → empfangen", () => {
    expect(detectInsepPrefix("empfangen", "empfangen", false, false)).toBe("emp");
  });

  it("emp-: empfehlen → empfohlen", () => {
    expect(detectInsepPrefix("empfehlen", "empfohlen", false, false)).toBe("emp");
  });

  it("zer-: zerstören → zerstört", () => {
    expect(detectInsepPrefix("zerstören", "zerstört", false, false)).toBe("zer");
  });

  it("zer-: zerbrechen → zerbrochen", () => {
    expect(detectInsepPrefix("zerbrechen", "zerbrochen", false, false)).toBe("zer");
  });

  it("miss-: missverstehen → missverstanden", () => {
    expect(detectInsepPrefix("missverstehen", "missverstanden", false, false)).toBe("miss");
  });

  it("miss-: misslingen → misslungen", () => {
    expect(detectInsepPrefix("misslingen", "misslungen", false, false)).toBe("miss");
  });

  // ── False positives: root verbs that start with insep prefix letters ──
  // Detected by ge- in Partizip II

  it("be-: beißen → gebissen (ge- guard)", () => {
    expect(detectInsepPrefix("beißen", "gebissen", false, false)).toBeNull();
  });

  it("be-: beten → gebetet (ge- guard)", () => {
    expect(detectInsepPrefix("beten", "gebetet", false, false)).toBeNull();
  });

  it("be-: bersten → geborsten (ge- guard)", () => {
    expect(detectInsepPrefix("bersten", "geborsten", false, false)).toBeNull();
  });

  it("er-: erben → geerbt (ge- guard)", () => {
    expect(detectInsepPrefix("erben", "geerbt", false, false)).toBeNull();
  });

  // ── Separable verbs: guard must block tagging ──

  it("separable: abbiegen → abgebogen", () => {
    expect(detectInsepPrefix("abbiegen", "abgebogen", true, false)).toBeNull();
  });

  it("separable: ankommen → angekommen", () => {
    expect(detectInsepPrefix("ankommen", "angekommen", true, false)).toBeNull();
  });

  it("separable verb with ver- prefix: vergehen (separable sense)", () => {
    expect(detectInsepPrefix("vergehen", "vergangen", true, false)).toBeNull();
  });

  // ── Oscillating verbs: guard must block tagging ──

  it("oscillating: übersetzen (insep) → übersetzt", () => {
    expect(detectInsepPrefix("übersetzen", "übersetzt", false, true)).toBeNull();
  });

  it("oscillating: misslingen would be guarded if oscillating=true", () => {
    expect(detectInsepPrefix("misslingen", "misslungen", false, true)).toBeNull();
  });

  // ── ge- prefix verbs: not in INSEP_PREFIXES → always null ──

  it("ge-: gehören → gehört (ge- not in prefix list)", () => {
    expect(detectInsepPrefix("gehören", "gehört", false, false)).toBeNull();
  });

  it("ge-: gelingen → gelungen (ge- not in prefix list)", () => {
    expect(detectInsepPrefix("gelingen", "gelungen", false, false)).toBeNull();
  });

  it("ge-: genießen → genossen (ge- not in prefix list)", () => {
    expect(detectInsepPrefix("genießen", "genossen", false, false)).toBeNull();
  });

  // ── Root verbs: no insep prefix ──

  it("laufen → gelaufen", () => {
    expect(detectInsepPrefix("laufen", "gelaufen", false, false)).toBeNull();
  });

  it("kommen → gekommen", () => {
    expect(detectInsepPrefix("kommen", "gekommen", false, false)).toBeNull();
  });

  it("übersetzen (insep, über- not in list) → übersetzt", () => {
    expect(detectInsepPrefix("übersetzen", "übersetzt", false, false)).toBeNull();
  });

  it("null past_participle → null", () => {
    expect(detectInsepPrefix("bekommen", null, false, false)).toBeNull();
  });
});

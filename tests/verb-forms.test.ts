import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { computeConjugation, computeAllForms } from "../src/utils/verb-forms.js";
import type { VerbWord, VerbEndingsFile, ConjugationTable } from "../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const endings: VerbEndingsFile = JSON.parse(
  readFileSync(join(ROOT, "data/rules/verb-endings.json"), "utf-8"),
);

function loadVerb(name: string): VerbWord {
  return JSON.parse(
    readFileSync(join(ROOT, `data/words/verbs/${name}.json`), "utf-8"),
  );
}

// ============================================================
// computeConjugation
// ============================================================

describe("computeConjugation", () => {
  // --- Weak verbs ---

  describe("weak verbs", () => {
    it("machen — basic weak conjugation", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("machen"), endings);

      expect(conj.present).toEqual({
        ich: "mache", du: "machst", er: "macht",
        wir: "machen", ihr: "macht", sie: "machen",
      });
      expect(conj.preterite.ich).toBe("machte");
      expect(conj.preterite.du).toBe("machtest");
      expect(conj.imperative.du).toBe("mache!");
      expect(conj.imperative.ihr).toBe("macht!");
      expect(conj.imperative.Sie).toBe("machen Sie!");
      expect(conj.participle1).toBe("machend");
      expect(conj.participle2).toBe("gemacht");
    });

    it("erinnern — -ern stem adjustments", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("erinnern"), endings);

      expect(conj.present.ich).toBe("erinnere");
      expect(conj.present.du).toBe("erinnerst");
      expect(conj.present.er).toBe("erinnert");
      expect(conj.present.wir).toBe("erinnern");
      expect(conj.present.sie).toBe("erinnern");
      expect(conj.participle1).toBe("erinnernd");
    });

    it("arbeiten — -t stem with e-insertion", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("arbeiten"), endings);

      expect(conj.present.du).toBe("arbeitest");
      expect(conj.present.er).toBe("arbeitet");
      expect(conj.present.ihr).toBe("arbeitet");
      expect(conj.present.ich).toBe("arbeite");
      expect(conj.preterite.ich).toBe("arbeitete");
      expect(conj.preterite.du).toBe("arbeitetest");
      expect(conj.imperative.du).toBe("arbeite!");
    });

    it("ordnen — -dn stem with e-insertion", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("ordnen"), endings);

      expect(conj.present.du).toBe("ordnest");    // e-insertion for dn cluster
      expect(conj.present.er).toBe("ordnet");
      expect(conj.present.ihr).toBe("ordnet");
    });

    it("trocknen — -kn stem with e-insertion", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("trocknen"), endings);

      expect(conj.present.du).toBe("trocknest");  // e-insertion for kn cluster
      expect(conj.present.er).toBe("trocknet");
      expect(conj.present.ihr).toBe("trocknet");
    });

    it("sammeln — -eln stem with ich contraction", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("sammeln"), endings);

      // -eln contraction in present: "sammel" + "e" -> "sammle"
      expect(conj.present.ich).toBe("sammle");
      expect(conj.present.du).toBe("sammelst");
      expect(conj.present.er).toBe("sammelt");
      expect(conj.present.wir).toBe("sammeln");
      expect(conj.present.sie).toBe("sammeln");
      // Imperative du also contracted
      expect(conj.imperative.du).toBe("sammle!");
      expect(conj.participle1).toBe("sammelnd");
      // Subjunctive 1 ich is NOT contracted (standard form)
      expect(conj.subjunctive1.ich).toBe("sammele");
    });
  });

  // --- Strong verbs ---

  describe("strong verbs", () => {
    it("laufen — a->au vowel change in present du/er", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("laufen"), endings);

      expect(conj.present.ich).toBe("laufe");
      expect(conj.present.du).toBe("l\u00e4ufst");
      expect(conj.present.er).toBe("l\u00e4uft");
      expect(conj.present.wir).toBe("laufen");
      expect(conj.preterite.ich).toBe("lief");
      expect(conj.preterite.du).toBe("liefst");
      expect(conj.participle2).toBe("gelaufen");
    });

    it("geben — e->i vowel change with imperative override", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("geben"), endings);

      expect(conj.present.ich).toBe("gebe");
      expect(conj.present.du).toBe("gibst");
      expect(conj.present.er).toBe("gibt");
      expect(conj.present.wir).toBe("geben");
      // Imperative du uses changed stem (gib!, not geb!)
      expect(conj.imperative.du).toBe("gib!");
      expect(conj.participle2).toBe("gegeben");
    });

    it("fahren — a->ae in present but NOT in imperative", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("fahren"), endings);

      expect(conj.present.du).toBe("f\u00e4hrst");
      expect(conj.present.er).toBe("f\u00e4hrt");
      // Imperative uses base stem — no umlaut
      expect(conj.imperative.du).toBe("fahr!");
    });

    it("finden — -d stem with e-insertion (strong verb)", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("finden"), endings);

      expect(conj.present.du).toBe("findest");
      expect(conj.present.er).toBe("findet");
      expect(conj.preterite.ich).toBe("fand");
      expect(conj.participle2).toBe("gefunden");
    });

    it("gehen — strong verb with irregular past stem", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("gehen"), endings);

      expect(conj.present.ich).toBe("gehe");
      expect(conj.present.du).toBe("gehst");
      expect(conj.preterite.ich).toBe("ging");
      expect(conj.preterite.du).toBe("gingst");
      expect(conj.participle2).toBe("gegangen");
    });

    it("halten — t-stem: Ablaut du/er with t-absorption", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("halten"), endings);

      // Stem halt -> vowel change haelt. The er-ending "t" is absorbed.
      expect(conj.present.ich).toBe("halte");
      expect(conj.present.du).toBe("h\u00e4ltst");   // NOT haelst
      expect(conj.present.er).toBe("h\u00e4lt");      // t absorbed, NOT haeltt
      expect(conj.present.wir).toBe("halten");
      expect(conj.present.ihr).toBe("haltet");   // e-insertion for non-Ablaut stem
    });

    it("treten — t-stem: e->i vowel change with consonant doubling", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("treten"), endings);

      // tret -> trit + t -> tritt (er), trit + st -> trittst (du)
      expect(conj.present.du).toBe("trittst");  // NOT tritest
      expect(conj.present.er).toBe("tritt");     // NOT trittt
      expect(conj.present.ich).toBe("trete");
      expect(conj.present.ihr).toBe("tretet");
    });

    it("laden — d-stem: vowel change without e-insertion for Ablaut", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("laden_jemanden"), endings);

      // lad -> laed (vowel change). No e-insertion for Ablaut stems.
      expect(conj.present.du).toBe("l\u00e4dst");     // NOT laedest
      expect(conj.present.er).toBe("l\u00e4dt");
      expect(conj.present.ich).toBe("lade");
      expect(conj.present.ihr).toBe("ladet");    // e-insertion for base stem
    });

    it("raten — t-stem: a->ae with t-absorption in er", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("raten_einen"), endings);

      expect(conj.present.du).toBe("r\u00e4tst");     // NOT raest
      expect(conj.present.er).toBe("r\u00e4t");        // NOT raett
      expect(conj.present.ihr).toBe("ratet");
    });

    it("gelten — t-stem: e->i with t-absorption", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("gelten"), endings);

      expect(conj.present.du).toBe("giltst");    // NOT gilst
      expect(conj.present.er).toBe("gilt");       // NOT giltt
    });
  });

  // --- Separable verbs ---

  describe("separable verbs", () => {
    it("ankommen — prefix separated in conjugated forms", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("ankommen"), endings);

      expect(conj.present.ich).toBe("komme an");
      expect(conj.present.du).toBe("kommst an");
      expect(conj.present.er).toBe("kommt an");
      expect(conj.preterite.ich).toBe("kam an");
      expect(conj.imperative.du).toBe("komm an!");
      expect(conj.imperative.Sie).toBe("kommen Sie an!");
      expect(conj.participle1).toBe("ankommend");
      expect(conj.participle2).toBe("angekommen");
    });

    it("aufheben — prefix separated correctly", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("aufheben"), endings);

      expect(conj.present.ich).toBe("hebe auf");
      expect(conj.present.du).toBe("hebst auf");
      expect(conj.preterite.ich).toBe("hob auf");
      expect(conj.imperative.du).toBe("heb auf!");
      expect(conj.participle1).toBe("aufhebend");
      expect(conj.participle2).toBe("aufgehoben");
    });

    it("einladen — separable + d-stem Ablaut", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("einladen"), endings);

      expect(conj.present.du).toBe("l\u00e4dst ein");    // NOT laedest ein
      expect(conj.present.er).toBe("l\u00e4dt ein");
      expect(conj.present.ich).toBe("lade ein");
    });
  });

  // --- Mixed verb ---

  describe("mixed verbs", () => {
    it("denken — changed stem + weak preterite endings", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("denken"), endings);

      expect(conj.present.ich).toBe("denke");
      expect(conj.present.du).toBe("denkst");
      expect(conj.preterite.ich).toBe("dachte");
      expect(conj.preterite.du).toBe("dachtest");
      expect(conj.subjunctive2.ich).toBe("d\u00e4chte");
      expect(conj.participle2).toBe("gedacht");
    });
  });

  // --- Irregular verbs ---

  describe("irregular verbs", () => {
    it("sein — returns stored conjugation unchanged", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("sein"), endings);

      expect(conj.present.ich).toBe("bin");
      expect(conj.present.du).toBe("bist");
      expect(conj.present.er).toBe("ist");
      expect(conj.preterite.ich).toBe("war");
      expect(conj.imperative.du).toBe("sei!");
      expect(conj.participle2).toBe("gewesen");
    });

    it("haben — returns stored conjugation unchanged", () => {
      const conj: ConjugationTable = computeConjugation(loadVerb("haben"), endings);

      expect(conj.present.ich).toBe("habe");
      expect(conj.present.du).toBe("hast");
      expect(conj.present.er).toBe("hat");
      expect(conj.preterite.ich).toBe("hatte");
      expect(conj.subjunctive2.ich).toBe("h\u00e4tte");
    });
  });
});

// ============================================================
// computeAllForms
// ============================================================

describe("computeAllForms", () => {
  it("returns a Set", () => {
    const forms: Set<string> = computeAllForms(loadVerb("machen"), endings);
    expect(forms).toBeInstanceOf(Set);
  });

  it("machen — includes infinitive and key forms", () => {
    const forms: Set<string> = computeAllForms(loadVerb("machen"), endings);

    expect(forms.has("machen")).toBe(true);
    expect(forms.has("mache")).toBe(true);
    expect(forms.has("machst")).toBe(true);
    expect(forms.has("macht")).toBe(true);
    expect(forms.has("machte")).toBe(true);
    expect(forms.has("gemacht")).toBe(true);
    expect(forms.has("machend")).toBe(true);
    // Both full and short imperative are searchable
    expect(forms.has("mache")).toBe(true); // full
    expect(forms.has("mach")).toBe(true);  // short (elided)
  });

  it("machen — form count is reasonable", () => {
    const forms: Set<string> = computeAllForms(loadVerb("machen"), endings);
    // 4 tenses x 6 + 3 imperative + 2 participles + 1 infinitive = 30 max
    // Many duplicates reduce this
    expect(forms.size).toBeGreaterThan(10);
    expect(forms.size).toBeLessThan(35);
  });

  it("ankommen — includes both separated and rejoined forms", () => {
    const forms: Set<string> = computeAllForms(loadVerb("ankommen"), endings);

    expect(forms.has("komme an")).toBe(true);
    expect(forms.has("kam an")).toBe(true);
    expect(forms.has("ankomme")).toBe(true);
    expect(forms.has("ankam")).toBe(true);
    expect(forms.has("ankommen")).toBe(true);
  });

  it("ankommen — does not rejoin multi-word bases", () => {
    const forms: Set<string> = computeAllForms(loadVerb("ankommen"), endings);
    // "kommen sie an" should NOT produce "ankommen sie"
    expect(forms.has("ankommen sie")).toBe(false);
  });

  it("sein — irregular forms from stored table", () => {
    const forms: Set<string> = computeAllForms(loadVerb("sein"), endings);

    expect(forms.has("sein")).toBe(true);
    expect(forms.has("bin")).toBe(true);
    expect(forms.has("bist")).toBe(true);
    expect(forms.has("ist")).toBe(true);
    expect(forms.has("war")).toBe(true);
    expect(forms.has("gewesen")).toBe(true);
  });

  it("all forms are lowercase", () => {
    const forms: Set<string> = computeAllForms(loadVerb("laufen"), endings);
    for (const form of forms) {
      expect(form).toBe(form.toLowerCase());
    }
  });

  it("imperative forms have exclamation marks stripped", () => {
    const forms: Set<string> = computeAllForms(loadVerb("machen"), endings);
    for (const form of forms) {
      expect(form).not.toContain("!");
    }
  });
});

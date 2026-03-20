/**
 * Tests for scripts/lib/merge.ts — sense-level LLM field merging.
 *
 * These tests guard against:
 *   1. Position shift: reordering senses must not shift translations to wrong meanings
 *   2. No wrong meaning: a sense whose German gloss changed must NOT inherit an old translation
 *   3. No data loss: senses that disappear become orphans (not silently dropped)
 *   4. Orphan recovery: a sense that was orphaned and reappears gets its translation back
 *   5. Duplicate glosses: first occurrence wins, no duplicate orphan entries
 *   6. Null/missing gloss_en fields: senses without translations don't affect others
 */

import { describe, it, expect } from "vitest";
import { mergeSenses, mergeHomonymGroup } from "../scripts/lib/merge.js";
import type { OrphanEntry } from "../scripts/lib/merge.js";
import type { Sense } from "../types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sense(
  gloss: string,
  gloss_en: string | null = null,
  extras: Partial<Sense> = {},
): Sense {
  return {
    gloss,
    gloss_en,
    tags: [],
    example_ids: [],
    synonyms: [],
    antonyms: [],
    ...extras,
  };
}

// ---------------------------------------------------------------------------
// 1. Stable order — translations pass through unchanged
// ---------------------------------------------------------------------------

describe("stable senses", () => {
  it("preserves gloss_en when senses are identical", () => {
    const existing = [sense("Möbelstück", "piece of furniture"), sense("Essen", "meal")];
    const newSenses = [sense("Möbelstück"), sense("Essen")];
    const { senses, orphans } = mergeSenses(newSenses, existing, []);

    expect(senses[0].gloss_en).toBe("piece of furniture");
    expect(senses[1].gloss_en).toBe("meal");
    expect(orphans).toHaveLength(0);
  });

  it("preserves gloss_en_full when present", () => {
    const existing = [
      sense("Möbelstück", "piece of furniture", {
        gloss_en_full: "A flat horizontal surface supported by legs",
        gloss_en_full_model: "gpt-4o-mini",
      }),
    ];
    const newSenses = [sense("Möbelstück")];
    const { senses } = mergeSenses(newSenses, existing, []);

    expect(senses[0].gloss_en_full).toBe("A flat horizontal surface supported by legs");
    expect(senses[0].gloss_en_full_model).toBe("gpt-4o-mini");
  });

  it("preserves synonyms_en when present", () => {
    const existing = [
      sense("schnell", "fast", { synonyms_en: ["quick", "rapid"], synonyms_en_model: "haiku" }),
    ];
    const newSenses = [sense("schnell")];
    const { senses } = mergeSenses(newSenses, existing, []);

    expect(senses[0].synonyms_en).toEqual(["quick", "rapid"]);
    expect(senses[0].synonyms_en_model).toBe("haiku");
  });
});

// ---------------------------------------------------------------------------
// 2. Position shift — translations must NOT move to wrong meanings
// ---------------------------------------------------------------------------

describe("position shift (the core bug)", () => {
  it("matches by gloss text when senses are reordered", () => {
    // Existing file: sense A at index 0, sense B at index 1
    const existing = [sense("Essen", "meal"), sense("Möbelstück", "piece of furniture")];
    // New transform reversed the order
    const newSenses = [sense("Möbelstück"), sense("Essen")];

    const { senses, orphans } = mergeSenses(newSenses, existing, []);

    // "Möbelstück" must get "piece of furniture", not "meal"
    expect(senses[0].gloss).toBe("Möbelstück");
    expect(senses[0].gloss_en).toBe("piece of furniture");

    // "Essen" must get "meal", not "piece of furniture"
    expect(senses[1].gloss).toBe("Essen");
    expect(senses[1].gloss_en).toBe("meal");

    expect(orphans).toHaveLength(0);
  });

  it("does not inherit translation when a sense disappears and a new one takes its position", () => {
    // Existing: two senses, only first translated
    const existing = [sense("Gefängnis", "prison"), sense("Schloss", null)];
    // New entry replaced first sense with a different meaning at position 0
    const newSenses = [sense("Türschloss"), sense("Schloss")];

    const { senses, orphans } = mergeSenses(newSenses, existing, []);

    // "Türschloss" is a completely new gloss — must NOT inherit "prison"
    expect(senses[0].gloss).toBe("Türschloss");
    expect(senses[0].gloss_en).toBeNull();

    // "Gefängnis" was translated and is now gone — must become an orphan
    expect(orphans).toHaveLength(1);
    expect(orphans[0].gloss).toBe("Gefängnis");
    expect(orphans[0].gloss_en).toBe("prison");
  });

  it("anhängen scenario: same German glosses, same count — all translations preserved", () => {
    // This is the scenario that went wrong in commit e61d9703bb.
    // 8 senses with the same German glosses but re-transformed → no translations should be lost.
    const glosses = [
      "etwas anhängen",
      "jemandem etwas anhängen",
      "einen Waggon anhängen",
      "einen Trailer anhängen",
      "einen Anhänger anhängen",
      "etwas an etwas anhängen",
      "jemanden anhängen",
      "sich anhängen",
    ];
    const translations = ["to attach", "to pin on sb.", "to couple", "to hitch", "to hook up", "to append", "to tail", "to cling to"];

    const existing = glosses.map((g, i) => sense(g, translations[i]));
    const newSenses = glosses.map((g) => sense(g)); // same order, no translations yet

    const { senses, orphans } = mergeSenses(newSenses, existing, []);

    for (let i = 0; i < glosses.length; i++) {
      expect(senses[i].gloss_en, `sense ${i} (${glosses[i]})`).toBe(translations[i]);
    }
    expect(orphans).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. No data loss — senses that vanish become orphans
// ---------------------------------------------------------------------------

describe("orphan accumulation", () => {
  it("saves unmatched translated sense as orphan", () => {
    const existing = [sense("A", "trans-A"), sense("B", "trans-B")];
    // New entry has only sense A
    const newSenses = [sense("A")];

    const { senses, orphans } = mergeSenses(newSenses, existing, []);

    expect(senses[0].gloss_en).toBe("trans-A");
    expect(orphans).toHaveLength(1);
    expect(orphans[0].gloss).toBe("B");
    expect(orphans[0].gloss_en).toBe("trans-B");
  });

  it("does NOT orphan senses that have no gloss_en (nothing to save)", () => {
    const existing = [sense("A", "trans-A"), sense("B", null)];
    const newSenses = [sense("A")];

    const { orphans } = mergeSenses(newSenses, existing, []);

    // Only A→B is unmatched, but B had no translation, so no orphan for it
    expect(orphans).toHaveLength(0);
  });

  it("carries forward existing orphans when the gloss is still absent", () => {
    const existingOrphans: OrphanEntry[] = [{ gloss: "Old sense", gloss_en: "old translation" }];
    const existing = [sense("Current", "current trans")];
    const newSenses = [sense("Current")];

    const { orphans } = mergeSenses(newSenses, existing, existingOrphans);

    // "Old sense" is still not in newSenses → must survive
    expect(orphans.some((o) => o.gloss === "Old sense")).toBe(true);
  });

  it("includes all LLM fields in the orphan entry", () => {
    const existing = [
      sense("Verschwundene Bedeutung", "lost meaning", {
        gloss_en_model: "gpt-4o",
        gloss_en_full: "The sense that was removed",
        gloss_en_full_model: "gpt-4o",
        synonyms_en: ["missing", "absent"],
        synonyms_en_model: "haiku",
      }),
    ];
    const newSenses = [sense("Andere Bedeutung")];

    const { orphans } = mergeSenses(newSenses, existing, []);

    expect(orphans).toHaveLength(1);
    const orphan = orphans[0];
    expect(orphan.gloss_en).toBe("lost meaning");
    expect(orphan.gloss_en_model).toBe("gpt-4o");
    expect(orphan.gloss_en_full).toBe("The sense that was removed");
    expect(orphan.gloss_en_full_model).toBe("gpt-4o");
    expect(orphan.synonyms_en).toEqual(["missing", "absent"]);
    expect(orphan.synonyms_en_model).toBe("haiku");
  });
});

// ---------------------------------------------------------------------------
// 4. Orphan recovery — translation restored when gloss reappears
// ---------------------------------------------------------------------------

describe("orphan recovery", () => {
  it("restores translation from orphan when gloss reappears in newSenses", () => {
    const existingOrphans: OrphanEntry[] = [
      { gloss: "Wiedergekommene Bedeutung", gloss_en: "recovered translation" },
    ];
    const existing: Sense[] = []; // the active senses file is now empty / different
    const newSenses = [sense("Wiedergekommene Bedeutung")]; // the gloss is back!

    const { senses, orphans } = mergeSenses(newSenses, existing, existingOrphans);

    // Translation must be restored
    expect(senses[0].gloss_en).toBe("recovered translation");
    // Orphan must be consumed
    expect(orphans.some((o) => o.gloss === "Wiedergekommene Bedeutung")).toBe(false);
  });

  it("existing sense takes precedence over orphan for the same gloss", () => {
    const existingOrphans: OrphanEntry[] = [
      { gloss: "Bedeutung A", gloss_en: "orphan translation" },
    ];
    const existing = [sense("Bedeutung A", "active translation")];
    const newSenses = [sense("Bedeutung A")];

    const { senses } = mergeSenses(newSenses, existing, existingOrphans);

    // Active sense wins over orphan
    expect(senses[0].gloss_en).toBe("active translation");
  });
});

// ---------------------------------------------------------------------------
// 5. Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("handles empty inputs without throwing", () => {
    const { senses, orphans } = mergeSenses([], [], []);
    expect(senses).toHaveLength(0);
    expect(orphans).toHaveLength(0);
  });

  it("does not create duplicate orphan entries when same gloss already in existingOrphans", () => {
    const existingOrphans: OrphanEntry[] = [{ gloss: "Haus", gloss_en: "house" }];
    const existing = [sense("Haus", "house")]; // also in active senses
    const newSenses = [sense("Baum")]; // neither Haus matches

    const { orphans } = mergeSenses(newSenses, existing, existingOrphans);

    const hausOrphans = orphans.filter((o) => o.gloss === "Haus");
    expect(hausOrphans).toHaveLength(1); // not duplicated
  });

  it("preserves translation on empty-gloss senses via positional matching", () => {
    // E.g. Halle_S., Halle_Saale: gloss="" but had a translation set
    const existing = [sense("", "Halle (Saale), city in Germany")];
    const newSenses = [sense("")];

    const { senses, orphans } = mergeSenses(newSenses, existing, []);

    expect(senses[0].gloss_en).toBe("Halle (Saale), city in Germany");
    expect(orphans).toHaveLength(0);
  });

  it("preserves translations on multiple empty-gloss senses by position", () => {
    const existing = [sense("", "first"), sense("", "second")];
    const newSenses = [sense(""), sense("")];

    const { senses } = mergeSenses(newSenses, existing, []);

    expect(senses[0].gloss_en).toBe("first");
    expect(senses[1].gloss_en).toBe("second");
  });

  it("does not transfer empty-gloss translation when pool is exhausted", () => {
    // More new empty-gloss senses than old — extras stay null
    const existing = [sense("", "only one")];
    const newSenses = [sense(""), sense("")];

    const { senses } = mergeSenses(newSenses, existing, []);

    expect(senses[0].gloss_en).toBe("only one");
    expect(senses[1].gloss_en).toBeNull();
  });

  it("fuzzy: minor rewording (bracket/paren swap) still transfers translation", () => {
    // Simulates: "[wegen des Eigengewichts]" → "(durch das Eigengewicht"
    const existing = [
      sense("an einem festen Punkt [wegen des Eigengewichts] nach unten baumelnd", "to hang"),
      sense("sehr gern haben, nicht verzichten wollen", "to be attached"),
    ];
    const newSenses = [
      sense("an einem festen Punkt (durch das Eigengewicht nach unten baumelnd"),
      sense("sehr gern haben, nicht auf die Sache verzichten wollen"),
    ];

    const { senses, orphans } = mergeSenses(newSenses, existing, []);

    expect(senses[0].gloss_en).toBe("to hang");
    expect(senses[1].gloss_en).toBe("to be attached");
    expect(orphans).toHaveLength(0);
  });

  it("fuzzy: does NOT match when glosses are unrelated (prevents wrong-meaning transfer)", () => {
    const existing = [
      sense("etwas beherrschen, wissen; fähig sein", "to master"),
      sense("etwas zu einem bestimmten Zeitpunkt vollenden", "to finish"),
    ];
    const newSenses = [
      sense("die Erlaubnis haben, etwas zu dürfen"),
      sense("unter Umständen vielleicht der Fall sein"),
    ];

    const { senses, orphans } = mergeSenses(newSenses, existing, []);

    expect(senses[0].gloss_en).toBeNull();
    expect(senses[1].gloss_en).toBeNull();
    expect(orphans).toHaveLength(2);
  });

  it("fuzzy: each old sense matched at most once (no double-consuming)", () => {
    // Two new senses similar to the same old sense — only one should match
    const existing = [sense("etwas kaufen und besitzen wollen", "to want")];
    const newSenses = [
      sense("etwas kaufen und haben wollen"),   // very similar
      sense("etwas kaufen und erwerben wollen"), // also similar
    ];

    const { senses } = mergeSenses(newSenses, existing, []);

    // Only the first (higher-scoring) sense should get the translation
    const translated = senses.filter((s) => s.gloss_en === "to want");
    expect(translated).toHaveLength(1);
  });

  it("first occurrence wins when multiple existing senses share the same German gloss", () => {
    const existing = [
      sense("Doppelt", "first translation"),
      sense("Doppelt", "second translation"), // duplicate gloss
    ];
    const newSenses = [sense("Doppelt")];

    const { senses } = mergeSenses(newSenses, existing, []);

    expect(senses[0].gloss_en).toBe("first translation");
  });
});

// ---------------------------------------------------------------------------
// 6. example_ids carry-forward (prevent orphaned translated examples)
// ---------------------------------------------------------------------------

describe("example_ids carry-forward", () => {
  it("carries old example_ids into new sense when Wiktionary drops an example", () => {
    // Old sense had examples [a, b]; new Wiktionary source only lists [c].
    // Both a and b should survive (they may be translated).
    const existing = [sense("Möbelstück", "piece of furniture", { example_ids: ["aaa", "bbb"] })];
    const newSenses = [sense("Möbelstück", null, { example_ids: ["ccc"] })];

    const { senses } = mergeSenses(newSenses, existing, []);

    expect(senses[0].example_ids).toContain("aaa");
    expect(senses[0].example_ids).toContain("bbb");
    expect(senses[0].example_ids).toContain("ccc");
  });

  it("does not duplicate example_ids already present in new sense", () => {
    const existing = [sense("Möbelstück", "table", { example_ids: ["aaa", "bbb"] })];
    const newSenses = [sense("Möbelstück", null, { example_ids: ["aaa", "ccc"] })];

    const { senses } = mergeSenses(newSenses, existing, []);

    const ids = senses[0].example_ids ?? [];
    expect(ids.filter((id) => id === "aaa")).toHaveLength(1); // no duplicate
    expect(ids).toContain("bbb");
    expect(ids).toContain("ccc");
  });

  it("carries example_ids via fuzzy match when gloss wording changes slightly", () => {
    // Old gloss "auf gewisse Art und Weise schlafen" fuzzy-matches new "auf bestimmte Art schlafen"
    const existing = [
      sense("auf gewisse Art und Weise schlafen", "to sleep in a certain way", {
        example_ids: ["old1", "old2"],
      }),
    ];
    const newSenses = [sense("auf bestimmte Art schlafen", null, { example_ids: ["new1"] })];

    const { senses } = mergeSenses(newSenses, existing, []);

    // gloss_en should be transferred (fuzzy match)
    expect(senses[0].gloss_en).toBe("to sleep in a certain way");
    // old example_ids should also survive
    expect(senses[0].example_ids).toContain("old1");
    expect(senses[0].example_ids).toContain("old2");
    expect(senses[0].example_ids).toContain("new1");
  });

  it("does not carry example_ids from orphan entries (OrphanEntry has no example_ids)", () => {
    // Orphans carry gloss_en but not example_ids — this should not throw
    const orphan: OrphanEntry = { gloss: "Möbelstück", gloss_en: "table" };
    const newSenses = [sense("Möbelstück", null, { example_ids: ["new1"] })];

    const { senses } = mergeSenses(newSenses, [], [orphan]);

    expect(senses[0].gloss_en).toBe("table");
    expect(senses[0].example_ids).toEqual(["new1"]); // unchanged — no orphan ids
  });
});

// ---------------------------------------------------------------------------
// 7. Cross-file homonym merge
// ---------------------------------------------------------------------------

/**
 * Builds the `newFiles` map that mergeHomonymGroup() expects:
 * the senses AFTER per-file mergeSenses() (some may already carry gloss_en).
 */
function newFilesMap(entries: Record<string, Sense[]>): Map<string, Sense[]> {
  return new Map(Object.entries(entries));
}

/**
 * Builds the `oldFiles` map that mergeHomonymGroup() expects:
 * old sibling files loaded from disk before the transform run.
 */
function oldFilesMap(
  entries: Record<string, { senses: Sense[]; orphans?: OrphanEntry[] }>,
): Map<string, { senses: Sense[]; orphans: OrphanEntry[] }> {
  return new Map(
    Object.entries(entries).map(([k, v]) => [k, { senses: v.senses, orphans: v.orphans ?? [] }]),
  );
}

describe("mergeHomonymGroup — cross-file translation transfer", () => {
  it("transfers translation from old file to new sibling file (split scenario)", () => {
    // Old file A had both senses; new transform split them into A and B.
    // Per-file merge already gave Tür to A; Pforte still null in new B.
    const nf = newFilesMap({
      A: [sense("Tür", "door")],
      B: [sense("Pforte")],       // new file — per-file found nothing
    });
    const of = oldFilesMap({
      A: { senses: [sense("Tür", "door"), sense("Pforte", "gate")] },
      // no old B
    });

    const { files, crossFileMatches } = mergeHomonymGroup(nf, of);

    expect(files.get("B")![0].gloss_en).toBe("gate");
    expect(crossFileMatches).toHaveLength(1);
    expect(crossFileMatches[0].oldFile).toBe("A");
    expect(crossFileMatches[0].oldGloss).toBe("Pforte");
    expect(crossFileMatches[0].newFile).toBe("B");
    expect(crossFileMatches[0].newGloss).toBe("Pforte");
  });

  it("transfers all translations when old file is fully renamed", () => {
    // Old file A is gone; new file B has the same senses. Only cross-file can recover.
    const nf = newFilesMap({
      B: [sense("Haus"), sense("Gebäude")],
    });
    const of = oldFilesMap({
      A: { senses: [sense("Haus", "house"), sense("Gebäude", "building")] },
    });

    const { files, crossFileMatches } = mergeHomonymGroup(nf, of);

    expect(files.get("B")![0].gloss_en).toBe("house");
    expect(files.get("B")![1].gloss_en).toBe("building");
    expect(crossFileMatches).toHaveLength(2);
  });

  it("does not touch senses that already have translations from per-file merge", () => {
    // Simulate what happens AFTER per-file mergeSenses() already ran:
    // both senses already carry gloss_en → mergeHomonymGroup should leave them alone.
    const nf = newFilesMap({
      A: [sense("Essen", "food")],    // already translated by per-file merge
      B: [sense("Tisch", "table")],   // already translated by per-file merge
    });
    const of = oldFilesMap({
      A: { senses: [sense("Essen", "food")] },
      B: { senses: [sense("Tisch", "table")] },
    });

    const { files, crossFileMatches } = mergeHomonymGroup(nf, of);

    // Nothing changed — all translations already present
    expect(files.get("A")![0].gloss_en).toBe("food");
    expect(files.get("B")![0].gloss_en).toBe("table");
    // No cross-file transfer needed
    expect(crossFileMatches).toHaveLength(0);
  });

  it("excludes own-file old senses from cross-file pool", () => {
    // Old A had [S], new A has [T] — completely different. Per-file left T null.
    // Old A's [S] should NOT be tried again for new A (same-file already ran).
    const nf = newFilesMap({
      A: [sense("Türschloss")],       // null after per-file (no match in old A)
    });
    const of = oldFilesMap({
      A: { senses: [sense("Gefängnis", "prison")] }, // different sense
    });

    const { files, crossFileMatches } = mergeHomonymGroup(nf, of);

    // Cross-file pool excludes old A when processing new A → stays null
    expect(files.get("A")![0].gloss_en).toBeNull();
    expect(crossFileMatches).toHaveLength(0);
  });

  it("each old sense consumed at most once across all new files", () => {
    // Two new files both want the same old sense — only the first gets it.
    const nf = newFilesMap({
      B: [sense("Gleiche Bedeutung")],
      C: [sense("Gleiche Bedeutung")],
    });
    const of = oldFilesMap({
      A: { senses: [sense("Gleiche Bedeutung", "same meaning")] },
    });

    const { files, crossFileMatches } = mergeHomonymGroup(nf, of);

    const bTrans = files.get("B")![0].gloss_en;
    const cTrans = files.get("C")![0].gloss_en;
    // Exactly one should be "same meaning", the other null
    expect([bTrans, cTrans].filter((x) => x === "same meaning")).toHaveLength(1);
    expect([bTrans, cTrans].filter((x) => x === null)).toHaveLength(1);
    expect(crossFileMatches).toHaveLength(1);
  });

  it("fuzzy cross-file: minor rewording transfers translation to sibling file", () => {
    const nf = newFilesMap({
      B: [sense("etwas kaufen und haben wollen")],  // slightly reworded
    });
    const of = oldFilesMap({
      A: { senses: [sense("etwas kaufen und besitzen wollen", "to want")] },
    });

    const { files, crossFileMatches } = mergeHomonymGroup(nf, of);

    expect(files.get("B")![0].gloss_en).toBe("to want");
    expect(crossFileMatches).toHaveLength(1);
    expect(crossFileMatches[0].oldFile).toBe("A");
    expect(crossFileMatches[0].newFile).toBe("B");
  });

  it("recovers from old orphans in sibling files", () => {
    // Old A has an orphan entry whose gloss now appears in new file B.
    const nf = newFilesMap({
      B: [sense("Wiedergekommene Bedeutung")],
    });
    const of = oldFilesMap({
      A: {
        senses: [],
        orphans: [{ gloss: "Wiedergekommene Bedeutung", gloss_en: "recovered" }],
      },
    });

    const { files, crossFileMatches } = mergeHomonymGroup(nf, of);

    expect(files.get("B")![0].gloss_en).toBe("recovered");
    expect(crossFileMatches).toHaveLength(1);
  });

  it("empty inputs return empty results without throwing", () => {
    const { files, crossFileMatches } = mergeHomonymGroup(new Map(), new Map());
    expect(files.size).toBe(0);
    expect(crossFileMatches).toHaveLength(0);
  });

  it("copies all LLM fields (gloss_en_full, synonyms_en) in cross-file transfer", () => {
    const nf = newFilesMap({
      B: [sense("Fenster")],
    });
    const of = oldFilesMap({
      A: {
        senses: [
          sense("Fenster", "window", {
            gloss_en_full: "An opening in a wall that lets in light",
            gloss_en_full_model: "gpt-4o",
            synonyms_en: ["pane", "glass"],
            synonyms_en_model: "haiku",
          }),
        ],
      },
    });

    const { files } = mergeHomonymGroup(nf, of);
    const s = files.get("B")![0];

    expect(s.gloss_en).toBe("window");
    expect(s.gloss_en_full).toBe("An opening in a wall that lets in light");
    expect(s.gloss_en_full_model).toBe("gpt-4o");
    expect(s.synonyms_en).toEqual(["pane", "glass"]);
    expect(s.synonyms_en_model).toBe("haiku");
  });
});

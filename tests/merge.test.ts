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
import { mergeSenses } from "../scripts/lib/merge.js";
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

  it("ignores senses with empty/null gloss for matching purposes", () => {
    const existing = [sense("", "should be ignored"), sense("Real", "real translation")];
    const newSenses = [sense("Real"), sense("")];

    const { senses, orphans } = mergeSenses(newSenses, existing, []);

    expect(senses[0].gloss_en).toBe("real translation");
    // The empty-gloss sense with a translation is lost — but it had no key to match on,
    // so it cannot become an orphan either (no gloss to index it by)
    expect(orphans).toHaveLength(0);
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

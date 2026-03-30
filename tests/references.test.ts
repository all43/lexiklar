import { describe, it, expect } from "vitest";
import { parseReferences } from "../src/utils/references.js";
import { stripEllipsisMarkers } from "../src/utils/text.js";

// ─── parseReferences ───────────────────────────────────────────────────────

describe("parseReferences — cross_ref (file path links)", () => {
  it("parses a basic cross-ref without sense", () => {
    const segs = parseReferences("[[Tisch|nouns/Tisch]]");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ type: "cross_ref", text: "Tisch", filePath: "nouns/Tisch" });
  });

  it("parses a cross-ref with sense number", () => {
    const segs = parseReferences("[[Band|nouns/Band_plural#5]]");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ type: "cross_ref", text: "Band", filePath: "nouns/Band_plural", senseNumber: 5 });
  });

  it("parses a cross-ref without display text", () => {
    const segs = parseReferences("[[nouns/Tisch]]");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ type: "cross_ref", filePath: "nouns/Tisch" });
  });

  it("parses path with [N] suffix — no orphan bracket (das_[1])", () => {
    const segs = parseReferences("[[das|pronouns/das_[1]]]");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ type: "cross_ref", text: "das", filePath: "pronouns/das_[1]" });
  });

  it("parses path with [word] infix — no orphan bracket (Bord_[schiffs-]rand)", () => {
    const segs = parseReferences("[[Bord|nouns/Bord_[schiffs-]rand]]");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ type: "cross_ref", text: "Bord", filePath: "nouns/Bord_[schiffs-]rand" });
  });

  it("parses path with [word] suffix — no orphan bracket (kosten_[jemandem])", () => {
    const segs = parseReferences("[[kosten|verbs/kosten_[jemandem]]]");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ type: "cross_ref", text: "kosten", filePath: "verbs/kosten_[jemandem]" });
  });

  it("leaves no leftover text after bracket-in-path link", () => {
    // The regression: orphaned ] was left as a text segment
    const segs = parseReferences("unter [[das|pronouns/das_[1]]] Band");
    expect(segs.every((s) => s.text !== "]")).toBe(true);
    const textSegs = segs.filter((s) => s.type === "text");
    expect(textSegs.map((s) => s.text).join("")).toBe("unter  Band");
  });
});

describe("parseReferences — inline_ref (#N)", () => {
  it("parses bare [[#N]] as inline_ref with correct senseNumber", () => {
    const segs = parseReferences("[[#3]]");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ type: "inline_ref", senseNumber: 3 });
    expect(segs[0].text).toBe("[3]");
  });

  it("does NOT render [[#3]] as [null]", () => {
    const segs = parseReferences("[[#3]]");
    expect(segs[0].text).not.toBe("[null]");
  });

  it("parses [[display|#N]] as inline_ref", () => {
    const segs = parseReferences("[[hier|#2]]");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ type: "inline_ref", text: "hier", senseNumber: 2 });
  });

  it("parses [[#N]] inline ref inside surrounding text", () => {
    const segs = parseReferences("der unter [[#3]] beschriebene Streifen");
    expect(segs).toHaveLength(3);
    expect(segs[1]).toMatchObject({ type: "inline_ref", senseNumber: 3 });
  });
});

describe("parseReferences — superscript_ref (^N)", () => {
  it("parses [[^3]] as superscript_ref", () => {
    const segs = parseReferences("[[^3]]");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ type: "superscript_ref", senseNumber: 3 });
  });

  it("parses [[display|^3]] as superscript_ref with display text", () => {
    const segs = parseReferences("[[Anm.|^1]]");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ type: "superscript_ref", text: "Anm.", senseNumber: 1 });
  });
});

describe("parseReferences — plain text and mixed input", () => {
  it("returns a single text segment for plain text", () => {
    const segs = parseReferences("kein Link hier");
    expect(segs).toEqual([{ type: "text", text: "kein Link hier" }]);
  });

  it("splits text around a link correctly", () => {
    const segs = parseReferences("Der [[Tisch|nouns/Tisch]] steht.");
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ type: "text", text: "Der " });
    expect(segs[1]).toMatchObject({ type: "cross_ref", text: "Tisch" });
    expect(segs[2]).toMatchObject({ type: "text", text: " steht." });
  });

  it("handles multiple links in one string", () => {
    const segs = parseReferences("[[A|nouns/A]] und [[B|nouns/B]]");
    expect(segs.filter((s) => s.type === "cross_ref")).toHaveLength(2);
  });

  it("returns empty array for empty string", () => {
    expect(parseReferences("")).toEqual([]);
  });
});

// ─── stripEllipsisMarkers ──────────────────────────────────────────────────

describe("stripEllipsisMarkers", () => {
  it("strips Unicode ellipsis marker at start", () => {
    expect(stripEllipsisMarkers("[…]dann schlief er.")).toBe("dann schlief er.");
  });

  it("strips Unicode ellipsis marker at end", () => {
    expect(stripEllipsisMarkers("Zwei Gestalten schleppen eine Bürde […].")).toBe(
      "Zwei Gestalten schleppen eine Bürde."
    );
  });

  it("strips Unicode ellipsis marker in the middle", () => {
    expect(stripEllipsisMarkers("Text […] more text.")).toBe("Text more text.");
  });

  it("strips ASCII ellipsis marker [...] at start", () => {
    expect(stripEllipsisMarkers("[...] ASCII version.")).toBe("ASCII version.");
  });

  it("strips ASCII ellipsis marker [...] at end", () => {
    expect(stripEllipsisMarkers("Text [...].")).toBe("Text.");
  });

  it("strips multiple ellipsis markers", () => {
    expect(stripEllipsisMarkers("A […] B […] C.")).toBe("A B C.");
  });

  it("strips marker followed by comma", () => {
    expect(stripEllipsisMarkers("Text […], continued.")).toBe("Text, continued.");
  });

  it("does not modify text without markers", () => {
    expect(stripEllipsisMarkers("Normaler Satz.")).toBe("Normaler Satz.");
  });

  it("does not strip [[…|…]] wiki-link tokens", () => {
    expect(stripEllipsisMarkers("[[das|pronouns/das_[1]]]")).toBe("[[das|pronouns/das_[1]]]");
  });

  it("returns empty string unchanged", () => {
    expect(stripEllipsisMarkers("")).toBe("");
  });
});

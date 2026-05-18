import { describe, it, expect } from "vitest";
import {
  annotateExampleText,
  type WordLookupEntry,
} from "../scripts/lib/text-linked.js";
import type { Annotation } from "../types/example.js";

function makeLookup(entries: Record<string, WordLookupEntry[]>): Map<string, WordLookupEntry[]> {
  return new Map(Object.entries(entries));
}

const LOOKUP = makeLookup({
  "aufstehen|verb": [{ posDir: "verbs", file: "aufstehen", senses: [
    { gloss: "sich erheben", gloss_en: "stand up", tags: [], example_ids: [], synonyms: [], antonyms: [] },
  ]}],
  "helfen|verb": [{ posDir: "verbs", file: "helfen", senses: [
    { gloss: "unterstützen", gloss_en: "help", tags: [], example_ids: [], synonyms: [], antonyms: [] },
  ]}],
  "verteidigen|verb": [{ posDir: "verbs", file: "verteidigen", senses: [
    { gloss: "verteidigen", gloss_en: "defend", tags: [], example_ids: [], synonyms: [], antonyms: [] },
  ]}],
  "Uhr|noun": [{ posDir: "nouns", file: "Uhr", senses: [
    { gloss: "Zeitmessgerät", gloss_en: "clock", tags: [], example_ids: [], synonyms: [], antonyms: [] },
  ]}],
  "anfangen|verb": [{ posDir: "verbs", file: "anfangen", senses: [
    { gloss: "beginnen", gloss_en: "begin", tags: [], example_ids: [], synonyms: [], antonyms: [] },
  ]}],
  "Arbeit|noun": [{ posDir: "nouns", file: "Arbeit", senses: [
    { gloss: "Tätigkeit", gloss_en: "work", tags: [], example_ids: [], synonyms: [], antonyms: [] },
  ]}],
});

describe("form2 — zu + infinitive", () => {
  it("merges adjacent zu + verb into single span", () => {
    const text = "Er versucht zu helfen.";
    const anns: Annotation[] = [
      { form: "helfen", lemma: "helfen", pos: "verb", gloss_hint: null, form2: "zu" },
    ];
    const result = annotateExampleText(text, anns, LOOKUP);
    expect(result).toBe("Er versucht [[zu helfen|verbs/helfen]].");
  });

  it("merges multiple zu + verb spans independently", () => {
    const text = "Er versucht zu helfen und zu verteidigen.";
    const anns: Annotation[] = [
      { form: "helfen", lemma: "helfen", pos: "verb", gloss_hint: null, form2: "zu" },
      { form: "verteidigen", lemma: "verteidigen", pos: "verb", gloss_hint: null, form2: "zu" },
    ];
    const result = annotateExampleText(text, anns, LOOKUP);
    expect(result).toBe("Er versucht [[zu helfen|verbs/helfen]] und [[zu verteidigen|verbs/verteidigen]].");
  });
});

describe("form2 — separated verb prefix", () => {
  it("creates two spans for non-adjacent separated verb", () => {
    const text = "Um 10 Uhr stehe ich auf.";
    const anns: Annotation[] = [
      { form: "Uhr", lemma: "Uhr", pos: "noun", gloss_hint: null },
      { form: "stehe", lemma: "aufstehen", pos: "verb", gloss_hint: null, form2: "auf" },
    ];
    const result = annotateExampleText(text, anns, LOOKUP);
    expect(result).toBe("Um 10 [[Uhr|nouns/Uhr]] [[stehe|verbs/aufstehen]] ich [[auf|verbs/aufstehen]].");
  });
});

describe("form_index — disambiguation", () => {
  it("uses word index to pick correct occurrence", () => {
    const text = "Er steht auf dem Berg und steht jeden Tag früh auf.";
    const anns: Annotation[] = [
      { form: "steht", lemma: "aufstehen", pos: "verb", gloss_hint: null, form_index: 6, form2: "auf", form2_index: 10 },
    ];
    const result = annotateExampleText(text, anns, LOOKUP);
    expect(result).toBe("Er steht auf dem Berg und [[steht|verbs/aufstehen]] jeden Tag früh [[auf|verbs/aufstehen]].");
  });
});

describe("backward compatibility", () => {
  it("works without form2 or form_index", () => {
    const text = "Um 10 Uhr stehe ich auf.";
    const anns: Annotation[] = [
      { form: "Uhr", lemma: "Uhr", pos: "noun", gloss_hint: null },
      { form: "stehe", lemma: "aufstehen", pos: "verb", gloss_hint: null },
    ];
    const result = annotateExampleText(text, anns, LOOKUP);
    expect(result).toBe("Um 10 [[Uhr|nouns/Uhr]] [[stehe|verbs/aufstehen]] ich auf.");
  });
});

describe("form2 — edge cases", () => {
  it("falls back gracefully when form2 not found in text", () => {
    const text = "Er hilft mir.";
    const anns: Annotation[] = [
      { form: "hilft", lemma: "helfen", pos: "verb", gloss_hint: null, form2: "zu" },
    ];
    const result = annotateExampleText(text, anns, LOOKUP);
    expect(result).toBe("Er [[hilft|verbs/helfen]] mir.");
  });

  it("handles form2_index out of range gracefully", () => {
    const text = "Ich stehe auf.";
    const anns: Annotation[] = [
      { form: "stehe", lemma: "aufstehen", pos: "verb", gloss_hint: null, form2: "auf", form2_index: 99 },
    ];
    const result = annotateExampleText(text, anns, LOOKUP);
    expect(result).toBe("Ich [[stehe|verbs/aufstehen]] auf.");
  });

  it("handles separable verb in subordinate clause (no separation, form2 not found)", () => {
    const text = "Ich weiß, dass er aufsteht.";
    const anns: Annotation[] = [
      { form: "aufsteht", lemma: "aufstehen", pos: "verb", gloss_hint: null, form2: "auf" },
    ];
    // "auf" appears inside "aufsteht" but not as a standalone word
    // form2 should NOT match inside the primary form
    const result = annotateExampleText(text, anns, LOOKUP);
    expect(result).toBe("Ich weiß, dass er [[aufsteht|verbs/aufstehen]].");
  });

  it("separable prefix in zu-infinitive: anfangen → anzufangen", () => {
    const text = "Er beginnt die Arbeit anzufangen.";
    const anns: Annotation[] = [
      { form: "Arbeit", lemma: "Arbeit", pos: "noun", gloss_hint: null },
      { form: "anzufangen", lemma: "anfangen", pos: "verb", gloss_hint: null },
    ];
    const result = annotateExampleText(text, anns, LOOKUP);
    expect(result).toBe("Er beginnt die [[Arbeit|nouns/Arbeit]] [[anzufangen|verbs/anfangen]].");
  });
});

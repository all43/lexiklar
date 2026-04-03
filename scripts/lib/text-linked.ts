/**
 * Text-linked resolution: converts annotations into [[form|path#sense]] markup.
 *
 * Extracted from build-index.ts for testability.
 */

import type { Annotation } from "../../types/example.js";
import type { Sense } from "../../types/word.js";

// ============================================================
// Interfaces
// ============================================================

export interface WordLookupEntry {
  posDir: string;
  file: string;
  senses: Sense[];
}

export interface ResolvedTarget {
  posDir: string;
  file: string;
  senseNumber: number | null;
}

export interface TextMatch {
  start: number;
  end: number;
  token: string;
}

// ============================================================
// Irregular English forms → base form
// ============================================================

export const IRREGULAR_EN: Record<string, string> = {
  // be
  was: "be", were: "be", been: "be", am: "be", is: "be", are: "be",
  // have
  had: "have", has: "have",
  // do
  did: "do", done: "do", does: "do",
  // go
  went: "go", gone: "go", goes: "go",
  // come
  came: "come", comes: "come",
  // take
  took: "take", taken: "take",
  // make
  made: "make",
  // give
  gave: "give", given: "give",
  // say
  said: "say",
  // get
  got: "get", gotten: "get",
  // know
  knew: "know", known: "know",
  // think
  thought: "think",
  // see
  saw: "see", seen: "see",
  // find
  found: "find",
  // put
  puts: "put",
  // bring
  brought: "bring",
  // keep
  kept: "keep",
  // let
  lets: "let",
  // begin
  began: "begin", begun: "begin",
  // leave
  left: "leave",
  // stand
  stood: "stand",
  // run
  ran: "run",
  // hold
  held: "hold",
  // write
  wrote: "write", written: "write",
  // speak
  spoke: "speak", spoken: "speak",
  // read (past) — can't include "read" — same spelling
  // lose
  lost: "lose",
  // win
  won: "win",
  // break
  broke: "break", broken: "break",
  // drive
  drove: "drive", driven: "drive",
  // eat
  ate: "eat", eaten: "eat",
  // fall
  fell: "fall", fallen: "fall",
  // grow
  grew: "grow", grown: "grow",
  // fly
  flew: "fly", flown: "fly",
  // throw
  threw: "throw", thrown: "throw",
  // sing
  sang: "sing", sung: "sing",
  // sit
  sat: "sit",
  // lie
  lay: "lie", lain: "lie",
  // lead
  led: "lead",
  // feel
  felt: "feel",
  // catch
  caught: "catch",
  // teach
  taught: "teach",
  // buy
  bought: "buy",
  // send
  sent: "send",
  // build
  built: "build",
  // sell
  sold: "sell",
  // spend
  spent: "spend",
  // Irregular nouns (plural → singular)
  children: "child", women: "woman", men: "man", people: "person",
  feet: "foot", teeth: "tooth", mice: "mouse", geese: "goose",
  lives: "life", wives: "wife", knives: "knife", halves: "half",
  leaves: "leaf", selves: "self", loaves: "loaf",
};

// ============================================================
// Resolution functions
// ============================================================

/**
 * Normalize a gloss_hint: split pipe-separated values (take first),
 * then lowercase.
 */
export function normalizeHint(raw: string): string {
  const first = raw.includes("|") ? raw.split("|")[0].trim() : raw;
  return first.toLowerCase();
}

/**
 * Resolve an annotation to a word file path + optional sense number.
 * Returns {posDir, file, senseNumber} or null.
 */
export function resolveWordFile(
  lemma: string,
  pos: string,
  glossHint: string | null,
  lookup: Map<string, WordLookupEntry[]>,
): ResolvedTarget | null {
  const key = `${lemma}|${pos}`;
  const entries = lookup.get(key);
  if (!entries || entries.length === 0) return null;

  // Single match — no disambiguation needed
  let entry = entries[0];
  let senseNumber: number | null = null;

  if (glossHint) {
    const hintLower = normalizeHint(glossHint);
    // Crude English stem: strip common inflectional suffixes for fuzzy matching.
    // Only strip suffixes that leave a stem of at least 4 chars to avoid
    // false positives ("time"→"tim" matching "moment", "free"→"fre" matching "freelance").
    const hintStem = hintLower
      .replace(/ies$/, "y")       // "families" → "family"
      .replace(/ied$/, "y")       // "carried" → "carry"
      .replace(/ying$/, "y")      // not common but safe
      .replace(/ing$/, "")        // "running" → "runn" (close enough for substring)
      .replace(/ed$/, "")         // "voted" → "vot"
      .replace(/(?:es|en|s)$/, ""); // plurals: "consequences" → "consequenc"
    // Note: single -e is NOT stripped — too aggressive for short words (time→tim, base→bas)
    const useStem = hintStem.length >= 4 && hintStem !== hintLower;

    // Irregular English base form: "was" → "be", "children" → "child"
    const irregBase = IRREGULAR_EN[hintLower] ?? null;

    // Helper: check if hint (or variants) matches a gloss string
    function hintMatchesGloss(gloss: string): boolean {
      const g = gloss.toLowerCase();
      if (g.includes(hintLower)) return true;
      if (useStem && g.includes(hintStem)) return true;
      if (irregBase && g.includes(irregBase)) return true;
      return false;
    }

    // Try German gloss first, then gloss_en fallback (LLMs often produce English hints).
    for (const pass of ["gloss", "gloss_en"] as const) {
      for (const candidate of entries) {
        for (let i = 0; i < candidate.senses.length; i++) {
          const gloss = candidate.senses[i][pass];
          if (gloss && hintMatchesGloss(gloss)) {
            entry = candidate;
            senseNumber = i + 1; // 1-based
            break;
          }
        }
        if (senseNumber) break;
      }
      if (senseNumber) break;
    }

    // synonyms_en fallback: check if hint appears in any sense's synonyms_en
    if (!senseNumber) {
      for (const candidate of entries) {
        for (let i = 0; i < candidate.senses.length; i++) {
          const syns = candidate.senses[i].synonyms_en;
          if (!syns) continue;
          for (const syn of syns) {
            if (hintMatchesGloss(syn)) {
              entry = candidate;
              senseNumber = i + 1;
              break;
            }
          }
          if (senseNumber) break;
        }
        if (senseNumber) break;
      }
    }

    // Word-level fallback: check if any word in the hint appears in any gloss.
    // Only used for homonym file resolution — no sense number assigned (too imprecise).
    if (!senseNumber && entries.length > 1) {
      const hintWords = hintLower.split(/\s+/).filter(w => w.length >= 3);
      if (hintWords.length > 0) {
        let wordMatch: WordLookupEntry | null = null;
        for (const pass of ["gloss", "gloss_en"] as const) {
          for (const candidate of entries) {
            for (const sense of candidate.senses) {
              const gloss = sense[pass];
              if (!gloss) continue;
              const glossLower = gloss.toLowerCase();
              if (hintWords.some(w => glossLower.includes(w))) {
                wordMatch = candidate;
                break;
              }
            }
            if (wordMatch) break;
          }
          if (wordMatch) break;
        }
        if (wordMatch) entry = wordMatch;
        // No senseNumber — word-level match is too imprecise for sense disambiguation
      }
    }
  }

  // Only include sense number when the entry has multiple senses —
  // for single-sense words, #1 is redundant noise.
  if (senseNumber && entry.senses.length <= 1) senseNumber = null;

  return { posDir: entry.posDir, file: entry.file, senseNumber };
}

/**
 * Find a form in text using word-boundary-aware matching.
 * Returns the start index or -1.
 */
export function findFormInText(text: string, form: string, startAfter: number): number {
  const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?<![\\wäöüÄÖÜß])${escaped}(?![\\wäöüÄÖÜß])`,
    "u",
  );
  const slice = text.slice(startAfter);
  const match = slice.match(re);
  return match && match.index != null ? startAfter + match.index : -1;
}

/**
 * Convert annotations into [[display|path]] reference tokens.
 * Returns the linked text, or null if no links were generated.
 */
export function annotateExampleText(
  text: string,
  annotations: Annotation[],
  lookup: Map<string, WordLookupEntry[]>,
): string | null {
  if (!annotations || annotations.length === 0) return null;

  const matches: TextMatch[] = [];

  for (const ann of annotations) {
    const target = resolveWordFile(ann.lemma, ann.pos, ann.gloss_hint, lookup);
    if (!target) continue;

    const idx = findFormInText(text, ann.form, 0);
    if (idx === -1) continue;

    let token = `[[${ann.form}|${target.posDir}/${target.file}`;
    if (target.senseNumber) token += `#${target.senseNumber}`;
    token += "]]";

    matches.push({
      start: idx,
      end: idx + ann.form.length,
      token,
    });
  }

  if (matches.length === 0) return null;

  // Sort by position, remove overlaps
  matches.sort((a, b) => a.start - b.start);
  const filtered: TextMatch[] = [matches[0]];
  for (let i = 1; i < matches.length; i++) {
    if (matches[i].start >= filtered[filtered.length - 1].end) {
      filtered.push(matches[i]);
    }
  }

  // Build result string
  let result = "";
  let pos = 0;
  for (const m of filtered) {
    result += text.slice(pos, m.start) + m.token;
    pos = m.end;
  }
  result += text.slice(pos);

  return result;
}

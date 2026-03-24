/**
 * Detect umlaut vowel change between singular and plural noun forms.
 * Returns the position and length of the umlauted segment in the plural string,
 * or null if no umlaut change is found.
 *
 * Supported changes: a→ä, o→ö, u→ü, au→äu (and uppercase variants).
 */

const UMLAUT_MAP: Record<string, string> = {
  a: "ä",
  o: "ö",
  u: "ü",
  A: "Ä",
  O: "Ö",
  U: "Ü",
};

export interface UmlautMatch {
  /** Character index in the plural string where the umlaut starts */
  index: number;
  /** Number of characters in the plural that form the umlaut (1 for ä/ö/ü, 2 for äu) */
  length: number;
}

export function findUmlaut(singular: string, plural: string): UmlautMatch | null {
  let i = 0; // singular index
  let j = 0; // plural index

  while (i < singular.length && j < plural.length) {
    if (singular[i] === plural[j]) {
      i++;
      j++;
      continue;
    }

    const sChar = singular[i];
    const expected = UMLAUT_MAP[sChar];
    if (!expected || plural[j] !== expected) return null;

    // Check for au→äu digraph
    if (sChar.toLowerCase() === "a" && singular[i + 1]?.toLowerCase() === "u" && plural[j + 1]?.toLowerCase() === "u") {
      return { index: j, length: 2 };
    }

    return { index: j, length: 1 };
  }

  return null;
}

export interface UmlautSplit {
  before: string;
  umlaut: string;
  after: string;
}

/**
 * Split a plural form into three segments: text before the umlaut,
 * the umlauted vowel(s), and text after.
 * Returns null if no umlaut change is detected.
 */
export function splitUmlaut(singular: string, plural: string): UmlautSplit | null {
  const match = findUmlaut(singular, plural);
  if (!match) return null;
  return {
    before: plural.slice(0, match.index),
    umlaut: plural.slice(match.index, match.index + match.length),
    after: plural.slice(match.index + match.length),
  };
}

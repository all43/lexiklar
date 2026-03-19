/**
 * Display-level text utilities.
 */

/**
 * Quote pairs recognised as "outer wrapper" quotes.
 * Each entry is [openingChar, closingChar].
 */
const QUOTE_PAIRS: [string, string][] = [
  ["\u201E", "\u201C"], // „ "  — German Anführungszeichen
  ["\u00BB", "\u00AB"], // » «  — German guillemets
  ["\u00AB", "\u00BB"], // « »  — Swiss / French guillemets
  ['"',      '"'      ], // " "  — ASCII double quotes
];

/**
 * Strip outer quotation marks from an example sentence if — and only if —
 * the inner text contains no quotes of the same type. This prevents
 * „pepper" und „butter" from becoming pepper" und „butter after stripping.
 *
 * Works on both plain text and text_linked markup (the [[…|…]] tokens are
 * never quote characters so they are unaffected).
 *
 * Examples:
 *   „Tourés Schwägerin betrat den Raum."  →  Tourés Schwägerin betrat den Raum.
 *   „Er kaufte „Pepper" und „Butter"."    →  unchanged (inner quotes present)
 *   „Er rief: »Komm her!«"                →  Er rief: »Komm her!«  (inner guillemets are a different type — safe)
 */
export function stripOuterQuotes(text: string): string {
  for (const [open, close] of QUOTE_PAIRS) {
    if (text.startsWith(open) && text.endsWith(close)) {
      const inner = text.slice(open.length, text.length - close.length);
      // Bail if the inner text contains the same quote characters
      if (inner.includes(open) || inner.includes(close)) return text;
      return inner;
    }
  }
  return text;
}

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
 * Strip outer quotation marks from an example sentence.
 *
 * Three cases handled:
 *
 * 1. **Balanced pair** — text starts with open AND ends with close, and the
 *    inner text contains neither quote character. Strips both.
 *    „Tourés Schwägerin betrat den Raum."  →  Tourés Schwägerin betrat den Raum.
 *    „Er kaufte „Pepper" und „Butter"."    →  unchanged (inner quotes present)
 *    „Er rief: »Komm her!«"                →  Er rief: »Komm her!«  (inner guillemets are a different type — safe)
 *
 * 2. **Orphaned opening** — text starts with open but does NOT end with the
 *    matching close (Wiktionary truncation artefact). Strips just the leading char.
 *    „Trotzdem gerät sein Inneres in Aufruhr.  →  Trotzdem gerät sein Inneres in Aufruhr.
 *
 * 3. **Orphaned closing** — text ends with close but does NOT start with the
 *    matching open. Strips just the trailing char.
 *    Trotzdem gerät sein Inneres in Aufruhr."  →  Trotzdem gerät sein Inneres in Aufruhr.
 *
 * 4. **Cross-pair** — text starts with an opener from one pair and ends with a
 *    closer from a *different* pair (mistyped/mixed quote). Strips both if the
 *    inner text contains neither quote character.
 *    „Gemischte Zeichen.«  →  Gemischte Zeichen.
 *    „Er rief »Komm!«.«   →  unchanged (inner « present)
 *
 * Note: ASCII `"` is symmetric (same char for open and close), so an orphaned
 * leading `"` in a sentence like `"Nein," sagte er.` will be stripped even
 * though the comma-quote is part of the text. This edge case is acceptable
 * because German Wiktionary examples rarely use ASCII quotes.
 *
 * Works on both plain text and text_linked markup (the [[…|…]] tokens are
 * never quote characters so they are unaffected).
 */
export function stripOuterQuotes(text: string): string {
  // Collect all recognised quote characters for guard checks
  const allOpeners = QUOTE_PAIRS.map(([o]) => o);
  const allClosers = QUOTE_PAIRS.map(([, c]) => c);

  for (const [open, close] of QUOTE_PAIRS) {
    const startsWithOpen = text.startsWith(open);
    const endsWithClose = text.endsWith(close);

    if (startsWithOpen && endsWithClose) {
      // Balanced pair — only strip if no same-type quotes inside
      const inner = text.slice(open.length, text.length - close.length);
      if (inner.includes(open) || inner.includes(close)) return text;
      return inner;
    }

    if (startsWithOpen && !endsWithClose) {
      // Orphaned opening — only strip if the tail isn't some other recognised
      // closing quote (which would indicate a mismatched-pair situation)
      const tailChar = text[text.length - 1];
      if (allClosers.includes(tailChar)) continue;
      return text.slice(open.length);
    }

    if (!startsWithOpen && endsWithClose) {
      // Orphaned closing — only strip if the head isn't some other recognised
      // opening quote
      const headChar = text[0];
      if (allOpeners.includes(headChar)) continue;
      return text.slice(0, text.length - close.length);
    }
  }

  // Cross-pair: opener and closer from different pairs (e.g. „...« — mistyped).
  // Strip if inner text contains neither the opener nor the closer.
  for (const [open] of QUOTE_PAIRS) {
    if (!text.startsWith(open)) continue;
    for (const [, close] of QUOTE_PAIRS) {
      if (!text.endsWith(close)) continue;
      const inner = text.slice(open.length, text.length - close.length);
      if (inner.includes(open) || inner.includes(close)) continue;
      return inner;
    }
  }

  return text;
}

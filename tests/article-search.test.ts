/**
 * Tests for article-stripping search logic and plural article correction.
 *
 * Covers:
 *  - stripArticle() parsing
 *  - dative plural form derivation
 *  - articleValid / correctArticle for artFormHits loop
 *  - wordListTitle display with/without articles
 */

import { describe, it, expect } from "vitest";
import { stripArticle, wordListTitle } from "../src/utils/word-list.js";

// ---------------------------------------------------------------------------
// Pure reimplementation of the artFormHits logic (SearchPage.vue)
// so we can unit-test it without spinning up Vue or a DB.
// ---------------------------------------------------------------------------

interface FakeResult {
  gender: string | null;
  pluralForm: string | null;
  pluralDominant: boolean;
}

type ArtFormOutcome =
  | { kind: "match" }
  | { kind: "mismatch"; articleMismatch: string; articleCorrect: string | undefined };

function classifyArtFormHit(
  artInfo: { article: string; remainder: string; genders: string[] },
  r: FakeResult,
): ArtFormOutcome {
  const remainderLower = artInfo.remainder.toLowerCase();
  const nomPl = r.pluralForm?.toLowerCase() ?? null;
  const datPl = nomPl
    ? !nomPl.endsWith("n") && !nomPl.endsWith("s")
      ? nomPl + "n"
      : nomPl
    : null;

  const isNomAccPl = nomPl != null && remainderLower === nomPl;
  const isDatPl = datPl != null && remainderLower === datPl;
  const isGenPl = isNomAccPl;

  const articleValid =
    (isNomAccPl && artInfo.article === "die") ||
    (isDatPl && artInfo.article === "den") ||
    (isGenPl && artInfo.article === "der") ||
    (artInfo.article === "die" && r.pluralDominant);

  const isAnyPl = isNomAccPl || isDatPl;
  const genderMatches =
    articleValid || (!isAnyPl && r.gender ? artInfo.genders.includes(r.gender) : false);

  if (genderMatches) {
    return { kind: "match" };
  } else if (isAnyPl) {
    const correctArticle = isDatPl && !isNomAccPl ? "den" : "die";
    return { kind: "mismatch", articleMismatch: artInfo.article, articleCorrect: correctArticle };
  } else {
    const correctArticle =
      r.gender === "M" ? "der" : r.gender === "F" ? "die" : r.gender === "N" ? "das" : undefined;
    return { kind: "mismatch", articleMismatch: artInfo.article, articleCorrect: correctArticle };
  }
}

// ---------------------------------------------------------------------------
// stripArticle
// ---------------------------------------------------------------------------

describe("stripArticle", () => {
  it("parses definite articles", () => {
    expect(stripArticle("der Tisch")).toEqual({ article: "der", remainder: "Tisch", genders: ["M"] });
    expect(stripArticle("die Frau")).toEqual({ article: "die", remainder: "Frau", genders: ["F"] });
    expect(stripArticle("das Kind")).toEqual({ article: "das", remainder: "Kind", genders: ["N"] });
    expect(stripArticle("den Mann")).toEqual({ article: "den", remainder: "Mann", genders: ["M"] });
    expect(stripArticle("dem Tisch")).toEqual({ article: "dem", remainder: "Tisch", genders: ["M", "N"] });
    expect(stripArticle("des Tisches")).toEqual({ article: "des", remainder: "Tisches", genders: ["M", "N"] });
  });

  it("parses indefinite articles, longest match first", () => {
    expect(stripArticle("einen Tisch")).toEqual({ article: "einen", remainder: "Tisch", genders: ["M"] });
    expect(stripArticle("einem Tisch")).toEqual({ article: "einem", remainder: "Tisch", genders: ["M", "N"] });
    expect(stripArticle("einer Frau")).toEqual({ article: "einer", remainder: "Frau", genders: ["F"] });
    expect(stripArticle("eines Kindes")).toEqual({ article: "eines", remainder: "Kindes", genders: ["M", "N"] });
    expect(stripArticle("eine Frau")).toEqual({ article: "eine", remainder: "Frau", genders: ["F"] });
    expect(stripArticle("ein Tisch")).toEqual({ article: "ein", remainder: "Tisch", genders: ["M", "N"] });
  });

  it("is case-insensitive for the article", () => {
    expect(stripArticle("Die Frau")).toEqual({ article: "die", remainder: "Frau", genders: ["F"] });
    expect(stripArticle("DER Tisch")).toEqual({ article: "der", remainder: "Tisch", genders: ["M"] });
  });

  it("preserves original casing of the remainder", () => {
    expect(stripArticle("die Tische")!.remainder).toBe("Tische");
    expect(stripArticle("der tisch")!.remainder).toBe("tisch");
  });

  it("returns null when no article prefix", () => {
    expect(stripArticle("Tisch")).toBeNull();
    expect(stripArticle("Frau")).toBeNull();
    expect(stripArticle("")).toBeNull();
  });

  it("returns null when remainder is too short (< 2 chars)", () => {
    expect(stripArticle("die X")).toBeNull();
    expect(stripArticle("der A")).toBeNull();
  });

  it("returns null for plain article without a following word", () => {
    expect(stripArticle("die")).toBeNull();
    expect(stripArticle("der")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dative plural derivation
// ---------------------------------------------------------------------------

describe("dative plural derivation", () => {
  function datPl(nomPlural: string): string {
    const n = nomPlural.toLowerCase();
    return !n.endsWith("n") && !n.endsWith("s") ? n + "n" : n;
  }

  it("adds -n for most nouns", () => {
    expect(datPl("Tische")).toBe("tischen");   // Tisch → Tische / Tischen
    expect(datPl("Bücher")).toBe("büchern");   // Buch → Bücher / Büchern
    expect(datPl("Städte")).toBe("städten");   // Stadt → Städte / Städten
    expect(datPl("Männer")).toBe("männern");
  });

  it("does not add -n when nominative plural already ends in -n", () => {
    expect(datPl("Frauen")).toBe("frauen");    // nom/dat pl identical
    expect(datPl("Kinder")).toBe("kindern");   // ends in -r, not -n → adds n
    expect(datPl("Augen")).toBe("augen");      // already ends in -n
    expect(datPl("Häfen")).toBe("häfen");
  });

  it("does not add -n when nominative plural ends in -s", () => {
    expect(datPl("Autos")).toBe("autos");
    expect(datPl("Sofas")).toBe("sofas");
    expect(datPl("Parks")).toBe("parks");
  });
});

// ---------------------------------------------------------------------------
// artFormHits classification — nom/acc plural
// ---------------------------------------------------------------------------

describe("classifyArtFormHit — nominative/accusative plural", () => {
  const tisch: FakeResult = { gender: "M", pluralForm: "Tische", pluralDominant: false };
  const buch: FakeResult  = { gender: "N", pluralForm: "Bücher", pluralDominant: false };
  const frau: FakeResult  = { gender: "F", pluralForm: "Frauen", pluralDominant: false };

  it("die Tische → match (correct plural article)", () => {
    const art = stripArticle("die Tische")!;
    expect(classifyArtFormHit(art, tisch)).toEqual({ kind: "match" });
  });

  it("die Bücher → match (correct plural article, neuter noun)", () => {
    const art = stripArticle("die Bücher")!;
    expect(classifyArtFormHit(art, buch)).toEqual({ kind: "match" });
  });

  it("die Frauen → match (correct article, -n plural = nom and dat)", () => {
    const art = stripArticle("die Frauen")!;
    expect(classifyArtFormHit(art, frau)).toEqual({ kind: "match" });
  });

  it("der Tische → match (genitive plural — same form as nom pl)", () => {
    const art = stripArticle("der Tische")!;
    expect(classifyArtFormHit(art, tisch)).toEqual({ kind: "match" });
  });

  it("den Tische → mismatch, correct is die (nom pl used with dative article)", () => {
    const art = stripArticle("den Tische")!;
    const out = classifyArtFormHit(art, tisch);
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "den", articleCorrect: "die" });
  });

  it("das Tische → mismatch, correct is die", () => {
    const art = stripArticle("das Tische")!;
    const out = classifyArtFormHit(art, tisch);
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "das", articleCorrect: "die" });
  });

  it("der Tisch → mismatch, correct is der (singular masculine gender match)", () => {
    // 'der Tisch' hits artLemmaHits not artFormHits, but test the form path anyway
    const art = stripArticle("der Tisch")!; // genders: ["M"]
    // Remainder "Tisch" ≠ pluralForm "Tische" → isNomAccPl=false, isDatPl=false
    // Falls back to singular gender match: gender M ∈ ["M"] → match
    expect(classifyArtFormHit(art, tisch)).toEqual({ kind: "match" });
  });
});

// ---------------------------------------------------------------------------
// artFormHits classification — dative plural
// ---------------------------------------------------------------------------

describe("classifyArtFormHit — dative plural", () => {
  const tisch: FakeResult = { gender: "M", pluralForm: "Tische", pluralDominant: false };
  const buch: FakeResult  = { gender: "N", pluralForm: "Bücher", pluralDominant: false };

  it("den Tischen → match (correct dative plural article)", () => {
    const art = stripArticle("den Tischen")!;
    expect(classifyArtFormHit(art, tisch)).toEqual({ kind: "match" });
  });

  it("den Büchern → match", () => {
    const art = stripArticle("den Büchern")!;
    expect(classifyArtFormHit(art, buch)).toEqual({ kind: "match" });
  });

  it("die Tischen → mismatch, correct is den", () => {
    const art = stripArticle("die Tischen")!;
    const out = classifyArtFormHit(art, tisch);
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "die", articleCorrect: "den" });
  });

  it("das Tischen → mismatch, correct is den", () => {
    const art = stripArticle("das Tischen")!;
    const out = classifyArtFormHit(art, tisch);
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "das", articleCorrect: "den" });
  });

  it("der Tischen → mismatch, correct is den", () => {
    const art = stripArticle("der Tischen")!;
    const out = classifyArtFormHit(art, tisch);
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "der", articleCorrect: "den" });
  });
});

// ---------------------------------------------------------------------------
// artFormHits classification — nouns where nom/acc/dat plural are identical (-n, -s endings)
// ---------------------------------------------------------------------------

describe("classifyArtFormHit — nouns where nom pl = dat pl", () => {
  // Frauen: nom pl = dat pl = "Frauen" (already ends in -n)
  const frau: FakeResult = { gender: "F", pluralForm: "Frauen", pluralDominant: false };
  // Autos: nom pl = dat pl = "Autos" (ends in -s)
  const auto: FakeResult = { gender: "N", pluralForm: "Autos", pluralDominant: false };

  it("die Frauen → match (both nom and dat pl accepted with 'die')", () => {
    expect(classifyArtFormHit(stripArticle("die Frauen")!, frau)).toEqual({ kind: "match" });
  });

  it("den Frauen → match (dative plural, dat pl = nom pl for Frauen)", () => {
    expect(classifyArtFormHit(stripArticle("den Frauen")!, frau)).toEqual({ kind: "match" });
  });

  it("den Autos → match (dative plural = nom pl for -s nouns)", () => {
    expect(classifyArtFormHit(stripArticle("den Autos")!, auto)).toEqual({ kind: "match" });
  });

  it("das Frauen → mismatch, correct is die (nom/dat ambiguous, suggest die)", () => {
    const out = classifyArtFormHit(stripArticle("das Frauen")!, frau);
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "das", articleCorrect: "die" });
  });
});

// ---------------------------------------------------------------------------
// artFormHits classification — plural-dominant nouns
// ---------------------------------------------------------------------------

describe("classifyArtFormHit — plural-dominant nouns", () => {
  const schuhe: FakeResult = { gender: "M", pluralForm: "Schuhe", pluralDominant: true };

  it("die Schuhe → match via pluralDominant flag", () => {
    expect(classifyArtFormHit(stripArticle("die Schuhe")!, schuhe)).toEqual({ kind: "match" });
  });

  it("den Schuhe → mismatch (pluralDominant doesn't override wrong form-based check)", () => {
    // "Schuhe" is nom pl, article "den" is wrong → mismatch, correct "die"
    const out = classifyArtFormHit(stripArticle("den Schuhe")!, schuhe);
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "den", articleCorrect: "die" });
  });
});

// ---------------------------------------------------------------------------
// artFormHits classification — singular form fallback (not a plural hit)
// ---------------------------------------------------------------------------

describe("classifyArtFormHit — singular form (not matching plural)", () => {
  const tisch: FakeResult = { gender: "M", pluralForm: "Tische", pluralDominant: false };
  const frau: FakeResult  = { gender: "F", pluralForm: "Frauen", pluralDominant: false };
  const kind: FakeResult  = { gender: "N", pluralForm: "Kinder", pluralDominant: false };

  it("der Tisch → match (singular M with correct article)", () => {
    expect(classifyArtFormHit(stripArticle("der Tisch")!, tisch)).toEqual({ kind: "match" });
  });

  it("die Frau → match (singular F with correct article)", () => {
    expect(classifyArtFormHit(stripArticle("die Frau")!, frau)).toEqual({ kind: "match" });
  });

  it("das Kind → match (singular N with correct article)", () => {
    expect(classifyArtFormHit(stripArticle("das Kind")!, kind)).toEqual({ kind: "match" });
  });

  it("das Tisch → mismatch, correct is der (singular M with wrong article)", () => {
    const out = classifyArtFormHit(stripArticle("das Tisch")!, tisch);
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "das", articleCorrect: "der" });
  });

  it("der Frau → mismatch, correct is die", () => {
    const out = classifyArtFormHit(stripArticle("der Frau")!, frau);
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "der", articleCorrect: "die" });
  });

  it("der Kind → mismatch, correct is das", () => {
    const out = classifyArtFormHit(stripArticle("der Kind")!, kind);
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "der", articleCorrect: "das" });
  });
});

// ---------------------------------------------------------------------------
// artFormHits classification — null pluralForm (no plural data)
// ---------------------------------------------------------------------------

describe("classifyArtFormHit — null pluralForm", () => {
  const noPl: FakeResult = { gender: "M", pluralForm: null, pluralDominant: false };

  it("falls back to singular gender matching when no plural data", () => {
    expect(classifyArtFormHit(stripArticle("der Tisch")!, noPl)).toEqual({ kind: "match" });
  });

  it("mismatch with correct singular article when no plural data", () => {
    const out = classifyArtFormHit(stripArticle("die Tisch")!, noPl);
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "die", articleCorrect: "der" });
  });
});

// ---------------------------------------------------------------------------
// wordListTitle display
// ---------------------------------------------------------------------------

describe("wordListTitle", () => {
  it("shows lemma by default", () => {
    expect(wordListTitle({ lemma: "Tisch", gender: "M" }, false)).toBe("Tisch");
  });

  it("prepends article when showArticles=true", () => {
    expect(wordListTitle({ lemma: "Tisch", gender: "M" }, true)).toBe("der Tisch");
    expect(wordListTitle({ lemma: "Frau", gender: "F" }, true)).toBe("die Frau");
    expect(wordListTitle({ lemma: "Kind", gender: "N" }, true)).toBe("das Kind");
  });

  it("shows plural form as title for plural-dominant nouns", () => {
    expect(wordListTitle({ lemma: "Schuh", pluralForm: "Schuhe", pluralDominant: true, gender: "M" }, false)).toBe("Schuhe");
    expect(wordListTitle({ lemma: "Schuh", pluralForm: "Schuhe", pluralDominant: true, gender: "M" }, true)).toBe("Schuhe");
  });

  it("does NOT show plural form for non-plural-dominant nouns even with pluralForm set", () => {
    expect(wordListTitle({ lemma: "Tisch", pluralForm: "Tische", pluralDominant: false, gender: "M" }, false)).toBe("Tisch");
    expect(wordListTitle({ lemma: "Tisch", pluralForm: "Tische", pluralDominant: false, gender: "M" }, true)).toBe("der Tisch");
  });

  it("shows lemma when gender is absent (no article prepended)", () => {
    expect(wordListTitle({ lemma: "laufen", gender: null }, true)).toBe("laufen");
  });
});

// ---------------------------------------------------------------------------
// Wiktionary form stripping (mirrors extractNounCaseForms in transform.ts)
// Strips embedded article prefixes from Wiktionary noun forms.
// ---------------------------------------------------------------------------

/**
 * Mirrors the stripping logic in extractNounCaseForms (transform.ts).
 * Returns the cleaned form, or null if the form should be skipped (noise).
 */
function stripWiktionaryFormPrefix(raw: string): string | null {
  let form = raw
    .replace(/^\([^)]+\)\s*/, "")  // strip "(article) " prefix
    .replace(/^(?:der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines)\s+/i, ""); // strip "article " prefix
  if (!form || /[ ()[\]]/.test(form)) return null;
  return form;
}

describe("Wiktionary form stripping — parenthesized article prefix", () => {
  it("strips (das) prefix", () => {
    expect(stripWiktionaryFormPrefix("(das) Abasinisch")).toBe("Abasinisch");
  });

  it("strips (des) prefix", () => {
    expect(stripWiktionaryFormPrefix("(des) Niederländisch")).toBe("Niederländisch");
    expect(stripWiktionaryFormPrefix("(des) Niederländischs")).toBe("Niederländischs");
  });

  it("strips (dem) prefix", () => {
    expect(stripWiktionaryFormPrefix("(dem) Abasinisch")).toBe("Abasinisch");
  });

  it("strips (den) prefix", () => {
    expect(stripWiktionaryFormPrefix("(den) Weg")).toBe("Weg");
  });
});

describe("Wiktionary form stripping — bare article prefix", () => {
  it("strips bare 'des' prefix", () => {
    expect(stripWiktionaryFormPrefix("des Niederländischen")).toBe("Niederländischen");
    expect(stripWiktionaryFormPrefix("des Afrikaans")).toBe("Afrikaans");
  });

  it("strips bare 'des' prefix leaving apostrophe", () => {
    expect(stripWiktionaryFormPrefix("des Afrikaans'")).toBe("Afrikaans'");
  });

  it("strips bare 'das' prefix", () => {
    expect(stripWiktionaryFormPrefix("das Niederländische")).toBe("Niederländische");
    expect(stripWiktionaryFormPrefix("das Englische")).toBe("Englische");
  });

  it("strips bare 'dem' prefix", () => {
    expect(stripWiktionaryFormPrefix("dem Niederländischen")).toBe("Niederländischen");
  });

  it("strips bare 'die' prefix", () => {
    expect(stripWiktionaryFormPrefix("die Abasinische")).toBe("Abasinische");
  });
});

describe("Wiktionary form stripping — clean forms (no stripping needed)", () => {
  it("leaves normal forms unchanged", () => {
    expect(stripWiktionaryFormPrefix("Tisches")).toBe("Tisches");
    expect(stripWiktionaryFormPrefix("Tische")).toBe("Tische");
    expect(stripWiktionaryFormPrefix("Tischen")).toBe("Tischen");
    expect(stripWiktionaryFormPrefix("Märzen")).toBe("Märzen");
    expect(stripWiktionaryFormPrefix("Frauen")).toBe("Frauen");
  });

  it("leaves form with apostrophe unchanged", () => {
    expect(stripWiktionaryFormPrefix("Afrikaans'")).toBe("Afrikaans'");
  });
});

describe("Wiktionary form stripping — noise forms (should return null)", () => {
  it("returns null for numbered reference forms", () => {
    expect(stripWiktionaryFormPrefix("[1] 01., 1., Ⅰ., I.")).toBeNull();
    expect(stripWiktionaryFormPrefix("[6] Formelzeichen: s")).toBeNull();
    expect(stripWiktionaryFormPrefix("[3] ♓ (das Tierkreiszeichen)")).toBeNull();
  });

  it("returns null for chemical/formula codes with spaces", () => {
    expect(stripWiktionaryFormPrefix("E 513")).toBeNull();
    expect(stripWiktionaryFormPrefix("E 949")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(stripWiktionaryFormPrefix("")).toBeNull();
  });

  it("returns null for form that is only an article (nothing left after strip)", () => {
    // e.g. if Wiktionary had "(des)" with nothing after — pathological case
    expect(stripWiktionaryFormPrefix("(des)")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyArtLemmaHit — nominative lemma form typed after an article
// ---------------------------------------------------------------------------

const GENITIVE_ARTICLES = new Set(["des", "eines"]);
const ACCUSATIVE_ARTICLES = new Set(["den", "einen"]);
const DATIVE_ARTICLES = new Set(["dem", "einem"]);

function classifyArtLemmaHit(
  artInfo: { article: string; genders: string[] },
  r: { gender: string | null; pluralDominant: boolean; accForm?: string | null },
): ArtFormOutcome {
  const genderMatches = r.gender
    ? artInfo.genders.includes(r.gender) || (artInfo.article === "die" && r.pluralDominant)
    : false;
  if (genderMatches) {
    const isNonNomArticle =
      GENITIVE_ARTICLES.has(artInfo.article) ||
      (r.accForm != null && (ACCUSATIVE_ARTICLES.has(artInfo.article) || DATIVE_ARTICLES.has(artInfo.article)));
    if (isNonNomArticle) {
      const correctArticle = r.gender === "M" ? "der" : r.gender === "F" ? "die" : "das";
      return { kind: "mismatch", articleMismatch: artInfo.article, articleCorrect: correctArticle };
    }
    return { kind: "match" };
  } else {
    const correctArticle =
      r.gender === "M" ? "der" : r.gender === "F" ? "die" : r.gender === "N" ? "das" : undefined;
    return { kind: "mismatch", articleMismatch: artInfo.article, articleCorrect: correctArticle };
  }
}

describe("classifyArtLemmaHit — nominative/accusative/dative articles → match", () => {
  it("der Tisch → match (nominative M)", () => {
    expect(classifyArtLemmaHit({ article: "der", genders: ["M"] }, { gender: "M", pluralDominant: false }))
      .toEqual({ kind: "match" });
  });
  it("die Frau → match (nominative F)", () => {
    expect(classifyArtLemmaHit({ article: "die", genders: ["F"] }, { gender: "F", pluralDominant: false }))
      .toEqual({ kind: "match" });
  });
  it("das Kind → match (nominative N)", () => {
    expect(classifyArtLemmaHit({ article: "das", genders: ["N"] }, { gender: "N", pluralDominant: false }))
      .toEqual({ kind: "match" });
  });
  it("ein Tisch → match (indefinite nom M)", () => {
    expect(classifyArtLemmaHit({ article: "ein", genders: ["M", "N"] }, { gender: "M", pluralDominant: false }))
      .toEqual({ kind: "match" });
  });
  it("eine Frau → match (indefinite nom F)", () => {
    expect(classifyArtLemmaHit({ article: "eine", genders: ["F"] }, { gender: "F", pluralDominant: false }))
      .toEqual({ kind: "match" });
  });
  // acc = nom for 96% of nouns (no accForm) — valid phrase, no correction
  it("den Tisch → match (accusative M, acc=nom, no accForm)", () => {
    expect(classifyArtLemmaHit({ article: "den", genders: ["M"] }, { gender: "M", pluralDominant: false, accForm: null }))
      .toEqual({ kind: "match" });
  });
  it("einen Tisch → match (indefinite accusative M, acc=nom)", () => {
    expect(classifyArtLemmaHit({ article: "einen", genders: ["M"] }, { gender: "M", pluralDominant: false, accForm: null }))
      .toEqual({ kind: "match" });
  });
  // dat = nom for 94% of nouns (no accForm) — valid phrase, no correction
  it("dem Tisch → match (dative M, dat=nom, no accForm)", () => {
    expect(classifyArtLemmaHit({ article: "dem", genders: ["M", "N"] }, { gender: "M", pluralDominant: false, accForm: null }))
      .toEqual({ kind: "match" });
  });
  it("einem Kind → match (indefinite dative N, acc=nom)", () => {
    expect(classifyArtLemmaHit({ article: "einem", genders: ["M", "N"] }, { gender: "N", pluralDominant: false, accForm: null }))
      .toEqual({ kind: "match" });
  });
  // F gen/dat = nom for 96% — valid phrase, no correction
  it("einer Frau → match (indefinite genitive/dative F, gen=nom)", () => {
    expect(classifyArtLemmaHit({ article: "einer", genders: ["F"] }, { gender: "F", pluralDominant: false, accForm: null }))
      .toEqual({ kind: "match" });
  });
});

describe("classifyArtLemmaHit — n-declension (accForm set): acc/dat articles also corrected", () => {
  // n-declension: acc ≠ nom (e.g. Mensch → acc: Menschen). accForm = "Menschen"
  it("den Mensch → not den → der (n-declension, acc≠nom)", () => {
    const out = classifyArtLemmaHit({ article: "den", genders: ["M"] }, { gender: "M", pluralDominant: false, accForm: "Menschen" });
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "den", articleCorrect: "der" });
  });
  it("dem Mensch → not dem → der (n-declension, dat≠nom)", () => {
    const out = classifyArtLemmaHit({ article: "dem", genders: ["M", "N"] }, { gender: "M", pluralDominant: false, accForm: "Menschen" });
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "dem", articleCorrect: "der" });
  });
  it("einen Affe → not einen → der (n-declension, acc≠nom)", () => {
    const out = classifyArtLemmaHit({ article: "einen", genders: ["M"] }, { gender: "M", pluralDominant: false, accForm: "Affen" });
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "einen", articleCorrect: "der" });
  });
  it("einem Affe → not einem → der (n-declension, dat≠nom)", () => {
    const out = classifyArtLemmaHit({ article: "einem", genders: ["M", "N"] }, { gender: "M", pluralDominant: false, accForm: "Affen" });
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "einem", articleCorrect: "der" });
  });
  // genitive already corrected regardless of accForm
  it("des Mensch → not des → der (genitive always corrected)", () => {
    const out = classifyArtLemmaHit({ article: "des", genders: ["M", "N"] }, { gender: "M", pluralDominant: false, accForm: "Menschen" });
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "des", articleCorrect: "der" });
  });
});

describe("classifyArtLemmaHit — genitive articles + lemma form → correction to nominative", () => {
  // gen ≠ nom for 94% of M nouns, 91% of N nouns
  it("des Tisch → not des → der", () => {
    const out = classifyArtLemmaHit({ article: "des", genders: ["M", "N"] }, { gender: "M", pluralDominant: false });
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "des", articleCorrect: "der" });
  });
  it("des Kind → not des → das", () => {
    const out = classifyArtLemmaHit({ article: "des", genders: ["M", "N"] }, { gender: "N", pluralDominant: false });
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "des", articleCorrect: "das" });
  });
  it("eines Kind → not eines → ein", () => {
    const out = classifyArtLemmaHit({ article: "eines", genders: ["M", "N"] }, { gender: "N", pluralDominant: false });
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "eines", articleCorrect: "das" });
  });
});

describe("classifyArtLemmaHit — wrong gender → correction", () => {
  it("das Tisch → not das → der", () => {
    const out = classifyArtLemmaHit({ article: "das", genders: ["N"] }, { gender: "M", pluralDominant: false });
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "das", articleCorrect: "der" });
  });
  it("die Tisch → not die → der", () => {
    const out = classifyArtLemmaHit({ article: "die", genders: ["F"] }, { gender: "M", pluralDominant: false });
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "die", articleCorrect: "der" });
  });
  it("des Frau → not des → die (gender mismatch wins)", () => {
    const out = classifyArtLemmaHit({ article: "des", genders: ["M", "N"] }, { gender: "F", pluralDominant: false });
    expect(out).toEqual({ kind: "mismatch", articleMismatch: "des", articleCorrect: "die" });
  });
});

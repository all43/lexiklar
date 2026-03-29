/**
 * Test three sense-ordering strategies against expected first-sense for B2 learners.
 *
 * Each test case defines the word file path and the gloss_en that should appear first.
 * Strategies are scored by how many words they get right.
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

interface Sense {
  gloss_en: string | null;
  tags: string[];
  example_ids?: string[];
  _ref_count?: number; // populated at runtime from annotation scan
}

interface WordData {
  word: string;
  pos: string;
  zipf?: number;
  senses: Sense[];
}

// ─── Test cases: [file, expected first gloss_en] ───
// The expected value is what a B2 German learner should see first.

const TEST_CASES: [string, string][] = [
  // ═══ Function words (25) — Wiktionary order is usually correct ═══
  ["prepositions/in", "in"],
  ["prepositions/auf", "on"],
  ["prepositions/zu", "toward"],
  ["prepositions/bei", "with"],
  ["prepositions/zwischen", "between (location)"],
  ["prepositions/für", "for"],
  ["prepositions/um", "around"],
  ["prepositions/über", "above"],
  ["conjunctions/und", "and"],
  ["conjunctions/wenn", "if"],
  ["conjunctions/als", "than"],
  ["conjunctions/aber", "but"],
  ["conjunctions/ob", "whether"],
  ["particles/nicht", "not"],
  ["particles/nur", "only"],
  ["particles/bis", "until"],
  ["adverbs/da", "there"],
  ["adverbs/immer", "always"],
  ["adverbs/je", "ever"],
  ["adverbs/noch", "still (present)"],  // "furthermore" is Wiktionary first but "still" is the B2 meaning
  ["adverbs/wo", "where"],
  ["adverbs/nun", "now"],
  ["pronouns/es", "it"],
  ["pronouns/man", "one"],              // impersonal "man" = "one/you" is the core B2 meaning
  ["determiners/ein", "a (masc)"],

  // ═══ Nouns (25) — primary everyday meaning ═══
  ["nouns/Ei", "egg (food)"],
  ["nouns/Tag_zeitraum", "day"],
  ["nouns/Land", "country"],
  ["nouns/Zug", "train"],
  ["nouns/Film", "movie"],
  ["nouns/Auto_automobil", "car"],
  ["nouns/Idee", "idea"],
  ["nouns/Weg", "path"],
  ["nouns/Wasser", "water"],
  ["nouns/Spiel", "play"],
  ["nouns/Seite", "side"],
  ["nouns/Arbeit", "task"],
  ["nouns/Welt", "world (society)"],
  ["nouns/Recht", "right"],
  ["nouns/Ordnung", "order"],
  ["nouns/Musik", "music"],
  ["nouns/Doktor", "doctor"],
  ["nouns/Zeug", "stuff"],
  ["nouns/Kumpel", "friend"],
  ["nouns/Killer", "killer"],
  ["nouns/Pass", "passport"],
  ["nouns/Schlüssel", "key"],
  ["nouns/Staat", "state"],
  ["nouns/Zustand", "condition"],
  ["nouns/Lauf", "run (noun)"],

  // ═══ Verbs (25) — primary everyday meaning ═══
  ["verbs/haben", "have (auxiliary)"],
  ["verbs/lassen", "leave (unchanged)"],
  ["verbs/geben", "hand"],
  ["verbs/fahren", "drive"],
  ["verbs/treffen", "meet"],
  ["verbs/ziehen", "pull"],
  ["verbs/stellen", "stand"],
  ["verbs/kriegen", "get"],
  ["verbs/leben", "live"],
  ["verbs/leisten", "accomplish"],       // "indulge" is Wiktionary first but "accomplish/achieve" is B2 core
  ["verbs/treten", "step on"],
  ["verbs/bauen", "construct"],
  ["verbs/verschwinden", "vanish"],
  ["verbs/melden", "report"],
  ["verbs/werfen", "throw"],
  ["verbs/leiden", "suffer"],
  ["verbs/schießen", "fire"],
  ["verbs/ergeben", "result in"],
  ["verbs/scheinen", "shine"],
  ["verbs/wirken", "work"],
  ["verbs/fangen", "capture"],
  ["verbs/vertreten", "represent"],
  ["verbs/unterhalten_etwas", "entertain"],
  ["verbs/liefern", "deliver"],
  ["verbs/verhalten_zurückhalten", "suppress"],

  // ═══ Adjectives (25) — primary everyday meaning ═══
  ["adjectives/gut", "good"],
  ["adjectives/einfach", "easy"],
  ["adjectives/hoch", "high (position)"],
  ["adjectives/stark", "powerful"],
  ["adjectives/kurz", "short"],
  ["adjectives/egal", "indifferent"],
  ["adjectives/aktiv", "engaged"],
  ["adjectives/positiv", "favorable"],
  ["adjectives/schwarz", "black"],
  ["adjectives/scharf", "sharp"],
  ["adjectives/sauber", "clean"],
  ["adjectives/negativ", "unfavorable"],
  ["adjectives/grün", "green"],
  ["adjectives/dick", "thick"],
  ["adjectives/trocken", "dry"],
  ["adjectives/blind", "sightless"],
  ["adjectives/ordentlich", "tidy"],
  ["adjectives/fein", "fine"],
  ["adjectives/schief", "slanted"],
  ["adjectives/wild", "untamed"],
  ["adjectives/nackt", "nude"],
  ["adjectives/hell", "bright"],
  ["adjectives/kräftig", "strong"],
  ["adjectives/glatt", "smooth"],
  ["adjectives/satt", "full"],
];

// ─── Strategies ───

const DEMOTED_STRICT = new Set(["colloquial", "derogatory", "vulgar", "slang", "informal", "figurative", "plural-only"]);
const DEMOTED_MILD = new Set(["derogatory", "vulgar", "slang"]);

type Strategy = (senses: Sense[]) => Sense[];

// Strategy A: Current algorithm — demote colloquial+informal, sort by example count
const strategyA: Strategy = (senses) => {
  const isDemoted = (s: Sense) => s.tags?.some((t) => DEMOTED_STRICT.has(t)) ? 1 : 0;
  return [...senses].sort(
    (a, b) => isDemoted(a) - isDemoted(b) || (b.example_ids?.length ?? 0) - (a.example_ids?.length ?? 0),
  );
};

// Strategy B: Only demote vulgar/derogatory/slang (keep colloquial/informal), sort by example count
const strategyB: Strategy = (senses) => {
  const isDemoted = (s: Sense) => s.tags?.some((t) => DEMOTED_MILD.has(t)) ? 1 : 0;
  return [...senses].sort(
    (a, b) => isDemoted(a) - isDemoted(b) || (b.example_ids?.length ?? 0) - (a.example_ids?.length ?? 0),
  );
};

// Strategy C: Only reorder if margin >= 3 examples AND original first has <= 2 examples;
//             demote only vulgar/derogatory/slang; otherwise keep Wiktionary order
const strategyC: Strategy = (senses) => {
  const isDemoted = (s: Sense) => s.tags?.some((t) => DEMOTED_MILD.has(t)) ? 1 : 0;
  return [...senses].sort((a, b) => {
    // Always push demoted senses to the end
    const dA = isDemoted(a);
    const dB = isDemoted(b);
    if (dA !== dB) return dA - dB;

    // Within non-demoted: only reorder if strong signal
    const exA = a.example_ids?.length ?? 0;
    const exB = b.example_ids?.length ?? 0;
    const margin = Math.abs(exA - exB);
    const minEx = Math.min(exA, exB);
    if (margin >= 3 && minEx <= 2) return exB - exA;

    // Otherwise preserve original order (stable sort)
    return 0;
  });
};

// Strategy D: POS-aware — keep Wiktionary order for function words, use Strategy C for content words
//             (requires POS passed via wrapper)
function makeStrategyD(pos: string): Strategy {
  const FUNCTION_POS = new Set(["preposition", "conjunction", "particle", "adverb", "pronoun", "determiner"]);
  if (FUNCTION_POS.has(pos)) return (senses) => [...senses];
  return strategyC;
}

// Strategy E: Lower margin (2 instead of 3), demote only vulgar/derog/slang,
//             but if ALL senses share the same demoted tag, ignore tags (sort within them)
const strategyE: Strategy = (senses) => {
  const isDemoted = (s: Sense) => s.tags?.some((t) => DEMOTED_MILD.has(t)) ? 1 : 0;
  const allSameTag = senses.length > 0 && senses.every((s) => isDemoted(s) === isDemoted(senses[0]));
  return [...senses].sort((a, b) => {
    if (!allSameTag) {
      const dA = isDemoted(a);
      const dB = isDemoted(b);
      if (dA !== dB) return dA - dB;
    }
    const exA = a.example_ids?.length ?? 0;
    const exB = b.example_ids?.length ?? 0;
    const margin = Math.abs(exA - exB);
    const minEx = Math.min(exA, exB);
    if (margin >= 2 && minEx <= 2) return exB - exA;
    return 0;
  });
};

// Strategy F: POS-aware (like D) + margin 2 + ignore tags when all senses share same tag
//             Combines the best ideas from D and E
function makeStrategyF(pos: string): Strategy {
  const FUNCTION_POS = new Set(["preposition", "conjunction", "particle", "adverb", "pronoun", "determiner"]);
  if (FUNCTION_POS.has(pos)) return (senses) => [...senses];
  return strategyE;
}

// Strategy G: Demote "specialist" tags (outdated/historical/physics/archaic/special),
//             NOT colloquial/derogatory. Margin 2. Deduplicate shared example IDs.
const SPECIALIST_TAGS = new Set(["outdated", "historical", "physics", "archaic", "special", "Swiss Standard German", "Austrian German"]);
const strategyG: Strategy = (senses) => {
  // Collect all example IDs to detect shared ones
  const idCounts = new Map<string, number>();
  for (const s of senses) {
    for (const id of s.example_ids ?? []) {
      idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    }
  }
  // Count only unique (non-shared) examples per sense
  const uniqueExCount = (s: Sense) => (s.example_ids ?? []).filter((id) => (idCounts.get(id) ?? 0) === 1).length;

  const isSpecialist = (s: Sense) => s.tags?.some((t) => SPECIALIST_TAGS.has(t)) ? 1 : 0;
  return [...senses].sort((a, b) => {
    const sA = isSpecialist(a);
    const sB = isSpecialist(b);
    if (sA !== sB) return sA - sB;

    const exA = uniqueExCount(a);
    const exB = uniqueExCount(b);
    const margin = Math.abs(exA - exB);
    const minEx = Math.min(exA, exB);
    if (margin >= 2 && minEx <= 2) return exB - exA;
    return 0;
  });
};

// Strategy H: Like G but also uses total (non-deduplicated) example count as tiebreaker
//             when unique counts are equal
const strategyH: Strategy = (senses) => {
  const idCounts = new Map<string, number>();
  for (const s of senses) {
    for (const id of s.example_ids ?? []) {
      idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    }
  }
  const uniqueExCount = (s: Sense) => (s.example_ids ?? []).filter((id) => (idCounts.get(id) ?? 0) === 1).length;
  const totalExCount = (s: Sense) => s.example_ids?.length ?? 0;

  const isSpecialist = (s: Sense) => s.tags?.some((t) => SPECIALIST_TAGS.has(t)) ? 1 : 0;
  return [...senses].sort((a, b) => {
    const sA = isSpecialist(a);
    const sB = isSpecialist(b);
    if (sA !== sB) return sA - sB;

    const uA = uniqueExCount(a);
    const uB = uniqueExCount(b);
    const margin = Math.abs(uA - uB);
    const minU = Math.min(uA, uB);
    if (margin >= 2 && minU <= 2) return uB - uA;

    // Tiebreaker: total example count with same margin rule
    const tA = totalExCount(a);
    const tB = totalExCount(b);
    const tMargin = Math.abs(tA - tB);
    const tMin = Math.min(tA, tB);
    if (tMargin >= 2 && tMin <= 2) return tB - tA;

    return 0;
  });
};

// Strategy I: Like G but POS-aware (keep Wiktionary for function words)
function makeStrategyI(pos: string): Strategy {
  const FUNCTION_POS = new Set(["preposition", "conjunction", "particle", "adverb", "pronoun", "determiner"]);
  if (FUNCTION_POS.has(pos)) return (senses) => [...senses];
  return strategyG;
}

// Strategy J: Like C but uses ref_count (annotation references) instead of owned example_ids
const strategyJ: Strategy = (senses) => {
  const isDemoted = (s: Sense) => s.tags?.some((t) => DEMOTED_MILD.has(t)) ? 1 : 0;
  return [...senses].sort((a, b) => {
    const dA = isDemoted(a), dB = isDemoted(b);
    if (dA !== dB) return dA - dB;
    const rA = a._ref_count ?? 0, rB = b._ref_count ?? 0;
    const margin = Math.abs(rA - rB), minR = Math.min(rA, rB);
    if (margin >= 3 && minR <= 2) return rB - rA;
    return 0;
  });
};

// Strategy K: Combined owned + ref counts, margin 3
const strategyK: Strategy = (senses) => {
  const isDemoted = (s: Sense) => s.tags?.some((t) => DEMOTED_MILD.has(t)) ? 1 : 0;
  return [...senses].sort((a, b) => {
    const dA = isDemoted(a), dB = isDemoted(b);
    if (dA !== dB) return dA - dB;
    const cA = (a.example_ids?.length ?? 0) + (a._ref_count ?? 0);
    const cB = (b.example_ids?.length ?? 0) + (b._ref_count ?? 0);
    const margin = Math.abs(cA - cB), minC = Math.min(cA, cB);
    if (margin >= 3 && minC <= 2) return cB - cA;
    return 0;
  });
};

// Strategy L: Ref-only count, no margin threshold — just sort by refs desc (demote mild)
const strategyL: Strategy = (senses) => {
  const isDemoted = (s: Sense) => s.tags?.some((t) => DEMOTED_MILD.has(t)) ? 1 : 0;
  return [...senses].sort((a, b) => {
    const dA = isDemoted(a), dB = isDemoted(b);
    if (dA !== dB) return dA - dB;
    return (b._ref_count ?? 0) - (a._ref_count ?? 0);
  });
};

// Baseline: Wiktionary order (no sorting)
const strategyWiki: Strategy = (senses) => [...senses];

// ─── Run evaluation ───

type StrategyFactory = (senses: Sense[], pos: string) => Sense[];

function wrapStrategy(s: Strategy): StrategyFactory {
  return (senses) => s(senses);
}

function evaluate(name: string, strategy: StrategyFactory, cases: [string, string][], words: Map<string, WordData>): {
  score: number;
  total: number;
  details: { file: string; expected: string; got: string | null; pass: boolean }[];
} {
  const details: { file: string; expected: string; got: string | null; pass: boolean }[] = [];
  for (const [file, expected] of cases) {
    const data = words.get(file);
    if (!data) {
      details.push({ file, expected, got: null, pass: false });
      continue;
    }
    const sorted = strategy(data.senses, data.pos);
    const got = sorted[0]?.gloss_en ?? "(null)";
    details.push({ file, expected, got, pass: got === expected });
  }
  return { score: details.filter((d) => d.pass).length, total: details.length, details };
}

// ─── Main ───

function main() {
  // Load word data
  const words = new Map<string, WordData>();
  for (const [file] of TEST_CASES) {
    const path = join("data/words", file + ".json");
    try {
      const raw = readFileSync(path, "utf-8");
      words.set(file, JSON.parse(raw) as WordData);
    } catch {
      console.error(`  ⚠ Could not read ${path}`);
    }
  }

  // ─── Build ref counts per sense by scanning example shards ───
  console.log("Scanning example shards for annotation references...\n");
  const EXAMPLES_DIR = join("data", "examples");
  // For each word, collect gloss_en→sense index mapping
  const glossToSenseIdx = new Map<string, Map<string, number>>(); // lemma → (gloss_hint → sense_idx)
  for (const [file, ] of TEST_CASES) {
    const data = words.get(file);
    if (!data) continue;
    const m = new Map<string, number>();
    for (let i = 0; i < data.senses.length; i++) {
      const g = data.senses[i].gloss_en;
      if (g) m.set(g.toLowerCase(), i);
    }
    glossToSenseIdx.set(data.word, m);
  }
  // Scan all shards
  const refCounts = new Map<string, number[]>(); // lemma → [count_per_sense]
  for (const [, data] of words) {
    refCounts.set(data.word, new Array(data.senses.length).fill(0));
  }
  const shardFiles = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".json")).sort();
  for (const sf of shardFiles) {
    const shard = JSON.parse(readFileSync(join(EXAMPLES_DIR, sf), "utf-8"));
    for (const [, ex] of Object.entries(shard) as [string, { annotations?: { lemma: string; gloss_hint?: string | null }[] }][]) {
      if (!ex.annotations) continue;
      for (const ann of ex.annotations) {
        if (!ann.lemma || !ann.gloss_hint) continue;
        const mapping = glossToSenseIdx.get(ann.lemma);
        if (!mapping) continue;
        const counts = refCounts.get(ann.lemma);
        if (!counts) continue;
        // Try exact substring match against each gloss_en
        const hintLower = ann.gloss_hint.toLowerCase();
        const idx = mapping.get(hintLower);
        if (idx !== undefined) {
          counts[idx]++;
        } else {
          // Try substring match
          for (const [gloss, sIdx] of mapping) {
            if (gloss.includes(hintLower) || hintLower.includes(gloss)) {
              counts[sIdx]++;
              break;
            }
          }
        }
      }
    }
  }
  // Attach ref counts to senses
  for (const [, data] of words) {
    const counts = refCounts.get(data.word);
    if (!counts) continue;
    for (let i = 0; i < data.senses.length; i++) {
      data.senses[i]._ref_count = counts[i];
    }
  }
  // Print ref counts for debugging
  for (const [file, ] of TEST_CASES) {
    const data = words.get(file);
    if (!data || data.senses.length < 2) continue;
    const refs = data.senses.map((s, i) => `${s.gloss_en}: ${s._ref_count ?? 0}r+${s.example_ids?.length ?? 0}o`);
    if (data.senses.some((s) => (s._ref_count ?? 0) > 0)) {
      console.log(`  ${data.word}: ${refs.join(", ")}`);
    }
  }
  console.log();

  const strategies: [string, StrategyFactory][] = [
    ["Wiktionary (baseline)", wrapStrategy(strategyWiki)],
    ["A: Demote colloquial + sort by examples", wrapStrategy(strategyA)],
    ["B: Demote vulgar only + sort by examples", wrapStrategy(strategyB)],
    ["C: Demote vulgar only + margin 3", wrapStrategy(strategyC)],
    ["D: POS-aware + margin 3", (senses, pos) => makeStrategyD(pos)(senses)],
    ["E: Margin 2 + same-tag-aware", wrapStrategy(strategyE)],
    ["F: POS-aware + margin 2 + same-tag", (senses, pos) => makeStrategyF(pos)(senses)],
    ["G: Specialist-demote + dedup + margin 2", wrapStrategy(strategyG)],
    ["H: G + total-count tiebreaker", wrapStrategy(strategyH)],
    ["I: POS-aware + specialist-demote + dedup", (senses, pos) => makeStrategyI(pos)(senses)],
    ["J: Ref-count only + margin 3", wrapStrategy(strategyJ)],
    ["K: Owned+ref combined + margin 3", wrapStrategy(strategyK)],
    ["L: Ref-count sort (no margin)", wrapStrategy(strategyL)],
  ];

  console.log(`\n${"═".repeat(70)}`);
  console.log("Sense Ordering Strategy Evaluation");
  console.log(`${"═".repeat(70)}\n`);
  console.log(`Test cases: ${TEST_CASES.length} words\n`);

  const results: { name: string; score: number; total: number; details: ReturnType<typeof evaluate>["details"] }[] = [];

  for (const [name, strategy] of strategies) {
    const result = evaluate(name, strategy, TEST_CASES, words);
    results.push({ name, ...result });
  }

  // Summary table
  console.log("Strategy Scores:");
  console.log("─".repeat(60));
  for (const r of results) {
    const pct = ((r.score / r.total) * 100).toFixed(1);
    const bar = "█".repeat(Math.round(r.score / r.total * 30));
    console.log(`  ${r.name}`);
    console.log(`    ${r.score}/${r.total} (${pct}%) ${bar}`);
  }
  console.log();

  // Detailed comparison — show where strategies differ
  console.log("Per-word results (✓ = correct first sense):");
  console.log("─".repeat(90));
  const header = "Word".padEnd(25) + results.map((r) => r.name.slice(0, 12).padEnd(14)).join("");
  console.log(header);
  console.log("─".repeat(90));

  for (let i = 0; i < TEST_CASES.length; i++) {
    const [file, expected] = TEST_CASES[i];
    const word = words.get(file)?.word ?? file;
    const marks = results.map((r) => {
      const d = r.details[i];
      return (d.pass ? "✓" : "✗ " + (d.got ?? "?").slice(0, 10)).padEnd(14);
    }).join("");
    // Only show if at least one strategy differs
    const anyFail = results.some((r) => !r.details[i].pass);
    if (anyFail) {
      console.log(`  ${(word + " (" + expected.slice(0, 12) + ")").padEnd(25)}${marks}`);
    }
  }

  console.log();
  console.log("(Only showing words where at least one strategy gets it wrong)");

  // Category breakdown
  console.log("\nCategory breakdown:");
  console.log("─".repeat(60));
  const categories: Record<string, number[]> = {
    "Function words": [],
    "Nouns": [],
    "Verbs": [],
    "Adjectives": [],
  };
  for (let i = 0; i < TEST_CASES.length; i++) {
    const [file] = TEST_CASES[i];
    const cat = file.startsWith("nouns/") ? "Nouns"
      : file.startsWith("verbs/") ? "Verbs"
      : file.startsWith("adjectives/") ? "Adjectives"
      : "Function words";
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(i);
  }

  for (const [cat, indices] of Object.entries(categories)) {
    console.log(`\n  ${cat}:`);
    for (const r of results) {
      const catScore = indices.filter((i) => r.details[i].pass).length;
      console.log(`    ${r.name.slice(0, 45).padEnd(48)} ${catScore}/${indices.length}`);
    }
  }
}

main();

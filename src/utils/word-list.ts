const ARTICLE_GENDERS: Record<string, string[]> = {
  einen: ["M"],
  einem: ["M", "N"],
  einer: ["F"],
  eines: ["M", "N"],
  eine: ["F"],
  der: ["M"],
  die: ["F"],
  das: ["N"],
  den: ["M"],
  dem: ["M", "N"],
  des: ["M", "N"],
  ein: ["M", "N"],
};

// Sorted longest-first so "einen" matches before "ein"
const ARTICLE_KEYS = Object.keys(ARTICLE_GENDERS);

export function stripArticle(q: string): { article: string; remainder: string; genders: string[] } | null {
  const lower = q.toLowerCase();
  for (const art of ARTICLE_KEYS) {
    if (lower.startsWith(art + " ")) {
      const remainder = q.slice(art.length + 1).trim();
      if (remainder.length < 2) return null;
      return { article: art, remainder, genders: ARTICLE_GENDERS[art] };
    }
  }
  return null;
}

export function genderColor(gender: string): string {
  if (gender === "M") return "blue";
  if (gender === "F") return "pink";
  if (gender === "N") return "green";
  return "";
}

export function wordListTitle(
  item: { pluralDominant?: boolean; pluralForm?: string | null; lemma: string; gender?: string | null },
  showArticles: boolean,
): string {
  const base = item.pluralDominant ? item.pluralForm : item.lemma;
  if (showArticles && item.gender && !item.pluralDominant) {
    const article = item.gender === "M" ? "der" : item.gender === "F" ? "die" : "das";
    return `${article} ${base}`;
  }
  return base || "";
}

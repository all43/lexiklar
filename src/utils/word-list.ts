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

/**
 * Lightweight i18n for UI chrome.
 *
 * Two locales: English (default) and German.
 * Grammar terms (Indikativ, Konjunktiv, Nom., etc.) stay in German
 * in both modes — only UI chrome is translated.
 */
import { reactive } from "vue";

export const LANGUAGE_KEY = "lexiklar_language";

const locales = {
  en: {
    // Tab bar
    "tab.search": "Search",
    "tab.favorites": "Favorites",
    "tab.settings": "Settings",

    // SearchPage
    "search.placeholder": "Search word or meaning...",
    "search.frequentlyViewed": "Frequently Viewed",
    "search.recentlyVisited": "Recently Visited",
    "search.noResults": "No words found.",
    "search.emptyHint": "Start typing to search for a German word or English meaning.",

    // WordPage
    "word.meanings": "Meanings",
    "word.synonymsAntonyms": "Synonyms & Antonyms",
    "word.expressions": "Expressions",
    "word.relatedWords": "Related Words",
    "word.conjugation": "Conjugation",
    "word.declension": "Declension",
    "word.grammar": "Grammar",
    "word.grammarSoon": "Grammar tables coming soon.",
    "word.notFound": "Word not found.",
    "word.loading": "Loading...",
    "word.openCard": "Open word card",
    "word.removeHistory": "Remove from history",
    "word.addFavorite": "Add to favorites",
    "word.removeFavorite": "Remove from favorites",
    "word.singular": "singular:",
    "word.proverb": "proverb",

    // Related type labels
    "related.feminineForm": "Feminine Form",
    "related.masculineForm": "Masculine Form",
    "related.antonyms": "Antonyms",
    "related.synonyms": "Synonyms",
    "related.sameStem": "Same Stem",
    "related.derived": "Derived Words",
    "related.derivedFrom": "Derived From",
    "related.compoundVerbs": "Compound Verbs",
    "related.baseVerb": "Base Verb",

    // FavoritesPage
    "favorites.title": "Favorites",
    "favorites.empty": "Saved words will appear here.",
    "favorites.remove": "Remove",

    // SettingsPage
    "settings.title": "Settings",
    "settings.appearance": "Appearance",
    "settings.language": "Language",
    "settings.data": "Data",
    "settings.clearHistory": "Clear History",
    "settings.clearConfirmTitle": "Clear History",
    "settings.clearConfirmMsg": "Clear all viewing history? This cannot be undone.",
    "settings.clearDone": "History cleared",
    "settings.clearFooter": "Removes all recently visited and frequently viewed words from the home screen.",
    "settings.clearFavorites": "Clear Favorites",
    "settings.clearFavoritesTitle": "Clear Favorites",
    "settings.clearFavoritesMsg": "Remove all saved words from favorites? This cannot be undone.",
    "settings.clearFavoritesDone": "Favorites cleared",
    "settings.clearFavoritesFooter": "Removes all saved words from your favorites list.",
    "settings.themeAuto": "Auto (System)",
    "settings.themeLight": "Light",
    "settings.themeDark": "Dark",
    "settings.langAuto": "Auto (System)",
    "settings.langEnglish": "English",
    "settings.langGerman": "Deutsch",
    "settings.showArticles": "Show articles in search",
    "settings.showArticlesFooter": "Displays der/die/das before nouns in search results and history.",

    // NounDeclension
    "noun.pluraletantum": "Pluraletantum — always used in plural",
    "noun.nDeklination": "N-Deklination — adds -(e)n to all cases except nominative",
    "noun.usuallyPlural": "Usually used in plural",
    "noun.singularetantum": "Singularetantum — usually no plural",
    "noun.exception": "Exception: ",
    "noun.singular": "Singular",
    "noun.plural": "Plural",

    // AdjectiveDeclension
    "adj.indeclinable": "Indeclinable — no case endings",
  },
  de: {
    // Tab bar
    "tab.search": "Suche",
    "tab.favorites": "Favoriten",
    "tab.settings": "Einstellungen",

    // SearchPage
    "search.placeholder": "Wort oder Bedeutung suchen...",
    "search.frequentlyViewed": "Häufig angesehen",
    "search.recentlyVisited": "Zuletzt besucht",
    "search.noResults": "Keine Wörter gefunden.",
    "search.emptyHint": "Tippe ein deutsches Wort oder eine englische Bedeutung ein.",

    // WordPage
    "word.meanings": "Bedeutungen",
    "word.synonymsAntonyms": "Synonyme & Antonyme",
    "word.expressions": "Redewendungen",
    "word.relatedWords": "Verwandte Wörter",
    "word.conjugation": "Konjugation",
    "word.declension": "Deklination",
    "word.grammar": "Grammatik",
    "word.grammarSoon": "Grammatiktabellen folgen bald.",
    "word.notFound": "Wort nicht gefunden.",
    "word.loading": "Laden...",
    "word.openCard": "Wortkarte öffnen",
    "word.removeHistory": "Aus Verlauf entfernen",
    "word.addFavorite": "Zu Favoriten hinzufügen",
    "word.removeFavorite": "Aus Favoriten entfernen",
    "word.singular": "Singular:",
    "word.proverb": "Sprichwort",

    // Related type labels
    "related.feminineForm": "Feminine Form",
    "related.masculineForm": "Maskuline Form",
    "related.antonyms": "Antonyme",
    "related.synonyms": "Synonyme",
    "related.sameStem": "Gleicher Stamm",
    "related.derived": "Abgeleitete Wörter",
    "related.derivedFrom": "Abgeleitet von",
    "related.compoundVerbs": "Zusammengesetzte Verben",
    "related.baseVerb": "Grundverb",

    // FavoritesPage
    "favorites.title": "Favoriten",
    "favorites.empty": "Gespeicherte Wörter erscheinen hier.",
    "favorites.remove": "Entfernen",

    // SettingsPage
    "settings.title": "Einstellungen",
    "settings.appearance": "Darstellung",
    "settings.language": "Sprache",
    "settings.data": "Daten",
    "settings.clearHistory": "Verlauf löschen",
    "settings.clearConfirmTitle": "Verlauf löschen",
    "settings.clearConfirmMsg": "Gesamten Verlauf löschen? Dies kann nicht rückgängig gemacht werden.",
    "settings.clearDone": "Verlauf gelöscht",
    "settings.clearFooter": "Entfernt alle zuletzt besuchten und häufig angesehenen Wörter vom Startbildschirm.",
    "settings.clearFavorites": "Favoriten löschen",
    "settings.clearFavoritesTitle": "Favoriten löschen",
    "settings.clearFavoritesMsg": "Alle gespeicherten Wörter löschen? Dies kann nicht rückgängig gemacht werden.",
    "settings.clearFavoritesDone": "Favoriten gelöscht",
    "settings.clearFavoritesFooter": "Entfernt alle gespeicherten Wörter aus deiner Favoritenliste.",
    "settings.themeAuto": "Automatisch (System)",
    "settings.themeLight": "Hell",
    "settings.themeDark": "Dunkel",
    "settings.langAuto": "Automatisch (System)",
    "settings.langEnglish": "English",
    "settings.langGerman": "Deutsch",
    "settings.showArticles": "Artikel in der Suche anzeigen",
    "settings.showArticlesFooter": "Zeigt der/die/das vor Nomen in Suchergebnissen und Verlauf.",

    // NounDeclension
    "noun.pluraletantum": "Pluraletantum — immer im Plural verwendet",
    "noun.nDeklination": "N-Deklination — fügt -(e)n in allen Fällen außer Nominativ hinzu",
    "noun.usuallyPlural": "Meist im Plural verwendet",
    "noun.singularetantum": "Singularetantum — meist kein Plural",
    "noun.exception": "Ausnahme: ",
    "noun.singular": "Singular",
    "noun.plural": "Plural",

    // AdjectiveDeclension
    "adj.indeclinable": "Indeklinabel — keine Kasusendungen",
  },
};

/**
 * Detect effective locale from browser language.
 * Returns "de" if the system language starts with "de", otherwise "en".
 */
function detectSystemLocale() {
  const lang = navigator.language || navigator.languages?.[0] || "en";
  return lang.startsWith("de") ? "de" : "en";
}

const state = reactive({
  /** Stored preference: "auto" | "en" | "de" */
  preference: localStorage.getItem(LANGUAGE_KEY) || "auto",
});

/**
 * Resolve the effective locale code ("en" or "de") from the current preference.
 */
function effectiveLocale() {
  return state.preference === "auto" ? detectSystemLocale() : state.preference;
}

/**
 * Return the translated string for the current locale.
 * Falls back to English, then to the raw key.
 */
export function t(key) {
  const loc = effectiveLocale();
  return locales[loc]?.[key] ?? locales.en[key] ?? key;
}

/**
 * Change the active locale and persist to localStorage.
 * @param {"auto"|"en"|"de"} lang
 */
export function setLocale(lang) {
  state.preference = lang;
  localStorage.setItem(LANGUAGE_KEY, lang);
}

/**
 * Return stored preference ("auto" | "en" | "de").
 */
export function getLocale() {
  return state.preference;
}

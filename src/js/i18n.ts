/**
 * Lightweight i18n for UI chrome.
 *
 * Two locales: English (default) and German.
 * Grammar terms (Indikativ, Konjunktiv, Nom., etc.) stay in German
 * in both modes — only UI chrome is translated.
 */
import { reactive } from "vue";
import { getCached, setItem } from "../utils/storage.js";

export const LANGUAGE_KEY = "lexiklar_language";

export type LocaleKey = "en" | "de";
export type LanguagePreference = "auto" | LocaleKey;

type TranslationMap = Record<string, string>;

const locales: Record<LocaleKey, TranslationMap> = {
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
    "word.meaningsCount": "meanings",
    "word.more": "more",

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
    "related.compoundOf": "Appears in",
    "word.compound": "Word Composition",
    "word.oscillatingVerb": "Two-way verb (separable/inseparable)",
    "word.oscillatingNoteSep": "\u21C4 Also inseparable with different meaning",
    "word.oscillatingNoteInsep": "\u21C4 Also separable with different meaning",

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

    // Data Sources / Attribution
    "settings.dataSources": "Data Sources",
    "settings.dataSourcesFooter": "Dictionary content \u00A9 Wiktionary contributors, CC\u00A0BY-SA\u00A04.0, extracted via Kaikki.org. Frequency data: Leipzig Corpora, SUBTLEX-DE (Brysbaert et al. 2011), OpenSubtitles.",

    "settings.privacyPolicy": "Privacy Policy",

    // About & Updates
    "settings.about": "About",
    "settings.dictionaryVersion": "Dictionary version",
    "settings.appVersion": "App version",
    "settings.checkUpdates": "Check for updates",
    "settings.checking": "Checking...",
    "settings.upToDate": "Up to date",
    "settings.updateAvailable": "Update available",
    "settings.updateSize": "({size})",
    "settings.downloading": "Downloading...",
    "settings.applying": "Applying update...",
    "settings.updateDone": "Dictionary updated",
    "settings.updateFailed": "Update failed",
    "settings.updateReload": "Update applied. Reload to use new data.",

    // NounDeclension
    "noun.pluraletantum": "Pluraletantum \u2014 always used in plural",
    "noun.nDeklination": "N-Deklination \u2014 adds -(e)n to all cases except nominative",
    "noun.usuallyPlural": "Usually used in plural",
    "noun.singularetantum": "Singularetantum \u2014 usually no plural",
    "noun.exception": "Exception: ",
    "noun.singular": "Singular",
    "noun.plural": "Plural",

    // VerbConjugation
    "verb.zuInfinitive": "Infinitive with zu",

    // AdjectiveDeclension
    "adj.indeclinable": "Indeclinable \u2014 no case endings",

    // Data reports
    "search.didYouMean": "Did you mean?",
    "report.missingWord": "Report \"{word}\" as missing",
    "report.notFound": "Can't find what you're looking for?",
    "report.incorrectData": "Report an issue with this entry",
    "report.details": "Details (optional)",
    "report.send": "Send",
    "report.cancel": "Cancel",
    "report.success": "Report sent. Thank you!",
    "report.error": "Could not send report.",

    // PWA update
    "pwa.updateAvailable": "A new version is available.",
    "pwa.reload": "Update",
    "pwa.dismiss": "Later",
  },
  de: {
    // Tab bar
    "tab.search": "Suche",
    "tab.favorites": "Favoriten",
    "tab.settings": "Einstellungen",

    // SearchPage
    "search.placeholder": "Wort oder Bedeutung suchen...",
    "search.frequentlyViewed": "H\u00E4ufig angesehen",
    "search.recentlyVisited": "Zuletzt besucht",
    "search.noResults": "Keine W\u00F6rter gefunden.",
    "search.emptyHint": "Tippe ein deutsches Wort oder eine englische Bedeutung ein.",

    // WordPage
    "word.meanings": "Bedeutungen",
    "word.synonymsAntonyms": "Synonyme & Antonyme",
    "word.expressions": "Redewendungen",
    "word.relatedWords": "Verwandte W\u00F6rter",
    "word.conjugation": "Konjugation",
    "word.declension": "Deklination",
    "word.grammar": "Grammatik",
    "word.grammarSoon": "Grammatiktabellen folgen bald.",
    "word.notFound": "Wort nicht gefunden.",
    "word.loading": "Laden...",
    "word.openCard": "Wortkarte \u00F6ffnen",
    "word.removeHistory": "Aus Verlauf entfernen",
    "word.addFavorite": "Zu Favoriten hinzuf\u00FCgen",
    "word.removeFavorite": "Aus Favoriten entfernen",
    "word.singular": "Singular:",
    "word.proverb": "Sprichwort",
    "word.meaningsCount": "Bedeutungen",
    "word.more": "weitere",

    // Related type labels
    "related.feminineForm": "Feminine Form",
    "related.masculineForm": "Maskuline Form",
    "related.antonyms": "Antonyme",
    "related.synonyms": "Synonyme",
    "related.sameStem": "Gleicher Stamm",
    "related.derived": "Abgeleitete W\u00F6rter",
    "related.derivedFrom": "Abgeleitet von",
    "related.compoundVerbs": "Zusammengesetzte Verben",
    "related.baseVerb": "Grundverb",
    "related.compoundOf": "Kommt vor in",
    "word.compound": "Wortzerlegung",
    "word.oscillatingVerb": "Trennbar/untrennbares Verb",
    "word.oscillatingNoteSep": "\u21C4 Auch untrennbar mit anderer Bedeutung",
    "word.oscillatingNoteInsep": "\u21C4 Auch trennbar mit anderer Bedeutung",

    // FavoritesPage
    "favorites.title": "Favoriten",
    "favorites.empty": "Gespeicherte W\u00F6rter erscheinen hier.",
    "favorites.remove": "Entfernen",

    // SettingsPage
    "settings.title": "Einstellungen",
    "settings.appearance": "Darstellung",
    "settings.language": "Sprache",
    "settings.data": "Daten",
    "settings.clearHistory": "Verlauf l\u00F6schen",
    "settings.clearConfirmTitle": "Verlauf l\u00F6schen",
    "settings.clearConfirmMsg": "Gesamten Verlauf l\u00F6schen? Dies kann nicht r\u00FCckg\u00E4ngig gemacht werden.",
    "settings.clearDone": "Verlauf gel\u00F6scht",
    "settings.clearFooter": "Entfernt alle zuletzt besuchten und h\u00E4ufig angesehenen W\u00F6rter vom Startbildschirm.",
    "settings.clearFavorites": "Favoriten l\u00F6schen",
    "settings.clearFavoritesTitle": "Favoriten l\u00F6schen",
    "settings.clearFavoritesMsg": "Alle gespeicherten W\u00F6rter l\u00F6schen? Dies kann nicht r\u00FCckg\u00E4ngig gemacht werden.",
    "settings.clearFavoritesDone": "Favoriten gel\u00F6scht",
    "settings.clearFavoritesFooter": "Entfernt alle gespeicherten W\u00F6rter aus deiner Favoritenliste.",
    "settings.themeAuto": "Automatisch (System)",
    "settings.themeLight": "Hell",
    "settings.themeDark": "Dunkel",
    "settings.langAuto": "Automatisch (System)",
    "settings.langEnglish": "English",
    "settings.langGerman": "Deutsch",
    "settings.showArticles": "Artikel in der Suche anzeigen",
    "settings.showArticlesFooter": "Zeigt der/die/das vor Nomen in Suchergebnissen und Verlauf.",

    // Data Sources / Attribution
    "settings.dataSources": "Datenquellen",
    "settings.dataSourcesFooter": "W\u00F6rterbuchinhalt \u00A9 Wiktionary-Autoren, CC\u00A0BY-SA\u00A04.0, extrahiert \u00FCber Kaikki.org. Frequenzdaten: Leipzig-Korpora, SUBTLEX-DE (Brysbaert et al. 2011), OpenSubtitles.",

    "settings.privacyPolicy": "Datenschutzerkl\u00E4rung",

    // About & Updates
    "settings.about": "Info",
    "settings.dictionaryVersion": "W\u00F6rterbuch-Version",
    "settings.appVersion": "App-Version",
    "settings.checkUpdates": "Nach Updates suchen",
    "settings.checking": "Wird gepr\u00FCft...",
    "settings.upToDate": "Aktuell",
    "settings.updateAvailable": "Update verf\u00FCgbar",
    "settings.updateSize": "({size})",
    "settings.downloading": "Wird heruntergeladen...",
    "settings.applying": "Update wird angewendet...",
    "settings.updateDone": "W\u00F6rterbuch aktualisiert",
    "settings.updateFailed": "Update fehlgeschlagen",
    "settings.updateReload": "Update angewendet. Neu laden f\u00FCr neue Daten.",

    // NounDeclension
    "noun.pluraletantum": "Pluraletantum \u2014 immer im Plural verwendet",
    "noun.nDeklination": "N-Deklination \u2014 f\u00FCgt -(e)n in allen F\u00E4llen au\u00DFer Nominativ hinzu",
    "noun.usuallyPlural": "Meist im Plural verwendet",
    "noun.singularetantum": "Singularetantum \u2014 meist kein Plural",
    "noun.exception": "Ausnahme: ",
    "noun.singular": "Singular",
    "noun.plural": "Plural",

    // VerbConjugation
    "verb.zuInfinitive": "Infinitiv mit zu",

    // AdjectiveDeclension
    "adj.indeclinable": "Indeklinabel \u2014 keine Kasusendungen",

    // Data reports
    "search.didYouMean": "Meinten Sie?",
    "report.missingWord": "\u201E{word}\u201C als fehlendes Wort melden",
    "report.notFound": "Nicht das Richtige gefunden?",
    "report.incorrectData": "Problem mit diesem Eintrag melden",
    "report.details": "Beschreibung (optional)",
    "report.send": "Senden",
    "report.cancel": "Abbrechen",
    "report.success": "Meldung gesendet. Vielen Dank!",
    "report.error": "Meldung konnte nicht gesendet werden.",

    // PWA update
    "pwa.updateAvailable": "Eine neue Version ist verf\u00FCgbar.",
    "pwa.reload": "Aktualisieren",
    "pwa.dismiss": "Sp\u00E4ter",
  },
};

/**
 * Detect effective locale from browser language.
 * Returns "de" if the system language starts with "de", otherwise "en".
 */
function detectSystemLocale(): LocaleKey {
  const lang = navigator.language || navigator.languages?.[0] || "en";
  return lang.startsWith("de") ? "de" : "en";
}

const state = reactive({
  /** Stored preference: "auto" | "en" | "de" */
  preference: (getCached(LANGUAGE_KEY) || "auto") as LanguagePreference,
});

/**
 * Resolve the effective locale code ("en" or "de") from the current preference.
 */
function effectiveLocale(): LocaleKey {
  return state.preference === "auto" ? detectSystemLocale() : state.preference;
}

/**
 * Return the translated string for the current locale.
 * Falls back to English, then to the raw key.
 */
export function t(key: string): string {
  const loc = effectiveLocale();
  return locales[loc]?.[key] ?? locales.en[key] ?? key;
}

/**
 * Change the active locale and persist to storage.
 */
export function setLocale(lang: LanguagePreference): void {
  state.preference = lang;
  setItem(LANGUAGE_KEY, lang);
}

/**
 * Return stored preference ("auto" | "en" | "de").
 */
export function getLocale(): LanguagePreference {
  return state.preference;
}

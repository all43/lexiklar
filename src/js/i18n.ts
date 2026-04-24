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
    "search.typeMoreChars": "Type at least 2 characters to search.",
    "search.matchingExpressions": "Matching Expressions",
    "search.searchResults": "Search Results",
    "search.showMorePhrases": "Show {n} more",
    "search.emptyHint": "Start typing to search for a German word or English meaning.",
    "search.cancel": "Cancel",
    "search.articleMismatch": "not {wrong} → {correct}",

    // WordPage
    "word.meanings": "Meanings",
    "word.synonymsAntonyms": "Similar & contrasting words",
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
    "word.removeHistoryConfirm": "Remove this word from history?",
    "word.addFavorite": "Add to favorites",
    "word.removeFavorite": "Remove from favorites",
    "word.share": "Share",
    "word.singular": "singular:",
    "word.proverb": "proverb",
    "word.meaningsCount": "meanings",
    "word.more": "more",

    // Related type labels
    "related.feminineForm": "Feminine Form",
    "related.masculineForm": "Masculine Form",
    "related.antonyms": "Contrasting words",
    "related.synonyms": "Similar words",
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
    "word.falseFriendTitle": "False friend",
    "word.falseFriendIfMeant": "If you meant…",
    "word.falseFriendUseInstead": "Use instead",
    "word.confusableTitle": "Don't confuse",

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
    "settings.clearCache": "Clear Dictionary Cache",
    "settings.clearCacheTitle": "Clear Dictionary Cache",
    "settings.clearCacheMsg": "Delete the cached dictionary database? You will need to re-download it to use the app.",
    "settings.clearCacheDone": "Dictionary cache cleared",
    "settings.themeAuto": "Auto (System)",
    "settings.themeLight": "Light",
    "settings.themeDark": "Dark",
    "settings.langAuto": "Auto (System)",
    "settings.langEnglish": "English",
    "settings.langGerman": "Deutsch",
    "settings.showArticles": "Show articles in search",
    "settings.showArticlesFooter": "Displays der/die/das before nouns in search results and history.",
    "settings.condensedGrammar": "Condensed adjective tables",
    "settings.condensedGrammarFooter": "Replaces the full declension grid with grouped rules and examples showing why each ending is used.",
    "settings.showGrammarTags": "Show grammar labels",
    "settings.showGrammarTagsFooter": "Shows transitive, intransitive, reflexive, and impersonal labels next to verb meanings.",

    // Sense tags
    "tag.colloquial":             "informal",
    "tag.figurative":             "fig.",
    "tag.outdated":               "dated",
    "tag.archaic":                "archaic",
    "tag.derogatory":             "offensive",
    "tag.literary":               "literary",
    "tag.rare":                   "rare",
    "tag.historical":             "historical",
    "tag.humorous":               "humorous",
    "tag.gehoben":                "elevated",
    "tag.impolite":               "rude",
    "tag.jargon":                 "jargon",
    "tag.vulgar":                 "vulgar",
    "tag.formal":                 "formal",
    "tag.poetic":                 "poetic",
    "tag.slang":                  "slang",
    "tag.casual":                 "casual",
    "tag.austrian_german":        "Austrian",
    "tag.swiss_standard_german":  "Swiss",
    "tag.regional":               "regional",
    "tag.south_german":           "South German",
    "tag.north_german":           "North German",
    "tag.bavarian":               "Bavarian",
    "tag.swabian":                "Swabian",
    "tag.physics":                "physics",
    "tag.geography":              "geography",
    "tag.geometry":               "geometry",
    "tag.finance":                "finance",
    "tag.law":                    "law",
    "tag.military":               "military",
    "tag.transitive":             "transitive",
    "tag.intransitive":           "intransitive",
    "tag.reflexive":              "reflexive",
    "tag.impersonal":             "impersonal",
    "settings.searchBarPosition": "Search Bar Position",
    "settings.searchBarAuto": "System Default",
    "settings.searchBarTop": "Top",
    "settings.searchBarBottom": "Bottom",

    // Data Sources / Attribution
    "settings.dataSources": "Data Sources",
    "settings.dataSourcesFooter": "Dictionary content \u00A9 Wiktionary contributors, CC\u00A0BY-SA\u00A04.0, extracted via Kaikki.org. Frequency data: Leipzig Corpora, SUBTLEX-DE (Brysbaert et al. 2011), OpenSubtitles.",

    "settings.privacyPolicy": "Privacy Policy",

    // About & Updates
    "settings.about": "About",
    "settings.dictionaryVersion": "Dictionary version",
    "settings.appVersion": "App version",
    "settings.autoCheckUpdates": "Check for updates automatically",
    "settings.checkUpdates": "Check for updates",
    "settings.checking": "Checking...",
    "settings.upToDate": "Up to date",
    "settings.updateAvailable": "Dictionary update available",
    "settings.updateAvailableFull": "Dictionary update (full download)",
    "settings.updateSize": "({size})",
    "settings.downloading": "Downloading...",
    "settings.applying": "Applying update...",
    "settings.updateDone": "Dictionary updated",
    "settings.updateFailed": "Update failed",
    "settings.updateReload": "Update applied. Reload to use new data.",
    "settings.appUpdateAvailable": "App update available \u2014 tap to download",
    "settings.appUpdateDownloading": "Downloading app update\u2026",
    "settings.appUpdateRestart": "App update ready \u2014 tap to restart",

    // NounDeclension
    "noun.pluraletantum": "Pluraletantum \u2014 always used in plural",
    "noun.nDeklination": "N-Deklination \u2014 adds -(e)n to all cases except nominative",
    "noun.usuallyPlural": "Usually used in plural",
    "noun.singularetantum": "Singularetantum \u2014 usually no plural",
    "noun.exception": "Exception: ",
    "noun.falseMatch": "{suffix} is not a suffix here",
    "noun.singular": "Singular",
    "noun.plural": "Plural",
    // Gender rules
    "noun.rule.suffix_ung":             "-ung \u2192 always feminine",
    "noun.rule.suffix_heit":            "-heit \u2192 always feminine",
    "noun.rule.suffix_keit":            "-keit \u2192 always feminine",
    "noun.rule.suffix_chen":            "-chen \u2192 always neuter",
    "noun.rule.suffix_lein":            "-lein \u2192 always neuter",
    "noun.rule.suffix_schaft":          "-schaft \u2192 nearly always feminine",
    "noun.rule.suffix_tion":            "-tion \u2192 nearly always feminine",
    "noun.rule.suffix_sion":            "-sion \u2192 nearly always feminine",
    "noun.rule.suffix_taet":            "-t\u00e4t \u2192 nearly always feminine",
    "noun.rule.suffix_ismus":           "-ismus \u2192 nearly always masculine",
    "noun.rule.suffix_ist":             "-ist \u2192 nearly always masculine",
    "noun.rule.suffix_ling":            "-ling \u2192 nearly always masculine",
    "noun.rule.suffix_tum":             "-tum \u2192 usually neuter",
    "noun.rule.suffix_or":              "-or \u2192 usually masculine",
    "noun.rule.suffix_ei":              "-ei \u2192 usually feminine",
    "noun.rule.suffix_anz":             "-anz \u2192 usually feminine",
    "noun.rule.suffix_enz":             "-enz \u2192 usually feminine",
    "noun.rule.nominalized_infinitive": "nominalized infinitive \u2192 always neuter",
    "noun.rule.suffix_ment":            "-ment \u2192 often neuter",
    "noun.rule.suffix_um":              "-um \u2192 often neuter",
    "noun.rule.suffix_ie":              "-ie \u2192 often feminine",
    "noun.rule.suffix_ik":              "-ik \u2192 often feminine",
    "noun.rule.suffix_ur":              "-ur \u2192 often feminine",
    "noun.rule.suffix_eur":             "-eur \u2192 often masculine",

    // VerbConjugation
    "verb.zuInfinitive": "Infinitive with zu",

    // AdjectiveDeclension
    "adj.indeclinable": "Indeclinable \u2014 no case endings",
    "adj.afterDefinite": "After der/die/das",
    "adj.afterDefiniteWhy": "Article already signals gender + case \u2192 adjective just adds -e or -en",
    "adj.afterIndefinite": "After ein/kein/mein",
    "adj.afterIndefiniteWhy": "\"ein\" alone doesn\u2019t reveal masc./neut. \u2192 adjective takes over the signal",
    "adj.withoutArticle": "Without article",
    "adj.withoutArticleWhy": "No article \u2192 adjective must signal gender + case itself (like the article)",
    "adj.nomSg": "Nom. Sg.",
    "adj.accSgMascEn": "Akk. Sg. masc. \u2192 -en",
    "adj.restAlwaysEn": "Everything else \u2192 always -en",
    "adj.mixedExceptWhere": "Like weak, but where ein- has no signal:",
    "adj.mascNom": "masc. Nom.",
    "adj.neutNomAcc": "neut. Nom./Akk.",
    "adj.viewRules": "Rules",
    "adj.viewTable": "Table",
    "adj.steigerung": "Comparison",

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

    // DB update toast
    "dbUpdate.available": "Dictionary update available",
    "dbUpdate.update": "Update",
    "dbUpdate.later": "Later",
    "dbUpdate.downloading": "Downloading update\u2026",
    "dbUpdate.applying": "Applying update\u2026",
    "dbUpdate.done": "Dictionary updated.",
    "dbUpdate.failed": "Dictionary update failed",

    // DB download / error
    "db.downloadTitle": "Dictionary download required",
    "db.downloadHint": "The dictionary database ({size}) needs to be downloaded once. After that, the app works fully offline.",
    "db.download": "Download",
    "db.downloading": "Downloading dictionary\u2026",
    "db.downloadFailed": "Download failed. Please check your connection and try again.",
    "db.notLoaded": "Dictionary database could not be loaded.",
    "db.notLoadedHint": "Please check your internet connection and reload the page.",
    "db.reload": "Reload",

    // Grammar reference
    "settings.grammarReference": "Grammar Reference",
    "grammar.nounGenderRules": "Noun gender rules",
    "grammar.nounGenderRulesTitle": "Noun Gender Rules",
    "grammar.nounGenderDesc": "Noun gender can often be predicted from word endings. These rules are memory aids — exceptions exist.",
    "grammar.adjectiveDeclension": "Adjective declension",
    "grammar.adjectiveDeclensionTitle": "Adjective Declension",
    "grammar.adjDeclDesc": "Adjective endings depend on whether the noun has a definite article (weak), indefinite article (mixed), or no article (strong).",
    "grammar.determiners": "Articles & determiners",
    "grammar.determinersTitle": "Articles & Determiners",
    "grammar.determinersDesc": "Declension tables for the definite article and possessive determiners.",
    "grammar.cases": "Cases & prepositions",
    "grammar.casesTitle": "Cases & Prepositions",
    "grammar.casesDesc": "German has four grammatical cases. The case determines the form of articles, pronouns, and adjective endings.",
    "grammar.modalVerbs": "Modal verbs",
    "grammar.modalVerbsTitle": "Modal Verbs",
    "grammar.modalVerbsDesc": "Modal verbs modify the meaning of the infinitive that follows. They have irregular present tense forms.",
    "grammar.reflexive": "Reflexive verbs & pronouns",
    "grammar.reflexiveTitle": "Reflexive Verbs & Pronouns",
    "grammar.reflexiveDesc": "Reflexive verbs require a reflexive pronoun — the subject acts on itself. The pronoun form differs for accusative vs. dative.",
    "grammar.always": "Always",
    "grammar.nearlyAlways": "Nearly always",
    "grammar.usually": "Usually",
    "grammar.often": "Often",
    "grammar.exceptions": "Exceptions:",
    "grammar.byReliability": "By reliability",
    "grammar.byGender": "By gender",
    "grammar.adjStrong": "No article (strong)",
    "grammar.adjWeak": "After der/die/das (weak)",
    "grammar.adjMixed": "After ein/kein/mein (mixed)",
    "grammar.adjStrongWhy": "No article \u2192 adjective signals gender + case itself",
    "grammar.adjWeakWhy": "Definite article signals gender \u2192 adjective only adds \u2011e or \u2011en",
    "grammar.adjMixedWhy": "Indefinite article lacks signal in 3 slots \u2192 adjective fills in",
    "grammar.nominative": "Nominative",
    "grammar.nominativeQ": "Wer / Was?",
    "grammar.nominativeRole": "Subject \u2014 who or what does the action",
    "grammar.accusative": "Accusative",
    "grammar.accusativeQ": "Wen / Was?",
    "grammar.accusativeRole": "Direct object \u2014 receives the action",
    "grammar.dative": "Dative",
    "grammar.dativeQ": "Wem?",
    "grammar.dativeRole": "Indirect object \u2014 to / for whom",
    "grammar.genitive": "Genitive",
    "grammar.genitiveQ": "Wessen?",
    "grammar.genitiveRole": "Possession or relationship",
    "grammar.prepAccOnly": "Accusative only",
    "grammar.prepDatOnly": "Dative only",
    "grammar.prepTwoWay": "Two-way (Wechselpr\u00e4positionen)",
    "grammar.prepTwoWayAccNote": "Accusative \u2014 movement / direction (Wohin?)",
    "grammar.prepTwoWayDatNote": "Dative \u2014 location / state (Wo?)",
    "grammar.modalPresent": "Present (Pr\u00e4sens)",
    "grammar.modalPreterite": "Preterite (Pr\u00e4teritum)",
    "grammar.reflexivePronouns": "Reflexive pronouns",
    "grammar.commonReflexiveVerbs": "Common reflexive verbs",
    "grammar.accusativeShort": "Acc.",
    "grammar.dativeShort": "Dat.",
    "grammar.allGenderRules": "All gender rules \u2192",
    "grammar.fullReference": "Full reference \u2192",
    "grammar.allDeterminerParadigms": "All determiner paradigms \u2192",
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
    "search.typeMoreChars": "Mindestens 2 Zeichen eingeben.",
    "search.matchingExpressions": "Passende Ausdrücke",
    "search.searchResults": "Suchergebnisse",
    "search.showMorePhrases": "{n} weitere anzeigen",
    "search.emptyHint": "Tippe ein deutsches Wort oder eine englische Bedeutung ein.",
    "search.cancel": "Abbrechen",
    "search.articleMismatch": "nicht {wrong} → {correct}",

    // WordPage
    "word.meanings": "Bedeutungen",
    "word.synonymsAntonyms": "Ähnliche & Gegenwörter",
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
    "word.removeHistoryConfirm": "Dieses Wort aus dem Verlauf entfernen?",
    "word.addFavorite": "Zu Favoriten hinzuf\u00FCgen",
    "word.removeFavorite": "Aus Favoriten entfernen",
    "word.share": "Teilen",
    "word.singular": "Singular:",
    "word.proverb": "Sprichwort",
    "word.meaningsCount": "Bedeutungen",
    "word.more": "weitere",

    // Related type labels
    "related.feminineForm": "Feminine Form",
    "related.masculineForm": "Maskuline Form",
    "related.antonyms": "Gegenwörter",
    "related.synonyms": "Ähnliche Wörter",
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
    "word.falseFriendTitle": "Falscher Freund",
    "word.falseFriendIfMeant": "Wenn du meinst…",
    "word.falseFriendUseInstead": "Verwende stattdessen",
    "word.confusableTitle": "Nicht verwechseln",

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
    "settings.clearCache": "W\u00F6rterbuch-Cache l\u00F6schen",
    "settings.clearCacheTitle": "W\u00F6rterbuch-Cache l\u00F6schen",
    "settings.clearCacheMsg": "Die gespeicherte W\u00F6rterbuch-Datenbank l\u00F6schen? Du musst sie erneut herunterladen, um die App zu nutzen.",
    "settings.clearCacheDone": "W\u00F6rterbuch-Cache gel\u00F6scht",
    "settings.themeAuto": "Automatisch (System)",
    "settings.themeLight": "Hell",
    "settings.themeDark": "Dunkel",
    "settings.langAuto": "Automatisch (System)",
    "settings.langEnglish": "English",
    "settings.langGerman": "Deutsch",
    "settings.showArticles": "Artikel in der Suche anzeigen",
    "settings.showArticlesFooter": "Zeigt der/die/das vor Nomen in Suchergebnissen und Verlauf.",
    "settings.condensedGrammar": "Kompakte Adjektivtabellen",
    "settings.condensedGrammarFooter": "Ersetzt die vollst\u00E4ndige Deklinationstabelle durch gruppierte Regeln mit Beispielen.",
    "settings.showGrammarTags": "Grammatikmarkierungen anzeigen",
    "settings.showGrammarTagsFooter": "Zeigt transitiv, intransitiv, reflexiv und unpersönlich neben Verbebedeutungen.",

    // Bedeutungsmarkierungen
    "tag.colloquial":             "umgangsspr.",
    "tag.figurative":             "übertr.",
    "tag.outdated":               "veraltet",
    "tag.archaic":                "archaisch",
    "tag.derogatory":             "abwertend",
    "tag.literary":               "literarisch",
    "tag.rare":                   "selten",
    "tag.historical":             "historisch",
    "tag.humorous":               "scherzhaft",
    "tag.gehoben":                "gehoben",
    "tag.impolite":               "unhöflich",
    "tag.jargon":                 "Jargon",
    "tag.vulgar":                 "vulgär",
    "tag.formal":                 "formell",
    "tag.poetic":                 "dichterisch",
    "tag.slang":                  "Slang",
    "tag.casual":                 "salopp",
    "tag.austrian_german":        "österr.",
    "tag.swiss_standard_german":  "schweiz.",
    "tag.regional":               "regional",
    "tag.south_german":           "süddeutsch",
    "tag.north_german":           "norddeutsch",
    "tag.bavarian":               "bairisch",
    "tag.swabian":                "schwäbisch",
    "tag.physics":                "Physik",
    "tag.geography":              "Geogr.",
    "tag.geometry":               "Geom.",
    "tag.finance":                "Finanzen",
    "tag.law":                    "Recht",
    "tag.military":               "Mil.",
    "tag.transitive":             "transitiv",
    "tag.intransitive":           "intransitiv",
    "tag.reflexive":              "reflexiv",
    "tag.impersonal":             "unpersönlich",
    "settings.searchBarPosition": "Position der Suchleiste",
    "settings.searchBarAuto": "Systemstandard",
    "settings.searchBarTop": "Oben",
    "settings.searchBarBottom": "Unten",

    // Data Sources / Attribution
    "settings.dataSources": "Datenquellen",
    "settings.dataSourcesFooter": "W\u00F6rterbuchinhalt \u00A9 Wiktionary-Autoren, CC\u00A0BY-SA\u00A04.0, extrahiert \u00FCber Kaikki.org. Frequenzdaten: Leipzig-Korpora, SUBTLEX-DE (Brysbaert et al. 2011), OpenSubtitles.",

    "settings.privacyPolicy": "Datenschutzerkl\u00E4rung",

    // About & Updates
    "settings.about": "Info",
    "settings.dictionaryVersion": "W\u00F6rterbuch-Version",
    "settings.appVersion": "App-Version",
    "settings.autoCheckUpdates": "Automatisch nach Updates suchen",
    "settings.checkUpdates": "Nach Updates suchen",
    "settings.checking": "Wird gepr\u00FCft...",
    "settings.upToDate": "Aktuell",
    "settings.updateAvailable": "Wörterbuch-Update verfügbar",
    "settings.updateAvailableFull": "Wörterbuch-Update (vollständig)",
    "settings.updateSize": "({size})",
    "settings.downloading": "Wird heruntergeladen...",
    "settings.applying": "Update wird angewendet...",
    "settings.updateDone": "W\u00F6rterbuch aktualisiert",
    "settings.updateFailed": "Update fehlgeschlagen",
    "settings.updateReload": "Update angewendet. Neu laden f\u00FCr neue Daten.",
    "settings.appUpdateAvailable": "App-Update verf\u00FCgbar \u2014 tippen zum Herunterladen",
    "settings.appUpdateDownloading": "App-Update wird heruntergeladen\u2026",
    "settings.appUpdateRestart": "App-Update bereit \u2014 tippen zum Neustarten",

    // NounDeclension
    "noun.pluraletantum": "Pluraletantum \u2014 immer im Plural verwendet",
    "noun.nDeklination": "N-Deklination \u2014 f\u00FCgt -(e)n in allen F\u00E4llen au\u00DFer Nominativ hinzu",
    "noun.usuallyPlural": "Meist im Plural verwendet",
    "noun.singularetantum": "Singularetantum \u2014 meist kein Plural",
    "noun.exception": "Ausnahme: ",
    "noun.falseMatch": "{suffix} ist hier kein Suffix",
    "noun.singular": "Singular",
    "noun.plural": "Plural",
    // Genusregeln
    "noun.rule.suffix_ung":             "-ung \u2192 immer feminin",
    "noun.rule.suffix_heit":            "-heit \u2192 immer feminin",
    "noun.rule.suffix_keit":            "-keit \u2192 immer feminin",
    "noun.rule.suffix_chen":            "-chen \u2192 immer s\u00e4chlich",
    "noun.rule.suffix_lein":            "-lein \u2192 immer s\u00e4chlich",
    "noun.rule.suffix_schaft":          "-schaft \u2192 fast immer feminin",
    "noun.rule.suffix_tion":            "-tion \u2192 fast immer feminin",
    "noun.rule.suffix_sion":            "-sion \u2192 fast immer feminin",
    "noun.rule.suffix_taet":            "-t\u00e4t \u2192 fast immer feminin",
    "noun.rule.suffix_ismus":           "-ismus \u2192 fast immer maskulin",
    "noun.rule.suffix_ist":             "-ist \u2192 fast immer maskulin",
    "noun.rule.suffix_ling":            "-ling \u2192 fast immer maskulin",
    "noun.rule.suffix_tum":             "-tum \u2192 meist s\u00e4chlich",
    "noun.rule.suffix_or":              "-or \u2192 meist maskulin",
    "noun.rule.suffix_ei":              "-ei \u2192 meist feminin",
    "noun.rule.suffix_anz":             "-anz \u2192 meist feminin",
    "noun.rule.suffix_enz":             "-enz \u2192 meist feminin",
    "noun.rule.nominalized_infinitive": "nominalisierter Infinitiv \u2192 immer s\u00e4chlich",
    "noun.rule.suffix_ment":            "-ment \u2192 oft s\u00e4chlich",
    "noun.rule.suffix_um":              "-um \u2192 oft s\u00e4chlich",
    "noun.rule.suffix_ie":              "-ie \u2192 oft feminin",
    "noun.rule.suffix_ik":              "-ik \u2192 oft feminin",
    "noun.rule.suffix_ur":              "-ur \u2192 oft feminin",
    "noun.rule.suffix_eur":             "-eur \u2192 oft maskulin",

    // VerbConjugation
    "verb.zuInfinitive": "Infinitiv mit zu",

    // AdjectiveDeclension
    "adj.indeclinable": "Indeklinabel \u2014 keine Kasusendungen",
    "adj.afterDefinite": "Nach der/die/das",
    "adj.afterDefiniteWhy": "Artikel zeigt Genus + Kasus \u2192 Adjektiv nur -e oder -en",
    "adj.afterIndefinite": "Nach ein/kein/mein",
    "adj.afterIndefiniteWhy": "\u201Eein\u201C allein zeigt nicht mask./neutr. \u2192 Adjektiv \u00FCbernimmt das Signal",
    "adj.withoutArticle": "Ohne Artikel",
    "adj.withoutArticleWhy": "Kein Artikel \u2192 Adjektiv muss Genus + Kasus selbst zeigen (wie der Artikel)",
    "adj.nomSg": "Nom. Sg.",
    "adj.accSgMascEn": "Akk. Sg. Mask. \u2192 -en",
    "adj.restAlwaysEn": "Alles andere \u2192 immer -en",
    "adj.mixedExceptWhere": "Wie schwach, aber wo ein- kein Signal hat:",
    "adj.mascNom": "Mask. Nom.",
    "adj.neutNomAcc": "Neutr. Nom./Akk.",
    "adj.viewRules": "Regeln",
    "adj.viewTable": "Tabelle",
    "adj.steigerung": "Steigerung",

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

    // DB update toast
    "dbUpdate.available": "W\u00F6rterbuch-Update verf\u00FCgbar",
    "dbUpdate.update": "Aktualisieren",
    "dbUpdate.later": "Sp\u00E4ter",
    "dbUpdate.downloading": "Update wird heruntergeladen\u2026",
    "dbUpdate.applying": "Update wird angewendet\u2026",
    "dbUpdate.done": "W\u00F6rterbuch aktualisiert.",
    "dbUpdate.failed": "W\u00F6rterbuch-Update fehlgeschlagen",

    // DB download / error
    "db.downloadTitle": "W\u00F6rterbuch-Download erforderlich",
    "db.downloadHint": "Die W\u00F6rterbuch-Datenbank ({size}) muss einmalig heruntergeladen werden. Danach funktioniert die App vollst\u00E4ndig offline.",
    "db.download": "Herunterladen",
    "db.downloading": "W\u00F6rterbuch wird heruntergeladen\u2026",
    "db.downloadFailed": "Download fehlgeschlagen. Bitte pr\u00FCfe deine Verbindung und versuche es erneut.",
    "db.notLoaded": "Die W\u00F6rterbuch-Datenbank konnte nicht geladen werden.",
    "db.notLoadedHint": "Bitte pr\u00FCfe deine Internetverbindung und lade die Seite neu.",
    "db.reload": "Neu laden",

    // Grammatik-Referenz
    "settings.grammarReference": "Grammatik-Referenz",
    "grammar.nounGenderRules": "Regeln f\u00fcr das Genus",
    "grammar.nounGenderRulesTitle": "Genus-Regeln",
    "grammar.nounGenderDesc": "Das Genus von Nomen l\u00e4sst sich oft anhand der Wortendung vorhersagen. Diese Regeln sind Ged\u00e4chtnisst\u00fctzen \u2014 Ausnahmen gibt es.",
    "grammar.adjectiveDeclension": "Adjektivdeklination",
    "grammar.adjectiveDeclensionTitle": "Adjektivdeklination",
    "grammar.adjDeclDesc": "Die Adjektivendungen h\u00e4ngen davon ab, ob ein bestimmter Artikel (schwach), unbestimmter Artikel (gemischt) oder kein Artikel (stark) vorangeht.",
    "grammar.determiners": "Artikel & Pronomen",
    "grammar.determinersTitle": "Artikel & Pronomen",
    "grammar.determinersDesc": "Deklinationstabellen f\u00fcr den bestimmten Artikel und Possessivpronomen.",
    "grammar.cases": "Kasus & Pr\u00e4positionen",
    "grammar.casesTitle": "Kasus & Pr\u00e4positionen",
    "grammar.casesDesc": "Das Deutsche hat vier grammatische Kasus. Der Kasus bestimmt die Form von Artikeln, Pronomen und Adjektivendungen.",
    "grammar.modalVerbs": "Modalverben",
    "grammar.modalVerbsTitle": "Modalverben",
    "grammar.modalVerbsDesc": "Modalverben modifizieren die Bedeutung des nachfolgenden Infinitivs. Sie haben unregelmäßige Präsensformen.",
    "grammar.reflexive": "Reflexive Verben & Pronomen",
    "grammar.reflexiveTitle": "Reflexive Verben & Pronomen",
    "grammar.reflexiveDesc": "Reflexive Verben ben\u00f6tigen ein Reflexivpronomen \u2014 das Subjekt handelt an sich selbst. Die Pronomenform unterscheidet sich je nach Kasus (Akkusativ oder Dativ).",
    "grammar.always": "Immer",
    "grammar.nearlyAlways": "Fast immer",
    "grammar.usually": "Meistens",
    "grammar.often": "Oft",
    "grammar.exceptions": "Ausnahmen:",
    "grammar.byReliability": "Nach Zuverlässigkeit",
    "grammar.byGender": "Nach Genus",
    "grammar.adjStrong": "Ohne Artikel (stark)",
    "grammar.adjWeak": "Nach der/die/das (schwach)",
    "grammar.adjMixed": "Nach ein/kein/mein (gemischt)",
    "grammar.adjStrongWhy": "Kein Artikel \u2192 Adjektiv signalisiert Genus + Kasus selbst",
    "grammar.adjWeakWhy": "Definiter Artikel signalisiert Genus \u2192 Adjektiv f\u00fcgt nur \u2011e oder \u2011en hinzu",
    "grammar.adjMixedWhy": "Indefiniter Artikel fehlt in 3 Zellen \u2192 Adjektiv \u00fcbernimmt das Signal",
    "grammar.nominative": "Nominativ",
    "grammar.nominativeQ": "Wer / Was?",
    "grammar.nominativeRole": "Subjekt \u2014 wer oder was handelt",
    "grammar.accusative": "Akkusativ",
    "grammar.accusativeQ": "Wen / Was?",
    "grammar.accusativeRole": "Direktes Objekt \u2014 empf\u00e4ngt die Handlung",
    "grammar.dative": "Dativ",
    "grammar.dativeQ": "Wem?",
    "grammar.dativeRole": "Indirektes Objekt \u2014 f\u00fcr wen / wem",
    "grammar.genitive": "Genitiv",
    "grammar.genitiveQ": "Wessen?",
    "grammar.genitiveRole": "Zugeh\u00f6rigkeit oder Beziehung",
    "grammar.prepAccOnly": "Nur Akkusativ",
    "grammar.prepDatOnly": "Nur Dativ",
    "grammar.prepTwoWay": "Wechselpr\u00e4positionen",
    "grammar.prepTwoWayAccNote": "Akkusativ \u2014 Richtung / Bewegung (Wohin?)",
    "grammar.prepTwoWayDatNote": "Dativ \u2014 Ort / Zustand (Wo?)",
    "grammar.modalPresent": "Pr\u00e4sens",
    "grammar.modalPreterite": "Pr\u00e4teritum",
    "grammar.reflexivePronouns": "Reflexivpronomen",
    "grammar.commonReflexiveVerbs": "H\u00e4ufige reflexive Verben",
    "grammar.accusativeShort": "Akk.",
    "grammar.dativeShort": "Dat.",
    "grammar.allGenderRules": "Alle Genus-Regeln \u2192",
    "grammar.fullReference": "Vollst\u00e4ndige Referenz \u2192",
    "grammar.allDeterminerParadigms": "Alle Deklinationsparadigmen \u2192",
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
export function t(key: string, params?: Record<string, string>): string {
  const loc = effectiveLocale();
  let str = locales[loc]?.[key] ?? locales.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) str = str.replaceAll(`{${k}}`, v);
  }
  return str;
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

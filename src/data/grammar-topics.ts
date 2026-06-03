/**
 * Canonical list of grammar reference pages.
 *
 * Single source of truth for both the Grammar index list (GrammarIndexPage.vue)
 * and grammar search (src/utils/grammar-search.ts). `slug` must match the route
 * path segment in src/js/routes.ts; `titleKey` is the i18n key for the page's
 * navbar title.
 *
 * `keywords` are curated bilingual search synonyms — terms a learner might type
 * that the title alone wouldn't catch (e.g. "Akkusativ", "subjunctive", "weil",
 * "warten auf"). Both locales are matched regardless of UI language.
 */

export interface GrammarTopic {
  /** Route path segment, e.g. "cases" → /grammar/cases/ */
  slug: string;
  /** i18n key for the page title, e.g. "grammar.casesTitle" */
  titleKey: string;
  keywords: { en: string[]; de: string[] };
}

export const grammarTopics: GrammarTopic[] = [
  {
    slug: "cases",
    titleKey: "grammar.casesTitle",
    keywords: {
      en: ["case", "cases", "nominative", "accusative", "dative", "genitive", "subject", "direct object", "indirect object", "preposition", "prepositions", "two-way preposition", "accusative preposition", "dative preposition", "case after preposition"],
      de: ["Kasus", "Fall", "Fälle", "Nominativ", "Akkusativ", "Dativ", "Genitiv", "Präposition", "Präpositionen", "Wechselpräposition", "Wechselpräpositionen", "Akkusativpräposition", "Dativpräposition", "wer", "wen", "wem", "wessen"],
    },
  },
  {
    slug: "noun-gender",
    titleKey: "grammar.nounGenderRulesTitle",
    keywords: {
      en: ["gender", "noun gender", "gender of nouns", "masculine", "feminine", "neuter", "gender rules", "noun endings", "feminine endings", "suffix", "der die das"],
      de: ["Genus", "Geschlecht", "maskulin", "feminin", "Maskulinum", "Femininum", "Neutrum", "Endung", "Endungen", "Wortendung", "Nomen", "-ung", "-heit", "-keit", "-chen", "-lein", "-tion", "-tät"],
    },
  },
  {
    slug: "determiners",
    titleKey: "grammar.determinersTitle",
    keywords: {
      en: ["article", "articles", "definite article", "indefinite article", "negative article", "determiner", "determiners", "possessive", "demonstrative", "der die das", "ein eine", "kein keine", "this that", "my your"],
      de: ["Artikel", "bestimmter Artikel", "unbestimmter Artikel", "Possessivpronomen", "Possessivartikel", "Demonstrativpronomen", "Begleiter", "Deklination", "mein", "dein", "sein", "ihr", "kein", "keine", "dieser", "jeder", "welcher"],
    },
  },
  {
    slug: "adjective-declension",
    titleKey: "grammar.adjectiveDeclensionTitle",
    keywords: {
      en: ["adjective", "adjectives", "adjective declension", "declension", "adjective endings", "adjective ending", "weak", "mixed", "strong", "comparative", "superlative", "comparison", "attributive"],
      de: ["Adjektiv", "Adjektive", "Adjektivdeklination", "Deklination", "Adjektivendung", "Adjektivendungen", "schwach", "gemischt", "stark", "Komparativ", "Superlativ", "Steigerung", "attributiv", "Endungen nach Artikel"],
    },
  },
  {
    slug: "tenses",
    titleKey: "grammar.tensesTitle",
    keywords: {
      en: ["tense", "tenses", "present", "past", "simple past", "preterite", "perfect", "present perfect", "pluperfect", "past perfect", "future", "future perfect", "auxiliary", "past participle", "participle", "conjugation", "weak verb", "strong verb", "irregular verb"],
      de: ["Zeit", "Zeitform", "Zeitformen", "Tempus", "Präsens", "Präteritum", "Imperfekt", "Perfekt", "Plusquamperfekt", "Futur", "Futur I", "Futur II", "Hilfsverb", "haben", "sein", "Partizip", "Partizip I", "Partizip II", "Konjugation"],
    },
  },
  {
    slug: "konjunktiv",
    titleKey: "grammar.konjunktivTitle",
    keywords: {
      en: ["subjunctive", "subjunctive 1", "subjunctive 2", "conditional", "konjunktiv", "K1", "K2", "unreal", "wish", "polite", "would", "indirect speech", "reported speech", "hypothetical"],
      de: ["Konjunktiv", "Konjunktiv I", "Konjunktiv II", "Konjunktiv 1", "Konjunktiv 2", "K1", "K2", "würde", "hätte", "wäre", "könnte", "irreal", "indirekte Rede", "Möglichkeitsform", "Bedingung", "Wunsch"],
    },
  },
  {
    slug: "modal-verbs",
    titleKey: "grammar.modalVerbsTitle",
    keywords: {
      en: ["modal", "modal verb", "modal verbs", "modality", "can", "must", "may", "should", "want", "ability", "permission", "obligation"],
      de: ["Modalverb", "Modalverben", "Modalität", "können", "müssen", "dürfen", "sollen", "wollen", "mögen", "möchten", "möchte"],
    },
  },
  {
    slug: "reflexive",
    titleKey: "grammar.reflexiveTitle",
    keywords: {
      en: ["reflexive", "reflexive verb", "reflexive verbs", "reflexive pronoun", "myself", "yourself", "reflexive accusative", "reflexive dative"],
      de: ["reflexiv", "Reflexivverb", "Reflexivverben", "Reflexivpronomen", "sich", "mich", "dich", "uns", "euch", "sich erinnern", "sich freuen", "sich interessieren", "sich setzen"],
    },
  },
  {
    slug: "oscillating-verbs",
    titleKey: "grammar.oscillatingVerbsTitle",
    keywords: {
      en: ["separable", "inseparable", "prefix", "dual prefix", "two-way prefix", "prefix stress", "stressed prefix", "oscillating", "separable verb", "inseparable verb"],
      de: ["trennbar", "untrennbar", "Präfix", "Vorsilbe", "Wechselpräfix", "trennbare Verben", "untrennbare Verben", "Betonung", "betontes Präfix", "durch", "über", "um", "unter", "hinter", "wieder"],
    },
  },
  {
    slug: "verb-prepositions",
    titleKey: "grammar.verbPrepositionsTitle",
    keywords: {
      en: ["verb preposition", "verbs with prepositions", "fixed preposition", "preposition after verb", "case government"],
      de: [
        "Verb mit Präposition", "Verben mit Präpositionen", "feste Präposition", "Rektion",
        // verb + preposition pairs (from data/rules/verb-prepositions.json)
        "denken an", "erinnern an", "gewöhnen an", "glauben an", "schreiben an", "teilnehmen an", "arbeiten an", "leiden an", "zweifeln an",
        "warten auf", "freuen auf", "achten auf", "hoffen auf", "konzentrieren auf", "verlassen auf", "bestehen auf", "verzichten auf", "aufpassen auf", "reagieren auf", "ankommen auf",
        "bestehen aus",
        "interessieren für", "entscheiden für", "sorgen für", "danken für", "halten für", "bedanken für",
        "kämpfen gegen", "protestieren gegen", "wehren gegen",
        "verlieben in",
        "anfangen mit", "aufhören mit", "beschäftigen mit", "rechnen mit", "sprechen mit", "treffen mit", "umgehen mit",
        "fragen nach", "suchen nach", "erkundigen nach", "riechen nach", "schmecken nach",
        "sprechen über", "freuen über", "ärgern über", "beschweren über", "nachdenken über", "berichten über", "wundern über", "diskutieren über", "lachen über",
        "kümmern um", "bewerben um", "bitten um", "handeln um", "sorgen um", "kämpfen um", "bemühen um",
        "leiden unter", "verstehen unter",
        "abhängen von", "träumen von", "erzählen von", "erholen von", "handeln von",
        "fürchten vor", "schützen vor", "warnen vor",
        "gehören zu", "gratulieren zu", "passen zu", "führen zu", "beitragen zu", "einladen zu",
      ],
    },
  },
  {
    slug: "connectors",
    titleKey: "grammar.connectorsTitle",
    keywords: {
      en: ["connector", "connectors", "conjunction", "conjunctions", "coordinating", "subordinating", "word order", "main clause", "subordinate clause", "because", "but", "although", "however"],
      de: ["Konnektor", "Konnektoren", "Konjunktion", "Konjunktionen", "Bindewort", "nebenordnend", "unterordnend", "Wortstellung", "Hauptsatz", "Nebensatz", "weil", "aber", "denn", "sondern", "obwohl", "dass", "wenn", "deshalb", "trotzdem"],
    },
  },
  {
    slug: "purpose-clauses",
    titleKey: "grammar.purposeClausesTitle",
    keywords: {
      en: ["purpose", "purpose clause", "final clause", "in order to", "um zu", "damit", "so that", "intention", "goal"],
      de: ["Finalsatz", "Finalsätze", "Absicht", "Zweck", "Ziel", "um zu", "damit"],
    },
  },
  {
    slug: "proadverb",
    titleKey: "grammar.proadverbTitle",
    keywords: {
      en: ["pronominal adverb", "pronominal adverbs", "prepositional adverb", "da compounds", "wo compounds", "preposition pronoun", "r insertion"],
      de: ["Pronominaladverb", "Pronominaladverbien", "da-Komposita", "wo-Komposita", "darauf", "daran", "darin", "darüber", "damit", "dazu", "davon", "dabei", "worauf", "woran", "wofür", "worüber", "wovon", "wozu"],
    },
  },
];

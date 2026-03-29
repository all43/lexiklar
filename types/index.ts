export type {
  Sense,
  Sound,
  WordMeta,
  ProofreadFlags,
  WordOverrides,
  GenderRule,
  CaseRow,
  CaseForms,
  PersonForms,
  ImperativeForms,
  ConjugationTable,
  VerbStems,
  PrincipalParts,
  GenderedCaseRows,
  FullDeclension,
  WordBase,
  NounWord,
  VerbWord,
  AdjectiveWord,
  AbbreviationWord,
  PhraseWord,
  NameWord,
  GenericWord,
  Word,
  NounGenderRuleEntry,
  NounGenderRules,
  AdjEndingsTable,
  VerbEndingsFile,
} from "./word.js";

export type {
  Annotation,
  ExampleProofread,
  Example,
  ExampleShard,
  ExampleMap,
} from "./example.js";

export type {
  PosConfig,
  PosKey,
  PosConfigMap,
} from "./pos.js";

export type {
  LLMProvider,
  LLMOptions,
  LLMResponse,
  ProviderConfig,
} from "./llm.js";

export type {
  SearchResult,
  WordRow,
  ExampleRow,
} from "./search.js";

export type {
  SegmentType,
  GlossSegment,
} from "./references.js";

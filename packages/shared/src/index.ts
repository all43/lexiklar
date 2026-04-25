// @lexiklar/shared — adapted grammar components for admin use.
// The main app does NOT import from this package.

// Zero-F7 components (verbatim copies with alias imports)
export { default as ConjugationTable } from "./components/ConjugationTable.vue";
export { default as VerbSepPipe } from "./components/VerbSepPipe.vue";
export { default as EnSynonyms } from "./components/EnSynonyms.vue";
export { default as GlossText } from "./components/GlossText.vue";

// Adapted components (F7 elements replaced with plain HTML)
export { default as NounDeclension } from "./components/NounDeclension.vue";
export { default as VerbConjugation } from "./components/VerbConjugation.vue";
export { default as AdjectiveDeclension } from "./components/AdjectiveDeclension.vue";
export { default as PronounDeclension } from "./components/PronounDeclension.vue";
export { default as DeterminerDeclension } from "./components/DeterminerDeclension.vue";
export { default as FalseFriend } from "./components/FalseFriend.vue";
export { default as ConfusablePair } from "./components/ConfusablePair.vue";

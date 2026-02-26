/**
 * Reference token utilities for the pipeline.
 *
 * Reference format:
 *   [[^N]]              — superscript ref to sense N (same word)
 *   [[#N]]              — inline ref to sense N (same word)
 *   [[pos/file#N]]      — cross-entry ref without display text
 *   [[display|^N]]      — superscript ref with display text
 *   [[display|#N]]      — inline ref with display text
 *   [[display|path#N]]  — cross-entry ref with display text (the word itself is the link)
 */

/**
 * Strip all reference tokens from text, producing clean input for LLM translation.
 * Tokens that carry display text are replaced with that text; bare markers are removed.
 *
 *   "Mein Arzt [[hat|verbs/haben#1]] noch keinen Doktortitel."
 *     → "Mein Arzt hat noch keinen Doktortitel."
 *   "um einen Tisch [[^1]] versammelte Gesellschaft"
 *     → "um einen Tisch versammelte Gesellschaft"
 *   "laufen (im Sinne von [[#1]])"
 *     → "laufen"
 *
 * @param {string} text
 * @returns {string}
 */
export function stripReferences(text) {
  return text
    // [[display|...]] → replace with display text (handles all typed with display text)
    .replace(/\[\[([^\]|]+)\|[^\]]+\]\]/g, "$1")
    // [[^N]] superscript refs without display text → strip (with possible leading space)
    .replace(/\s*\[\[\^\d+\]\]/g, "")
    // (...[[#N]]...) parenthetical inline refs without display text → strip whole paren
    .replace(/\s*\([^)]*?\[\[#\d+\]\][^)]*?\)/g, "")
    // bare [[#N]] inline refs without display text → strip
    .replace(/\[\[#\d+\]\]/g, "")
    // [[path#N]] cross-entry refs without display text → strip
    .replace(/\[\[[^|\]]+#\d+\]\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

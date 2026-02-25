/**
 * Reference token utilities for the pipeline.
 *
 * Reference format:
 *   [[^N]]           — superscript ref to sense N (same word)
 *   [[#N]]           — inline ref to sense N (same word)
 *   [[pos/file#N]]   — cross-entry ref (future)
 */

/**
 * Strip all reference tokens from text, producing clean input for LLM translation.
 *
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
    .replace(/\s*\[\[\^\d+\]\]/g, "")                    // [[^N]] superscript refs
    .replace(/\s*\([^)]*?\[\[#\d+\]\][^)]*?\)/g, "")     // (...[[#N]]...) parenthetical refs
    .replace(/\[\[#\d+\]\]/g, "")                         // bare [[#N]] inline refs
    .replace(/\[\[[^\]]+#\d+\]\]/g, "")                   // [[path#N]] cross-entry refs
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Reference token parser for the Vue app.
 *
 * Reference format:
 *   [[^N]]           — superscript ref to sense N (same word)
 *   [[#N]]           — inline ref to sense N (same word)
 *   [[pos/file#N]]   — cross-entry ref (future)
 *
 * @typedef {'text' | 'superscript_ref' | 'inline_ref' | 'cross_ref'} SegmentType
 *
 * @typedef {Object} GlossSegment
 * @property {SegmentType} type
 * @property {string} text - display text for this segment
 * @property {number} [senseNumber] - 1-based sense index (for refs)
 * @property {string} [filePath] - relative path for cross-entry refs
 */

// Matches all reference token forms:
//   [[^N]]              superscript ref to sense N (same card)
//   [[#N]]              inline ref to sense N (same card)
//   [[path#N]]          cross-entry ref without display text
//   [[display|^N]]      superscript ref with display text
//   [[display|#N]]      inline ref with display text
//   [[display|path#N]]  cross-entry ref WITH display text (the clickable word itself)
const REF_PATTERN = /\[\[(?:([^\]|]+)\|)?(?:(\^)|(?:([^#\]]+))?#)?(\d+)\]\]/g;

/**
 * Parse a gloss string into an array of segments for rendering.
 * @param {string} gloss
 * @returns {GlossSegment[]}
 */
export function parseReferences(gloss) {
  const segments = [];
  let lastIndex = 0;

  for (const match of gloss.matchAll(REF_PATTERN)) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", text: gloss.slice(lastIndex, match.index) });
    }

    const displayText = match[1] || null;
    const isSuperscript = match[2] === "^";
    const filePath = match[3] || null;
    const senseNumber = parseInt(match[4], 10);

    if (filePath) {
      segments.push({
        type: "cross_ref",
        text: displayText || `[${senseNumber}]`,
        senseNumber,
        filePath,
        hasDisplayText: !!displayText,
      });
    } else if (isSuperscript) {
      segments.push({
        type: "superscript_ref",
        text: displayText || `${senseNumber}`,
        senseNumber,
        hasDisplayText: !!displayText,
      });
    } else {
      segments.push({
        type: "inline_ref",
        text: displayText || `[${senseNumber}]`,
        senseNumber,
        hasDisplayText: !!displayText,
      });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < gloss.length) {
    segments.push({ type: "text", text: gloss.slice(lastIndex) });
  }

  return segments;
}

/**
 * Quick check whether a gloss contains any reference tokens.
 * @param {string} gloss
 * @returns {boolean}
 */
export function hasReferences(gloss) {
  return gloss.includes("[[");
}

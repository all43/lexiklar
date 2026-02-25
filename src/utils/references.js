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

// Matches all reference token forms: [[^N]], [[#N]], [[path#N]]
const REF_PATTERN = /\[\[(?:(\^)|(?:([^#\]]+))?#)?(\d+)\]\]/g;

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

    const isSuperscript = match[1] === "^";
    const filePath = match[2] || null;
    const senseNumber = parseInt(match[3], 10);

    if (filePath) {
      segments.push({ type: "cross_ref", text: `[${senseNumber}]`, senseNumber, filePath });
    } else if (isSuperscript) {
      segments.push({ type: "superscript_ref", text: `${senseNumber}`, senseNumber });
    } else {
      segments.push({ type: "inline_ref", text: `[${senseNumber}]`, senseNumber });
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

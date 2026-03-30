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

import type { GlossSegment, SegmentType } from "../../types/references.js";

// Matches all reference token forms:
//   [[^N]]              superscript ref to sense N (same card)
//   [[#N]]              inline ref to sense N (same card)
//   [[path#N]]          cross-entry ref with sense number
//   [[path]]            cross-entry ref without sense number (whole word)
//   [[display|^N]]      superscript ref with display text
//   [[display|#N]]      inline ref with display text
//   [[display|path#N]]  cross-entry ref WITH display text + sense
//   [[display|path]]    cross-entry ref WITH display text, no sense
//
// Groups: 1=display, 2=^, 3=superscript N, 4=file path, 5=sense N after path, 6=bare #N
// Group 4 allows [bracket] sequences inside file paths (e.g. pronouns/das_[1], nouns/Bord_[schiffs-]rand).
// Requires at least one leading non-bracket char (+) so [[#N]] falls through to the bare-#N alternative.
const REF_PATTERN = /\[\[(?:([^\]|]+)\|)?(?:(\^)(\d+)|([^#\[\]]+(?:\[[^\]]*\][^#\[\]]*)*?)(?:#(\d+))?|#(\d+))\]\]/g;

/**
 * Parse a gloss string into an array of segments for rendering.
 * @param {string} gloss
 * @returns {GlossSegment[]}
 */
export function parseReferences(gloss: string): GlossSegment[] {
  const segments: GlossSegment[] = [];
  let lastIndex = 0;

  for (const match of gloss.matchAll(REF_PATTERN)) {
    const matchIndex = match.index!;
    if (matchIndex > lastIndex) {
      segments.push({ type: "text", text: gloss.slice(lastIndex, matchIndex) });
    }

    const displayText = match[1] || null;
    const isSuperscript = match[2] === "^";
    const superscriptN = match[3] ? parseInt(match[3], 10) : null;
    const filePath = match[4] || null;
    const pathSenseN = match[5] ? parseInt(match[5], 10) : null;
    const bareSenseN = match[6] ? parseInt(match[6], 10) : null;

    if (filePath) {
      // Cross-entry ref: [[path#N]] or [[path]] or [[display|path#N]] or [[display|path]]
      const senseNumber = pathSenseN ?? undefined;
      segments.push({
        type: "cross_ref",
        text: displayText || (senseNumber ? `[${senseNumber}]` : filePath.split("/").pop()!),
        senseNumber,
        filePath,
        hasDisplayText: !!displayText,
      });
    } else if (isSuperscript) {
      // Superscript ref: [[^N]] or [[display|^N]]
      segments.push({
        type: "superscript_ref",
        text: displayText || `${superscriptN}`,
        senseNumber: superscriptN ?? undefined,
        hasDisplayText: !!displayText,
      });
    } else {
      // Inline ref: [[#N]] or [[display|#N]]
      segments.push({
        type: "inline_ref",
        text: displayText || `[${bareSenseN}]`,
        senseNumber: bareSenseN ?? undefined,
        hasDisplayText: !!displayText,
      });
    }

    lastIndex = matchIndex + match[0].length;
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
export function hasReferences(gloss: string): boolean {
  return gloss.includes("[[");
}

export type { GlossSegment, SegmentType };

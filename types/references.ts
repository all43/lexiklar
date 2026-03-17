/** Reference/gloss segment types for parsing [[...]] tokens. */

export type SegmentType = "text" | "superscript_ref" | "inline_ref" | "cross_ref";

export interface GlossSegment {
  type: SegmentType;
  text: string;
  senseNumber?: number;
  filePath?: string;
  hasDisplayText?: boolean;
}

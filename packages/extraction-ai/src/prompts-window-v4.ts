// packages/extraction-ai/src/prompts-window-v4.ts
// VERSIONED Window-detection pass: STRUCTURAL_WINDOW_DETECTION_V4.
//
// This is a SEPARATE, versioned prompt. It does NOT overwrite the legacy Core
// prompt in prompts.ts (which is frozen verbatim for parity, §9). It is used
// ONLY when the AI_WINDOWS_V4 feature flag is enabled, and is gated to run as
// an additional pass after the Core structural pass. The Core pass remains the
// rollback (AI_WINDOWS_V4 default OFF).
//
// Root-cause addressed: the Core opening schema example only shows a `door`,
// so providers frequently return zero `type:"window"` openings. This dedicated
// pass systematically inspects every wall region and returns windows as
// first-class openings that the existing opening-normalizer accepts
// (normalizeType("window") === WINDOW).

import { CATALOG_SLUGS } from './prompts';

export const WINDOW_DETECTION_V4_VERSION = '4';

const WINDOW_BASE_RULES = `
CRITICAL REQUIREMENTS:
- (0,0) is bottom-left. Use absolute coordinates in METERS.
- OUTPUT ONLY VALID JSON. Start with '{' and end with '}'. No markdown formatting.
- Inspect EVERY wall segment (exterior and interior) systematically for opening symbols.
- Distinguish Windows from Doors, wall gaps, dimension lines, room labels, and furniture.
- Detect repeated Window symbols as SEPARATE records (each window opening gets its own id).
- Use visible linework as the PRIMARY evidence. Drafting labels are SUPPORTING evidence only.
- DO NOT create a Window from a text label alone.
- DO NOT treat a blue/colored symbol as sufficient evidence by itself.
- DO NOT invent hidden openings that are not visible in the linework.
- Return uncertain symbols in the "review" array, not as accepted windows.
- Preserve source pixel bounds (sourceBoxPx) for audit.
- Use the declared project-coordinate convention (bottom-left origin, metres).
`;

export function getWindowDetectionPromptV4(args: {
  imageWidthPx: number;
  imageHeightPx: number;
  acceptedWallIds: string[];
  /** Optional focused wall-crop context (batch 2). */
  focusedCropContext?: { cropId: string; sourceBoxPx: [number, number, number, number]; candidateWallIds: string[] }[];
}): string {
  const wallList = args.acceptedWallIds.length ? args.acceptedWallIds.join(', ') : '(none yet — rely on visible linework)';
  const crops = args.focusedCropContext?.length
    ? `\nFOCUSED WALL CROPS (verify these regions specifically):\n${JSON.stringify(args.focusedCropContext)}`
    : '';
  return `You are a Window-Detection Specialist for architectural plans.
TASK: Find EVERY window opening in the provided 2D floor plan.

INPUT:
- Full source image (${args.imageWidthPx}x${args.imageHeightPx} px).
- Accepted structural wall ids (for host-wall hints only, not authoritative): ${wallList}.${crops}

${WINDOW_BASE_RULES}

EXPECTED JSON SCHEMA:
{
  "windows": [
    {
      "id": "w1",
      "type": "window",
      "sourceBoxPx": [x, y, w, h],
      "candidateHostWallId": "w3",
      "pos": [x, z],
      "width": 1.2,
      "height": 1.2,
      "elevation": 0.9,
      "sillM": 0.9,
      "headM": 2.1,
      "orientationDeg": 0,
      "symbolType": "double-glazed" | "single" | "sliding" | "fixed" | "round" | "unknown",
      "confidence": 0.9,
      "evidence": "visible double-line window symbol on north exterior wall",
      "reviewReason": null
    }
  ],
  "review": [
    {
      "id": "wr1",
      "type": "window",
      "sourceBoxPx": [x, y, w, h],
      "pos": [x, z],
      "width": 1.0,
      "height": 1.2,
      "confidence": 0.4,
      "evidence": "faint symbol, ambiguous vs dimension line",
      "reviewReason": "AMBIGUOUS_SYMBOL"
    }
  ]
}

RULES:
- Every "windows" entry MUST have type "window".
- pos is the window centre in project metres [x, z].
- width/height are opening sizes in metres; elevation is the sill height (default 0.9 if unclear).
- candidateHostWallId is your best guess; deterministic geometry will confirm the host.
- Return strict JSON only.`;
}

// Re-export the catalog const so downstream tooling can reference V4 identity
// without importing the frozen prompts.ts directly.
export const WINDOW_V4_CATALOG_SLUGS = CATALOG_SLUGS;

// packages/extraction-mupdf/src/provider.ts
// Framework-free Pure MuPDF extraction provider.
// Emits real progress events (no fake percentages) and a neutral ExtractionResult.
// Runs without React, Next, Pascal, useScene, Viewer, ChatPanel, old scene bridge.

import type { ExtractionRequest, ExtractionEvent, ExtractionResult } from 'design-build-extraction-contracts';
import { extractPureWallResult, type MuPdfPureResult } from './mupdf-pure';
import { toExtractionResult } from './result-adapter';

export interface MuPdfExtractionOptions {
  pageNumber?: number;
  /** Override scale if the drawing has no dimension text. */
  scaleMmPerPt?: number;
}

function ev(phase: ExtractionEvent['phase'], progress: number, message: string): ExtractionEvent {
  return { phase, progress, message };
}

/**
 * Direct, testable pure function. Returns the neutral ExtractionResult.
 * This is the single entry point the API route / worker calls.
 */
export async function extractBuildingFromPdf(
  input: Uint8Array,
  options?: MuPdfExtractionOptions,
): Promise<ExtractionResult> {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input as unknown as ArrayBuffer);
  const raw: MuPdfPureResult = extractPureWallResult(
    data as unknown as Uint8Array,
    options?.pageNumber ?? 0,
    undefined,
    undefined,
  );
  return toExtractionResult(raw);
}

/**
 * Async-iterable provider that streams typed progress events, then yields the
 * neutral ExtractionResult via `extractAll`. Mirrors the neutral ExtractionProvider
 * contract (defined in design-build-extraction-ai) without importing it directly
 * to keep this package dependency-light.
 */
export async function* extractionProvider(request: ExtractionRequest): AsyncIterable<ExtractionEvent> {
  const t0 = Date.now();
  yield ev('document', 0.02, 'Reading PDF vectors');
  const data = request.pdf;
  const raw: MuPdfPureResult = extractPureWallResult(
    data as unknown as Uint8Array,
    request.pageNumber ?? 0,
    undefined,
    undefined,
  );
  const accepted = raw.accepted.length;
  yield ev('document', 0.1, 'Locating the building');
  yield ev('slab', 0.25, 'Measuring wall thicknesses');
  yield ev('walls', 0.55, `Building the physical wall network (${accepted} candidate walls)`);
  yield ev('review', 0.85, 'Validating wall elements');
  const result = toExtractionResult(raw, { fileName: request.fileName });
  yield ev('completed', 1, `Validated ${result.walls.length} wall elements`);
  // Surface the full result on the final event for consumers that await the stream.
  yield { phase: 'completed', progress: 1, message: 'done', partial: result };
}

export const mupdfExtractionProvider = { extract: extractionProvider, extractAll: extractBuildingFromPdf };

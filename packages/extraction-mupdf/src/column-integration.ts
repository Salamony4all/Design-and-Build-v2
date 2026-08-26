// Column integration into the single-pass Pure MuPDF orchestration.
//
// Wiring contract (main supervisor):
//   captured vectors (already in memory, NO PDF reopen, NO recapture)
//     -> trusted wall extraction      (frozen, untouched)
//     -> verified window extraction   (frozen, untouched)
//     -> verified door extraction     (frozen, untouched)
//     -> claimed-source registry      (wall/window/door segment + leaf ids)
//     -> column extraction from REMAINING (unclaimed) geometry
//
// PRODUCTION ENTRY POINT: `extractColumnsFromCapturedGeometry` — receives
// already-captured vectors and NEVER opens or recaptures the PDF. The
// application orchestration MUST call only this function.
//
// `extractColumnsFromPdf` is retained SOLELY for isolated package E2E tests;
// it captures once then delegates to the captured-geometry entry point.
import { collectPageVectors, mupdf } from './index';
import { extractColumns, type CapturedGeometry, type Segment, type CubicCurve, type ColumnFootprint } from 'design-build-extraction-columns';

export interface ColumnContract {
  physicalColumnId: string;
  footprintType: ColumnFootprint;
  centreProjectM: { x: number; y: number };
  widthM: number;
  depthM: number;
  rotationRad: number;
  heightM: number;
  sourceSegmentIds: string[];
  sourceOperationIds: string[];
  verdict: 'ACCEPT' | 'REVIEW';
}

export interface ColumnExtractOptions {
  includeReview?: boolean;
  minSizeM?: number;
  /** Exclude ids already owned by walls/windows/doors/annotations. */
  claimedSourceIds?: string[];
}

/**
 * PRODUCTION ENTRY POINT.
 *
 * Receives already-captured vectors (the same `lines`/`cubics` the wall,
 * window and door extractors consumed) and the claimed-source registry. It
 * NEVER opens a PDF and NEVER recaptures vectors — `totalPdfOpenCount` and
 * `totalVectorCaptureCount` for the column stage are both 0.
 */
export function extractColumnsFromCapturedGeometry(
  input: {
    lines: Segment[];
    cubics: CubicCurve[];
    claimedSourceIds: string[];
    scaleMmPerPt: number;
    sourceHash: string;
    coordinateFrame?: unknown;
    structuralEnvelope?: { minX: number; minY: number; maxX: number; maxY: number };
  },
  opts: ColumnExtractOptions = {},
): ColumnContract[] {
  const claimed = new Set(input.claimedSourceIds);
  const segments = (input.lines ?? []).filter((l) => !claimed.has(l.id));
  const curves = (input.cubics ?? []).filter((c) => !claimed.has(c.id));
  const geo: CapturedGeometry = {
    segments,
    curves,
    mmPerUnit: input.scaleMmPerPt,
    sourceHash: input.sourceHash,
  };
  const cols = extractColumns(
    geo,
    opts.minSizeM != null ? { minSizeM: opts.minSizeM } : {},
  );
  const filtered = opts.includeReview
    ? cols
    : cols.filter((c) => c.verdict === 'ACCEPT' && c.footprintType === 'RECTANGULAR');
  return filtered.map((c) => ({
    physicalColumnId: c.physicalColumnId,
    footprintType: c.footprintType,
    centreProjectM: c.centreProjectM,
    widthM: c.widthM ?? 0,
    depthM: c.depthM ?? 0,
    rotationRad: c.rotationRad,
    heightM: (c as any).heightM ?? 3,
    sourceSegmentIds: c.sourceSegmentIds,
    sourceOperationIds: c.sourceOperationIds,
    verdict: c.verdict as 'ACCEPT' | 'REVIEW',
    sourceHash: input.sourceHash,
  }));
}

export interface ColumnExtractionInput {
  /** Raw PDF bytes — opened ONCE here, ONLY for isolated package E2E. */
  pdfBytes: Uint8Array;
  pageNumber?: number;
  /** Claimed ids from trusted wall/window/door extraction (excluded from columns). */
  claimedSourceIds: string[];
  /** Wall/window/door scale (mm per PDF point). */
  scaleMmPerPt: number;
  sourceHash: string;
}

/**
 * Isolated-package E2E only. Captures vectors ONCE, then delegates to the
 * captured-geometry entry point. The production application must NOT call this.
 */
export function extractColumnsFromPdf(
  input: ColumnExtractionInput,
  opts: ColumnExtractOptions = {},
): ColumnContract[] {
  const cap = collectPageVectors(
    mupdf.Document.openDocument(input.pdfBytes, 'application/pdf').loadPage(input.pageNumber ?? 0),
    false,
    input.pageNumber ?? 0,
  );
  const lines: Segment[] = [];
  const cubics: CubicCurve[] = [];
  for (const v of cap.vectors as any[]) {
    const op = (v as any).id;
    const subpaths = (v as any).subpaths as Array<Array<{ x: number; y: number }>>;
    for (let si = 0; si < (subpaths?.length ?? 0); si++) {
      const sp = subpaths[si];
      const sid = `${op}:s${si}`;
      if (sp.length >= 2) lines.push({ id: sid, a: sp[0], b: sp[sp.length - 1], sourceOperationId: op });
    }
    let cur: { x: number; y: number } | undefined;
    let cidx = 0;
    for (const c of ((v as any).commands ?? []) as Array<any>) {
      if (c.op === 'M') cur = c.p0 ?? c.p1;
      else if (c.op === 'L') cur = c.p1;
      else if (c.op === 'C') {
        const p0 = cur ?? c.p0 ?? c.p1;
        cubics.push({ id: `${op}:c${cidx}`, p0, p1: c.p1, p2: c.p2, p3: c.p3, sourceOperationId: op });
        cur = c.p3;
        cidx++;
      }
    }
    const pts = (v as any).points as Array<{ x: number; y: number }>;
    for (let i = 0; i + 1 < (pts?.length ?? 0); i++) {
      const lid = `${op}:L${i}`;
      const sid = `${op}:seg:${i}`;
      lines.push({ id: lid, a: pts[i], b: pts[i + 1], sourceOperationId: op });
      lines.push({ id: sid, a: pts[i], b: pts[i + 1], sourceOperationId: op });
    }
  }
  return extractColumnsFromCapturedGeometry(
    {
      lines,
      cubics,
      claimedSourceIds: input.claimedSourceIds,
      scaleMmPerPt: input.scaleMmPerPt,
      sourceHash: input.sourceHash,
    },
    opts,
  );
}

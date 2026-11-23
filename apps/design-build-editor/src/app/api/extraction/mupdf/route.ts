// apps/design-build-editor/app/api/extraction/mupdf/route.ts
// Dedicated clean Pure MuPDF extraction boundary (Change Set 2, §7).
// Does NOT use the legacy Fusion route. Never mutates Pascal. Never imports
// apps/editor at runtime. Returns the neutral ExtractionResult (or typed errors).

import { NextRequest, NextResponse } from 'next/server';
import type { ExtractionResult } from 'design-build-extraction-contracts';
import type { MuPdfPureWindowResult, MuPdfPureDoorResult } from 'design-build-extraction-mupdf';
import { completeWalls } from 'design-build-extraction-mupdf';
import type { RawSegment, ProtectedOpening } from 'design-build-extraction-mupdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/octet-stream', // some clients send this for .pdf
]);

type ApiError = { error: string; code: string; detail?: string };

function fail(code: string, message: string, status: number, detail?: string) {
  const body: ApiError = { error: message, code, detail };
  return NextResponse.json(body, { status });
}

type MupdfLib = typeof import('design-build-extraction-mupdf');
type Pt = { x: number; y: number };

/**
 * Curved walls, glass partitions and pods read from the drawing's own arcs, cut into
 * Pascal walls (start, end, curveOffset). Straight walls read from the same curves are
 * dropped in their favour. Never fatal: a failure only means no curved walls.
 */
function curvedWallsFor(
  lib: Pick<MupdfLib, 'detectCurvedWalls' | 'curvedWallPieces' | 'curvedBandUnder' | 'documentFrameFromPure'>,
  createCoordinateFrame: typeof import('design-build-coordinate-frame').createCoordinateFrame,
  vectors: any[],
  pureResult: any,
  geometryHash: string,
) {
  const none = { walls: [] as any[], pods: [] as any[], doorSpecs: [] as any[], dropWallIds: new Set<string>(), onCurve: (_a?: Pt, _b?: Pt) => false };
  // curved walls are matched in metres: without a real scale there is nothing to match
  if (pureResult.scaleSource === 'fallback') return none;
  try {
    // Only inside the building's extent (straight walls plus 3 m): not title blocks, logos or legends.
    const accepted: any[] = pureResult.accepted ?? [];
    let within: [number, number, number, number] | undefined;
    if (accepted.length >= 4) {
      const xs = accepted.flatMap((w) => [w.centerline.a.x, w.centerline.b.x]);
      const ys = accepted.flatMap((w) => [w.centerline.a.y, w.centerline.b.y]);
      const m = 3 / (pureResult.scaleMmPerPt / 1000);
      within = [Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m];
    }
    const found = lib.detectCurvedWalls({ vectors, scaleMmPerPt: pureResult.scaleMmPerPt, within });
    if (found.segments.length === 0) return none;
    const frameIn = lib.documentFrameFromPure(pureResult);
    const cf = createCoordinateFrame({
      pageBoundsPt: frameIn.pageBoundsPt,
      scaleMmPerPt: frameIn.scaleMmPerPt,
      pageWidthM: frameIn.widthM,
      pageHeightM: frameIn.heightM,
    });
    const walls: any[] = lib.curvedWallPieces(found.segments, (x, y) => cf.toPascal(x, y)).map((p) => ({ ...p, sourceHash: geometryHash }));
    // Doors in pod gaps: a straight wall across the gap holds an ordinary door (Pascal
    // curved walls cannot hold openings). The door uses the door installer's contract.
    const doorSpecs: any[] = [];
    for (const d of found.podDoors) {
      const [sx, sy] = cf.toPascal(d.start.x, d.start.y);
      const [ex, ey] = cf.toPascal(d.end.x, d.end.y);
      walls.push({
        id: d.id, segmentId: d.id, podId: d.podId, kind: d.kind, role: 'pod-door',
        start: { x: sx, y: sy }, end: { x: ex, y: ey }, curveOffset: 0,
        thicknessM: d.thicknessM, lengthM: d.widthM, sourceOperationIds: d.sourceOperationIds, sourceHash: geometryHash,
      });
      const margin = Math.min(0.02, d.widthM * 0.02);
      doorSpecs.push({
        id: d.id,
        doorAssemblyId: d.id,
        wallId: d.id,
        doorType: 'POD_SWING',
        intervalStartM: margin,
        intervalEndM: d.widthM - margin,
        widthM: d.widthM - 2 * margin,
        hingeSide: d.hingeSide,
        swingDirection: d.swingDirection,
        evidenceMode: 'GEOMETRY_ONLY',
        annotationIds: [],
        sourceSegmentIds: [],
        sourceOperationIds: d.sourceOperationIds,
        glazed: d.kind === 'glass',
        provenance: { confidence: 0.85, extractionType: 'curved-pod-door', note: d.podId },
      });
    }
    const pods = found.pods.map((p) => {
      const [x, y] = cf.toPascal(p.center.x, p.center.y);
      return { ...p, centerPascal: { x, y } };
    });
    const tolPt = 0.1 / (pureResult.scaleMmPerPt / 1000);
    const onCurve = (a?: Pt, b?: Pt) => !!a && !!b && !!lib.curvedBandUnder(a, b, found.segments, tolPt);
    const dropWallIds = new Set<string>();
    for (const w of pureResult.accepted ?? []) {
      if (onCurve(w.centerline?.a, w.centerline?.b)) dropWallIds.add(w.physicalWallId);
    }
    console.log(`[MuPdfRoute] Curved walls: ${found.segments.length} arcs -> ${walls.length} walls, ${pods.length} pods, ${doorSpecs.length} pod doors, ${dropWallIds.size} straight duplicates dropped.`);
    return { walls, pods, doorSpecs, dropWallIds, onCurve };
  } catch (e) {
    console.warn('[MuPdfRoute] curved wall detection skipped:', e);
    return none;
  }
}

export async function POST(req: NextRequest) {
  console.log('[MuPdfRoute] POST request received');
  let bytes: Uint8Array;
  let fileName = 'upload.pdf';

  try {
    const contentType = req.headers.get('content-type') ?? '';

    // Support multipart/form-data (file field) and raw application/pdf body.
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return fail('invalid-input', 'No PDF file field in multipart upload.', 400);
      }
      fileName = file.name || fileName;
      const buf = Buffer.from(await file.arrayBuffer());
      bytes = new Uint8Array(buf);
    } else if (contentType.includes('application/json')) {
      const json = await req.json();
      if (json?.attachment?.bytes && Array.isArray(json.attachment.bytes)) {
        bytes = Uint8Array.from(json.attachment.bytes);
        fileName = json.attachment.fileName || fileName;
      } else if (typeof json?.pdfBase64 === 'string') {
        bytes = Uint8Array.from(Buffer.from(json.pdfBase64, 'base64'));
        fileName = json.fileName || fileName;
      } else {
        return fail('invalid-input', 'JSON body must carry attachment.bytes or pdfBase64.', 400);
      }
    } else {
      // Raw PDF body.
      const buf = Buffer.from(await req.arrayBuffer());
      bytes = new Uint8Array(buf);
    }
  } catch (e) {
    return fail('invalid-input', 'Could not read request body.', 400, e instanceof Error ? e.message : String(e));
  }

  console.log(`[MuPdfRoute] Request body parsed, filename: ${fileName}, bytes length: ${bytes?.length ?? 0}`);

  // Validate MIME + size.
  const declaredMime = req.headers.get('content-type') ?? '';
  if (declaredMime.includes('multipart/form-data')) {
    // multipart is fine; PDF magic-byte check below is authoritative.
  } else if (!ALLOWED_MIME.has(declaredMime) && !declaredMime.includes('application/pdf')) {
    // PNG/JPEG must be routed to AI extraction, not Pure MuPDF.
    return fail('unsupported-input', 'Pure MuPDF accepts PDF only. Use the AI (Gemini) method for PNG/JPEG.', 415);
  }
  if (!bytes || bytes.length === 0) {
    return fail('empty-document', 'Empty document.', 400);
  }
  if (bytes.length > MAX_BYTES) {
    return fail('unsupported-input', `PDF exceeds ${MAX_BYTES} bytes.`, 413);
  }
  // PDF magic-byte check.
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return fail('invalid-pdf', 'File is not a valid PDF (missing %PDF header).', 400);
  }

  const isStream = req.nextUrl.searchParams.get('stream') === 'true' ||
    req.headers.get('accept')?.includes('application/x-ndjson') ||
    req.headers.get('accept')?.includes('text/event-stream');

  try {
    const { extractPureWallResult, toExtractionResult, documentFrameFromPure, runWindowPipeline, runDoorPipeline, collectPageVectors, mupdf, PURE_WINDOW_DEFAULTS, PURE_DOOR_DEFAULTS, acceptedGeometryHash, acceptedEvidenceHash, buildDoorProductionManifest, extractColumnsFromCapturedGeometry, detectCurvedWalls, curvedWallPieces, curvedBandUnder, alongWalls } = await import('design-build-extraction-mupdf');
    const curvedLib = { detectCurvedWalls, curvedWallPieces, curvedBandUnder, documentFrameFromPure };
    // Glass partitions are walls too: wall completion must not lay solid copies over them.
    const offGlass = (pureResult: any, walls: any[]) => {
      const glass = (pureResult.accepted ?? []).filter((w: any) => w.glass)
        .map((w: any) => ({ a: w.centerline.a, b: w.centerline.b, thickness: w.thickness }));
      return glass.length ? walls.filter((c) => !alongWalls(glass, c.centrelineStartProjectM, c.centrelineEndProjectM, 2)) : walls;
    };
    const { createCoordinateFrame } = await import('design-build-coordinate-frame');
    const { captureDoorAnnotations, DEFAULT_ANNOTATION_OPTIONS } = await import('design-build-extraction-annotations');
    const t0 = Date.now();

    if (isStream) {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      const sendChunk = async (chunk: unknown) => {
        try {
          await writer.write(encoder.encode(JSON.stringify(chunk) + '\n'));
        } catch {
          // Client disconnected
        }
      };

      (async () => {
        try {
          const tPdf0 = Date.now();
          const doc = mupdf.Document.openDocument(bytes as any, 'application/pdf');
          const page = doc.loadPage(0);
          const captured = collectPageVectors(page, false, 0);
          const pageBoundsMupdf: [number, number, number, number] = (() => {
            const b = page.getBounds() as unknown as number[];
            return [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0];
          })();
          const tAnn0 = Date.now();
          const annCapture = captureDoorAnnotations(page, DEFAULT_ANNOTATION_OPTIONS, undefined, 0);
          const annotationCaptureMs = Date.now() - tAnn0;

          const wallRaw = extractPureWallResult(bytes, 0, undefined, undefined, true) as any;
          const pureResult = wallRaw.pureResult;
          const geometryHash = acceptedGeometryHash(pureResult.accepted);
          const evidenceHash = acceptedEvidenceHash(pureResult.accepted);
          const result = toExtractionResult(pureResult, { fileName });

          if (!result.walls || result.walls.length === 0) {
            await sendChunk({ type: 'error', error: 'No building region / walls detected in document.' });
            await writer.close();
            return;
          }

          // Wall completion calculation
          let completionWalls: any[] = [];
          let finalizedWallCount = pureResult.accepted.length;
          let wallCompletionHash = '';
          let finalizedTopologyHash = '';
          try {
            const wcLines: RawSegment[] = [];
            for (const v of captured.vectors as any[]) {
              const op = (v as any).id;
              const pts = (v as any).points as Array<{ x: number; y: number }> | undefined;
              if (pts && pts.length >= 2) {
                for (let i = 0; i + 1 < pts.length; i++) {
                  wcLines.push({ id: `${op}:L${i}`, a: pts[i], b: pts[i + 1], sourceOperationId: op });
                }
                continue;
              }
              const subpaths = (v as any).subpaths as Array<Array<{ x: number; y: number }>> | undefined;
              if (subpaths) {
                for (let si = 0; si < subpaths.length; si++) {
                  const sp = subpaths[si];
                  for (let i = 0; i + 1 < sp.length; i++) {
                    wcLines.push({ id: `${op}:s${si}:L${i}`, a: sp[i], b: sp[i + 1], sourceOperationId: op });
                  }
                }
                continue;
              }
              const cmds = (v as any).commands as Array<any> | undefined;
              if (cmds) {
                let cur: { x: number; y: number } | undefined;
                for (const c of cmds) {
                  if (c.op === 'M') cur = c.p0 ?? c.p1;
                  else if (c.op === 'L') { if (cur) wcLines.push({ id: `${op}:cL`, a: cur, b: c.p1, sourceOperationId: op }); cur = c.p1; }
                  else if (c.op === 'C') { if (cur) wcLines.push({ id: `${op}:cL`, a: cur, b: c.p3, sourceOperationId: op }); cur = c.p3; }
                }
              }
            }
            const acceptedPhysicalWalls = pureResult.accepted.map((w: any) => {
              const a = w.centerline?.a ?? w.startM ?? w.a ?? { x: 0, y: 0 };
              const b = w.centerline?.b ?? w.endM ?? w.b ?? { x: 0, y: 0 };
              const thickness = typeof w.thickness === 'number'
                ? (w.thickness * pureResult.scaleMmPerPt) / 1000
                : (w.thicknessM ?? 0.2);
              return {
                physicalWallId: w.physicalWallId ?? w.id,
                startM: { x: a.x, y: a.y },
                endM: { x: b.x, y: b.y },
                thicknessM: thickness,
                sourceSegmentIds: w.sourceSubpathIds ?? [],
              };
            });
            const frameIn = documentFrameFromPure(pureResult);
            const cf = createCoordinateFrame({
              pageBoundsPt: frameIn.pageBoundsPt,
              scaleMmPerPt: frameIn.scaleMmPerPt,
              pageWidthM: frameIn.widthM,
              pageHeightM: frameIn.heightM,
            });
            const scalePtToM = pureResult.scaleMmPerPt / 1000;
            const wc = completeWalls({
              acceptedPhysicalWalls,
              capturedLines: wcLines,
              claimedSourceIds: (pureResult.accepted ?? []).flatMap((w: any) => w.sourceSubpathIds ?? []),
              acceptedWindows: [],
              acceptedDoors: [],
              scaleMmPerPt: pureResult.scaleMmPerPt,
              sourceHash: geometryHash,
              config: {
                joinTolM: 0.35 / scalePtToM,
                maxAutoExtensionM: 2.0 / scalePtToM,
                scaleMmPerPt: pureResult.scaleMmPerPt,
              },
            });
            completionWalls = wc.completionWalls.map((c) => {
              const [ax, az] = cf.toPascal(c.centrelineStartProjectM.x, c.centrelineStartProjectM.y);
              const [bx, bz] = cf.toPascal(c.centrelineEndProjectM.x, c.centrelineEndProjectM.y);
              return {
                ...c,
                sourceHash: geometryHash,
                centrelineStartPascal: { x: ax, y: az },
                centrelineEndPascal: { x: bx, y: bz },
              };
            });
            finalizedWallCount = wc.finalized.finalizedWallCount;
            wallCompletionHash = wc.finalized.wallCompletionHash;
            finalizedTopologyHash = wc.finalized.finalizedTopologyHash;
          } catch (wce) {
            console.warn('[MuPdfRoute Stream] wall completion warning:', wce);
          }

          // Curved walls, glass partitions and pods; straight copies of them are dropped.
          const curved = curvedWallsFor(curvedLib, createCoordinateFrame, captured.vectors as any[], pureResult, geometryHash);
          const wallsResult = curved.dropWallIds.size
            ? { ...result, walls: result.walls.filter((w) => !curved.dropWallIds.has(w.id)) }
            : result;
          completionWalls = offGlass(pureResult, completionWalls.filter((c) => !curved.onCurve(c.centrelineStartProjectM, c.centrelineEndProjectM)));

          // STAGE 1 CHUNK: Stream Walls immediately (in under 250ms!)
          await sendChunk({
            type: 'stage-walls',
            result: wallsResult,
            completionWalls,
            curvedWalls: curved.walls,
            curvedPods: curved.pods,
            coordinateFrame: {
              scaleMmPerPt: pureResult.scaleMmPerPt,
              pageBoundsMupdf: pureResult.pageBoundsMupdf,
            },
            sourceHash: geometryHash,
            originalWallCount: pureResult.accepted.length,
            completionWallCount: completionWalls.length,
            finalizedWallCount,
          });

          // STAGE 2: Window extraction
          let windowSpecs: import('@/features/window-pilot/install-pilot-windows').LiveWindowContract[] = [];
          let windowAudit: any = null;
          try {
            const winResult = runWindowPipeline({
              vectors: captured.vectors,
              wallResult: pureResult,
              pageBoundsMupdf,
            }, PURE_WINDOW_DEFAULTS, false) as MuPdfPureWindowResult;
            const mPerPt = (pureResult.scaleMmPerPt ?? 13.12766664766308) / 1000;
            const accepted = winResult.accepted ?? [];
            windowSpecs = accepted.map((r) => {
              const from = r.wallLocalInterval?.from ?? 0;
              const to = r.wallLocalInterval?.to ?? 0;
              return {
                id: r.openingRegionId,
                wallId: r.selectedPhysicalWallId ?? '',
                intervalStartM: from * mPerPt,
                intervalEndM: to * mPerPt,
                widthM: (to - from) * mPerPt,
                sillM: 0.9,
                headM: 2.1,
                provenance: {
                  sourcePrimitiveIds: r.sourceSegmentIds,
                  confidence: r.score,
                  extractionType: 'pure-mupdf-window',
                  note: (r.positiveEvidence ?? []).join('|'),
                },
              };
            });
            windowAudit = {
              candidates: winResult.rawCandidateCount,
              accepted: accepted.length,
              review: (winResult.review ?? []).length,
              rejected: (winResult.rejected ?? []).length,
              hostSummary: winResult.hostSummary,
              candidateHash: winResult.candidateHash,
              timings: winResult.timings,
            };
          } catch (we) {
            console.warn('[MuPdfRoute Stream] window extraction warning:', we);
          }

          // STAGE 2 CHUNK: Stream Windows
          await sendChunk({
            type: 'stage-windows',
            windowSpecs,
            windowAudit,
          });

          // STAGE 3: Door extraction
          let doorSpecs: Array<{
            id: string;
            wallId: string;
            doorType: string;
            intervalStartM: number;
            intervalEndM: number;
            widthM: number;
            hingeSide: string;
            swingDirection: string;
            sourceSegmentIds: string[];
            sourceOperationIds: string[];
            provenance: { sourcePrimitiveIds: string[]; confidence: number; extractionType: string; note: string };
          }> = [];
          let doorAudit: any = null;
          let doorManifest: any = undefined;
          try {
            const doorResult = runDoorPipeline({
              vectors: captured.vectors,
              wallResult: pureResult,
              pageBoundsMupdf,
              annotations: annCapture.annotations,
              annotationIndex: annCapture.index,
              annotationCaptureMs,
            }, PURE_DOOR_DEFAULTS, false) as MuPdfPureDoorResult;
            const mPerPt = (pureResult.scaleMmPerPt ?? 13.12766664766308) / 1000;
            const acceptedDoors = doorResult.accepted ?? [];
            doorSpecs = acceptedDoors.map((a) => {
              const from = a.wallLocalInterval?.from ?? 0;
              const to = a.wallLocalInterval?.to ?? 0;
              return {
                id: a.doorAssemblyId,
                doorAssemblyId: a.doorAssemblyId,
                wallId: a.selectedPhysicalWallId ?? '',
                doorType: a.doorType,
                intervalStartM: from * mPerPt,
                intervalEndM: to * mPerPt,
                widthM: (to - from) * mPerPt,
                hingeSide: (a.hingeSide ?? 'left') as 'left' | 'right',
                swingDirection: (a.swingDirection ?? 'inward') as 'inward' | 'outward',
                evidenceMode: (a.evidenceMode ?? 'GEOMETRY_ONLY') as 'GEOMETRY_ONLY' | 'ANNOTATION_ASSISTED_GEOMETRY_VERIFIED',
                annotationIds: a.assistedByAnnotationId ? [a.assistedByAnnotationId] : [],
                sourceSegmentIds: [...(a.leafSegmentIds || []), ...(a.swingSegmentIds || [])],
                sourceOperationIds: a.sourceOperationIds || [],
                provenance: {
                  sourcePrimitiveIds: [...(a.leafSegmentIds || []), ...(a.swingSegmentIds || [])],
                  confidence: 1,
                  extractionType: 'pure-mupdf-door',
                  note: (a.positiveEvidence ?? []).join('|'),
                },
              };
            });
            doorAudit = {
              candidates: doorResult.rawCandidateCount,
              accepted: acceptedDoors.length,
              review: (doorResult.review ?? []).length,
              rejected: (doorResult.rejected ?? []).length,
              annotationAssisted: (doorResult.annotationAssisted ?? []).length,
              evidenceModeSummary: doorResult.evidenceModeSummary,
              candidateHash: doorResult.candidateHash,
              assemblyHash: doorResult.assemblyHash,
              annotationHash: doorResult.annotationHash,
              timings: doorResult.timings,
            };
            doorManifest = buildDoorProductionManifest(doorResult, pureResult.scaleMmPerPt, geometryHash);
          } catch (de) {
            console.warn('[MuPdfRoute Stream] door extraction warning:', de);
          }

          // STAGE 3 CHUNK: Stream Doors
          await sendChunk({
            type: 'stage-doors',
            acceptedDoors: [...doorSpecs, ...curved.doorSpecs],
            reviewDoors: doorAudit?.review ?? 0,
            doorAudit,
            doorManifest,
          });

          // STAGE 4: Guide rendering
          let guideDataUrl: string | undefined;
          try {
            const [px0, py0, px1, py1] = pureResult.pageBoundsMupdf;
            const [rx0, ry0, rx1, ry1] = pureResult.activeBuildingRegionMupdf;
            const pageWpt = px1 - px0;
            const pageHpt = py1 - py0;
            const zoom = Math.max(1600 / pageWpt, 1600 / pageHpt);
            const matrix = mupdf.Matrix.scale(zoom, zoom);
            const pix = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, false);
            const W = pix.getWidth();
            const H = pix.getHeight();
            const left = Math.max(0, Math.min(Math.round((rx0 - px0) * zoom), Math.round((rx1 - px0) * zoom)));
            const right = Math.min(W, Math.max(Math.round((rx0 - px0) * zoom), Math.round((rx1 - px0) * zoom)));
            const top = Math.max(0, Math.min(Math.round((ry0 - py0) * zoom), Math.round((ry1 - py0) * zoom)));
            const bottom = Math.min(H, Math.max(Math.round((ry0 - py0) * zoom), Math.round((ry1 - py0) * zoom)));
            const cw = right - left;
            const ch = bottom - top;

            if (cw > 10 && ch > 10) {
              const full = Buffer.from(pix.getPixels() as unknown as Uint8Array);
              const cropped = Buffer.alloc(cw * ch * 4);
              for (let y = 0; y < ch; y++) {
                const srcRow = (top + y) * pix.getStride() + left * 3;
                const dstRow = y * cw * 4;
                for (let x = 0; x < cw; x++) {
                  cropped[dstRow + x * 4] = full[srcRow + x * 3];
                  cropped[dstRow + x * 4 + 1] = full[srcRow + x * 3 + 1];
                  cropped[dstRow + x * 4 + 2] = full[srcRow + x * 3 + 2];
                  cropped[dstRow + x * 4 + 3] = 255;
                }
              }
              const { encodePng } = await import('@/harness/encode-png');
              const pngBuf = encodePng(cropped, cw, ch);
              guideDataUrl = `data:image/png;base64,${pngBuf.toString('base64')}`;
            }
          } catch (ge) {
            console.warn('[MuPdfRoute Stream] guide rendering warning:', ge);
          }

          // STAGE 4 CHUNK: Stream Guide
          if (guideDataUrl) {
            await sendChunk({
              type: 'stage-guide',
              guideDataUrl,
            });
          }

          // FINAL CHUNK: Stream complete
          await sendChunk({
            type: 'stage-complete',
            ok: true,
            timings: { totalMs: Date.now() - t0 },
          });

          await writer.close();
        } catch (streamErr) {
          console.error('[MuPdfRoute Stream] internal error:', streamErr);
          await sendChunk({ type: 'error', error: streamErr instanceof Error ? streamErr.message : String(streamErr) });
          await writer.close();
        }
      })();

      return new Response(readable, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
        },
      });
    }

    console.log('[MuPdfRoute] Opening PDF once + capturing vector geometry once...');
    const tPdf0 = Date.now();
    const doc = mupdf.Document.openDocument(bytes as any, 'application/pdf');
    const page = doc.loadPage(0);
    const captured = collectPageVectors(page, false, 0);
    const pageBoundsMupdf: [number, number, number, number] = (() => {
      const b = page.getBounds() as unknown as number[];
      return [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0];
    })();
    // Annotation capture in the SAME single PDF pass (no reopen). PDF open count = 1.
    const tAnn0 = Date.now();
    const annCapture = captureDoorAnnotations(page, DEFAULT_ANNOTATION_OPTIONS, undefined, 0);
    const annotationCaptureMs = Date.now() - tAnn0;
    const tCaptureMs = Date.now() - tPdf0;

    // Walls: frozen wall extractor opens the PDF itself (its internal capture is
    // out of scope / trusted). Windows below REUSE the vectors captured above so
    // the geometric window pipeline never re-opens or re-parses the PDF.
    const wallRaw = extractPureWallResult(bytes, 0, undefined, undefined, true) as any;
    const pureResult = wallRaw.pureResult;
    const lineageStore = wallRaw.lineageStore;
    const tWallMs = Date.now() - tPdf0;

    const geometryHash = acceptedGeometryHash(pureResult.accepted);
    const evidenceHash = acceptedEvidenceHash(pureResult.accepted);
    console.log(`[MuPdfRoute] Wall extraction done: ${pureResult.accepted.length} accepted; geometryHash=${geometryHash} evidenceHash=${evidenceHash}`);

    console.log('[MuPdfRoute] Adapting to neutral ExtractionResult...');
    const result = toExtractionResult(pureResult, { fileName });
    console.log(`[MuPdfRoute] Wall adaptation completed: ${result.walls?.length ?? 0} walls found.`);

    if (!result.walls || result.walls.length === 0) {
      return fail('no-building-region', 'No building region / walls detected in the document.', 422);
    }

    // --- Single-pass window extraction (reuses captured vectors) -------------
    let windowSpecs: import('@/features/window-pilot/install-pilot-windows').LiveWindowContract[] = [];
    let windowAudit: any = null;
    let winResult: MuPdfPureWindowResult | null = null;
    const tWin0 = Date.now();
    try {
      console.log('[MuPdfRoute] Running companion window extractor from captured vectors (single-pass)...');
      winResult = runWindowPipeline({
        vectors: captured.vectors,
        wallResult: pureResult,
        pageBoundsMupdf,
      }, PURE_WINDOW_DEFAULTS, false) as MuPdfPureWindowResult;
      const mPerPt = (pureResult.scaleMmPerPt ?? 13.12766664766308) / 1000;
      const accepted = winResult.accepted ?? [];
      windowSpecs = accepted.map((r) => {
        const from = r.wallLocalInterval?.from ?? 0;
        const to = r.wallLocalInterval?.to ?? 0;
        return {
          id: r.openingRegionId,
          wallId: r.selectedPhysicalWallId ?? '',
          intervalStartM: from * mPerPt,
          intervalEndM: to * mPerPt,
          widthM: (to - from) * mPerPt,
          sillM: 0.9,
          headM: 2.1,
          provenance: {
            sourcePrimitiveIds: r.sourceSegmentIds,
            confidence: r.score,
            extractionType: 'pure-mupdf-window',
            note: (r.positiveEvidence ?? []).join('|'),
          },
        };
      });
      windowAudit = {
        candidates: winResult.rawCandidateCount,
        accepted: accepted.length,
        review: (winResult.review ?? []).length,
        rejected: (winResult.rejected ?? []).length,
        hostSummary: winResult.hostSummary,
        candidateHash: winResult.candidateHash,
        timings: winResult.timings,
      };
      console.log(`[MuPdfRoute] Window extraction completed: ${windowSpecs.length} windows accepted (candidates=${winResult.rawCandidateCount}).`);
    } catch (we) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[MuPdfRoute] window extraction failed:', we);
      }
    }
    const tWinMs = Date.now() - tWin0;

    // --- Single-pass door extraction (reuses the SAME captured vectors) --------
    let doorSpecs: Array<{
      id: string;
      wallId: string;
      doorType: string;
      intervalStartM: number;
      intervalEndM: number;
      widthM: number;
      hingeSide: string;
      swingDirection: string;
      sourceSegmentIds: string[];
      sourceOperationIds: string[];
      provenance: { sourcePrimitiveIds: string[]; confidence: number; extractionType: string; note: string };
    }> = [];
    let doorAudit: any = null;
    let doorManifest: any = undefined;
    let doorResult: MuPdfPureDoorResult | null = null;
    const tDoor0 = Date.now();
    try {
      console.log('[MuPdfRoute] Running companion door extractor from captured vectors (single-pass)...');
      doorResult = runDoorPipeline({
        vectors: captured.vectors,
        wallResult: pureResult,
        pageBoundsMupdf,
        annotations: annCapture.annotations,
        annotationIndex: annCapture.index,
        annotationCaptureMs,
      }, PURE_DOOR_DEFAULTS, false) as MuPdfPureDoorResult;
      const mPerPt = (pureResult.scaleMmPerPt ?? 13.12766664766308) / 1000;
      const acceptedDoors = doorResult.accepted ?? [];
      doorSpecs = acceptedDoors.map((a) => {
        const from = a.wallLocalInterval?.from ?? 0;
        const to = a.wallLocalInterval?.to ?? 0;
        return {
          id: a.doorAssemblyId,
          wallId: a.selectedPhysicalWallId ?? '',
          doorType: a.doorType,
          intervalStartM: from * mPerPt,
          intervalEndM: to * mPerPt,
          widthM: (to - from) * mPerPt,
          hingeSide: a.hingeSide ?? 'left',
          swingDirection: a.swingDirection ?? 'inward',
          sourceSegmentIds: [...a.leafSegmentIds, ...a.swingSegmentIds],
          sourceOperationIds: a.sourceOperationIds,
          provenance: {
            sourcePrimitiveIds: [...a.leafSegmentIds, ...a.swingSegmentIds],
            confidence: 1,
            extractionType: 'pure-mupdf-door',
            note: (a.positiveEvidence ?? []).join('|'),
          },
        };
      });
      doorAudit = {
        candidates: doorResult.rawCandidateCount,
        accepted: acceptedDoors.length,
        review: (doorResult.review ?? []).length,
        rejected: (doorResult.rejected ?? []).length,
        annotationAssisted: (doorResult.annotationAssisted ?? []).length,
        evidenceModeSummary: doorResult.evidenceModeSummary,
        candidateHash: doorResult.candidateHash,
        assemblyHash: doorResult.assemblyHash,
        annotationHash: doorResult.annotationHash,
        timings: doorResult.timings,
      };
      // Deterministic production manifest: only the verified ACCEPT set (excludes
      // REVIEW/REJECT and ANNOTATION_ONLY / ANNOTATION_ASSISTED_REVIEW_REQUIRED).
      // DR-16 and other review records are surfaced separately (never installed).
      doorManifest = buildDoorProductionManifest(doorResult, pureResult.scaleMmPerPt, geometryHash);
      console.log(`[MuPdfRoute] Door manifest: ${doorManifest.acceptedCount} accepted / ${doorManifest.reviewCount} review (manifestHash=${doorManifest.manifestHash}).`);
      console.log(`[MuPdfRoute] Door extraction completed: ${doorSpecs.length} doors accepted (candidates=${doorResult.rawCandidateCount}, review=${(doorResult.review ?? []).length}).`);
    } catch (de) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[MuPdfRoute] door extraction failed:', de);
      }
    }
    const tDoorMs = Date.now() - tDoor0;

    // --- Single-pass column extraction (reuses the SAME captured vectors) -----
    // Columns are structural: they consume the already-captured vectors and the
    // claimed-source registry (wall/window/door/annotation ids). They NEVER open
    // or recapture the PDF. This honors Item 4: the route calls ONLY
    // extractColumnsFromCapturedGeometry (never extractColumnsFromPdf).
    let columnContracts: ReturnType<typeof extractColumnsFromCapturedGeometry> = [];
    let columnAudit: any = null;
    const tCol0 = Date.now();
    try {
      console.log('[MuPdfRoute] Running companion column extractor from captured vectors (single-pass)...');
      // Flatten captured vectors into the column contract's line/cubic shape.
      const lines: Array<{ id: string; a: { x: number; y: number }; b: { x: number; y: number }; sourceOperationId?: string }> = [];
      const cubics: Array<{ id: string; p0: { x: number; y: number }; p1: { x: number; y: number }; p2: { x: number; y: number }; p3: { x: number; y: number }; sourceOperationId?: string }> = [];
      for (const v of captured.vectors as any[]) {
        const op = (v as any).id;
        const subpaths = (v as any).subpaths as Array<Array<{ x: number; y: number }>>;
        for (let si = 0; si < (subpaths?.length ?? 0); si++) {
          const sp = subpaths[si];
          if (sp.length >= 2) lines.push({ id: `${op}:s${si}`, a: sp[0], b: sp[sp.length - 1], sourceOperationId: op });
        }
        let cur: { x: number; y: number } | undefined;
        let cidx = 0;
        for (const c of ((v as any).commands ?? []) as Array<any>) {
          if (c.op === 'M') cur = c.p0 ?? c.p1;
          else if (c.op === 'L') cur = c.p1;
          else if (c.op === 'C') {
            cubics.push({ id: `${op}:c${cidx}`, p0: cur ?? c.p0 ?? c.p1, p1: c.p1, p2: c.p2, p3: c.p3, sourceOperationId: op });
            cur = c.p3;
            cidx++;
          }
        }
        const pts = (v as any).points as Array<{ x: number; y: number }>;
        for (let i = 0; i + 1 < (pts?.length ?? 0); i++) {
          lines.push({ id: `${op}:L${i}`, a: pts[i], b: pts[i + 1], sourceOperationId: op });
          lines.push({ id: `${op}:seg:${i}`, a: pts[i], b: pts[i + 1], sourceOperationId: op });
        }
      }
      // Claimed-source registry: exclude every id already owned by walls/windows/doors.
      const claimedIds: string[] = [
        ...(pureResult.accepted ?? []).flatMap((w: any) => w.sourceSubpathIds ?? []),
        ...(winResult?.accepted ?? []).flatMap((w: any) => w.sourceSegmentIds ?? []),
        ...(doorResult?.accepted ?? []).flatMap((d: any) => [...(d.leafSegmentIds ?? []), ...(d.swingSegmentIds ?? [])]),
      ];
      columnContracts = extractColumnsFromCapturedGeometry({
        lines: lines as any,
        cubics: cubics as any,
        claimedSourceIds: claimedIds,
        scaleMmPerPt: pureResult.scaleMmPerPt,
        sourceHash: geometryHash,
        // solid-filled rectangles in the wall network are the primary column evidence
        vectors: captured.vectors as any,
        walls: (pureResult.accepted ?? []) as any,
      });
      columnAudit = {
        accepted: columnContracts.length,
        allRectangularAccept: columnContracts.every((c) => c.footprintType === 'RECTANGULAR' && c.verdict === 'ACCEPT'),
        passage: { columnPdfOpenCount: 0, columnVectorCaptureCount: 0 },
      };
      console.log(`[MuPdfRoute] Column extraction completed: ${columnContracts.length} proven rectangular columns (columnPdfOpenCount=0).`);
    } catch (ce) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[MuPdfRoute] column extraction failed:', ce);
      }
    }
    const tColMs = Date.now() - tCol0;

    // --- Wall-completion stage (MASTER CHECKPOINT §3-§14): recover missing wall
    // and partition boundaries from paired parallel source faces. Runs AFTER the
    // trusted 70-wall extractor, consumes the SAME captured vectors, never reopens
    // the PDF. Produces a finalized wall-topology result; completion walls become
    // Pascal WallNodes downstream (§16). Columns are NOT used to close rooms.
    let completionWalls: any[] = [];
    let finalizedWallCount = pureResult.accepted.length;
    let wallCompletionHash = '';
    let finalizedTopologyHash = '';
    const tWc0 = Date.now();
    try {
      const wcLines: RawSegment[] = [];
      for (const v of captured.vectors as any[]) {
        const op = (v as any).id;
        // Prefer explicit polyline points.
        const pts = (v as any).points as Array<{ x: number; y: number }> | undefined;
        if (pts && pts.length >= 2) {
          for (let i = 0; i + 1 < pts.length; i++) {
            wcLines.push({ id: `${op}:L${i}`, a: pts[i], b: pts[i + 1], sourceOperationId: op });
          }
          continue;
        }
        // Fallback: subpaths (each is an array of points).
        const subpaths = (v as any).subpaths as Array<Array<{ x: number; y: number }>> | undefined;
        if (subpaths) {
          for (let si = 0; si < subpaths.length; si++) {
            const sp = subpaths[si];
            for (let i = 0; i + 1 < sp.length; i++) {
              wcLines.push({ id: `${op}:s${si}:L${i}`, a: sp[i], b: sp[i + 1], sourceOperationId: op });
            }
          }
          continue;
        }
        // Fallback: commands (M/L/C) producing line segments.
        const cmds = (v as any).commands as Array<any> | undefined;
        if (cmds) {
          let cur: { x: number; y: number } | undefined;
          for (const c of cmds) {
            if (c.op === 'M') cur = c.p0 ?? c.p1;
            else if (c.op === 'L') { if (cur) wcLines.push({ id: `${op}:cL`, a: cur, b: c.p1, sourceOperationId: op }); cur = c.p1; }
            else if (c.op === 'C') { if (cur) wcLines.push({ id: `${op}:cL`, a: cur, b: c.p3, sourceOperationId: op }); cur = c.p3; }
          }
        }
      }
      const acceptedPhysicalWalls = pureResult.accepted.map((w: any) => {
        const a = w.centerline?.a ?? w.startM ?? w.a ?? { x: 0, y: 0 };
        const b = w.centerline?.b ?? w.endM ?? w.b ?? { x: 0, y: 0 };
        const thickness = typeof w.thickness === 'number'
          ? (w.thickness * pureResult.scaleMmPerPt) / 1000
          : (w.thicknessM ?? 0.2);
        return {
          physicalWallId: w.physicalWallId ?? w.id,
          startM: { x: a.x, y: a.y },
          endM: { x: b.x, y: b.y },
          thicknessM: thickness,
          sourceSegmentIds: w.sourceSubpathIds ?? [],
        };
      });
      const protectedOpenings: ProtectedOpening[] = [
        ...(winResult?.accepted ?? []).map((w: any) => ({
          openingId: w.windowAssemblyId ?? `win_${w.id}`,
          openingType: 'WINDOW' as const,
          selectedPhysicalWallId: w.selectedPhysicalWallId,
          worldStart: w.worldStartM ?? { x: 0, y: 0 },
          worldEnd: w.worldEndM ?? { x: 0, y: 0 },
          worldCentre: w.worldCentreM ?? { x: 0, y: 0 },
          widthM: w.widthM ?? 1,
          confidence: 'VERIFIED' as const,
          protectionStatus: 'VERIFIED_OPENING' as const,
        })),
        ...(doorResult?.accepted ?? []).map((d: any) => ({
          openingId: d.doorAssemblyId ?? `door_${d.id}`,
          openingType: 'DOOR' as const,
          selectedPhysicalWallId: d.selectedPhysicalWallId,
          worldStart: d.worldStartM ?? { x: 0, y: 0 },
          worldEnd: d.worldEndM ?? { x: 0, y: 0 },
          worldCentre: d.worldCentreM ?? { x: 0, y: 0 },
          widthM: d.widthM ?? 0.9,
          confidence: 'VERIFIED' as const,
          protectionStatus: 'VERIFIED_OPENING' as const,
        })),
      ];
      const wcClaimedIds: string[] = [
        ...(pureResult.accepted ?? []).flatMap((w: any) => w.sourceSubpathIds ?? []),
        ...(winResult?.accepted ?? []).flatMap((w: any) => w.sourceSegmentIds ?? []),
        ...(doorResult?.accepted ?? []).flatMap((d: any) => [...(d.leafSegmentIds ?? []), ...(d.swingSegmentIds ?? [])]),
      ];
      const frameIn = documentFrameFromPure(pureResult);
      const cf = createCoordinateFrame({
        pageBoundsPt: frameIn.pageBoundsPt,
        scaleMmPerPt: frameIn.scaleMmPerPt,
        pageWidthM: frameIn.widthM,
        pageHeightM: frameIn.heightM,
      });
      const scalePtToM = pureResult.scaleMmPerPt / 1000; // PDF points -> meters
      const wc = completeWalls({
        acceptedPhysicalWalls,
        capturedLines: wcLines,
        claimedSourceIds: wcClaimedIds,
        acceptedWindows: protectedOpenings.filter((o) => o.openingType === 'WINDOW'),
        acceptedDoors: protectedOpenings.filter((o) => o.openingType === 'DOOR'),
        scaleMmPerPt: pureResult.scaleMmPerPt,
        sourceHash: geometryHash,
        // Coordinates are in PDF points; thresholds are authored in meters, so
        // convert meters -> points by dividing by (mmPerPt/1000).
        config: {
          joinTolM: 0.35 / scalePtToM,
          maxAutoExtensionM: 2.0 / scalePtToM,
          scaleMmPerPt: pureResult.scaleMmPerPt,
        },
      });
      // Transform completion-wall centreline into the Pascal world frame so the
      // staged build installs them in the SAME coordinate space as the 70 trusted
      // walls (cf.toPascal); otherwise they land in raw PDF-point space.
      completionWalls = wc.completionWalls.map((c) => {
        const [ax, az] = cf.toPascal(c.centrelineStartProjectM.x, c.centrelineStartProjectM.y);
        const [bx, bz] = cf.toPascal(c.centrelineEndProjectM.x, c.centrelineEndProjectM.y);
        return {
          ...c,
          sourceHash: geometryHash,
          centrelineStartPascal: { x: ax, y: az },
          centrelineEndPascal: { x: bx, y: bz },
        };
      });
      finalizedWallCount = wc.finalized.finalizedWallCount;
      wallCompletionHash = wc.finalized.wallCompletionHash;
      finalizedTopologyHash = wc.finalized.finalizedTopologyHash;
      console.log(`[MuPdfRoute] Wall completion: ${completionWalls.length} completion walls (finalized=${finalizedWallCount}).`);
    } catch (wce) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[MuPdfRoute] wall completion failed:', wce);
      }
    }
    const tWcMs = Date.now() - tWc0;

    // Curved walls, glass partitions and pods; straight copies of them are dropped.
    const curved = curvedWallsFor(curvedLib, createCoordinateFrame, captured.vectors as any[], pureResult, geometryHash);
    const wallsResult = curved.dropWallIds.size
      ? { ...result, walls: result.walls.filter((w) => !curved.dropWallIds.has(w.id)) }
      : result;
    completionWalls = offGlass(pureResult, completionWalls.filter((c) => !curved.onCurve(c.centrelineStartProjectM, c.centrelineEndProjectM)));

    let guideDataUrl: string | undefined;
    try {
      const [px0, py0, px1, py1] = pureResult.pageBoundsMupdf;
      const [rx0, ry0, rx1, ry1] = pureResult.activeBuildingRegionMupdf;
      const pageWpt = px1 - px0;
      const pageHpt = py1 - py0;
      const zoom = Math.max(1600 / pageWpt, 1600 / pageHpt);
      const matrix = mupdf.Matrix.scale(zoom, zoom);
      const pix = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, false);
      const W = pix.getWidth();
      const H = pix.getHeight();
      const left = Math.max(0, Math.min(Math.round((rx0 - px0) * zoom), Math.round((rx1 - px0) * zoom)));
      const right = Math.min(W, Math.max(Math.round((rx0 - px0) * zoom), Math.round((rx1 - px0) * zoom)));
      const top = Math.max(0, Math.min(Math.round((ry0 - py0) * zoom), Math.round((ry1 - py0) * zoom)));
      const bottom = Math.min(H, Math.max(Math.round((ry0 - py0) * zoom), Math.round((ry1 - py0) * zoom)));
      const cw = right - left;
      const ch = bottom - top;

      if (cw > 10 && ch > 10) {
        const full = Buffer.from(pix.getPixels() as unknown as Uint8Array);
        const cropped = Buffer.alloc(cw * ch * 4);
        for (let y = 0; y < ch; y++) {
          const srcRow = (top + y) * pix.getStride() + left * 3;
          const dstRow = y * cw * 4;
          for (let x = 0; x < cw; x++) {
            cropped[dstRow + x * 4] = full[srcRow + x * 3];
            cropped[dstRow + x * 4 + 1] = full[srcRow + x * 3 + 1];
            cropped[dstRow + x * 4 + 2] = full[srcRow + x * 3 + 2];
            cropped[dstRow + x * 4 + 3] = 255;
          }
        }
        const { encodePng } = await import('@/harness/encode-png');
        const pngBuf = encodePng(cropped, cw, ch);
        guideDataUrl = `data:image/png;base64,${pngBuf.toString('base64')}`;
      }
    } catch (ge) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[MuPdfRoute] guide rendering skipped:', ge);
      }
    }

    console.log('[MuPdfRoute] Returning compact production response.');
    const payload = {
      ok: true,
      fileName,
      result: wallsResult,
      curvedWalls: curved.walls,
      curvedPods: curved.pods,
      guideDataUrl,
      windowSpecs,
      windowAudit,
      acceptedDoors: [...doorSpecs, ...curved.doorSpecs],
      reviewDoors: doorAudit?.review ?? 0,
      doorAudit,
      doorManifest: (typeof doorManifest !== 'undefined') ? doorManifest : undefined,
      columnContracts,
      columnAudit,
      completionWalls,
      finalizedWallCount,
      wallCompletionHash,
      finalizedTopologyHash,
      extractionMetrics: {
        acceptedWalls: pureResult.accepted.length,
        acceptedWindows: windowSpecs.length,
        acceptedDoors: doorSpecs.length,
        geometryHash,
        evidenceHash,
        passage: {
          pdfOpenCount: 1,
          vectorCaptureCount: 1,
          textSearchCount: 1,
          annotationIndexBuildCount: 1,
          fullPageOcrCount: 0,
          columnPdfOpenCount: 0,
          columnVectorCaptureCount: 0,
        },
        annotation: {
          storageMode: annCapture.storageClassified,
          recoveredDtAnchors: annCapture.annotations.length,
          byKind: annCapture.byKind,
          annotationCaptureMs,
        },
      },
      coordinateFrame: {
        scaleMmPerPt: pureResult.scaleMmPerPt,
        pageBoundsMupdf: pureResult.pageBoundsMupdf,
      },
      sourceHash: geometryHash,
      timings: {
        pdfOpenMs: tWallMs,
        wallExtractionMs: tWallMs,
        windowExtractionMs: tWinMs,
        doorExtractionMs: tDoorMs,
        annotationCaptureMs,
        totalPipelineMs: Date.now() - t0,
      },
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // MuPDF throws on encrypted / corrupt PDFs.
    if (/encrypt|password|decrypt/i.test(msg)) {
      return fail('encrypted-pdf', 'PDF is encrypted and cannot be read.', 422, msg);
    }
    if (/page|out of range|index/i.test(msg)) {
      return fail('page-out-of-range', 'Requested page is out of range.', 422, msg);
    }
    return fail('extraction-failure', 'Pure MuPDF extraction failed.', 500, msg);
  }
}

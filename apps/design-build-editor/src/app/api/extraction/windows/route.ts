// apps/design-build-editor/app/api/extraction/windows/route.ts
// Change Set 2 (Gate C, live): dedicated, NON-BLOCKING server-side route for the
// REAL geometric window detector. Kept separate from /api/extraction/mupdf so the
// wall extraction returns fast and the (heavier) window detection never hangs the
// initial Extract. The client fetches this AFTER walls commit; mupdf stays a
// genuine server dependency (never bundled into the browser).

import { NextRequest, NextResponse } from 'next/server';
import { extractLiveWindows } from '@/harness/extract-live-windows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest) {
  let bytes: Uint8Array;
  try {
    const ct = req.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const json = await req.json();
      if (json?.pdfBase64) bytes = Uint8Array.from(Buffer.from(json.pdfBase64, 'base64'));
      else if (Array.isArray(json?.bytes)) bytes = Uint8Array.from(json.bytes);
      else return NextResponse.json({ error: 'JSON body must carry pdfBase64 or bytes.' }, { status: 400 });
    } else {
      bytes = new Uint8Array(Buffer.from(await req.arrayBuffer()));
    }
  } catch (e) {
    return NextResponse.json({ error: 'Could not read request body.' }, { status: 400 });
  }
  if (!bytes || bytes.length === 0) return NextResponse.json({ error: 'Empty document.' }, { status: 400 });
  if (bytes.length > MAX_BYTES) return NextResponse.json({ error: 'PDF exceeds size limit.' }, { status: 413 });
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return NextResponse.json({ error: 'Not a valid PDF.' }, { status: 400 });
  }

  try {
    // The window detector needs the live wall centerlines (page space). We obtain
    // them from the SAME live mupdf extraction so walls + windows share one space
    // and host resolution matches the rendered walls exactly.
    // Optimization: run the pure wall tracer ONCE with captureLineage = true, and
    // convert to the neutral result via toExtractionResult.
    const { extractPureWallResult, toExtractionResult } = await import('design-build-extraction-mupdf');
    const rawResult = extractPureWallResult(bytes, 0, undefined, undefined, true) as any;
    const pureResult = rawResult.pureResult;
    const lineageStore = rawResult.lineageStore;

    const result = toExtractionResult(pureResult, { fileName: 'page-0' });
    const extraction = extractLiveWindows(lineageStore, result);
    return NextResponse.json(
      { ok: true, windowSpecs: extraction.specs, windowAudit: extraction.audit },
      { status: 200 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'Window extraction failed.', detail: msg, windowSpecs: [], windowAudit: { error: msg } }, { status: 200 });
  }
}

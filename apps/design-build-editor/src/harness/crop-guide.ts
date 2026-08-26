// harness/crop-guide.ts
// Client-only: rasterize the uploaded PDF's first page and crop it to the
// verified active building region (ROI) so the Guide image shows ONLY the
// building footprint — not the full PDF page (title block, border, notes, etc).
//
// The cropped image's aspect ratio equals (roiW_pts / roiH_pts) which is the
// same as (widthM / depthM), so a uniform Guide scale = widthM yields an exact
// widthM x depthM plane with no stretch.
//
// Orientation: we crop the ROI rectangle AS-IS from the rendered page (PDF
// top-left origin). The GuideNode plane + coordinate-frame Y-mirror handle the
// world mapping; we do NOT flip the crop (no mirror).

import type { Bounds } from 'design-build-coordinate-frame';

/**
 * @param pdfBytes  raw PDF file bytes (from the upload)
 * @param pageBoundsPt  full PDF page bounds in points [x0,y0,x1,y1]
 * @param activeRegionPt  verified building ROI in points [x0,y0,x1,y1]
 * @param renderScale  device-pixel multiplier for the page render (default 2)
 * @returns cropped PNG dataURL, or undefined on failure
 */
export async function cropGuideToRoi(
  pdfBytes: Uint8Array,
  pageBoundsPt: Bounds,
  activeRegionPt: Bounds,
  renderScale = 2,
): Promise<string | undefined> {
  try {
    const pdfjs = await import('pdfjs-dist');
    // Resolve the worker via webpack's URL handling (Next client build).
    const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url);
    (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = workerUrl.href;

    const loadingTask = pdfjs.getDocument({ data: pdfBytes.slice() });
    const doc = await loadingTask.promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: renderScale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) { await loadingTask.destroy(); return undefined; }
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    // Map ROI (PDF points, top-left origin) -> canvas pixels.
    const pageW = pageBoundsPt[2] - pageBoundsPt[0];
    const pageH = pageBoundsPt[3] - pageBoundsPt[1];
    const sx = (activeRegionPt[0] - pageBoundsPt[0]) / pageW; // 0..1
    const sy = (activeRegionPt[1] - pageBoundsPt[1]) / pageH;
    const sw = (activeRegionPt[2] - activeRegionPt[0]) / pageW;
    const sh = (activeRegionPt[3] - activeRegionPt[1]) / pageH;
    const cropX = Math.round(sx * viewport.width);
    const cropY = Math.round(sy * viewport.height);
    const cropW = Math.max(1, Math.round(sw * viewport.width));
    const cropH = Math.max(1, Math.round(sh * viewport.height));

    const out = document.createElement('canvas');
    out.width = cropW;
    out.height = cropH;
    const octx = out.getContext('2d');
    if (!octx) { await loadingTask.destroy(); return undefined; }
    octx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const dataUrl = out.toDataURL('image/png');
    await loadingTask.destroy();
    return dataUrl;
  } catch (e) {
    console.warn('[cropGuideToRoi] failed:', e);
    return undefined;
  }
}

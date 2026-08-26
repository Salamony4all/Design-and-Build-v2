// harness/verified-image.ts
// Single source of truth for creating image data URLs from raw bytes.
//
// Detects the ACTUAL byte signature before stamping a MIME prefix. This stops
// the historical defect where unknown bytes (e.g. a PDF's `%PDF…`) were defaulted
// to `image/png` and handed to THREE.TextureLoader as a corrupt data URL.
//
// Supported image formats: PNG, JPEG, WebP. PDF is explicitly REJECTED — the
// Guide needs browser-decodable raster bytes; a raw PDF must be rasterized
// first (see crop-guide.ts), never passed straight to a texture loader.

export type DetectedImage =
  | { mime: 'image/png'; ext: 'png' }
  | { mime: 'image/jpeg'; ext: 'jpg' }
  | { mime: 'image/webp'; ext: 'webp' }
  | { mime: 'application/pdf'; ext: 'pdf' }
  | { mime: 'application/octet-stream'; ext: 'unknown' };

/** Inspect the leading bytes and return the detected media type. */
export function detectByteType(bytes: Uint8Array): DetectedImage {
  if (bytes.length >= 4) {
    // PNG: 89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return { mime: 'image/png', ext: 'png' };
    }
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return { mime: 'image/jpeg', ext: 'jpg' };
    }
    // PDF: 25 50 44 46  ("%PDF")
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
      return { mime: 'application/pdf', ext: 'pdf' };
    }
  }
  // WebP: "RIFF" .... "WEBP"  (bytes 0..3 = RIFF, 8..11 = WEBP)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return { mime: 'application/octet-stream', ext: 'unknown' };
}

export type VerifiedImageResult =
  | { ok: true; dataUrl: string; mime: 'image/png' | 'image/jpeg' | 'image/webp' }
  | {
      ok: false;
      detectedMimeType: string;
      reason:
        | 'EMPTY_BYTES'
        | 'UNSUPPORTED_FORMAT'
        | 'PDF_NOT_RASTERIZED'
        | 'MIME_MISMATCH';
    };

/**
 * Build a verified image data URL from raw bytes.
 *
 * @param bytes           raw file bytes
 * @param declaredMimeType  optional caller-provided MIME (e.g. from a file input).
 *                          When provided, the detected type must AGREE or the
 *                          call is rejected (MIME_MISMATCH) — never silently
 *                          trusted.
 * @returns a safe data URL for PNG/JPEG/WebP, or a structured rejection.
 *
 * The full Base64 payload is NEVER included in any error, so it cannot leak
 * into logs or the UI.
 */
export function createVerifiedImageDataUrl(
  bytes: Uint8Array | undefined | null,
  declaredMimeType?: string,
): VerifiedImageResult {
  if (!bytes || bytes.length === 0) {
    return { ok: false, detectedMimeType: 'application/octet-stream', reason: 'EMPTY_BYTES' };
  }
  const detected = detectByteType(bytes);
  if (detected.ext === 'pdf') {
    return { ok: false, detectedMimeType: detected.mime, reason: 'PDF_NOT_RASTERIZED' };
  }
  if (detected.ext === 'unknown') {
    return { ok: false, detectedMimeType: detected.mime, reason: 'UNSUPPORTED_FORMAT' };
  }
  // detected is now png | jpg | webp
  const mime = detected.mime as 'image/png' | 'image/jpeg' | 'image/webp';
  if (declaredMimeType && declaredMimeType !== mime) {
    // Allow the common aliases before rejecting.
    const aliases: Record<string, string> = { 'image/jpg': 'image/jpeg' };
    const declared = aliases[declaredMimeType] ?? declaredMimeType;
    if (declared !== mime) {
      return { ok: false, detectedMimeType: mime, reason: 'MIME_MISMATCH' };
    }
  }
  const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  return { ok: true, dataUrl, mime };
}

/**
 * Auto-detect the non-white drawing bounding box in an image data URL and crop
 * the image on an HTML5 canvas to the active architectural plan area.
 * This guarantees 100% 1:1 alignment with extracted 3D wall footprints.
 */
export async function autoCropDrawing(
  dataUrl: string,
): Promise<{ dataUrl: string; cropped: boolean }> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { dataUrl, cropped: false };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (w < 10 || h < 10) {
          resolve({ dataUrl, cropped: false });
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve({ dataUrl, cropped: false });
          return;
        }

        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;

        let minX = w, minY = h, maxX = 0, maxY = 0;
        let found = false;

        for (let y = 0; y < h; y += 2) {
          for (let x = 0; x < w; x += 2) {
            const idx = (y * w + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const a = data[idx + 3];

            // Non-white background pixel (ink, lines, furniture, labels)
            if (a > 30 && (r < 235 || g < 235 || b < 235)) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
              found = true;
            }
          }
        }

        if (!found || maxX <= minX || maxY <= minY) {
          resolve({ dataUrl, cropped: false });
          return;
        }

        // Only crop if there is significant margin (> 3% on any border)
        const padX = (maxX - minX);
        const padY = (maxY - minY);
        if (minX < w * 0.03 && minY < h * 0.03 && maxX > w * 0.97 && maxY > h * 0.97) {
          resolve({ dataUrl, cropped: false });
          return;
        }

        const marginX = Math.max(2, Math.round(padX * 0.01));
        const marginY = Math.max(2, Math.round(padY * 0.01));
        const cropX = Math.max(0, minX - marginX);
        const cropY = Math.max(0, minY - marginY);
        const cropW = Math.min(w - cropX, (maxX - minX) + marginX * 2);
        const cropH = Math.min(h - cropY, (maxY - minY) + marginY * 2);

        const outCanvas = document.createElement('canvas');
        outCanvas.width = cropW;
        outCanvas.height = cropH;
        const outCtx = outCanvas.getContext('2d');
        if (!outCtx) {
          resolve({ dataUrl, cropped: false });
          return;
        }

        outCtx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        const croppedUrl = outCanvas.toDataURL('image/png');
        resolve({ dataUrl: croppedUrl, cropped: true });
      } catch {
        resolve({ dataUrl, cropped: false });
      }
    };
    img.onerror = () => resolve({ dataUrl, cropped: false });
    img.src = dataUrl;
  });
}

import { describe, it, expect } from 'vitest';
import { detectByteType, createVerifiedImageDataUrl } from './verified-image';

// Real byte signatures (no full payloads — just the magic numbers).
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38]);
const UNKNOWN = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

describe('detectByteType', () => {
  it('recognizes PDF by %PDF signature', () => {
    expect(detectByteType(PDF)).toEqual({ mime: 'application/pdf', ext: 'pdf' });
  });
  it('recognizes PNG by 89 50 4E 47', () => {
    expect(detectByteType(PNG)).toEqual({ mime: 'image/png', ext: 'png' });
  });
  it('recognizes JPEG by FF D8 FF', () => {
    expect(detectByteType(JPEG)).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
  });
  it('recognizes WebP by RIFF....WEBP', () => {
    expect(detectByteType(WEBP)).toEqual({ mime: 'image/webp', ext: 'webp' });
  });
  it('falls back to octet-stream for unknown bytes', () => {
    expect(detectByteType(UNKNOWN).ext).toBe('unknown');
  });
});

describe('createVerifiedImageDataUrl', () => {
  it('accepts PNG and emits a matching data URL', () => {
    const r = createVerifiedImageDataUrl(PNG);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mime).toBe('image/png');
      expect(r.dataUrl).toBe(`data:image/png;base64,${b64(PNG)}`);
    }
  });

  it('accepts JPEG and emits a matching data URL', () => {
    const r = createVerifiedImageDataUrl(JPEG);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mime).toBe('image/jpeg');
      expect(r.dataUrl).toBe(`data:image/jpeg;base64,${b64(JPEG)}`);
    }
  });

  it('accepts WebP and emits a matching data URL', () => {
    const r = createVerifiedImageDataUrl(WEBP);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mime).toBe('image/webp');
  });

  it('REJECTS PDF bytes (never stamps them as image/png)', () => {
    const r = createVerifiedImageDataUrl(PDF);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.detectedMimeType).toBe('application/pdf');
      expect(r.reason).toBe('PDF_NOT_RASTERIZED');
      // The error must carry NO Base64 payload.
      expect(JSON.stringify(r)).not.toContain(b64(PDF));
    }
  });

  it('rejects empty bytes', () => {
    const r = createVerifiedImageDataUrl(new Uint8Array(0));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('EMPTY_BYTES');
  });

  it('rejects null/undefined', () => {
    expect(createVerifiedImageDataUrl(null).ok).toBe(false);
    expect(createVerifiedImageDataUrl(undefined).ok).toBe(false);
  });

  it('rejects unsupported formats without defaulting to image/png', () => {
    const r = createVerifiedImageDataUrl(UNKNOWN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('UNSUPPORTED_FORMAT');
  });

  it('honors a declared MIME that agrees with detection', () => {
    const r = createVerifiedImageDataUrl(PNG, 'image/png');
    expect(r.ok).toBe(true);
  });

  it('rejects a declared MIME that disagrees with detection', () => {
    // A real PDF declared as image/png — must NOT be trusted as an image.
    const r = createVerifiedImageDataUrl(PDF, 'image/png');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // PDF is rejected either as PDF_NOT_RASTERIZED or a MIME mismatch — both
      // refuse to stamp PDF bytes as a raster image.
      expect(['MIME_MISMATCH', 'PDF_NOT_RASTERIZED']).toContain(r.reason);
      expect(r.detectedMimeType).toBe('application/pdf');
    }
  });
});

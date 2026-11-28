import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { collectPageVectors, mupdf } from '../src/index';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PDF = join(ROOT, '..', '..', '..', 'test drawings and png', 'CODE_06 1 page.pdf');

describe('collectPageVectors', () => {
  // mupdf.js keeps a JS device's callbacks, and every vector they collected, in a table
  // until the device is dropped. Its finalizers do not run while a request is being worked
  // through, so a reader of several pages held them all: the page picker needed over 3 GB
  // for a ten-page set and was killed on the hosted app.
  it('releases its device once the page is read', () => {
    const doc = mupdf.Document.openDocument(new Uint8Array(readFileSync(PDF)) as never, 'application/pdf');
    const page = doc.loadPage(0);
    const destroy = vi.spyOn(mupdf.Device.prototype, 'destroy');
    try {
      const first = collectPageVectors(page, false, 0);
      expect(first.vectors.length).toBeGreaterThan(1000);
      expect(destroy).toHaveBeenCalledTimes(1);
      // A released device does not disturb the next reading of the same page.
      const again = collectPageVectors(page, true, 0);
      expect(again.vectors.length).toBe(first.vectors.length);
      expect(destroy).toHaveBeenCalledTimes(2);
    } finally {
      destroy.mockRestore();
      page.destroy();
      doc.destroy();
    }
  });
});

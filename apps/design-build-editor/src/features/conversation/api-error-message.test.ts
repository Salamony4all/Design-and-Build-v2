import { describe, expect, it } from 'vitest';
import { apiErrorMessage, UPLOAD_TOO_LARGE } from './api-error-message';

describe('apiErrorMessage', () => {
  it('passes on what our own routes say', () => {
    expect(apiErrorMessage(400, { error: 'File is not a valid PDF (missing %PDF header).', code: 'invalid-pdf' }, 'Extraction')).toBe('File is not a valid PDF (missing %PDF header).');
    expect(apiErrorMessage(413, { error: 'PDF exceeds 52428800 bytes.' }, 'Extraction')).toBe('PDF exceeds 52428800 bytes.');
  });

  it('explains the upload limit when the platform turns a large file away', () => {
    // what the hosting platform answers for a body over its limit
    expect(apiErrorMessage(413, { error: { code: '413', message: 'Request Entity Too Large' } }, 'Extraction')).toBe(UPLOAD_TOO_LARGE);
    expect(apiErrorMessage(413, {}, 'Extraction')).toBe(UPLOAD_TOO_LARGE);
  });

  it('is always text, whatever the body holds', () => {
    expect(apiErrorMessage(504, { error: { code: '504', message: 'Gateway Timeout' } }, 'Extraction')).toBe('Extraction failed: Gateway Timeout (504).');
    expect(apiErrorMessage(500, { message: 'boom' }, 'AI extraction')).toBe('AI extraction failed: boom (500).');
    for (const body of [null, undefined, 'text', 42, [], { error: 7 }, { error: '' }, { error: { code: 1 } }]) {
      expect(typeof apiErrorMessage(500, body, 'Extraction')).toBe('string');
      expect(apiErrorMessage(500, body, 'Extraction')).toBe('Extraction failed (500).');
    }
  });
});

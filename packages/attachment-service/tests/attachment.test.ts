// packages/attachment-service/tests/attachment.test.ts
import { describe, it, expect } from 'vitest';
import {
  createEmptyRepository,
  addAttachment,
  setEnabled,
  removeAttachment,
  reorder,
  getActiveAttachments,
  kindFromMime,
} from '../src/index';

describe('attachment repository (§12)', () => {
  it('adds multiple, disables one, preserves order', () => {
    let s = createEmptyRepository();
    s = addAttachment(s, { id: 'a', name: 'a.pdf', mimeType: 'application/pdf', kind: 'pdf', enabled: true });
    s = addAttachment(s, { id: 'b', name: 'b.png', mimeType: 'image/png', kind: 'png', enabled: true });
    s = addAttachment(s, { id: 'c', name: 'c.jpg', mimeType: 'image/jpeg', kind: 'jpeg', enabled: true });
    expect(s.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    s = setEnabled(s, 'b', false);
    expect(getActiveAttachments(s).map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('reorders and keeps indices consistent', () => {
    let s = createEmptyRepository();
    s = addAttachment(s, { id: 'a', name: 'a', mimeType: 'application/pdf', kind: 'pdf', enabled: true });
    s = addAttachment(s, { id: 'b', name: 'b', mimeType: 'image/png', kind: 'png', enabled: true });
    s = addAttachment(s, { id: 'c', name: 'c', mimeType: 'image/jpeg', kind: 'jpeg', enabled: true });
    s = reorder(s, 'c', 0);
    expect(s.items.map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(s.items.map((i) => i.order)).toEqual([0, 1, 2]);
  });

  it('removes and reindexes', () => {
    let s = createEmptyRepository();
    ['a', 'b', 'c'].forEach((id) =>
      (s = addAttachment(s, { id, name: id, mimeType: 'image/png', kind: 'png', enabled: true })),
    );
    s = removeAttachment(s, 'b');
    expect(s.items.map((i) => i.order)).toEqual([0, 1]);
    expect(s.items.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('classifies mime types', () => {
    expect(kindFromMime('application/pdf')).toBe('pdf');
    expect(kindFromMime('image/png')).toBe('png');
    expect(kindFromMime('image/jpeg')).toBe('jpeg');
    expect(kindFromMime('text/plain')).toBe('other');
  });
});

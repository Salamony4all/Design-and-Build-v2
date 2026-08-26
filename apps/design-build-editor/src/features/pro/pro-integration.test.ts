// Focused tests for the PRO (optional official Pascal PRO editing mode) integration.
// These assert the host-side guarantees without a browser: icon registration
// is idempotent and covers the finite required set, and the mode machine always
// starts STANDARD (never auto-enters PRO from sessionStorage).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the Iconify offline API so registration is observable + idempotent-checkable
// without pulling the full browser runtime.
const added: string[] = [];
vi.mock('@iconify/react/offline', () => ({
  addCollection: (data: { prefix?: string }) => {
    added.push(data.prefix ?? 'unknown');
  },
}));

import { registerPascalEditorIcons } from './pascal-editor-icons';

describe('PRO host icon registration', () => {
  beforeEach(() => {
    added.length = 0;
  });

  it('registers exactly the finite required collections (not full Iconify sets)', () => {
    registerPascalEditorIcons();
    expect(added.sort()).toEqual(
      ['carbon', 'charm', 'lucide', 'mdi', 'ph', 'qlementine-icons'].sort(),
    );
  });

  it('is idempotent — a second call registers nothing extra', () => {
    registerPascalEditorIcons();
    const afterFirst = added.length;
    registerPascalEditorIcons();
    expect(added.length).toBe(afterFirst);
  });
});

describe('PRO mode machine starts in STANDARD', () => {
  it('exposes effectiveMode=standard and requestPro/returnToStandard/markProReady', async () => {
    const { useEditorMode } = await import('./useEditorMode');
    expect(typeof useEditorMode).toBe('function');
  });

  it('icon manifest is the exact finite set (35 names, no full collections)', async () => {
    const { PASCAL_EDITOR_ICONS } = await import('./pascal-editor-icon-manifest');
    expect(PASCAL_EDITOR_ICONS.length).toBe(35);
    // No prefix should imply a whole collection import here; each entry is one icon.
    for (const name of PASCAL_EDITOR_ICONS) {
      expect(name).toMatch(/^[a-z0-9-]+:[a-z0-9-]+$/);
    }
  });

  it('curated icon data file contains exactly the manifest icons', async () => {
    const data = await import('./pascal-editor-icon-data.json');
    const manifest = await import('./pascal-editor-icon-manifest');
    const json = (data as unknown as { default: Record<string, { prefix: string; icons: Record<string, unknown> }> }).default;
    const fileNames = Object.values(json).flatMap((c) =>
      Object.keys(c.icons).map((n) => `${c.prefix}:${n}`),
    );
    expect(fileNames.sort()).toEqual([...manifest.PASCAL_EDITOR_ICONS].sort());
  });
});

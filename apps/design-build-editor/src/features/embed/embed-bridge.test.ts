import { describe, expect, it } from 'vitest';
import { countSceneNodes, embedOriginAllowed, parseParentMessage } from './embed-bridge';

const msg = (type: string, extra: Record<string, unknown> = {}) => ({ source: 'boqflow', v: 1, type, ...extra });
const pdf = (bytes = 10, type = 'application/pdf') => new Blob([new Uint8Array(bytes)], { type });

describe('embed origins', () => {
  it('accepts BOQ Flow production, its previews and local dev', () => {
    expect(embedOriginAllowed('https://boqv-2.vercel.app', '')).toBe(true);
    expect(embedOriginAllowed('https://boqv-2-abc123-team.vercel.app', '')).toBe(true);
    expect(embedOriginAllowed('http://localhost:5173', '')).toBe(true);
  });
  it('rejects other sites, look-alikes and opaque origins', () => {
    expect(embedOriginAllowed('https://evil.example', '')).toBe(false);
    expect(embedOriginAllowed('https://boqv-2.vercel.app.evil.example', '')).toBe(false);
    expect(embedOriginAllowed('https://xboqv-2.vercel.app', '')).toBe(false);
    expect(embedOriginAllowed('null', '')).toBe(false);
    expect(embedOriginAllowed('', '')).toBe(false);
  });
  it('takes extra origins from configuration', () => {
    expect(embedOriginAllowed('https://boq.example.com', 'https://boq.example.com, https://x.test')).toBe(true);
  });
});

describe('parent messages', () => {
  it('accepts a PDF plan', () => {
    const m = parseParentMessage(msg('plan', { file: pdf(), name: 'FBO lounge.pdf' }));
    expect(m?.type).toBe('plan');
    expect(m && m.type === 'plan' && m.name).toBe('FBO lounge.pdf');
  });
  it('rejects plans that are not PDFs, empty, or not files', () => {
    expect(parseParentMessage(msg('plan', { file: pdf(10, 'image/png'), name: 'plan.png' }))).toBeNull();
    expect(parseParentMessage(msg('plan', { file: pdf(0), name: 'plan.pdf' }))).toBeNull();
    expect(parseParentMessage(msg('plan', { file: 'not a file', name: 'plan.pdf' }))).toBeNull();
  });
  it('ignores messages from other senders or versions', () => {
    expect(parseParentMessage({ source: 'other', v: 1, type: 'ping' })).toBeNull();
    expect(parseParentMessage({ source: 'boqflow', v: 2, type: 'ping' })).toBeNull();
    expect(parseParentMessage(null)).toBeNull();
    expect(parseParentMessage(msg('unknown'))).toBeNull();
  });
  it('cleans product lines: quantity, sizes, and only image links or inline images', () => {
    const m = parseParentMessage(msg('products', {
      items: [
        { id: 'r1', description: 'Curved sofa', qty: '5', imageUrl: 'https://cdn.example/sofa.jpg', dims: { w: 3.2, d: 1.2, h: 0.85 } },
        { description: 'Chair', qty: -3, imageUrl: 'javascript:alert(1)', dims: { w: 900 } },
        { qty: 2 },
      ],
    }));
    expect(m?.type).toBe('products');
    if (m?.type !== 'products') return;
    expect(m.items).toHaveLength(2);
    expect(m.items[0]).toMatchObject({ id: 'r1', qty: 5, imageUrl: 'https://cdn.example/sofa.jpg', dims: { w: 3.2, d: 1.2, h: 0.85 } });
    expect(m.items[1]).toMatchObject({ id: 'item_2', qty: 1, imageUrl: undefined, dims: { w: undefined } });
  });
});

describe('scene counts', () => {
  it('counts walls, glass and curved walls, openings and furniture', () => {
    const c = countSceneNodes({
      a: { type: 'wall' },
      b: { type: 'wall', material: { preset: 'glass' } },
      c: { type: 'wall', curveOffset: 0.4 },
      d: { type: 'window' },
      e: { type: 'door' },
      f: { type: 'item' },
      g: { type: 'slab' },
    });
    expect(c).toEqual({ walls: 3, glassWalls: 1, curvedWalls: 1, windows: 1, doors: 1, items: 1 });
  });
});

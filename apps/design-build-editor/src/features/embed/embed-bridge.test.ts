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
  it('reads a drawn-type focus, and refuses odd type ids', () => {
    expect(parseParentMessage(msg('focus-type', { typeId: 'ft_15' }))).toEqual({ type: 'focus-type', typeId: 'ft_15' });
    expect(parseParentMessage(msg('focus-type', { typeId: null }))).toEqual({ type: 'focus-type', typeId: null });
    expect(parseParentMessage(msg('focus-type', { typeId: 'a b' }))).toBeNull();
    expect(parseParentMessage(msg('focus-type', {}))).toBeNull();
  });
  it('keeps the drawn type a custom item is set on, and nothing odd', () => {
    const m = parseParentMessage(msg('products', {
      items: [
        { id: 'c1', description: 'Custom curved sofa', qty: 5, typeId: 'ft_15' },
        { id: 'c2', description: 'Custom table', qty: 1, typeId: 'ft 15; drop' },
      ],
    }));
    if (m?.type !== 'products') throw new Error('expected products');
    expect(m.items.map((p) => p.typeId)).toEqual(['ft_15', undefined]);
  });
  it('accepts a render request and product focus (or none), and nothing else', () => {
    expect(parseParentMessage(msg('render'))).toEqual({ type: 'render' });
    expect(parseParentMessage(msg('focus-product', { productId: 't0r3' }))).toEqual({ type: 'focus-product', productId: 't0r3' });
    expect(parseParentMessage(msg('focus-product', { productId: null }))).toEqual({ type: 'focus-product', productId: null });
    expect(parseParentMessage(msg('focus-product', { productId: 42 }))).toBeNull();
    expect(parseParentMessage(msg('focus-product', { productId: 'x'.repeat(101) }))).toBeNull();
    expect(parseParentMessage(msg('focus-product'))).toBeNull();
  });
  it('keeps whole inline thumbnails and drops broken or oversized ones', () => {
    const thumb = `data:image/jpeg;base64,${'A'.repeat(5000)}`;
    const m = parseParentMessage(msg('products', {
      items: [
        { id: 'a', description: 'Chair', qty: 1, imageUrl: thumb },
        { id: 'b', description: 'Chair', qty: 1, imageUrl: 'data:image/jpeg;base64,AAA<script>' },
        { id: 'c', description: 'Chair', qty: 1, imageUrl: `data:image/png;base64,${'A'.repeat(700_000)}` },
        { id: 'd', description: 'Chair', qty: 1, imageUrl: 'data:image/svg+xml;base64,AAAA' },
      ],
    }));
    if (m?.type !== 'products') throw new Error('expected products');
    expect(m.items.map((p) => p.imageUrl?.length ?? 0)).toEqual([thumb.length, 0, 0, 0]);
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

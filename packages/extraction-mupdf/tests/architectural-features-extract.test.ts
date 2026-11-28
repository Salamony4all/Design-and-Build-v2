import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  collectPageVectors,
  detectFurniture,
  extractPureWallResult,
  furnitureTextsFromStructuredText,
  mupdf,
  type MuVector,
  type Vec2,
} from '../src/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const SCALE = (100 * 25.4) / 72;
const pt = (m: number) => m / (SCALE / 1000);
const O = { x: 100, y: 100 };

let nextId = 0;
function vec(commands: MuVector['commands'], layer?: string, extra: Partial<MuVector> = {}): MuVector {
  const pts: Vec2[] = [];
  for (const c of commands as Array<Record<string, any>>) {
    if (c.op === 'M' || c.op === 'L') pts.push({ x: c.x, y: c.y });
    if (c.op === 'C') pts.push(c.p1, c.p2, c.p3);
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    id: `af${nextId++}`,
    operation: 'stroke-path',
    commands,
    points: pts,
    subpaths: [pts],
    bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    color: [0, 0, 0],
    strokeWidthPt: 0.25,
    ...(layer !== undefined ? { layer } : {}),
    ...extra,
  };
}

function oval(cx: number, cy: number, rx: number, ry: number, layer?: string, n = 28): MuVector {
  const cmds: MuVector['commands'] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const p = { x: O.x + pt(cx + rx * Math.cos(a)), y: O.y + pt(cy + ry * Math.sin(a)) };
    cmds.push(i === 0 ? { op: 'M', ...p } : { op: 'L', ...p });
  }
  cmds.push({ op: 'Z' });
  return vec(cmds, layer);
}

function curvedCounter(cx: number, cy: number, rIn: number, rOut: number, a0: number, a1: number, layer = 'A-FURN'): MuVector {
  const steps = 10;
  const cmds: MuVector['commands'] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const p = { x: O.x + pt(cx + rOut * Math.cos(a)), y: O.y + pt(cy + rOut * Math.sin(a)) };
    cmds.push(i === 0 ? { op: 'M', ...p } : { op: 'L', ...p });
  }
  for (let i = steps; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / steps;
    cmds.push({ op: 'L', x: O.x + pt(cx + rIn * Math.cos(a)), y: O.y + pt(cy + rIn * Math.sin(a)) });
  }
  cmds.push({ op: 'Z' });
  return vec(cmds, layer);
}

describe('custom kiosks, feature columns, slat screens & ceiling canopy extraction', () => {
  it('classifies duty-free curved kiosks, central column, and extracts concentric rotunda canopy zone', () => {
    const cx = 8;
    const cy = 8;
    const vectors: MuVector[] = [
      // Outer ceiling rotunda ring + inner drum collar on RCP layer
      oval(cx, cy, 4.4, 4.4, 'A-CEIL-RCP', 36),
      oval(cx, cy, 1.5, 1.5, 'A-CEIL-RCP', 28),
      // Central fluted retail column (diameter 1.38 m)
      oval(cx, cy, 0.69, 0.69, 'A-FURN', 28),
      // Three curved Duty-Free vitrine kiosks arrayed around the hub
      curvedCounter(cx, cy, 2.2, 3.0, 0.1, 1.3),
      curvedCounter(cx, cy, 2.2, 3.0, 2.1, 3.3),
      curvedCounter(cx, cy, 2.2, 3.0, 4.2, 5.4),
      // Curved free-standing architectural slat screen (thin arc with label)
      curvedCounter(cx + 6.5, cy, 2.8, 2.94, 0.2, 1.4),
    ];

    const texts = [
      { text: 'DUTY FREE SHOP', x: O.x + pt(cx) - 10, y: O.y + pt(cy) - 5, w: 20, h: 10 },
      { text: 'SLAT SCREEN', x: O.x + pt(cx + 8.5), y: O.y + pt(cy + 2.0), w: 20, h: 10 },
    ];

    const res = detectFurniture({ vectors, scaleMmPerPt: SCALE, texts });
    const kiosks = res.pieces.filter((p) => p.subtype === 'retail-kiosk');
    const col = res.pieces.find((p) => p.subtype === 'feature-column');
    const screen = res.pieces.find((p) => p.subtype === 'slat-screen');

    expect(kiosks.length).toBe(3);
    expect(kiosks.every((k) => k.kind === 'joinery' && k.customModel)).toBe(true);
    expect(col).toBeDefined();
    expect(col?.heightM).toBeGreaterThanOrEqual(2.8);
    expect(screen).toBeDefined();
    expect(screen?.kind).toBe('screen');
    expect(screen?.heightM).toBeGreaterThanOrEqual(2.0);

    const rotunda = res.zones?.find((z) => z.kind === 'rotunda-canopy');
    expect(rotunda).toBeDefined();
    expect(rotunda?.shape).toBe('round');
    expect(rotunda?.radiusM).toBeGreaterThan(3.8);
    expect(rotunda?.innerRadiiM?.length).toBeGreaterThanOrEqual(1);
  });

  it('recovers duty-free kiosks, central column, and rotunda zone on fbo-lounge.pdf when present', () => {
    const fboPath = path.join(REPO_ROOT, 'tmp', 'fbo-lounge.pdf');
    if (!fs.existsSync(fboPath)) return;
    const bytes = new Uint8Array(fs.readFileSync(fboPath));
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
    const page = doc.loadPage(0);
    const cap = collectPageVectors(page, false, 0);
    const pure = extractPureWallResult(bytes, 0, undefined, undefined, true).pureResult;
    const accepted = pure.accepted ?? [];
    const xs = accepted.flatMap((w) => [w.centerline.a.x, w.centerline.b.x]);
    const ys = accepted.flatMap((w) => [w.centerline.a.y, w.centerline.b.y]);
    const m = 1 / (pure.scaleMmPerPt / 1000);
    const within: [number, number, number, number] = [Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m];
    const texts = furnitureTextsFromStructuredText(page.toStructuredText('preserve-whitespace').asJSON());
    const walls = accepted.map((w) => ({ a: w.centerline.a, b: w.centerline.b, t: w.thickness }));
    const res = detectFurniture({ vectors: cap.vectors, scaleMmPerPt: pure.scaleMmPerPt, within, texts, walls });
    page.destroy();
    doc.destroy();

    expect(res.pieces.some((p) => p.subtype === 'retail-kiosk')).toBe(true);
    expect(res.pieces.some((p) => p.subtype === 'feature-column')).toBe(true);
    expect((res.zones ?? []).some((z) => z.kind === 'rotunda-canopy')).toBe(true);
  });
});

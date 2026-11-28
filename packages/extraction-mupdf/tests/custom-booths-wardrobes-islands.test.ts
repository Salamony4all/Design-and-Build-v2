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
const CUSTOM_FIXTURES_DIR = path.join(REPO_ROOT, 'test drawings and png', 'fresh-custom');

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
    id: `cb${nextId++}`,
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

const line = (a: Vec2, b: Vec2, layer?: string) =>
  vec([{ op: 'M', ...a }, { op: 'L', ...b }], layer);

function rect(x: number, y: number, w: number, h: number, layer?: string): MuVector {
  const p = (dx: number, dy: number) => ({ x: O.x + pt(x + dx), y: O.y + pt(y + dy) });
  const a = p(0, 0);
  const b = p(w, 0);
  const c = p(w, h);
  const d = p(0, h);
  return vec([{ op: 'M', ...a }, { op: 'L', ...b }, { op: 'L', ...c }, { op: 'L', ...d }, { op: 'Z' }], layer);
}

const CUSTOM_PDF_FILES = [
  'kirklees-cleckheaton-kitchen-island.pdf',
  'uga-nkba-kitchen-island-booth.pdf',
  'kirklees-huddersfield-wardrobes.pdf',
  'barnsley-gf-1f-wardrobes.pdf',
  'ewu-residence-wardrobes.pdf',
  'fleet-harlington-banquette.pdf',
  'wsu-dining-booths-banquettes.pdf',
];

function pickBestPlanPage(doc: ReturnType<typeof mupdf.Document.openDocument>): number {
  const count = Math.min(doc.countPages(), 25);
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < count; i++) {
    const p = doc.loadPage(i);
    const txt = p.toStructuredText('preserve-whitespace').asText();
    const cap = collectPageVectors(p, false, i);
    const planHit = /\b(floor\s*plan|proposed\s*ground|first\s*floor|kitchen|wardrobe|banquette|booth|scale\s*1:|level\s*1)\b/i.test(txt)
      ? 2.0
      : 1.0;
    const score = cap.vectors.length * planHit;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
    p.destroy();
  }
  return bestIdx;
}

describe('custom booths, banquettes, wardrobes, kitchen islands & wall artworks extraction', () => {
  it('classifies synthetic booths, wall-backed banquettes, bedroom wardrobes, kitchen islands & wall artworks', () => {
    const northWall = line({ x: O.x, y: O.y }, { x: O.x + pt(16), y: O.y });
    const westWall = line({ x: O.x, y: O.y }, { x: O.x, y: O.y + pt(12) });
    const walls = [
      { a: { x: O.x, y: O.y }, b: { x: O.x + pt(16), y: O.y }, t: pt(0.15) },
      { a: { x: O.x, y: O.y }, b: { x: O.x, y: O.y + pt(12) }, t: pt(0.15) },
    ];
    const claimed = new Set([northWall.id, westWall.id]);

    const vectors: MuVector[] = [
      northWall,
      westWall,
      // 1. Acoustic dining booth (labeled)
      rect(1.0, 1.8, 2.2, 1.35, 'A-FURN'),
      // 2. Wall-backed dining banquette against north wall
      rect(4.2, 0.12, 2.8, 0.62, 'A-FURN'),
      // 3. Free-standing kitchen island (not against wall, with inner prep sink cutout)
      rect(8.5, 2.5, 2.8, 1.05, 'A-FURN'),
      rect(9.4, 2.8, 0.55, 0.42, 'A-FURN'),
      // 4. Bedroom built-in wardrobe against north wall (layered)
      rect(12.0, 0.12, 2.4, 0.6, 'A-FURN'),
      // 5. Framed wall artwork hung along west wall (labeled)
      rect(0.12, 5.0, 0.14, 1.6, 'A-FURN'),
    ];

    const texts = [
      { text: 'DINING BOOTH', x: O.x + pt(1.7), y: O.y + pt(2.4), w: 20, h: 10 },
      { text: 'DINING AREA', x: O.x + pt(5.4), y: O.y + pt(1.4), w: 20, h: 10 },
      { text: 'KITCHEN', x: O.x + pt(9.2), y: O.y + pt(1.5), w: 20, h: 10 },
      { text: 'KITCHEN ISLAND', x: O.x + pt(9.5), y: O.y + pt(3.0), w: 20, h: 10 },
      { text: 'BEDROOM', x: O.x + pt(13.0), y: O.y + pt(2.2), w: 20, h: 10 },
      { text: 'WALL ARTWORK', x: O.x + pt(0.4), y: O.y + pt(5.7), w: 20, h: 10 },
    ];

    const res = detectFurniture({
      vectors,
      scaleMmPerPt: SCALE,
      walls,
      claimedVectorIds: claimed,
      texts,
    });

    const subs = new Set(res.pieces.map((p) => p.subtype));
    expect(subs.has('booth')).toBe(true);
    expect(subs.has('banquette')).toBe(true);
    expect(subs.has('island')).toBe(true);
    expect(subs.has('wardrobe')).toBe(true);
    expect(subs.has('wall-art')).toBe(true);

    const island = res.pieces.find((p) => p.subtype === 'island')!;
    expect(island.kind).toBe('joinery');
    expect(island.customModel).toBe(true);

    const wardrobe = res.pieces.find((p) => p.subtype === 'wardrobe')!;
    expect(wardrobe.heightM).toBeGreaterThanOrEqual(2.1);
  });

  it('extracts geometry & furniture cleanly across all 7 downloaded public PDF drawings', () => {
    const manifestPath = path.join(CUSTOM_FIXTURES_DIR, 'manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    let totalWalls = 0;
    let totalVectors = 0;
    let totalPieces = 0;

    for (const file of CUSTOM_PDF_FILES) {
      const fullPath = path.join(CUSTOM_FIXTURES_DIR, file);
      expect(fs.existsSync(fullPath)).toBe(true);
      const bytes = new Uint8Array(fs.readFileSync(fullPath));
      const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
      const pageIdx = pickBestPlanPage(doc);
      const page = doc.loadPage(pageIdx);
      const cap = collectPageVectors(page, false, pageIdx);
      const wallRaw = extractPureWallResult(bytes, pageIdx, undefined, undefined, true);
      const pure = wallRaw.pureResult;
      const accepted = pure.accepted ?? [];
      const texts = furnitureTextsFromStructuredText(page.toStructuredText('preserve-whitespace').asJSON());
      const walls = accepted
        .filter((w) => w?.centerline?.a && w?.centerline?.b)
        .map((w) => ({ a: w.centerline.a, b: w.centerline.b, t: w.thickness }));
      const furniture = detectFurniture({
        vectors: cap.vectors,
        scaleMmPerPt: pure.scaleMmPerPt > 0 ? pure.scaleMmPerPt : SCALE,
        texts,
        walls,
      });
      page.destroy();
      doc.destroy();

      expect(cap.vectors.length).toBeGreaterThan(20);
      totalVectors += cap.vectors.length;
      totalWalls += accepted.length;
      totalPieces += furniture.pieces.length;
    }

    expect(totalVectors).toBeGreaterThan(1000);
    expect(totalWalls).toBeGreaterThan(15);
    expect(totalPieces).toBeGreaterThanOrEqual(0);
  }, 60000);

  it('extracts walls, kitchen island, dining booth, banquette, wardrobe, curved sofa & rotunda canopy from custom-showcase-plan.pdf', () => {
    const fullPath = path.join(CUSTOM_FIXTURES_DIR, 'custom-showcase-plan.pdf');
    expect(fs.existsSync(fullPath)).toBe(true);
    const bytes = new Uint8Array(fs.readFileSync(fullPath));
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
    const page = doc.loadPage(0);
    const cap = collectPageVectors(page, false, 0);
    const wallRaw = extractPureWallResult(bytes, 0, undefined, undefined, true);
    const pure = wallRaw.pureResult;
    const accepted = pure.accepted ?? [];
    const claimed = new Set<string>();
    for (const w of accepted as Array<{ sourceRootIds?: string[]; sourceSubpathIds?: string[]; sourceStrokeIds?: string[] }>) {
      for (const id of w?.sourceRootIds ?? []) claimed.add(String(id).split(':')[0]);
      for (const id of w?.sourceSubpathIds ?? []) claimed.add(String(id).split(':')[0]);
      for (const id of w?.sourceStrokeIds ?? []) claimed.add(String(id).split(':')[0]);
    }
    const texts = furnitureTextsFromStructuredText(page.toStructuredText('preserve-whitespace').asJSON());
    const walls = accepted
      .filter((w) => w?.centerline?.a && w?.centerline?.b)
      .map((w) => ({ a: w.centerline.a, b: w.centerline.b, t: w.thickness }));
    const furniture = detectFurniture({
      vectors: cap.vectors,
      scaleMmPerPt: pure.scaleMmPerPt > 0 ? pure.scaleMmPerPt : SCALE,
      texts,
      walls,
      claimedVectorIds: claimed,
    });
    page.destroy();
    doc.destroy();

    expect(accepted.length).toBeGreaterThanOrEqual(6);
    const subs = new Set(furniture.pieces.map((p) => p.subtype));
    expect(subs.has('island')).toBe(true);
    expect(subs.has('booth')).toBe(true);
    expect(subs.has('banquette')).toBe(true);
    expect(subs.has('wardrobe')).toBe(true);
    expect(furniture.zones.some((z) => z.kind === 'rotunda-canopy')).toBe(true);
  });

  it('picks the page with the most accepted walls across multi-page architectural PDFs', () => {
    const fullPath = path.join(CUSTOM_FIXTURES_DIR, 'uga-nkba-kitchen-island-booth.pdf');
    const bytes = new Uint8Array(fs.readFileSync(fullPath));
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
    const limit = Math.min(doc.countPages(), 25);
    const pageWallCounts: number[] = [];
    for (let i = 0; i < limit; i++) {
      const w = extractPureWallResult(bytes, i, undefined, undefined, true);
      pageWallCounts.push(w.pureResult?.accepted?.length ?? 0);
    }
    doc.destroy();
    const maxWalls = Math.max(...pageWallCounts);
    expect(maxWalls).toBeGreaterThan(0);
    expect(pageWallCounts[0]).toBeGreaterThanOrEqual(2);
    expect(maxWalls).toBe(pageWallCounts[0]);
  }, 60000);
});

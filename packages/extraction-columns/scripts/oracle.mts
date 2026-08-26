// INDEPENDENT OBJECT-LEVEL VISUAL ORACLE — raster cavity analysis.
//
// ORACLE-INDEPENDENCE CONTRACT
//  * NOT imported by src/. Evidence generator only; production never reads it.
//  * Imports NOTHING from src/. No shared code path with the extractor.
//  * Different algorithm family:
//        production : canonical-edge de-dup -> union-find -> ring tracing ->
//                     analytic rectangle / circle fitting on vector vertices
//        oracle     : ink rasterisation -> exterior flood fill -> enclosed
//                     cavity labelling -> raster moment / occupancy analysis
//    No shared thresholds, no shared data structures, no shared intermediate.
//  * Uses information production deliberately DOES NOT have: the oracle stamps
//    WALL ink as well, so wall-abutting footprints close naturally in the image.
//    This makes it a true cross-check rather than a re-run of the same idea.
//  * Contains no expected count and no hardcoded footprint coordinate. Every
//    gate is a physical dimension in metres.
//
// PRINCIPLE
//  In an architectural plan a column reads as a small, compact, closed outline.
//  Rasterise every drawn line, flood the exterior, and each remaining
//  background island is an enclosed cavity. Rooms are large; hatch cells are
//  tiny and ragged; a column cavity is small, compact and either rectangular
//  (high bbox occupancy, anisotropic moments allowed) or circular (occupancy
//  near pi/4 with isotropic moments).

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

interface P { x: number; y: number }
interface FixLine { id: string; sourceOperationId?: string; a: P; b: P }
interface FixCubic { id: string; sourceOperationId?: string; p0: P; p1: P; p2: P; p3: P }

const FIXTURE = join(process.cwd(), '..', 'extraction-mupdf', 'extraction-results', 'secondary-fixture.json');
const OUT = join(process.cwd(), 'evidence');

const raw = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const mmPerPt: number = raw.scaleMmPerPt;
const wallIds = new Set<string>();
const claimed = new Set<string>();
for (const c of raw.claimed as Array<{ kind: string; sourceIds: string[] }>) {
  for (const id of c.sourceIds) {
    claimed.add(id);
    if (c.kind === 'wall') wallIds.add(id);
  }
}
const lines: FixLine[] = raw.lines;
const cubics: FixCubic[] = raw.cubics;

// -------------------------------------------------------------- raster ------
// 10 mm cells: the smallest footprint we care about (0.20 m) spans 20 cells.
const CELL_MM = 10;
const cellPt = CELL_MM / mmPerPt;

const wallLines = lines.filter((l) => wallIds.has(l.id));
let wminX = Infinity, wminY = Infinity, wmaxX = -Infinity, wmaxY = -Infinity;
for (const l of wallLines) for (const p of [l.a, l.b]) {
  if (p.x < wminX) wminX = p.x; if (p.y < wminY) wminY = p.y;
  if (p.x > wmaxX) wmaxX = p.x; if (p.y > wmaxY) wmaxY = p.y;
}
const PAD = cellPt * 4;
const ox = wminX - PAD, oy = wminY - PAD;
const W = Math.ceil((wmaxX - wminX + 2 * PAD) / cellPt);
const H = Math.ceil((wmaxY - wminY + 2 * PAD) / cellPt);
const ink = new Uint8Array(W * H);
const idxOf = (cx: number, cy: number) => cy * W + cx;

function stamp(a: P, b: P) {
  const x0 = (a.x - ox) / cellPt, y0 = (a.y - oy) / cellPt;
  const x1 = (b.x - ox) / cellPt, y1 = (b.y - oy) / cellPt;
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const cx = Math.round(x0 + (x1 - x0) * t);
    const cy = Math.round(y0 + (y1 - y0) * t);
    if (cx >= 0 && cy >= 0 && cx < W && cy < H) ink[idxOf(cx, cy)] = 1;
  }
}
let stamped = 0;
for (const l of lines) {
  if (Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) < 1e-7) continue;
  stamp(l.a, l.b);
  stamped++;
}
for (const c of cubics) {
  let prev = c.p0;
  for (let i = 1; i <= 8; i++) {
    const t = i / 8, u = 1 - t;
    const p = {
      x: u * u * u * c.p0.x + 3 * u * u * t * c.p1.x + 3 * u * t * t * c.p2.x + t * t * t * c.p3.x,
      y: u * u * u * c.p0.y + 3 * u * u * t * c.p1.y + 3 * u * t * t * c.p2.y + t * t * t * c.p3.y,
    };
    stamp(prev, p);
    prev = p;
  }
}

// ------------------------------------------- exterior flood + cavities ------
const seen = new Uint8Array(W * H);
const stack: number[] = [];
for (let x = 0; x < W; x++) { for (const y of [0, H - 1]) { const i = idxOf(x, y); if (!ink[i] && !seen[i]) { seen[i] = 1; stack.push(i); } } }
for (let y = 0; y < H; y++) { for (const x of [0, W - 1]) { const i = idxOf(x, y); if (!ink[i] && !seen[i]) { seen[i] = 1; stack.push(i); } } }
while (stack.length) {
  const c = stack.pop()!;
  const cx = c % W, cy = (c / W) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nx = cx + dx, ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const n = idxOf(nx, ny);
    if (!ink[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
  }
}

interface Cav { cells: number[] }
const cavities: Cav[] = [];
const visited = new Uint8Array(W * H);
for (let s = 0; s < ink.length; s++) {
  if (ink[s] || seen[s] || visited[s]) continue;
  const cells: number[] = [];
  stack.length = 0;
  stack.push(s); visited[s] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    cells.push(c);
    const cx = c % W, cy = (c / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = idxOf(nx, ny);
      if (!ink[n] && !seen[n] && !visited[n]) { visited[n] = 1; stack.push(n); }
    }
    if (cells.length > 400000) break;
  }
  cavities.push({ cells });
}

// -------------------------------------------------- cavity descriptors ------
interface OracleObject {
  oracleId: string;
  shapeClass: 'RECTANGLE' | 'DISC' | 'POLYGON' | 'COMPLEX';
  centreProjectM: P;
  widthM: number;
  depthM: number;
  bboxOccupancy: number;
  momentIsotropy: number;
  principalRad: number;
  aspect: number;
  cellCount: number;
  cornerConsensus: number;
  columnLikeness: number;
}
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const toM = (pt: number) => (pt * mmPerPt) / 1000;
const cellM = CELL_MM / 1000;

// Cavity gates are the *interior* of a footprint, so they run one line-weight
// smaller than the footprint itself: 0.15 m .. 1.4 m per side.
const MIN_SIDE_M = 0.15;
const MAX_SIDE_M = 1.4;

function analyse(cav: Cav): OracleObject | null {
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const c of cav.cells) {
    const cx = c % W, cy = (c / W) | 0;
    if (cx < bx0) bx0 = cx; if (cx > bx1) bx1 = cx;
    if (cy < by0) by0 = cy; if (cy > by1) by1 = cy;
  }
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  const widthM = bw * cellM, depthM = bh * cellM;
  if (Math.min(widthM, depthM) < MIN_SIDE_M) return null;
  if (Math.max(widthM, depthM) > MAX_SIDE_M) return null;

  const bboxOccupancy = cav.cells.length / (bw * bh);
  let sx = 0, sy = 0;
  for (const c of cav.cells) { sx += c % W; sy += (c / W) | 0; }
  const n = cav.cells.length;
  const mx = sx / n, my = sy / n;
  let mxx = 0, myy = 0, mxy = 0;
  for (const c of cav.cells) {
    const dx = (c % W) - mx, dy = ((c / W) | 0) - my;
    mxx += dx * dx; myy += dy * dy; mxy += dx * dy;
  }
  mxx /= n; myy /= n; mxy /= n;
  const tr = mxx + myy, det = mxx * myy - mxy * mxy;
  const d2 = Math.max(0, (tr * tr) / 4 - det);
  const l1 = tr / 2 + Math.sqrt(d2), l2 = tr / 2 - Math.sqrt(d2);
  const momentIsotropy = l1 > 1e-9 ? l2 / l1 : 0;
  let principalRad = 0.5 * Math.atan2(2 * mxy, mxx - myy);
  if (principalRad < 0) principalRad += Math.PI;
  if (principalRad >= Math.PI / 2) principalRad -= Math.PI / 2;
  const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));

  // corner consensus: fraction of the four bbox corner cells that are inside.
  // A rectangle fills all four; a disc fills none.
  const inSet = new Set(cav.cells);
  let corners = 0;
  for (const [cx, cy] of [[bx0, by0], [bx1, by0], [bx0, by1], [bx1, by1]] as const) {
    if (inSet.has(idxOf(cx, cy))) corners++;
  }
  const cornerConsensus = corners / 4;

  // For a convex cavity, bbox occupancy alone separates the families:
  //   axis-aligned rectangle -> ~1.00      disc -> pi/4 ~= 0.785
  //   rotated rectangle      -> >= 0.5     ragged/complex -> low & no corners
  let shapeClass: OracleObject['shapeClass'];
  if (bboxOccupancy >= 0.9 && cornerConsensus >= 0.75 && aspect < 4) shapeClass = 'RECTANGLE';
  else if (bboxOccupancy >= 0.7 && bboxOccupancy < 0.9 && momentIsotropy > 0.75 && cornerConsensus <= 0.25 && aspect < 1.3) shapeClass = 'DISC';
  else if (bboxOccupancy >= 0.55 && aspect < 4) shapeClass = 'POLYGON';
  else shapeClass = 'COMPLEX';

  const squareness = Math.max(0, 1 - (aspect - 1) / 2);
  const compact = Math.min(1, bboxOccupancy / 0.9);
  const columnLikeness = round6(Math.max(0, Math.min(1, compact * 0.45 + squareness * 0.35 + momentIsotropy * 0.2)));

  return {
    oracleId: `orc_${bx0}_${by0}_${bw}x${bh}`,
    shapeClass,
    centreProjectM: { x: round6(toM(ox + (bx0 + bw / 2) * cellPt)), y: round6(toM(oy + (by0 + bh / 2) * cellPt)) },
    widthM: round6(widthM),
    depthM: round6(depthM),
    bboxOccupancy: round6(bboxOccupancy),
    momentIsotropy: round6(momentIsotropy),
    principalRad: round6(principalRad),
    aspect: round6(aspect),
    cellCount: n,
    cornerConsensus,
    columnLikeness,
  };
}

const objects: OracleObject[] = [];
for (const cav of cavities) {
  const a = analyse(cav);
  if (a) objects.push(a);
}
objects.sort((a, b) => (a.centreProjectM.x - b.centreProjectM.x) || (a.centreProjectM.y - b.centreProjectM.y));

mkdirSync(OUT, { recursive: true });
const payload = {
  method: 'raster-cavity-moment-analysis',
  independence: [
    'imports nothing from src/',
    'algorithm family differs from production (raster cavities vs vector ring tracing)',
    'stamps wall ink that production never sees',
    'no expected counts, no hardcoded coordinates',
  ],
  cellSizeMm: CELL_MM,
  raster: { width: W, height: H },
  stampedLines: stamped,
  totalCavities: cavities.length,
  sizeGateM: { min: MIN_SIDE_M, max: MAX_SIDE_M },
  objects,
};
writeFileSync(join(OUT, 'visual-oracle.json'), JSON.stringify(payload, null, 2));

const byClass = new Map<string, number>();
for (const o of objects) byClass.set(o.shapeClass, (byClass.get(o.shapeClass) ?? 0) + 1);
console.log(`raster ${W}x${H} cells (${CELL_MM}mm); cavities ${cavities.length}; in-size ${objects.length}`);
console.log('by class:', [...byClass.entries()]);
const sizeB = new Map<string, number>();
for (const o of objects.filter((o) => o.shapeClass === 'RECTANGLE')) {
  const k = `${Math.round(o.widthM * 100) / 100}x${Math.round(o.depthM * 100) / 100}`;
  sizeB.set(k, (sizeB.get(k) ?? 0) + 1);
}
console.log('RECTANGLE size buckets:', [...sizeB.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20));
const discB = new Map<string, number>();
for (const o of objects.filter((o) => o.shapeClass === 'DISC')) {
  const k = `${Math.round(o.widthM * 100) / 100}`;
  discB.set(k, (discB.get(k) ?? 0) + 1);
}
console.log('DISC diameter buckets:', [...discB.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15));
console.log('wrote evidence/visual-oracle.json');

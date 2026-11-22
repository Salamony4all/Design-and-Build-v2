// Door scoring against a hand-verified answer key (test-only; never imported by
// production code). Errors are measured in the host wall's own frame: ALONG the wall
// axis (position/width) and ACROSS it (the key's jambs sit on a wall face, the
// extractor's interval on the centreline, so up to one wall thickness across is fine).
//   hostOk   - an accepted assembly sits on a wall of the right orientation, within one
//              wall thickness across and HOST_TOL_PT along of the true opening centre
//   placedOk - hostOk and the centre is within PLACE_TOL_PT along the wall
//   widthOk  - placedOk and the opening length is within WIDTH_TOL of the true opening
//   hingeOk  - widthOk and the reported hinge is at the true hinge jamb (along the wall)
//   swingOk  - hingeOk and the leaf opens to the true side of the wall
// Matching is one-to-one, greedy by ascending centre distance (deterministic).
export interface KeyDoor {
  id: string;
  tag: string;
  type: string;
  wallOrientation: 'H' | 'V';
  jambA: [number, number];
  jambB: [number, number];
  openingMm: number;
  hingeJamb: 'A' | 'B';
  swingSide: 'N' | 'S' | 'E' | 'W';
}

export const HOST_TOL_PT = 25;
export const PLACE_TOL_PT = 4;
export const WIDTH_TOL = 0.05;
export const HINGE_TOL_PT = 6;

type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function assemblyOpening(a: any, wallsById: Map<string, any>) {
  const w = a.selectedPhysicalWallId ? wallsById.get(a.selectedPhysicalWallId) : undefined;
  if (!w || !a.wallLocalInterval) return undefined;
  const A: Pt = w.centerline.a;
  const B: Pt = w.centerline.b;
  const L = dist(A, B) || 1;
  const u = { x: (B.x - A.x) / L, y: (B.y - A.y) / L };
  const p = { x: A.x + u.x * a.wallLocalInterval.from, y: A.y + u.y * a.wallLocalInterval.from };
  const q = { x: A.x + u.x * a.wallLocalInterval.to, y: A.y + u.y * a.wallLocalInterval.to };
  return {
    p,
    q,
    A,
    u,
    thickness: (w.thickness as number) ?? 0,
    centre: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
    lengthPt: dist(p, q),
    orientation: (Math.abs(u.x) > Math.abs(u.y) ? 'H' : 'V') as 'H' | 'V',
  };
}

export function scoreDoors(accepted: any[], walls: any[], key: KeyDoor[], scaleMmPerPt: number) {
  const wallsById = new Map<string, any>(walls.map((w) => [w.physicalWallId, w]));
  const openings = accepted.map((a) => assemblyOpening(a, wallsById));
  const keyCentre = (k: KeyDoor): Pt => ({ x: (k.jambA[0] + k.jambB[0]) / 2, y: (k.jambA[1] + k.jambB[1]) / 2 });
  const edges: Array<{ a: number; k: number; d: number; along: number }> = [];
  openings.forEach((o, ai) => {
    if (!o) return;
    key.forEach((k, ki) => {
      if (o.orientation !== k.wallOrientation) return;
      const kc = keyCentre(k);
      const dx = kc.x - o.centre.x;
      const dy = kc.y - o.centre.y;
      const along = Math.abs(dx * o.u.x + dy * o.u.y);
      const across = Math.abs(dx * o.u.y - dy * o.u.x);
      if (across > Math.max(o.thickness, 8) || along > HOST_TOL_PT) return;
      edges.push({ a: ai, k: ki, d: Math.hypot(dx, dy), along });
    });
  });
  edges.sort((x, y) => x.d - y.d || x.a - y.a || x.k - y.k);
  const usedA = new Set<number>();
  const usedK = new Set<number>();
  const pairs: typeof edges = [];
  for (const e of edges) {
    if (usedA.has(e.a) || usedK.has(e.k)) continue;
    usedA.add(e.a);
    usedK.add(e.k);
    pairs.push(e);
  }
  let placedOk = 0;
  let widthOk = 0;
  let hingeOk = 0;
  let swingOk = 0;
  const SIDE: Record<string, Pt> = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 } };
  for (const p of pairs) {
    if (p.along > PLACE_TOL_PT) continue;
    placedOk++;
    const k = key[p.k]!;
    const o = openings[p.a]!;
    const a = accepted[p.a];
    const truePt = k.openingMm / scaleMmPerPt;
    if (Math.abs(o.lengthPt - truePt) / truePt > WIDTH_TOL) continue;
    widthOk++;
    const h = a.hinge as Pt | undefined;
    const jamb = k.hingeJamb === 'A' ? k.jambA : k.jambB;
    if (!h || Math.abs((h.x - jamb[0]) * o.u.x + (h.y - jamb[1]) * o.u.y) > HINGE_TOL_PT) continue;
    // hingeSide must agree with where the hinge really is along the wall
    const hingeAlong = (jamb[0] - o.A.x) * o.u.x + (jamb[1] - o.A.y) * o.u.y;
    const midAlong = (a.wallLocalInterval.from + a.wallLocalInterval.to) / 2;
    if (a.hingeSide !== (hingeAlong < midAlong ? 'left' : 'right')) continue;
    hingeOk++;
    // 'inward' = leaf opens toward the wall-local +Z normal (-u.y, u.x)
    const sgn = a.swingDirection === 'inward' ? 1 : -1;
    const n = { x: -o.u.y * sgn, y: o.u.x * sgn };
    const want = SIDE[k.swingSide]!;
    if (a.swingDirection && n.x * want.x + n.y * want.y > 0.7) swingOk++;
  }
  return {
    keyDoors: key.length,
    accepted: accepted.length,
    hostOk: pairs.length,
    wrongWallOrMissed: key.filter((_, i) => !usedK.has(i)).map((k) => k.id),
    falsePositives: accepted.length - pairs.length,
    placedOk,
    widthOk,
    hingeOk,
    swingOk,
  };
}

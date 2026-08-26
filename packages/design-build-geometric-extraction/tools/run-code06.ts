// CS4 CODE-06 FF&E geometric extraction runner (deterministic).
// Uses the ACTIVATED extraction-mupdf collectPageVectors + the new
// design-build-geometric-extraction package. Emits JSON evidence + overlay SVG.
// No production Pascal nodes are created.

import * as mupdf from 'mupdf';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
import { collectPageVectors, type MuVector } from '../../extraction-mupdf/src/vector-device.ts';
import { buildComponent, clusterFamilies, type Component } from '../src/shared/component-store.ts';
import { discoverFurnitureFamilies, canonicalSignature } from '../src/furniture/family-extractor.ts';
import { classifyFamily } from '../src/furniture/sector-classifier.ts';
import { reconcileFamily } from '../src/furniture/reconciliation.ts';
import { buildWorkspace } from '../src/furniture/workspace.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const PDF = join(ROOT, 'apps/design-build-editor/public/CODE_06.pdf');
const OUT = join(__dirname, '..', 'evidence', 'code06');
const ORACLE = 'C:/Users/Mohamad60025/AppData/Local/Temp/cs4-inspect/design-build-full-upgrade-v0.4-ffe-sector/packages/geometric-extraction/e2e/code06-ffe-sector-oracle.json';

// CODE-06: page is 728.92 x 330.72 pts. Wall mass ~ 695 x 310 pts.
// Measured scale from the activated 70-wall run: 1 pt = 5.14 mm.
const SCALE_MM_PER_PT = 5.14;
// 4 six-bed units each ~ 11.0 x 6.0 m -> per-unit area in points:
const UNIT_W_PT = 11000 / SCALE_MM_PER_PT; // width meters->pts
const UNIT_H_PT = 6000 / SCALE_MM_PER_PT;

interface RawVec { id: string; sourceRootId?: string; operation: 'fill-path' | 'stroke-path'; points: {x:number;y:number}[]; subpaths?: {x:number;y:number}[][]; bounds: [number,number,number,number]; color?: number[]; alpha?: number; strokeWidth?: number; closed?: boolean; commands?: {op:string;[k:string]:unknown}[]; }

function toRaw(v: MuVector): RawVec {
  return {
    id: v.id, sourceRootId: v.sourceRootId, operation: v.operation as any,
    points: v.points, subpaths: v.subpaths, bounds: v.bounds as any,
    color: v.color, alpha: v.alpha, strokeWidth: v.strokeWidth,
    closed: v.operation === 'fill-path', commands: v.commands as any,
  };
}

async function main() {
  const buf = readFileSync(PDF);
  const pdf = mupdf.Document.openDocument(new Uint8Array(buf), 'application/pdf');
  const page = pdf.loadPage(0);
  const coll = collectPageVectors(page);
  const pageBounds: [number, number, number, number] = [0, 0, 728.92, 330.72];
  const buildingRegion: [number, number, number, number] = [16, 10, 712, 320];

  // Build normalized components from EVERY collected root primitive (fills + strokes).
  // CODE-06 draws beds as COMPOSITE symbols (many short strokes, no single closed
  // bed root), so a grouping pre-pass merges nearby primitives into one furniture
  // symbol via connected-component union-find on bounding-box proximity.
  const roots = coll.vectors.filter((v) => !v.sourceRootId);
  const GAP = 28; // PDF pts (~144 mm) merge tolerance for symbol grouping

  const rects = roots.map((v) => ({ id: v.id, x0: v.bounds[0], y0: v.bounds[1], x1: v.bounds[2], y1: v.bounds[3], raw: toRaw(v) }));
  // union-find by proximity (boxes within GAP of each other merge)
  const parent = rects.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const near = (a: typeof rects[number], b: typeof rects[number]) =>
    a.x0 - GAP <= b.x1 && b.x0 - GAP <= a.x1 && a.y0 - GAP <= b.y1 && b.y0 - GAP <= a.y1;
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++)
      if (near(rects[i], rects[j])) parent[find(i)] = find(j);

  const groups = new Map<number, typeof rects>();
  rects.forEach((r, i) => {
    const g = find(i);
    const arr = groups.get(g) ?? [];
    arr.push(r);
    groups.set(g, arr);
  });

  // Composite furniture symbols: merged bounds + combined source IDs.
  const grouped: { id: string; bounds: [number, number, number, number]; sources: string[]; strokeCount: number; fillCount: number }[] = [];
  for (const [, arr] of groups) {
    if (arr.length < 2) continue; // skip singletons (pure linework handled separately)
    const x0 = Math.min(...arr.map((r) => r.x0)), y0 = Math.min(...arr.map((r) => r.y0));
    const x1 = Math.max(...arr.map((r) => r.x1)), y1 = Math.max(...arr.map((r) => r.y1));
    grouped.push({
      id: `grp-${arr[0].id}`,
      bounds: [x0, y0, x1, y1],
      sources: arr.map((r) => r.id),
      strokeCount: arr.filter((r) => r.raw.operation === 'stroke-path').length,
      fillCount: arr.filter((r) => r.raw.operation === 'fill-path').length,
    });
  }

  // Map grouped symbols -> subagent Component (bounds in MM). Restrict to
  // plausible furniture footprints (exclude the dominant wall mass: require the
  // composite to be small enough to be furniture, not a whole wall run).
  const simpleComps = grouped
    .filter((g) => {
      const w = (g.bounds[2] - g.bounds[0]) * SCALE_MM_PER_PT;
      const h = (g.bounds[3] - g.bounds[1]) * SCALE_MM_PER_PT;
      const small = Math.min(w, h), large = Math.max(w, h);
      // furniture envelope: 0.3m..3.5m per side; reject huge wall-mass blocks
      return small >= 250 && large <= 3600 && large / Math.max(1, small) <= 4;
    })
    .map((g) => {
      const wmm = (g.bounds[2] - g.bounds[0]) * SCALE_MM_PER_PT;
      const hmm = (g.bounds[3] - g.bounds[1]) * SCALE_MM_PER_PT;
      return {
        id: g.id,
        bounds: [0, 0, wmm, hmm] as [number, number, number, number],
        points: [{ x: 0, y: 0 }, { x: wmm, y: 0 }, { x: wmm, y: hmm }, { x: 0, y: hmm }] as { x: number; y: number }[],
        closed: true,
        curves: 0,
        lines: g.strokeCount,
        strokeWidth: 0.3,
        source: { primitiveIds: g.sources, rootIds: g.sources, page: 0 },
      };
    }) as any;

  const families = discoverFurnitureFamilies(simpleComps, { unitsPerMeter: 1000, minRecurrence: 3 });

  // Recurrence clustering (for diagnostics)
  const fams = clusterFamilies(grouped.map((g) => ({ componentId: g.id, bounds: g.bounds, topologySignature: { closed: true, curves: 0, lines: g.strokeCount, strokeWidthMm: 0.3 } } as any)), 3);

  const classified = families.map((f) => classifyFamily(f, { sector: 'accommodation', spaceType: 'six-bed-unit' }, { unitsPerMeter: 1000 }));

  // Bed family = accommodation single-bed families
  const bedFamilies = classified.filter((c) => c.assignment.productType === 'single-bed' || c.assignment.productType === 'bunk-bed');
  const acceptedBeds = bedFamilies.reduce((n, c) => n + c.family.instances.length, 0);

  // AI reconciliation: load the real Gemini AI result (16 furniture records)
  const aiResult = JSON.parse(readFileSync(join(ROOT, 'ai_post_result.json'), 'utf8'));
  const aiFurniture = ((aiResult.result?.furniture ?? aiResult.furniture ?? []) as any[]).map((f: any) => ({
    id: f.id, class: f.class, center: { x: f.positionM?.x ?? 0, y: f.positionM?.y ?? 0 },
    width: (f.widthM ?? 1) * 1000, depth: (f.depthM ?? 1) * 1000, rotation: (f.rotationDeg ?? 0) * Math.PI / 180, confidence: f.confidence ?? 0.5,
  }));
  const reconciled = classified.flatMap((c) => reconcileFamily(c, aiFurniture, 350 /* mm tolerance */));
  const confirmed = reconciled.filter((r) => r.verdict === 'CONFIRMED_BY_AI_AND_GEOMETRY').length;
  const conflict = reconciled.filter((r) => r.verdict === 'CONFLICT').length;

  // Workspace
  const workspace = {
    byProductType: buildWorkspace(classified, 'product-type'),
    byFamily: buildWorkspace(classified, 'family'),
    byCategory: buildWorkspace(classified, 'category'),
    byScope: buildWorkspace(classified, 'scope'),
  };

  // Oracle comparison
  let oracle: any = null;
  try { oracle = JSON.parse(readFileSync(ORACLE, 'utf8')); } catch {}
  const oracleBeds = oracle?.expectedBedInstances ?? null;

  const report = {
    generatedAt: new Date().toISOString(),
    document: 'CODE_06.pdf',
    scaleMmPerPt: SCALE_MM_PER_PT,
    vectorCount: coll.vectors.length,
    diagnostics: coll.diagnostics,
    componentCount: grouped.length,
    rootPrimitiveCount: roots.length,
    groupDiagnostics: {
      totalGroups: groups.size,
      giantBlobGroups: [...groups.values()].filter((a) => a.length > 1000).length,
      maxGroupPrimitiveCount: Math.max(...[...groups.values()].map((a) => a.length)),
      note: 'CODE-06 furniture is embedded in a connected linework mesh; proximity grouping merges the drawing into a few giant blobs. Pure-primitive recurrence does not reconstruct 24 discrete beds. AI/geometric reconciliation (§11) is the source-backed path for bed proposals.',
    },
    recurrenceClusterCount: fams.size,
    familyCount: families.length,
    acceptedBedFamilies: bedFamilies.length,
    acceptedBedInstances: acceptedBeds,
    oracleExpectedBeds: oracleBeds,
    bedMatch: oracleBeds != null ? (acceptedBeds === oracleBeds) : null,
    reconciliation: { confirmed, conflict, geometricOnly: reconciled.filter(r=>r.verdict==='GEOMETRIC_ONLY').length, aiOnly: reconciled.filter(r=>r.verdict==='AI_ONLY').length },
    families: families.map((f) => ({
      id: f.id, signature: f.signature, recurrence: f.recurrence, proposedClass: f.proposedClass,
      classConfidence: f.classConfidence,
      productType: classified.find((c)=>c.family.id===f.id)?.assignment.productType,
      catalogueStatus: f.catalogueStatus,
      instances: f.instances.map((i)=>({id:i.id, center:i.center, width:i.width, depth:i.depth, orientationRad:i.orientation, sourceIds:i.sourceIds, verdict:i.verdict})),
    })),
    workspace,
  };

  mkdirSync(OUT, { recursive: true });
  const runId = process.env.CS4_RUN || 'run1';
  writeFileSync(join(OUT, `code06-ffe-${runId}.json`), JSON.stringify(report, null, 2));
  // canonical hash for determinism
  const hash = createHash('sha256').update(JSON.stringify(report.families)).digest('hex');
  writeFileSync(join(OUT, `code06-ffe-${runId}.canonicalhash`), hash);
  console.log(JSON.stringify({ runId, bedFamilies: bedFamilies.length, acceptedBeds, oracleBeds, bedMatch: report.bedMatch, familyCount: families.length, canonicalHash: hash }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });

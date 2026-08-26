// packages/extraction-mupdf/src/canonical-hash.ts
// Documented canonical accepted-wall representation (Change Set 2, §1).
//
// TWO DISTINCT canons — never combined into one ambiguous parity hash:
//
//  acceptedGeometryHash — geometry identity ONLY:
//      canonical endpoints, thickness, orientation class, stable wall order.
//  acceptedEvidenceHash — geometry identity PLUS stable, sorted evidence /
//      provenance fields (verdict, evidence types, source ids, connectivity
//      class, floating class, perimeter contribution, logical wall run,
//      opening-fragment role, positive/negative evidence).
//
// Normalization applied to BOTH:
//   - array order (stable sort by physicalWallId)
//   - negative zero -> 0
//   - numeric precision (PRECISION_MM = 3 decimals)
//   - endpoint direction (lexicographic: lower X first; tie -> lower Y)
//   - absent optional values -> null (so they serialize deterministically)
//
// Stable JSON serializer (sorted keys) guarantees determinism across runs.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PurePhysicalWall } from './mupdf-pure';
import type { LineageStore } from './vector-device';

/** Round to 3 decimals (~0.35mm at 17.5mm/pt). One documented precision. */
export const PRECISION_MM = 3;
const rnd = (n: number): number => {
  const v = Math.round((n + 0) * 10 ** PRECISION_MM) / 10 ** PRECISION_MM;
  return Object.is(v, -0) ? 0 : v;
};

function orientationClassOf(w: PurePhysicalWall): 'horizontal' | 'vertical' | 'diagonal' {
  const dx = Math.abs(w.centerline.b.x - w.centerline.a.x);
  const dy = Math.abs(w.centerline.b.y - w.centerline.a.y);
  const ang = Math.atan2(dy, dx) * (180 / Math.PI);
  if (ang < 22.5 || ang > 157.5) return 'horizontal';
  if (ang > 67.5 && ang < 112.5) return 'vertical';
  return 'diagonal';
}

function orderedEndpoints(a: { x: number; y: number }, b: { x: number; y: number }) {
  const A = { x: rnd(a.x), y: rnd(a.y) };
  const B = { x: rnd(b.x), y: rnd(b.y) };
  // lexicographic: lower X first; tie -> lower Y
  if (A.x < B.x || (A.x === B.x && A.y <= B.y)) return [A, B];
  return [B, A];
}

const norm = (v: unknown): unknown => (v === undefined ? null : v);

export interface CanonicalWallRecord {
  physicalWallId: string;
  a: [number, number];
  b: [number, number];
  thickness: number;
  orientationClass: 'horizontal' | 'vertical' | 'diagonal';
}

function geometryRecord(w: PurePhysicalWall): CanonicalWallRecord {
  const [A, B] = orderedEndpoints(w.centerline.a, w.centerline.b);
  return {
    physicalWallId: w.physicalWallId,
    a: [A.x, A.y] as [number, number],
    b: [B.x, B.y] as [number, number],
    thickness: rnd(w.thickness),
    orientationClass: orientationClassOf(w),
  };
}

export function canonicalWallRecords(accepted: PurePhysicalWall[]): CanonicalWallRecord[] {
  return accepted
    .map(geometryRecord)
    .sort((x, y) => (x.physicalWallId < y.physicalWallId ? -1 : x.physicalWallId > y.physicalWallId ? 1 : 0));
}

/** Stable JSON: recursively sort object keys, no whitespace. Deterministic
 *  across runs (the canonical contract requires byte-identical output). */
function stableStringify(o: unknown): string {
  return JSON.stringify(sortKeys(o));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys(obj[k]);
        return acc;
      }, {});
  }
  return v;
}

export function acceptedGeometryHash(accepted: PurePhysicalWall[]): string {
  const recs = canonicalWallRecords(accepted).map((r) => ({
    physicalWallId: r.physicalWallId,
    a: r.a,
    b: r.b,
    thickness: r.thickness,
    orientationClass: r.orientationClass,
  }));
  return crypto.createHash('sha256').update(stableStringify(recs)).digest('hex').slice(0, 16);
}

export function acceptedEvidenceHash(accepted: PurePhysicalWall[]): string {
  const byId = new Map(accepted.map((w) => [w.physicalWallId, w]));
  const recs = canonicalWallRecords(accepted).map((r) => {
    const w = byId.get(r.physicalWallId)!;
    return {
      physicalWallId: r.physicalWallId,
      a: r.a,
      b: r.b,
      thickness: r.thickness,
      orientationClass: r.orientationClass,
      // --- evidence / provenance (stable, sorted, normalized) ---
      verdict: norm(w.verdict),
      evidenceTypes: [...(w.evidenceTypes ?? [])].sort(),
      sourceRootIds: [...(w.sourceRootIds ?? [])].sort(),
      sourceSubpathIds: [...(w.sourceSubpathIds ?? [])].sort(),
      sourceStrokeIds: [...(w.sourceStrokeIds ?? [])].sort(),
      connectivityClass: norm(w.connectivityClass),
      floatingClass: norm(w.floatingClass),
      perimeterContribution: norm(w.perimeterContribution),
      logicalWallRunId: norm(w.logicalWallRunId),
      isFragmentOfOpening: norm(w.isFragmentOfOpening),
      positiveEvidence: [...(w.positiveEvidence ?? [])].sort(),
      negativeEvidence: [...(w.negativeEvidence ?? [])].sort(),
    };
  });
  return crypto.createHash('sha256').update(stableStringify(recs)).digest('hex').slice(0, 16);
}

/**
 * Archive both canonical payloads to a JSON file so the two hashes can be
 * proven distinct (per Change Set 2 final closeout §1). Returns the file path.
 */
export function archiveCanonicalInputs(accepted: PurePhysicalWall[], outPath: string): {
  geometryPayloadHash: string;
  evidencePayloadHash: string;
  geometryHash: string;
  evidenceHash: string;
  payloadsDiffer: boolean;
} {
  const geoRecs = canonicalWallRecords(accepted).map((r) => ({
    physicalWallId: r.physicalWallId,
    a: r.a,
    b: r.b,
    thickness: r.thickness,
    orientationClass: r.orientationClass,
  }));
  const byId = new Map(accepted.map((w) => [w.physicalWallId, w]));
  const evRecs = canonicalWallRecords(accepted).map((r) => {
    const w = byId.get(r.physicalWallId)!;
    return {
      physicalWallId: r.physicalWallId,
      a: r.a,
      b: r.b,
      thickness: r.thickness,
      orientationClass: r.orientationClass,
      verdict: norm(w.verdict),
      evidenceTypes: [...(w.evidenceTypes ?? [])].sort(),
      sourceRootIds: [...(w.sourceRootIds ?? [])].sort(),
      sourceSubpathIds: [...(w.sourceSubpathIds ?? [])].sort(),
      sourceStrokeIds: [...(w.sourceStrokeIds ?? [])].sort(),
      connectivityClass: norm(w.connectivityClass),
      floatingClass: norm(w.floatingClass),
      perimeterContribution: norm(w.perimeterContribution),
      logicalWallRunId: norm(w.logicalWallRunId),
      isFragmentOfOpening: norm(w.isFragmentOfOpening),
      positiveEvidence: [...(w.positiveEvidence ?? [])].sort(),
      negativeEvidence: [...(w.negativeEvidence ?? [])].sort(),
    };
  });
  const geoStr = stableStringify(geoRecs);
  const evStr = stableStringify(evRecs);
  const payload = { geometryPayload: geoRecs, evidencePayload: evRecs };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  return {
    geometryPayloadHash: crypto.createHash('sha256').update(geoStr).digest('hex').slice(0, 16),
    evidencePayloadHash: crypto.createHash('sha256').update(evStr).digest('hex').slice(0, 16),
    geometryHash: acceptedGeometryHash(accepted),
    evidenceHash: acceptedEvidenceHash(accepted),
    payloadsDiffer: geoStr !== evStr,
  };
}

export function lineageStoreHash(store: LineageStore): string {
  const str = stableStringify(store.operations);
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

import type { Affine2, CircularArc, PdfVectorPrimitive } from './pdfFfeTypes';
import type { Vec2 } from './types';
import type { RadiusFamily, RadiusFamilyReport, RadiusReferenceBinding } from './models';

export function calibrateFromDoorArcs(
  arcs: readonly CircularArc[],
  targetNominalRadiusMm = 900
): { mmPerPdfUnit: number; averageArcRadiusPdf: number; transform: Affine2; report: RadiusFamilyReport } {
  const candidateArcCount = arcs ? arcs.length : 0;

  if (!arcs || !arcs.length) {
    throw new Error('No pre-isolated door arcs provided for scale calibration.');
  }

  // Filter 90-degree quadrant arcs (angle sweep ~ Math.PI / 2)
  const valid90Arcs = arcs
    .filter(a => Math.abs(Math.abs(a.endAngle - a.startAngle) - Math.PI / 2) <= 0.15 && a.radius > 0)
    .sort((a, b) => (a.sourceId || '').localeCompare(b.sourceId || ''));

  if (!valid90Arcs.length) {
    throw new Error('No valid 90-degree door arcs found in calibration candidate set.');
  }

  // Cluster 90-degree arcs by radius proximity (DBSCAN 1D clustering with 10% relative tolerance)
  const sortedByRadius = [...valid90Arcs].sort((a, b) => a.radius - b.radius);
  const clusters: CircularArc[][] = [];

  for (const arc of sortedByRadius) {
    let placed = false;
    for (const cluster of clusters) {
      const avgRadius = cluster.reduce((sum, x) => sum + x.radius, 0) / cluster.length;
      if (Math.abs(arc.radius - avgRadius) / avgRadius <= 0.10) {
        cluster.push(arc);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push([arc]);
    }
  }

  // Identify dominant cluster (largest arc count)
  clusters.sort((a, b) => b.length - a.length);
  const dominantCluster = clusters[0]!;

  const selectedInlierCount = dominantCluster.length;
  const rejectedCount = candidateArcCount - selectedInlierCount;
  const averageSelectedRadiusPdf = dominantCluster.reduce((s, a) => s + a.radius, 0) / selectedInlierCount;

  // Calculate StdDev and CV (Coefficient of Variation)
  const variance = dominantCluster.reduce((sum, a) => sum + Math.pow(a.radius - averageSelectedRadiusPdf, 2), 0) / selectedInlierCount;
  const stdDev = Math.sqrt(variance);
  const cv = averageSelectedRadiusPdf > 0 ? stdDev / averageSelectedRadiusPdf : 0;

  const resultingMmPerPdfUnit = targetNominalRadiusMm / averageSelectedRadiusPdf;

  // Use neutral family identifiers without encoding physical dimensions (e.g. radius_family_001)
  const families: RadiusFamily[] = clusters.map((cluster, idx) => {
    const isDom = cluster === dominantCluster;
    const familyId = `radius_family_${String(idx + 1).padStart(3, '0')}`;
    const avgR = cluster.reduce((s, a) => s + a.radius, 0) / cluster.length;
    const v = cluster.reduce((sum, a) => sum + Math.pow(a.radius - avgR, 2), 0) / cluster.length;
    const sd = Math.sqrt(v);
    const estMm = Math.round(avgR * resultingMmPerPdfUnit);

    const referenceBinding: RadiusReferenceBinding = isDom ? {
      familyId,
      declaredPhysicalRadiusMm: targetNominalRadiusMm,
      bindingSource: 'project-door-standard',
      isKnownBeforeCalibration: false,
    } : {
      familyId,
      declaredPhysicalRadiusMm: estMm,
      bindingSource: 'inferred-post-calibration',
      isKnownBeforeCalibration: false,
    };

    return {
      familyId,
      nominalRadiusMm: estMm,
      arcsCount: cluster.length,
      averageArcRadiusPdf: avgR,
      stdDevRadiusPdf: sd,
      coefficientOfVariation: avgR > 0 ? sd / avgR : 0,
      arcs: cluster,
      isDominant: isDom,
      referenceBinding,
    };
  });

  const report: RadiusFamilyReport = {
    candidateArcCount,
    families,
    selectedFamily: families[0] || null,
    selectedInlierCount,
    rejectedCount,
    averageSelectedRadiusPdf,
    coefficientOfVariation: cv,
    resultingMmPerPdfUnit,
    isValid: true,
  };

  const transform: Affine2 = {
    a: resultingMmPerPdfUnit,
    b: 0,
    c: 0,
    d: resultingMmPerPdfUnit,
    tx: 0,
    ty: 0,
  };

  return {
    mmPerPdfUnit: resultingMmPerPdfUnit,
    averageArcRadiusPdf: averageSelectedRadiusPdf,
    transform,
    report,
  };
}

export function transformPoint(p: Vec2, t: Affine2): Vec2 {
  return {
    x: t.a * p.x + t.c * p.y + t.tx,
    y: t.b * p.x + t.d * p.y + t.ty,
  };
}

export function transformPrimitive(p: PdfVectorPrimitive, t: Affine2): PdfVectorPrimitive {
  return {
    ...p,
    points: p.points.map(x => transformPoint(x, t)),
  };
}

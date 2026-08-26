import type { FfeInstance, ClusterCatalogBinding } from './pdfFfeTypes';

export interface AuthoritativeCatalogEntry {
  catalogId: string;
  name: string;
  category: string;
  assetUrl: string;
  dimensionsMetres: [number, number, number]; // [width, length, height] in metres
  dimensionsMm: [number, number, number];    // [width, length, height] in mm
  pivotOffsetMetres: [number, number, number];
  yawOffsetRad: number;
}

export const AUTHORITATIVE_CATALOG_MANIFEST: Record<string, AuthoritativeCatalogEntry> = {
  'OM-BED-SR-90X200': {
    catalogId: 'OM-BED-SR-90X200',
    name: 'Single Bed 90x200',
    category: 'Furniture/Beds',
    assetUrl: '/assets/models/om_bed_sr_90x200.glb',
    dimensionsMetres: [0.90, 2.00, 0.50],
    dimensionsMm: [900, 2000, 500],
    pivotOffsetMetres: [0, 0, 0],
    yawOffsetRad: 0,
  },
};

export function strictCatalogMatch(o: any, catalog: readonly any[], tol = 0.025): any | null {
  for (const p of catalog) {
    if (p.enabled === false) continue;
    if (p.descriptorToken && o.descriptor?.token && p.descriptorToken !== o.descriptor.token) continue;
    const [L, W] = p.dimensions;
    for (const swapped of [false, true]) {
      const l = swapped ? W : L;
      const w = swapped ? L : W;
      const dl = Math.abs((o.obb?.length ?? 2000) / (o.obb?.length > 100 ? 1000 : 1) - l);
      const dw = Math.abs((o.obb?.width ?? 900) / (o.obb?.width > 100 ? 1000 : 1) - w);
      if (dl <= tol && dw <= tol) {
        return { observationId: o.id, prototype: p, swapped, dimensionErrorMm: [dl * 1000, dw * 1000] };
      }
    }
  }
  return null;
}

export function asPascalItemNode(m: any, parentId: string) {
  return {
    object: 'node',
    id: `item_${(m.observationId || m.instanceId || '1').replace(/[^a-zA-Z0-9]/g, '_')}`,
    type: 'item',
    parentId,
    visible: true,
    name: m.prototype?.catalogId || 'Item',
    position: [m.matrix?.[12] || 0, m.matrix?.[13] || 0, m.matrix?.[14] || 0],
    rotation: [0, Math.atan2(m.matrix?.[1] || 0, m.matrix?.[0] || 1), 0],
    scale: [1, 1, 1],
    asset: {
      id: m.prototype?.catalogId || 'Item',
      name: m.prototype?.catalogId || 'Item',
      category: m.prototype?.category || 'Furniture',
      url: m.prototype?.assetUrl || '/assets/models/om_bed_sr_90x200.glb',
      dimensions: m.prototype?.dimensions || [0.9, 2.0, 0.5],
    },
    metadata: {
      source: 'deterministic-cad-ffe',
      descriptorToken: m.prototype?.descriptorToken,
      dimensionErrorMm: m.dimensionErrorMm,
      gpuMatrixColumnMajor: m.matrix,
    },
  };
}

export interface PascalItemNode {
  object: 'node';
  id: string;
  type: 'ItemNode';
  parentId: string;
  visible: boolean;
  name: string;
  position: [number, number, number]; // in Pascal scene metres [X, Y, Z]
  rotation: [number, number, number]; // Euler angles [rx, ry, rz]
  scale: [number, number, number];
  asset: {
    id: string;
    name: string;
    category: string;
    url: string;
    dimensions: [number, number, number];
  };
  metadata: {
    source: 'human-approved-pascal-ffe-binding';
    instanceId: string;
    patternId: string;
    topo64Hash: string;
    roomId: string;
    detectedObbMm: [number, number];
    detectedCenterMm: [number, number];
    userMappingProvenance: {
      mappedBy: string;
      mappedAt: string;
    };
    matrices: {
      auditMmColumnMajor4x4: number[];
      pascalSceneMetresColumnMajor4x4: number[];
    };
  };
}

export function buildColumnMajor4x4Metres(
  xM: number,
  zM: number,
  thetaRad: number,
  yOffsetM = 0
): number[] {
  const c = Math.cos(thetaRad);
  const s = Math.sin(thetaRad);
  const n = (v: number) => (Object.is(v, -0) ? 0 : v);
  // Pascal 3D Scene Column-Major Matrix (Y is vertical up, X/Z are floor plane)
  return [n(c), 0, n(s), 0, 0, 1, 0, 0, n(-s), 0, n(c), 0, xM, yOffsetM, zM, 1];
}

export function buildColumnMajor4x4Mm(xMm: number, yMm: number, thetaRad: number): number[] {
  const c = Math.cos(thetaRad);
  const s = Math.sin(thetaRad);
  const n = (v: number) => (Object.is(v, -0) ? 0 : v);
  return [n(c), n(s), 0, 0, n(-s), n(c), 0, 0, 0, 0, 1, 0, xMm, yMm, 0, 1];
}

export function validateFfeMaterializationBatch(
  binding: ClusterCatalogBinding,
  instances: readonly any[],
  structuralBaselineHashBefore: string,
  structuralBaselineHashAfter: string
): { isValid: boolean; reason?: string } {
  if (structuralBaselineHashBefore !== structuralBaselineHashAfter) {
    return { isValid: false, reason: 'STALE_STRUCTURAL_BASELINE_MUTATED' };
  }

  const asset = AUTHORITATIVE_CATALOG_MANIFEST[binding.catalogId];
  if (!asset) {
    return { isValid: false, reason: `UNREGISTERED_CATALOG_SKU: ${binding.catalogId}` };
  }

  if (instances.length === 0) {
    return { isValid: false, reason: 'ZERO_INSTANCES_TO_MATERIALIZE' };
  }

  for (const inst of instances) {
    const instW = inst.intrinsicWidthMm ?? inst.detectedObbMm?.[0];
    const instL = inst.intrinsicLengthMm ?? inst.detectedObbMm?.[1];

    const targetW = asset.dimensionsMm[0];
    const targetL = asset.dimensionsMm[1];

    const directMatch = Math.abs(instW - targetW) <= 25 && Math.abs(instL - targetL) <= 25;
    const swappedMatch = Math.abs(instW - targetL) <= 25 && Math.abs(instL - targetW) <= 25;

    if (!directMatch && !swappedMatch) {
      return {
        isValid: false,
        reason: `PHYSICAL_DIMENSION_MISMATCH: instance (${instW}x${instL}mm) vs asset (${targetW}x${targetL}mm) exceeds 25mm tolerance`,
      };
    }
  }

  return { isValid: true };
}

export function materializePatternToItemNodes(
  binding: ClusterCatalogBinding,
  instances: readonly any[],
  levelId = 'level_ground'
): PascalItemNode[] {
  const asset = AUTHORITATIVE_CATALOG_MANIFEST[binding.catalogId];
  if (!asset) {
    throw new Error(`Cannot materialize unknown catalog SKU: ${binding.catalogId}`);
  }

  const itemNodes: PascalItemNode[] = [];

  for (const inst of instances) {
    const centerMm = inst.centerMm ?? inst.detectedCenterMm;
    const theta = (inst.theta ?? inst.orientationRad ?? 0) + asset.yawOffsetRad;

    // Convert local mm to Pascal scene metres (50.334 mmPerPdfUnit -> local mm -> metres / 1000)
    const xM = centerMm.x / 1000 + asset.pivotOffsetMetres[0];
    const zM = centerMm.y / 1000 + asset.pivotOffsetMetres[2];
    const yM = asset.pivotOffsetMetres[1];

    const auditMmMatrix = buildColumnMajor4x4Mm(centerMm.x, centerMm.y, theta);
    const pascalSceneMatrix = buildColumnMajor4x4Metres(xM, zM, theta, yM);

    itemNodes.push({
      object: 'node',
      id: `item_${inst.instanceId.replace(/[^a-zA-Z0-9]/g, '_')}`,
      type: 'item' as any,
      parentId: levelId,
      visible: true,
      name: `${asset.catalogId} (${inst.instanceId})`,
      position: [xM, yM, zM],
      rotation: [0, theta, 0],
      scale: [1, 1, 1],
      asset: {
        id: asset.catalogId,
        name: asset.name,
        category: asset.category,
        url: asset.assetUrl,
        dimensions: asset.dimensionsMetres,
      },
      metadata: {
        source: 'human-approved-pascal-ffe-binding',
        instanceId: inst.instanceId,
        patternId: binding.clusterId,
        topo64Hash: binding.topologicalHash,
        roomId: inst.roomId,
        detectedObbMm: [inst.intrinsicWidthMm ?? 900, inst.intrinsicLengthMm ?? 2000],
        detectedCenterMm: [centerMm.x, centerMm.y],
        userMappingProvenance: {
          mappedBy: binding.mappedBy ?? 'human-operator',
          mappedAt: binding.mappedAt ?? new Date().toISOString(),
        },
        matrices: {
          auditMmColumnMajor4x4: auditMmMatrix,
          pascalSceneMetresColumnMajor4x4: pascalSceneMatrix,
        },
      },
    });
  }

  return itemNodes;
}

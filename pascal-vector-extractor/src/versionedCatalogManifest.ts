export interface VersionedCatalogManifestEntry {
  schemaVersion: '1.0.0';
  catalogId: string;
  name: string;
  category: string;
  assetUrl: string;
  glbSha256: string;
  measuredXyzBoundsMetres: [number, number, number]; // [width, height, length] in GLB space
  logicalDimensionsMetres: [number, number, number]; // [width, length, height] in floor plane space
  logicalDimensionsMm: [number, number, number];
  attachmentTarget: 'floor' | 'wall' | 'ceiling';
  pivotOffsetMetres: [number, number, number];
  forwardAxis: '+Z';
  intrinsicYawOffsetRad: number;
  enabled: boolean;
}

export const VERSIONED_CATALOGUE_MANIFEST_V1: Record<string, VersionedCatalogManifestEntry> = {
  'OM-BED-SR-90X200': {
    schemaVersion: '1.0.0',
    catalogId: 'OM-BED-SR-90X200',
    name: 'Single Bed 90x200',
    category: 'Furniture/Beds',
    assetUrl: '/assets/models/om_bed_sr_90x200.glb',
    glbSha256: '50889ef796a0cfe9a4c23b950df9a2d8b83fc8a8e6528e561e8a356b0f2fe35f',
    measuredXyzBoundsMetres: [0.90, 0.50, 2.00],
    logicalDimensionsMetres: [0.90, 2.00, 0.50],
    logicalDimensionsMm: [900, 2000, 500],
    attachmentTarget: 'floor',
    pivotOffsetMetres: [0, 0, 0],
    forwardAxis: '+Z',
    intrinsicYawOffsetRad: 0.0,
    enabled: true,
  },
};

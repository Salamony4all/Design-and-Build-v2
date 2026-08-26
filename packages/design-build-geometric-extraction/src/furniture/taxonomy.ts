// CS4 FF&E sector taxonomy (isolated — no production imports).
export type SectorId =
  | 'workplace' | 'residential' | 'education' | 'healthcare' | 'hospitality'
  | 'retail' | 'accommodation' | 'public' | 'industrial' | 'mixed-use' | 'custom';

export type ScopeClass =
  | 'loose-ffe' | 'built-in-joinery' | 'kitchen-equipment' | 'appliance'
  | 'sanitary' | 'specialist-equipment' | 'technology-av' | 'lighting' | 'accessory';

export type FfeCategory =
  | 'sleeping' | 'seating' | 'tables-work-surfaces' | 'storage' | 'workstations'
  | 'casegoods' | 'kitchen-cabinetry' | 'kitchen-worktops' | 'kitchen-appliances'
  | 'education-equipment' | 'healthcare-equipment' | 'technology-av' | 'lighting'
  | 'accessories' | 'specialist-equipment' | 'unclassified';

export type ProductType =
  | 'single-bed' | 'bunk-bed' | 'sofa' | 'lounge-chair' | 'task-chair' | 'visitor-chair'
  | 'dining-chair' | 'stool' | 'bench'
  | 'desk' | 'workstation' | 'meeting-table' | 'dining-table' | 'coffee-table' | 'side-table'
  | 'wardrobe' | 'locker' | 'filing-cabinet' | 'storage-cabinet' | 'bookshelf' | 'pedestal'
  | 'base-cabinet' | 'wall-cabinet' | 'tall-cabinet' | 'kitchen-island' | 'countertop' | 'sink-unit'
  | 'refrigerator' | 'cooker' | 'oven' | 'dishwasher' | 'washing-machine' | 'microwave' | 'extractor-hood'
  | 'generic-item';

export interface TaxonomyAssignment {
  sector: SectorId;
  spaceType?: string;
  category: FfeCategory;
  scope: ScopeClass;
  productType: ProductType;
  confidence: number;
  basis: string[];
}

export interface FfeIdentity {
  geometricFamilyId: string;
  semanticClass?: ProductType;
  pascalAssetId?: string;
  catalogueItemId?: string;
  boqItemId?: string;
}

export interface ConfidenceVector {
  geometry: number;
  recurrence: number;
  spaceContext: number;
  semantic: number;
  pascalAsset: number;
  catalogue: number;
}

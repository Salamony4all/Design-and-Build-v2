// CS4 sector dictionary — sector/space/product priors. Dimensions are in METERS.
import type { FfeCategory, ProductType, SectorId, ScopeClass } from './taxonomy.ts';

export interface SpaceProfile {
  id: string;
  labels: string[];
  preferred: ProductType[];
  categories: FfeCategory[];
}

export interface ProductPrior {
  productType: ProductType;
  category: FfeCategory;
  scope: ScopeClass;
  minWidth?: number;
  maxWidth?: number;
  minDepth?: number;
  maxDepth?: number;
  keywords: string[];
}

export interface SectorProfile {
  id: SectorId;
  displayName: string;
  priority: number;
  spaces: SpaceProfile[];
  products: ProductPrior[];
}

const p = (
  productType: ProductType, category: FfeCategory, scope: ScopeClass,
  keywords: string[], dims?: [number, number, number, number],
): ProductPrior => ({
  productType, category, scope, keywords,
  ...(dims ? { minWidth: dims[0], maxWidth: dims[1], minDepth: dims[2], maxDepth: dims[3] } : {}),
});

export const WORKPLACE: SectorProfile = {
  id: 'workplace',
  displayName: 'Workplace / Office',
  priority: 100,
  spaces: [
    { id: 'open-office', labels: ['open office', 'workspace', 'work area'], preferred: ['workstation', 'task-chair', 'pedestal'], categories: ['workstations', 'seating', 'storage'] },
    { id: 'private-office', labels: ['private office', 'manager office'], preferred: ['desk', 'task-chair', 'visitor-chair', 'storage-cabinet'], categories: ['tables-work-surfaces', 'seating', 'storage'] },
    { id: 'meeting-room', labels: ['meeting room', 'boardroom', 'conference'], preferred: ['meeting-table', 'visitor-chair'], categories: ['tables-work-surfaces', 'seating', 'technology-av'] },
    { id: 'reception', labels: ['reception', 'waiting'], preferred: ['desk', 'lounge-chair', 'sofa', 'side-table'], categories: ['workstations', 'seating', 'tables-work-surfaces'] },
    { id: 'pantry', labels: ['pantry', 'tea point', 'breakout kitchen'], preferred: ['base-cabinet', 'wall-cabinet', 'countertop', 'sink-unit', 'refrigerator', 'microwave'], categories: ['kitchen-cabinetry', 'kitchen-worktops', 'kitchen-appliances'] },
  ],
  products: [
    p('workstation', 'workstations', 'loose-ffe', ['workstation', 'bench desk'], [0.9, 2.4, 0.55, 1.6]),
    p('desk', 'tables-work-surfaces', 'loose-ffe', ['desk', 'reception desk', 'writing desk'], [0.9, 3.0, 0.5, 1.2]),
    p('task-chair', 'seating', 'loose-ffe', ['task chair', 'operator chair'], [0.45, 0.85, 0.45, 0.85]),
    p('visitor-chair', 'seating', 'loose-ffe', ['visitor chair', 'meeting chair'], [0.4, 0.85, 0.4, 0.85]),
    p('meeting-table', 'tables-work-surfaces', 'loose-ffe', ['meeting table', 'boardroom table', 'conference table'], [1.2, 6, 0.7, 2]),
    p('sofa', 'seating', 'loose-ffe', ['sofa', 'lounge sofa', 'settee'], [1.4, 2.6, 0.7, 1.1]),
    p('lounge-chair', 'seating', 'loose-ffe', ['lounge chair', 'armchair'], [0.6, 1.1, 0.6, 1.1]),
    p('side-table', 'tables-work-surfaces', 'loose-ffe', ['side table', 'occasional table'], [0.35, 0.8, 0.35, 0.8]),
    p('pedestal', 'storage', 'loose-ffe', ['mobile pedestal', 'pedestal'], [0.3, 0.65, 0.4, 0.8]),
    p('filing-cabinet', 'storage', 'loose-ffe', ['filing cabinet'], [0.35, 1.2, 0.35, 0.7]),
    p('storage-cabinet', 'storage', 'loose-ffe', ['storage cabinet', 'credenza'], [0.5, 2.4, 0.35, 0.8]),
  ],
};

export const RESIDENTIAL: SectorProfile = {
  id: 'residential',
  displayName: 'Residential',
  priority: 95,
  spaces: [
    { id: 'kitchen', labels: ['kitchen', 'open kitchen', 'galley kitchen'], preferred: ['base-cabinet', 'wall-cabinet', 'tall-cabinet', 'kitchen-island', 'countertop', 'sink-unit', 'refrigerator', 'cooker', 'oven', 'dishwasher', 'microwave', 'extractor-hood'], categories: ['kitchen-cabinetry', 'kitchen-worktops', 'kitchen-appliances'] },
    { id: 'bedroom', labels: ['bedroom', 'master bedroom'], preferred: ['single-bed', 'wardrobe', 'side-table'], categories: ['sleeping', 'storage', 'tables-work-surfaces'] },
    { id: 'living', labels: ['living room', 'family room'], preferred: ['sofa', 'lounge-chair', 'coffee-table', 'side-table'], categories: ['seating', 'tables-work-surfaces'] },
    { id: 'dining', labels: ['dining room', 'dining'], preferred: ['dining-table', 'dining-chair'], categories: ['tables-work-surfaces', 'seating'] },
    { id: 'study', labels: ['study', 'home office'], preferred: ['desk', 'task-chair', 'bookshelf'], categories: ['tables-work-surfaces', 'seating', 'storage'] },
  ],
  products: [
    // Built-in kitchen joinery
    p('base-cabinet', 'kitchen-cabinetry', 'built-in-joinery', ['base cabinet', 'floor unit'], [0.3, 1.2, 0.45, 0.75]),
    p('wall-cabinet', 'kitchen-cabinetry', 'built-in-joinery', ['wall cabinet', 'upper unit'], [0.3, 1.2, 0.25, 0.55]),
    p('tall-cabinet', 'kitchen-cabinetry', 'built-in-joinery', ['tall cabinet', 'tall unit', 'larder'], [0.3, 1.2, 0.45, 0.75]),
    p('kitchen-island', 'kitchen-cabinetry', 'built-in-joinery', ['island', 'peninsula'], [0.9, 4.5, 0.6, 1.5]),
    p('countertop', 'kitchen-worktops', 'built-in-joinery', ['countertop', 'worktop'], [0.3, 8, 0.45, 1.5]),
    p('sink-unit', 'kitchen-cabinetry', 'built-in-joinery', ['sink unit', 'sink base', 'sink cabinet'], [0.45, 1.5, 0.45, 0.8]),
    // Appliances
    p('refrigerator', 'kitchen-appliances', 'appliance', ['fridge', 'refrigerator'], [0.45, 1.2, 0.45, 0.9]),
    p('cooker', 'kitchen-appliances', 'appliance', ['cooker', 'range'], [0.45, 1.2, 0.45, 0.9]),
    p('oven', 'kitchen-appliances', 'appliance', ['oven'], [0.45, 0.9, 0.45, 0.8]),
    p('dishwasher', 'kitchen-appliances', 'appliance', ['dishwasher'], [0.4, 0.75, 0.45, 0.75]),
    p('microwave', 'kitchen-appliances', 'appliance', ['microwave'], [0.3, 0.8, 0.25, 0.6]),
    p('extractor-hood', 'kitchen-appliances', 'appliance', ['hood', 'extractor'], [0.45, 1.5, 0.25, 0.75]),
    // Loose FF&E
    p('dining-table', 'tables-work-surfaces', 'loose-ffe', ['dining table'], [1.2, 2.6, 0.75, 1.3]),
    p('dining-chair', 'seating', 'loose-ffe', ['dining chair'], [0.4, 0.65, 0.4, 0.65]),
    p('sofa', 'seating', 'loose-ffe', ['sofa'], [1.4, 2.6, 0.7, 1.1]),
    p('single-bed', 'sleeping', 'loose-ffe', ['single bed', 'bed'], [0.75, 1.2, 1.7, 2.3]),
    p('wardrobe', 'storage', 'loose-ffe', ['wardrobe'], [0.45, 1.8, 0.35, 0.8]),
  ],
};

export const ACCOMMODATION: SectorProfile = {
  id: 'accommodation',
  displayName: 'Accommodation / Staff Housing',
  priority: 90,
  spaces: [
    { id: 'six-bed-unit', labels: ['6 bed unit', 'six-bed unit', 'dormitory'], preferred: ['single-bed', 'wardrobe'], categories: ['sleeping', 'storage'] },
  ],
  products: [
    // Single bed: width 0.75-1.2 m, depth (length) 1.7-2.3 m — CS4 requirement.
    p('single-bed', 'sleeping', 'loose-ffe', ['single bed', 'bed'], [0.75, 1.2, 1.7, 2.3]),
    p('bunk-bed', 'sleeping', 'loose-ffe', ['bunk bed', 'bunk'], [0.75, 1.2, 1.7, 2.3]),
    p('wardrobe', 'storage', 'loose-ffe', ['wardrobe'], [0.45, 1.8, 0.35, 0.8]),
    p('locker', 'storage', 'loose-ffe', ['locker'], [0.3, 0.6, 0.3, 0.6]),
  ],
};

const simple = (id: SectorId, name: string): SectorProfile => ({ id, displayName: name, priority: 50, spaces: [], products: [] });

export const SECTOR_DICTIONARY: Record<SectorId, SectorProfile> = {
  workplace: WORKPLACE,
  residential: RESIDENTIAL,
  accommodation: ACCOMMODATION,
  education: simple('education', 'Education'),
  healthcare: simple('healthcare', 'Healthcare'),
  hospitality: simple('hospitality', 'Hospitality'),
  retail: simple('retail', 'Retail'),
  public: simple('public', 'Public / Government'),
  industrial: simple('industrial', 'Industrial'),
  'mixed-use': simple('mixed-use', 'Mixed Use'),
  custom: simple('custom', 'Custom'),
};

export const getSectorProfile = (id: SectorId): SectorProfile => SECTOR_DICTIONARY[id];

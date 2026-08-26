// packages/extraction-ai/src/pascal-furniture-catalog.ts
// Canonical Furniture Ontology & Pascal Asset Resolution.

export type FurnitureCategory =
  | 'beds'
  | 'seating'
  | 'tables'
  | 'storage'
  | 'appliances'
  | 'plumbing'
  | 'electronics'
  | 'decorations'
  | 'plants'
  | 'misc';

export type PlacementClass = 'free-standing' | 'wall-aligned' | 'corner' | 'floor-decor';

export interface CanonicalFurnitureFamily {
  familyId: string;
  slug: string;
  label: string;
  category: FurnitureCategory;
  defaultDimensionsM: [number, number, number]; // width, depth, height
  dimensionRangeM: {
    minWidthM: number;
    maxWidthM: number;
    minDepthM: number;
    maxDepthM: number;
  };
  placementClass: PlacementClass;
  wallAligned: boolean;
  rotationPolicy: 'free' | 'wall-tangent' | 'cardinal';
  supportType: 'floor' | 'wall' | 'table-top';
  aliases: readonly string[];
}

export const CANONICAL_FURNITURE_FAMILIES: readonly CanonicalFurnitureFamily[] = [
  // ── Beds ──
  {
    familyId: 'BED_SINGLE',
    slug: 'single-bed',
    label: 'Single Bed',
    category: 'beds',
    defaultDimensionsM: [0.9, 2.0, 0.45],
    dimensionRangeM: { minWidthM: 0.8, maxWidthM: 1.2, minDepthM: 1.8, maxDepthM: 2.2 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['single bed', 'single-bed', 'twin bed', 'twin-bed', 'bed single', 'cot'],
  },
  {
    familyId: 'BED_DOUBLE',
    slug: 'double-bed',
    label: 'Double Bed',
    category: 'beds',
    defaultDimensionsM: [1.8, 2.0, 0.55],
    dimensionRangeM: { minWidthM: 1.4, maxWidthM: 2.2, minDepthM: 1.9, maxDepthM: 2.2 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['double bed', 'double-bed', 'queen bed', 'queen-bed', 'king bed', 'king-bed', 'master bed', 'bed'],
  },
  {
    familyId: 'BED_BUNK',
    slug: 'bunkbed',
    label: 'Bunk Bed',
    category: 'beds',
    defaultDimensionsM: [1.0, 2.0, 1.6],
    dimensionRangeM: { minWidthM: 0.8, maxWidthM: 1.2, minDepthM: 1.8, maxDepthM: 2.2 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['bunkbed', 'bunk bed', 'bunk-bed', 'double deck bed'],
  },

  // ── Tables & Desks ──
  {
    familyId: 'DESK',
    slug: 'desk',
    label: 'Desk',
    category: 'tables',
    defaultDimensionsM: [1.2, 0.7, 0.75],
    dimensionRangeM: { minWidthM: 0.8, maxWidthM: 1.8, minDepthM: 0.5, maxDepthM: 0.9 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['desk', 'work desk', 'study desk', 'writing desk', 'office desk'],
  },
  {
    familyId: 'OFFICE_TABLE',
    slug: 'office-table',
    label: 'Office Table',
    category: 'tables',
    defaultDimensionsM: [1.4, 0.7, 0.75],
    dimensionRangeM: { minWidthM: 1.0, maxWidthM: 2.0, minDepthM: 0.6, maxDepthM: 1.0 },
    placementClass: 'free-standing',
    wallAligned: false,
    rotationPolicy: 'free',
    supportType: 'floor',
    aliases: ['office table', 'office-table', 'workstation', 'cubicle desk'],
  },
  {
    familyId: 'MEETING_TABLE',
    slug: 'meeting-table',
    label: 'Meeting Table',
    category: 'tables',
    defaultDimensionsM: [2.4, 1.1, 0.75],
    dimensionRangeM: { minWidthM: 1.6, maxWidthM: 4.0, minDepthM: 0.9, maxDepthM: 1.6 },
    placementClass: 'free-standing',
    wallAligned: false,
    rotationPolicy: 'free',
    supportType: 'floor',
    aliases: ['meeting table', 'meeting-table', 'conference table', 'boardroom table'],
  },
  {
    familyId: 'DINING_TABLE',
    slug: 'dining-table',
    label: 'Dining Table',
    category: 'tables',
    defaultDimensionsM: [1.6, 0.9, 0.75],
    dimensionRangeM: { minWidthM: 1.0, maxWidthM: 2.4, minDepthM: 0.7, maxDepthM: 1.2 },
    placementClass: 'free-standing',
    wallAligned: false,
    rotationPolicy: 'free',
    supportType: 'floor',
    aliases: ['dining table', 'dining-table', 'pantry table', 'pantry-table', 'table'],
  },
  {
    familyId: 'COFFEE_TABLE',
    slug: 'coffee-table',
    label: 'Coffee Table',
    category: 'tables',
    defaultDimensionsM: [1.1, 0.6, 0.4],
    dimensionRangeM: { minWidthM: 0.6, maxWidthM: 1.5, minDepthM: 0.4, maxDepthM: 0.9 },
    placementClass: 'free-standing',
    wallAligned: false,
    rotationPolicy: 'free',
    supportType: 'floor',
    aliases: ['coffee table', 'coffee-table', 'center table', 'tea table'],
  },
  {
    familyId: 'BEDSIDE_TABLE',
    slug: 'bedside-table',
    label: 'Bedside Table',
    category: 'tables',
    defaultDimensionsM: [0.5, 0.45, 0.5],
    dimensionRangeM: { minWidthM: 0.35, maxWidthM: 0.65, minDepthM: 0.35, maxDepthM: 0.6 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['bedside table', 'bedside-table', 'nightstand', 'night stand', 'side table', 'side-table'],
  },

  // ── Seating ──
  {
    familyId: 'OFFICE_CHAIR',
    slug: 'office-chair',
    label: 'Office Chair',
    category: 'seating',
    defaultDimensionsM: [0.65, 0.65, 0.95],
    dimensionRangeM: { minWidthM: 0.5, maxWidthM: 0.8, minDepthM: 0.5, maxDepthM: 0.8 },
    placementClass: 'free-standing',
    wallAligned: false,
    rotationPolicy: 'free',
    supportType: 'floor',
    aliases: ['office chair', 'office-chair', 'task chair', 'desk chair', 'swivel chair', 'chair'],
  },
  {
    familyId: 'DINING_CHAIR',
    slug: 'dining-chair',
    label: 'Dining Chair',
    category: 'seating',
    defaultDimensionsM: [0.5, 0.55, 0.9],
    dimensionRangeM: { minWidthM: 0.4, maxWidthM: 0.65, minDepthM: 0.4, maxDepthM: 0.65 },
    placementClass: 'free-standing',
    wallAligned: false,
    rotationPolicy: 'free',
    supportType: 'floor',
    aliases: ['dining chair', 'dining-chair', 'side chair'],
  },
  {
    familyId: 'SOFA',
    slug: 'reception-sofa',
    label: 'Sofa',
    category: 'seating',
    defaultDimensionsM: [2.0, 0.85, 0.8],
    dimensionRangeM: { minWidthM: 1.5, maxWidthM: 2.6, minDepthM: 0.7, maxDepthM: 1.1 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['sofa', 'reception-sofa', 'reception sofa', 'three seat sofa', 'couch-medium', 'medium couch', 'couch'],
  },
  {
    familyId: 'LOUNGE_CHAIR',
    slug: 'livingroom-chair',
    label: 'Lounge Chair',
    category: 'seating',
    defaultDimensionsM: [0.8, 0.8, 0.85],
    dimensionRangeM: { minWidthM: 0.65, maxWidthM: 1.1, minDepthM: 0.65, maxDepthM: 1.1 },
    placementClass: 'free-standing',
    wallAligned: false,
    rotationPolicy: 'free',
    supportType: 'floor',
    aliases: ['lounge chair', 'lounge-chair', 'livingroom chair', 'livingroom-chair', 'armchair'],
  },
  {
    familyId: 'STOOL',
    slug: 'stool',
    label: 'Stool',
    category: 'seating',
    defaultDimensionsM: [0.4, 0.4, 0.45],
    dimensionRangeM: { minWidthM: 0.3, maxWidthM: 0.55, minDepthM: 0.3, maxDepthM: 0.55 },
    placementClass: 'free-standing',
    wallAligned: false,
    rotationPolicy: 'free',
    supportType: 'floor',
    aliases: ['stool', 'bar stool', 'barstool', 'bean bag', 'bean-bag'],
  },

  // ── Storage ──
  {
    familyId: 'CLOSET',
    slug: 'closet',
    label: 'Closet',
    category: 'storage',
    defaultDimensionsM: [1.5, 0.6, 2.1],
    dimensionRangeM: { minWidthM: 0.8, maxWidthM: 3.0, minDepthM: 0.5, maxDepthM: 0.8 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['closet', 'wardrobe', 'cupboard', 'clothes closet', 'fitted wardrobe'],
  },
  {
    familyId: 'BOOKSHELF',
    slug: 'bookshelf',
    label: 'Bookshelf',
    category: 'storage',
    defaultDimensionsM: [1.0, 0.35, 2.0],
    dimensionRangeM: { minWidthM: 0.6, maxWidthM: 2.0, minDepthM: 0.25, maxDepthM: 0.5 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['bookshelf', 'book shelf', 'bookcase', 'storage shelf', 'shelf'],
  },
  {
    familyId: 'DRESSER',
    slug: 'dresser',
    label: 'Dresser',
    category: 'storage',
    defaultDimensionsM: [1.2, 0.5, 1.0],
    dimensionRangeM: { minWidthM: 0.8, maxWidthM: 1.8, minDepthM: 0.4, maxDepthM: 0.65 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['dresser', 'chest of drawers', 'drawers', 'sideboard'],
  },
  {
    familyId: 'CABINET',
    slug: 'cabinet',
    label: 'Cabinet',
    category: 'storage',
    defaultDimensionsM: [0.9, 0.5, 0.9],
    dimensionRangeM: { minWidthM: 0.5, maxWidthM: 1.8, minDepthM: 0.35, maxDepthM: 0.7 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['cabinet', 'storage cabinet', 'credenza', 'pantry'],
  },
  {
    familyId: 'LOCKER',
    slug: 'locker',
    label: 'Locker',
    category: 'storage',
    defaultDimensionsM: [0.5, 0.5, 1.8],
    dimensionRangeM: { minWidthM: 0.35, maxWidthM: 1.2, minDepthM: 0.35, maxDepthM: 0.6 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['locker', 'lockers', 'staff locker', 'gym locker'],
  },

  // ── Kitchen & Sanitary ──
  {
    familyId: 'KITCHEN_COUNTER',
    slug: 'kitchen-counter',
    label: 'Kitchen Counter',
    category: 'storage',
    defaultDimensionsM: [2.0, 0.6, 0.9],
    dimensionRangeM: { minWidthM: 1.0, maxWidthM: 4.0, minDepthM: 0.5, maxDepthM: 0.8 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['kitchen counter', 'kitchen-counter', 'countertop', 'kitchen countertop', 'kitchen island'],
  },
  {
    familyId: 'KITCHEN_CABINET',
    slug: 'kitchen-cabinet',
    label: 'Kitchen Cabinet',
    category: 'storage',
    defaultDimensionsM: [0.6, 0.6, 0.9],
    dimensionRangeM: { minWidthM: 0.4, maxWidthM: 1.2, minDepthM: 0.4, maxDepthM: 0.7 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['kitchen cabinet', 'kitchen-cabinet', 'kitchen cupboard', 'kitchen-shelf'],
  },
  {
    familyId: 'FRIDGE',
    slug: 'kitchen-fridge',
    label: 'Refrigerator',
    category: 'appliances',
    defaultDimensionsM: [0.8, 0.75, 1.8],
    dimensionRangeM: { minWidthM: 0.6, maxWidthM: 1.2, minDepthM: 0.6, maxDepthM: 0.9 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['fridge', 'kitchen fridge', 'kitchen-fridge', 'refrigerator', 'freezer'],
  },
  {
    familyId: 'STOVE',
    slug: 'stove',
    label: 'Stove',
    category: 'appliances',
    defaultDimensionsM: [0.6, 0.65, 0.9],
    dimensionRangeM: { minWidthM: 0.5, maxWidthM: 1.0, minDepthM: 0.5, maxDepthM: 0.8 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['stove', 'cooktop', 'range', 'oven', 'cooker'],
  },
  {
    familyId: 'TOILET',
    slug: 'toilet',
    label: 'Toilet',
    category: 'plumbing',
    defaultDimensionsM: [0.4, 0.7, 0.7],
    dimensionRangeM: { minWidthM: 0.35, maxWidthM: 0.55, minDepthM: 0.55, maxDepthM: 0.85 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['toilet', 'wc', 'water closet', 'commode'],
  },
  {
    familyId: 'BATHROOM_SINK',
    slug: 'bathroom-sink',
    label: 'Bathroom Sink',
    category: 'plumbing',
    defaultDimensionsM: [0.65, 0.5, 0.85],
    dimensionRangeM: { minWidthM: 0.4, maxWidthM: 1.2, minDepthM: 0.35, maxDepthM: 0.65 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['bathroom sink', 'bathroom-sink', 'sink cabinet', 'sink-cabinet', 'wash basin', 'basin', 'wall-sink', 'kitchen-sink'],
  },
  {
    familyId: 'BATHTUB',
    slug: 'bathtub',
    label: 'Bathtub',
    category: 'plumbing',
    defaultDimensionsM: [0.8, 1.7, 0.6],
    dimensionRangeM: { minWidthM: 0.7, maxWidthM: 1.1, minDepthM: 1.4, maxDepthM: 2.0 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['bathtub', 'bath tub', 'tub'],
  },
  {
    familyId: 'SHOWER_SQUARE',
    slug: 'shower-square',
    label: 'Square Shower',
    category: 'plumbing',
    defaultDimensionsM: [1.0, 1.0, 2.1],
    dimensionRangeM: { minWidthM: 0.8, maxWidthM: 1.4, minDepthM: 0.8, maxDepthM: 1.4 },
    placementClass: 'corner',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['shower square', 'shower-square', 'shower', 'shower enclosure'],
  },
  {
    familyId: 'SHOWER_CORNER',
    slug: 'shower-angle',
    label: 'Corner Shower',
    category: 'plumbing',
    defaultDimensionsM: [1.0, 1.0, 2.1],
    dimensionRangeM: { minWidthM: 0.8, maxWidthM: 1.4, minDepthM: 0.8, maxDepthM: 1.4 },
    placementClass: 'corner',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'floor',
    aliases: ['shower angle', 'shower-angle', 'corner shower', 'angle shower'],
  },

  // ── Electronics & Decor ──
  {
    familyId: 'TELEVISION',
    slug: 'flat-screen-tv',
    label: 'Television',
    category: 'electronics',
    defaultDimensionsM: [1.2, 0.08, 0.7],
    dimensionRangeM: { minWidthM: 0.8, maxWidthM: 2.0, minDepthM: 0.05, maxDepthM: 0.2 },
    placementClass: 'wall-aligned',
    wallAligned: true,
    rotationPolicy: 'wall-tangent',
    supportType: 'wall',
    aliases: ['television', 'flat-screen-tv', 'tv', 'flat screen tv'],
  },
  {
    familyId: 'COMPUTER',
    slug: 'computer',
    label: 'Computer',
    category: 'electronics',
    defaultDimensionsM: [0.6, 0.4, 0.45],
    dimensionRangeM: { minWidthM: 0.4, maxWidthM: 0.9, minDepthM: 0.2, maxDepthM: 0.6 },
    placementClass: 'free-standing',
    wallAligned: false,
    rotationPolicy: 'free',
    supportType: 'table-top',
    aliases: ['computer', 'pc', 'monitor', 'desktop computer'],
  },
  {
    familyId: 'INDOOR_PLANT',
    slug: 'indoor-plant',
    label: 'Indoor Plant',
    category: 'plants',
    defaultDimensionsM: [0.5, 0.5, 1.2],
    dimensionRangeM: { minWidthM: 0.3, maxWidthM: 1.0, minDepthM: 0.3, maxDepthM: 1.0 },
    placementClass: 'free-standing',
    wallAligned: false,
    rotationPolicy: 'free',
    supportType: 'floor',
    aliases: ['indoor plant', 'indoor-plant', 'potted plant', 'plant', 'bush', 'palm', 'cactus', 'tree'],
  },
  {
    familyId: 'CARPET_RECTANGULAR',
    slug: 'rectangular-carpet',
    label: 'Rectangular Carpet',
    category: 'decorations',
    defaultDimensionsM: [2.0, 1.4, 0.02],
    dimensionRangeM: { minWidthM: 1.0, maxWidthM: 4.0, minDepthM: 0.8, maxDepthM: 3.0 },
    placementClass: 'floor-decor',
    wallAligned: false,
    rotationPolicy: 'free',
    supportType: 'floor',
    aliases: ['rectangular carpet', 'rectangular-carpet', 'rug', 'carpet', 'rectangular rug'],
  },
  {
    familyId: 'CARPET_ROUND',
    slug: 'round-carpet',
    label: 'Round Carpet',
    category: 'decorations',
    defaultDimensionsM: [1.5, 1.5, 0.02],
    dimensionRangeM: { minWidthM: 0.8, maxWidthM: 3.0, minDepthM: 0.8, maxDepthM: 3.0 },
    placementClass: 'floor-decor',
    wallAligned: false,
    rotationPolicy: 'free',
    supportType: 'floor',
    aliases: ['round carpet', 'round-carpet', 'round rug', 'circular carpet'],
  },
];

const normalize = (v: string) =>
  (v || '')
    .toLowerCase()
    .replace(/^catalog:/, '')
    .replace(/[_\s-]+/g, ' ')
    .trim();

export interface FurnitureResolutionResult {
  family: CanonicalFurnitureFamily | null;
  slug: string;
  label: string;
  category: FurnitureCategory;
  defaultDimensionsM: [number, number, number];
  confidence: number;
  reason: 'EXACT' | 'ALIAS' | 'CONTROLLED_PATTERN' | 'GENERIC_FALLBACK';
}

export interface PascalFurnitureLegacyDef {
  slug: string;
  label: string;
  category: string;
  widthM: number;
  depthM: number;
  heightM: number;
  aliases: readonly string[];
}

export interface FurnitureResolutionResult {
  family: CanonicalFurnitureFamily | null;
  def: PascalFurnitureLegacyDef | null;
  slug: string;
  label: string;
  category: FurnitureCategory;
  defaultDimensionsM: [number, number, number];
  confidence: number;
  reason: 'EXACT' | 'ALIAS' | 'CONTROLLED_PATTERN' | 'GENERIC_FALLBACK';
}

function makeLegacyDef(family: CanonicalFurnitureFamily | null): PascalFurnitureLegacyDef | null {
  if (!family) return null;
  return {
    slug: family.slug,
    label: family.label,
    category: family.category,
    widthM: family.defaultDimensionsM[0],
    depthM: family.defaultDimensionsM[1],
    heightM: family.defaultDimensionsM[2],
    aliases: family.aliases,
  };
}

export function resolvePascalFurniture(rawType: string): FurnitureResolutionResult {
  const q = normalize(rawType);
  if (!q) {
    return {
      family: null,
      def: null,
      slug: 'misc-item',
      label: 'Unknown Item',
      category: 'misc',
      defaultDimensionsM: [1.0, 1.0, 0.8],
      confidence: 0,
      reason: 'GENERIC_FALLBACK',
    };
  }

  // 1. Exact slug or exact familyId match
  const exact = CANONICAL_FURNITURE_FAMILIES.find(
    (f) => normalize(f.slug) === q || normalize(f.familyId) === q,
  );
  if (exact) {
    return {
      family: exact,
      def: makeLegacyDef(exact),
      slug: exact.slug,
      label: exact.label,
      category: exact.category,
      defaultDimensionsM: exact.defaultDimensionsM,
      confidence: 1.0,
      reason: 'EXACT',
    };
  }

  // 2. Exact alias match
  const aliasMatch = CANONICAL_FURNITURE_FAMILIES.find((f) =>
    f.aliases.some((a) => normalize(a) === q),
  );
  if (aliasMatch) {
    return {
      family: aliasMatch,
      def: makeLegacyDef(aliasMatch),
      slug: aliasMatch.slug,
      label: aliasMatch.label,
      category: aliasMatch.category,
      defaultDimensionsM: aliasMatch.defaultDimensionsM,
      confidence: 0.95,
      reason: 'ALIAS',
    };
  }

  // 3. Substring / Token Match Scoring
  const candidates = CANONICAL_FURNITURE_FAMILIES.map((family) => {
    const terms = [family.slug, family.label, ...family.aliases].map(normalize);
    const score = Math.max(
      ...terms.map((t) => {
        if (q === t) return 1.0;
        if (q.includes(t) || t.includes(q)) {
          return Math.min(q.length, t.length) / Math.max(q.length, t.length);
        }
        return 0;
      }),
    );
    return { family, score };
  }).sort((a, b) => b.score - a.score);

  if (candidates[0] && candidates[0].score >= 0.60) {
    const matched = candidates[0].family;
    return {
      family: matched,
      def: makeLegacyDef(matched),
      slug: matched.slug,
      label: matched.label,
      category: matched.category,
      defaultDimensionsM: matched.defaultDimensionsM,
      confidence: candidates[0].score,
      reason: 'CONTROLLED_PATTERN',
    };
  }

  // 4. Generic Fallback
  return {
    family: null,
    def: null,
    slug: rawType.toLowerCase().replace(/[s_]+/g, '-'),
    label: rawType,
    category: 'misc',
    defaultDimensionsM: [1.0, 1.0, 0.8],
    confidence: 0.3,
    reason: 'GENERIC_FALLBACK',
  };
}

export const PASCAL_FURNITURE = CANONICAL_FURNITURE_FAMILIES.map((f) => ({
  slug: f.slug,
  label: f.label,
  category: f.category,
  widthM: f.defaultDimensionsM[0],
  depthM: f.defaultDimensionsM[1],
  heightM: f.defaultDimensionsM[2],
  aliases: f.aliases,
}));

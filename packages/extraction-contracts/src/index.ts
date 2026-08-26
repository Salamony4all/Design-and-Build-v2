// design-build-extraction-contracts
// Neutral, serializable extraction result contracts.
// HARD RULE: this package must NOT import React, Pascal, Three.js or MuPDF.
// Pure MuPDF and Gemini both implement these contracts while keeping
// provider-specific evidence on the side.

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

/** A PDF page frame + scale, the basis for the shared coordinate frame. */
export interface DocumentFrame {
  pageId: string;
  pageBoundsPt: [number, number, number, number]; // [x0,y0,x1,y1] in PDF points
  scaleMmPerPt: number; // real-world mm per PDF point (from dim text or fallback)
  widthM: number; // page width in meters
  heightM: number; // page height in meters
  orientation: 'portrait' | 'landscape';
}

export interface Provenance {
  sourceKind: 'mupdf' | 'gemini' | 'mock';
  sourcePrimitiveIds: string[];
  confidence: number; // 0..1
  extractionType: string; // 'wall' | 'column' | 'window' | 'door' | 'slab' | ...
  note?: string;
}

export interface SlabContract {
  id: string;
  kind: 'slab';
  polygonM: Vec2[]; // closed loop, world meters (X,Z)
  thicknessM: number;
  elevationM: number;
  provenance: Provenance;
}

export interface WallContract {
  id: string;
  kind: 'wall';
  startM: Vec2; // world meters (X,Z)
  endM: Vec2;
  thicknessM: number;
  heightM: number;
  provenance: Provenance;
  /** Optional structured provenance bag (Change Set 2, §6): raw extracted
   *  fields retained for parity/audit without polluting the canonical shape. */
  metadata?: Record<string, unknown>;
}

export interface ColumnContract {
  id: string;
  kind: 'column';
  positionM: Vec2; // world meters (X,Z) center
  widthM: number;
  depthM: number;
  heightM: number;
  rotationDeg: number;
  provenance: Provenance;
}

export interface WindowContract {
  id: string;
  kind: 'window';
  wallId: string;
  startM: Vec2;
  endM: Vec2;
  sillM: number;
  headM: number;
  provenance: Provenance;
}

export interface DoorContract {
  id: string;
  kind: 'door';
  wallId: string;
  startM: Vec2;
  endM: Vec2;
  provenance: Provenance;
}

export interface FurnitureFamily {
  familyId: string;
  label: string;
  defaultWidthM: number;
  defaultDepthM: number;
  defaultHeightM: number;
  category: 'bed' | 'sanitary' | 'seating' | 'storage' | 'appliance' | 'other';
}

export interface FurnitureInstance {
  id: string;
  kind: 'furniture';
  familyId: string;
  positionM: Vec2;
  rotationDeg: number;
  widthM: number;
  depthM: number;
  heightM: number;
  provenance: Provenance;
}

export interface ReviewItem {
  id: string;
  kind: 'review';
  category: 'column' | 'wall-pier' | 'opening' | 'unknown';
  positionM: Vec2;
  sizeM: [number, number];
  reason: string;
  sourcePrimitiveIds: string[];
}

export interface RejectedItem {
  id: string;
  kind: 'rejected';
  reason: string;
  sourcePrimitiveIds: string[];
  /** Optional world-meter centre for visual debugging. */
  positionM?: Vec2;
}

export type AuditVerdict = 'accepted' | 'review' | 'rejected';

export interface ExtractionAudit {
  generatedAt: string;
  documentFrame: DocumentFrame;
  counts: { slab: number; walls: number; columns: number; windows: number; doors: number; furniture: number; review: number; rejected: number; };
  rejectedIds: string[];
  notes: string[];
}

export interface ReviewSummary {
  total: number; // full count of review candidates (e.g. 749)
  returned: number; // count actually included in `review` (capped)
  truncated: boolean;
  limit: number; // applied cap (e.g. 200); 0 = no cap
  byReason: Record<string, number>;
  byGenerator?: Record<string, number>;
}

export interface ExtractionResult {
  document: DocumentFrame;
  slab?: SlabContract;
  walls: WallContract[];
  columns: ColumnContract[];
  windows: WindowContract[];
  doors: DoorContract[];
  furniture: FurnitureInstance[];
  furnitureFamilies: FurnitureFamily[];
  /** Capped/paginated review items actually returned (see reviewSummary). */
  review: ReviewItem[];
  /** Complete rejected items (never truncated) — full audit trail. */
  rejectedItems?: RejectedItem[];
  /** Summary of review pagination + breakdowns (total vs returned). */
  reviewSummary?: ReviewSummary;
  audit: ExtractionAudit;
  providerEvidence?: Record<string, unknown>;
}

export type ProgressivePhase =
  | 'idle' | 'document' | 'slab' | 'walls' | 'columns' | 'windows' | 'doors' | 'furniture' | 'review' | 'completed' | 'error';

export interface ProgressiveExtractionEvent {
  phase: ProgressivePhase;
  progress: number; // 0..1
  message?: string;
  partial?: Partial<ExtractionResult>;
  error?: string;
}

export type ExtractionEvent = ProgressiveExtractionEvent;

export interface ExtractionRequest {
  pdf: Uint8Array;
  fileName?: string;
  pageNumber?: number;
  geometryOnly?: boolean;
  scaleMmPerPt?: number;
}

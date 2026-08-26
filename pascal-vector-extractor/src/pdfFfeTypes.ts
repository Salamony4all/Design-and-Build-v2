import type { Vec2 } from './types';

export interface CircularArc { center: Vec2; radius: number; startAngle: number; endAngle: number; sourceId: string }
export interface Affine2 { a: number; b: number; c: number; d: number; tx: number; ty: number }
export interface PdfVectorPrimitive { id: string; kind: 'line' | 'polyline' | 'arc' | 'bezier'; points: readonly Vec2[]; closed: boolean; sourceObjectId?: string }
export interface DnaProfile { aspectRatio: number; compactness: number; solidity: number; nestedLoopCount: number; cyclicTokens: readonly string[]; canonical: string; hash: string }
export interface PdfFfeInstance { instanceId: string; roomId: string; clusterId: string; hash: string; frequency: number; centerMm: Vec2; intrinsicWidthMm: number; intrinsicLengthMm: number; theta: number; matrix: readonly number[]; dna: DnaProfile }
export interface RecurrenceCluster { clusterId: string; topologicalHash: string; frequency: number; instanceIds: string[]; representative: { widthMm: number; lengthMm: number; dna: DnaProfile } }
export interface PdfFfeStagingPayload { schema: 'pascal.pdf-ffe-staging/1'; scale: { mmPerPdfUnit: number; doorAnchorCount: number; averageArcRadiusPdf: number }; instances: PdfFfeInstance[]; recurrence: RecurrenceCluster[]; unresolved: string[] }
export interface ClusterCatalogBinding { clusterId: string; topologicalHash: string; catalogId: string; assetUrl: string; category: string; dimensionsMm: readonly [number, number, number]; mappedBy?: string; mappedAt?: string }
export interface ClusterMappingCommand { type: 'bind-cluster-to-pascal-catalog'; sceneId: string; levelId: string; binding: ClusterCatalogBinding; expectedFrequency: number; instanceIds: readonly string[] }

export type PdfFfePrimitive = PdfVectorPrimitive;
export type PdfFfeDoorArc = CircularArc;
export type PdfFfeRoomPolygon = { id: string; polygon: Vec2[]; holes?: Vec2[][] };

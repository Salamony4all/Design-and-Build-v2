export type Vec2 = Readonly<{ x: number; y: number }>;
export type Aabb = Readonly<{ minX:number; minY:number; maxX:number; maxY:number }>;
export type PrimitiveKind = "LINE" | "LWPOLYLINE" | "POLYLINE" | "ARC" | "CIRCLE" | "INSERT";
export interface Segment { readonly id:string; readonly layer:string; readonly a:Vec2; readonly b:Vec2; readonly source:PrimitiveKind }
export interface ClosedRing { readonly vertices:readonly Vec2[]; readonly segmentIds:readonly string[] }
export interface Transform2 { readonly c:number; readonly s:number; readonly tx:number; readonly ty:number }
export interface WallNode { id:string; type:"Wall"; centerline:readonly Vec2[]; height:number; thickness:number; }
export interface SlabNode { id:string; type:"Slab"; boundary:readonly Vec2[]; elevation:number; thickness:number; }
export interface ItemNode { id:string; type:"Item"; catalogId:string; topologicalHash:string; matrix:readonly number[]; }
export interface GroupNode { id:string; type:"Site"|"Building"|"Level"|"Walls"|"Slabs"|"Items"; name:string; children:SceneNode[]; elevation?:number; }
export type SceneNode = GroupNode | WallNode | SlabNode | ItemNode;
export interface CatalogEntry { catalogId:string; assetUrl:string; family:"FF&E"|"door"|"window"; }
export type CatalogRegistry = Readonly<Record<string,CatalogEntry>>;

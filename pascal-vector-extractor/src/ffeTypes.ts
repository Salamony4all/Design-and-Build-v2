import type { Aabb, Segment, Vec2 } from './types'
export type Polygon2 = readonly Vec2[]
export interface RoomMask { id:string; polygon:Polygon2; holes?:readonly Polygon2[] }
export interface FfePrimitive extends Segment { bbox:Aabb; blockId?:string }
export interface ObjectCloud { id:string; roomId:string; primitives:readonly FfePrimitive[] }
export interface Obb { center:Vec2; length:number; width:number; theta:number; corners:readonly Vec2[] }
export interface ShapeDescriptor { aspectRatio:number; solidity:number; compactness:number; subLoops:number; holeDepthHistogram:readonly number[]; token:string }
export interface FfeObservation { id:string; roomId:string; cloud:ObjectCloud; footprint:Polygon2; hull:Polygon2; obb:Obb; descriptor:ShapeDescriptor }
export interface PascalCatalogPrototype { catalogId:string; assetUrl:string; category:string; dimensions:readonly [number,number,number]; descriptorToken:string; attachment:'floor'|'wall'|'ceiling'|'surface'; enabled?:boolean }
export interface FfeMatch { observationId:string; prototype:PascalCatalogPrototype; swapped:boolean; dimensionErrorMm:readonly [number,number]; matrix:readonly number[] }

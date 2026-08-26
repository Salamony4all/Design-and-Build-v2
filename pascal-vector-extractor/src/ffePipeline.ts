import type { Segment } from './types'
import type { FfeMatch, FfeObservation, PascalCatalogPrototype, RoomMask } from './ffeTypes'
import { filterFfe, maskByRooms } from './ffeFiltering'
import { clusterRoom } from './ffeClustering'
import { convexHull, minimumAreaObb } from './ffeObb'
import { descriptor } from './ffeDescriptor'
import { strictCatalogMatch, asPascalItemNode } from './ffeCatalog'
export interface FfePipelineResult { observations:FfeObservation[]; matches:FfeMatch[]; unresolved:string[]; itemNodes:unknown[] }
export function extractFfe(segments:readonly Segment[],rooms:readonly RoomMask[],catalog:readonly PascalCatalogPrototype[],parentId:string):FfePipelineResult{const masked=maskByRooms(filterFfe(segments),rooms),observations:FfeObservation[]=[];for(const [roomId,p] of [...masked].sort(([a],[b])=>a.localeCompare(b)))for(const cloud of clusterRoom(roomId,p,.1,1)){const pts=cloud.primitives.flatMap(s=>[s.a,s.b]),hull=convexHull(pts);if(hull.length<3)continue;const obb=minimumAreaObb(hull),fp=hull,desc=descriptor(fp,hull,obb.length,obb.width,[]);observations.push({id:cloud.id,roomId,cloud,footprint:fp,hull,obb,descriptor:desc})}const matches=observations.map(o=>strictCatalogMatch(o,catalog)).filter((x):x is FfeMatch=>x!==null);const accepted=new Set(matches.map(x=>x.observationId));return{observations,matches,unresolved:observations.filter(x=>!accepted.has(x.id)).map(x=>x.id),itemNodes:matches.map(x=>asPascalItemNode(x,parentId))}}

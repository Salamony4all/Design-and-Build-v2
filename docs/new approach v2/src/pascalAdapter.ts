import { DoorNode, ItemNode, SlabNode, WallNode, WindowNode } from '@pascal-app/core/schema'
import type { PhaseResult } from './phasedExtractor.js'
export function toPascalNodes(x:PhaseResult,levelId:string){
 const walls=x.walls.map(w=>WallNode.parse({parentId:levelId,start:[w.start.x,w.start.y],end:[w.end.x,w.end.y],thickness:w.thickness,height:w.height,metadata:{source:'deterministic-cad-extractor'}}))
 const wallIds=new Map(x.walls.map((w,i)=>[w.id,walls[i]!.id]))
 const slabs=x.slabs.map(s=>SlabNode.parse({parentId:levelId,polygon:s.polygon.map(p=>[p.x,p.y]),holes:s.holes.map(h=>h.map(p=>[p.x,p.y])),metadata:{source:'deterministic-cad-extractor',thickness:s.thickness}}))
 const openings=x.openings.map(o=>o.kind==='door'?DoorNode.parse({parentId:wallIds.get(o.wallId),wallId:wallIds.get(o.wallId),position:[o.position.x,0,o.position.y],rotation:[0,o.rotation,0],width:o.width,height:o.height,metadata:{source:'deterministic-cad-extractor'}}):WindowNode.parse({parentId:wallIds.get(o.wallId),wallId:wallIds.get(o.wallId),position:[o.position.x,o.sillHeight,o.position.y],rotation:[0,o.rotation,0],width:o.width,height:o.height,metadata:{source:'deterministic-cad-extractor'}}))
 const items=x.items.map(i=>ItemNode.parse({parentId:levelId,position:[i.position.x,0,i.position.y],rotation:[0,i.rotation,0],asset:{id:i.match.prototype.catalogId,name:i.match.prototype.catalogId,category:i.match.prototype.category,url:i.match.prototype.assetUrl,dimensions:i.dimensions},metadata:{source:'deterministic-cad-extractor',matchScore:i.match.score,blockId:i.blockId}}))
 return {walls,slabs,openings,items,unresolved:x.unresolved}
}

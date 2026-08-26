import type { ClosedRing, Segment, Vec2 } from './types'
import { traceBoundedLoops } from './loopTracer'
import { describeFootprint, matchCatalog, type CatalogPrototype, type CatalogMatch } from './catalogMatcher'

export interface CadBlock { id:string; name:string; layer:string; position:Vec2; rotation:number; scale:Vec2; geometry:readonly Segment[] }
export interface ExtractInput { segments:readonly Segment[]; blocks:readonly CadBlock[]; unitToMeters:number }
export interface WallDetection { id:string; start:Vec2; end:Vec2; thickness:number; height:number }
export interface SlabDetection { id:string; polygon:readonly Vec2[]; holes:readonly (readonly Vec2[])[]; thickness:number }
export interface OpeningDetection { id:string; kind:'door'|'window'|'opening'; wallId:string; position:Vec2; width:number; height:number; sillHeight:number; rotation:number }
export interface ItemDetection { id:string; blockId:string; position:Vec2; rotation:number; dimensions:readonly [number,number,number]; match:CatalogMatch }
export interface PhaseResult { slabs:SlabDetection[]; walls:WallDetection[]; openings:OpeningDetection[]; items:ItemDetection[]; unresolved:string[] }
export interface ExtractRules { wallLayer:RegExp; slabLayer:RegExp; doorLayer:RegExp; windowLayer:RegExp; itemLayer:RegExp; defaults:{wallHeight:number;slabThickness:number;doorHeight:number;windowHeight:number;windowSill:number}; snapTolerance:number; catalogMaxScore:number }
const center=(v:readonly Vec2[]):Vec2=>({x:v.reduce((s,p)=>s+p.x,0)/v.length,y:v.reduce((s,p)=>s+p.y,0)/v.length})
const bounds=(v:readonly Vec2[])=>{const xs=v.map(p=>p.x),ys=v.map(p=>p.y);return [Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)] as const}
function nearestWall(p:Vec2,walls:readonly WallDetection[]):WallDetection|null{let best:WallDetection|null=null,bd=Infinity;for(const w of walls){const vx=w.end.x-w.start.x,vy=w.end.y-w.start.y,l2=vx*vx+vy*vy,t=Math.max(0,Math.min(1,((p.x-w.start.x)*vx+(p.y-w.start.y)*vy)/l2));const d=Math.hypot(p.x-(w.start.x+t*vx),p.y-(w.start.y+t*vy));if(d<bd){bd=d;best=w}}return best}
export function extractPhased(input:ExtractInput,r:ExtractRules,catalog:readonly CatalogPrototype[]):PhaseResult{
 const m=input.unitToMeters, unresolved:string[]=[]
 // Phase 1: slab polygons are explicit closed CAD loops on slab/floor layers.
 const slabLoops=traceBoundedLoops(input.segments.filter(s=>r.slabLayer.test(s.layer)),r.snapTolerance)
 const slabs=slabLoops.map((x,i)=>({id:`slab_${i}`,polygon:x.vertices.map(p=>({x:p.x*m,y:p.y*m})),holes:[],thickness:r.defaults.slabThickness}))
 // Phase 2: wall centerlines. Native centerline layers are authoritative; paired-face inference belongs in the CAD adapter.
 const walls=input.segments.filter(s=>r.wallLayer.test(s.layer)).map((s,i)=>({id:`wall_${i}`,start:{x:s.a.x*m,y:s.a.y*m},end:{x:s.b.x*m,y:s.b.y*m},thickness:Number((s as Segment&{thickness?:number}).thickness??.1),height:r.defaults.wallHeight}))
 // Phase 3: host openings from named native blocks; never infer an opening without a wall host.
 const openings:OpeningDetection[]=[]
 for(const b of input.blocks.filter(b=>r.doorLayer.test(b.layer)||r.windowLayer.test(b.layer))){const ring=traceBoundedLoops(b.geometry,r.snapTolerance)[0]?.vertices??b.geometry.flatMap(s=>[s.a,s.b]),z=bounds(ring),p={x:b.position.x*m,y:b.position.y*m},w=nearestWall(p,walls);if(!w){unresolved.push(b.id);continue}const isDoor=r.doorLayer.test(b.layer);openings.push({id:`${isDoor?'door':'window'}_${b.id}`,kind:isDoor?'door':'window',wallId:w.id,position:p,width:Math.max(z[0],z[1])*m,height:isDoor?r.defaults.doorHeight:r.defaults.windowHeight,sillHeight:isDoor?0:r.defaults.windowSill,rotation:b.rotation})}
 // Phase 4: FF&E only. Structural/opening blocks are excluded before catalog matching.
 const items:ItemDetection[]=[]
 for(const b of input.blocks.filter(b=>r.itemLayer.test(b.layer)&&!r.doorLayer.test(b.layer)&&!r.windowLayer.test(b.layer))){const loops=traceBoundedLoops(b.geometry,r.snapTolerance);if(!loops.length){unresolved.push(b.id);continue}const fp=describeFootprint(loops.sort((a,c)=>Math.abs(c.vertices.length)-Math.abs(a.vertices.length))[0]!.vertices.map(p=>({x:p.x*m,y:p.y*m})));const match=matchCatalog(fp,catalog,r.catalogMaxScore);if(!match){unresolved.push(b.id);continue}items.push({id:`item_${b.id}`,blockId:b.id,position:{x:b.position.x*m,y:b.position.y*m},rotation:b.rotation,dimensions:match.prototype.dimensions,match})}
 return {slabs,walls,openings,items,unresolved}
}

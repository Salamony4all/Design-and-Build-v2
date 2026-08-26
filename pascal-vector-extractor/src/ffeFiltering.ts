import RBush from 'rbush'
import type { Aabb, Segment, Vec2 } from './types'
import type { FfePrimitive, RoomMask } from './ffeTypes'
const REJECT_LAYER=/(WALL|A[-_]?WALL|DOOR|WINDOW|GLAZ|SLAB|FLOOR|CEIL|GRID|DIM|TEXT|TXT|ANNO|TITLE|BORDER|HATCH|LEADER)/i
export function primitiveBbox(s:Segment):Aabb{return{minX:Math.min(s.a.x,s.b.x),minY:Math.min(s.a.y,s.b.y),maxX:Math.max(s.a.x,s.b.x),maxY:Math.max(s.a.y,s.b.y)}}
export function pointInRing(p:Vec2,ring:readonly Vec2[]):boolean{let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i]!,b=ring[j]!;if(((a.y>p.y)!==(b.y>p.y))&&(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x))inside=!inside}return inside}
export function inRoom(p:Vec2,r:RoomMask):boolean{return pointInRing(p,r.polygon)&&!(r.holes??[]).some(h=>pointInRing(p,h))}
export function filterFfe(segments:readonly Segment[]):FfePrimitive[]{return segments.filter(s=>!REJECT_LAYER.test(s.layer)).map(s=>({...s,bbox:primitiveBbox(s)}))}
type RoomEntry=Aabb&{room:RoomMask}
export function maskByRooms(primitives:readonly FfePrimitive[],rooms:readonly RoomMask[]):Map<string,FfePrimitive[]>{
 const tree=new RBush<RoomEntry>(); tree.load(rooms.map(room=>{const xs=room.polygon.map(p=>p.x),ys=room.polygon.map(p=>p.y);return{minX:Math.min(...xs),minY:Math.min(...ys),maxX:Math.max(...xs),maxY:Math.max(...ys),room}}))
 const out=new Map<string,FfePrimitive[]>(); for(const p of primitives){const c={x:(p.a.x+p.b.x)/2,y:(p.a.y+p.b.y)/2};const hits=tree.search(p.bbox).filter(x=>inRoom(c,x.room)).sort((a,b)=>a.room.id.localeCompare(b.room.id));if(hits.length===1){const a=out.get(hits[0]!.room.id)??[];a.push(p);out.set(hits[0]!.room.id,a)}}return out
}

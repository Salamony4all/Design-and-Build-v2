import type { ClosedRing, Segment, Vec2 } from "./types.js";
import { key, signedArea } from "./numeric.js";
type Half={from:Vec2;to:Vec2;sid:string;twin:number;used:boolean;angle:number};
// Polygonizes a planar, pre-noded line graph with a deterministic half-edge face walk.
// Intersections must be split before entry; dangling edges naturally produce no bounded face.
export function traceBoundedLoops(segments:readonly Segment[],tol=1e-6):ClosedRing[]{
  const half:Half[]=[];const outgoing=new Map<string,number[]>();
  const add=(from:Vec2,to:Vec2,sid:string,twin:number)=>{const i=half.length;half.push({from,to,sid,twin,used:false,angle:Math.atan2(to.y-from.y,to.x-from.x)});const k=key(from,tol),a=outgoing.get(k)??[];a.push(i);outgoing.set(k,a);return i;};
  for(const s of segments){const i=half.length,j=i+1;add(s.a,s.b,s.id,j);add(s.b,s.a,s.id,i);}
  for(const a of outgoing.values())a.sort((i,j)=>half[i]!.angle-half[j]!.angle||half[i]!.sid.localeCompare(half[j]!.sid));
  const rings:ClosedRing[]=[];
  for(let start=0;start<half.length;start++){if(half[start]!.used)continue;const vertices:Vec2[]=[],ids:string[]=[];let cur=start,guard=0;
    while(guard++<=half.length){const e=half[cur]!;if(e.used&&cur!==start)break;e.used=true;vertices.push(e.from);ids.push(e.sid);const a=outgoing.get(key(e.to,tol))!;const pos=a.indexOf(e.twin);if(pos<0)break;cur=a[(pos-1+a.length)%a.length]!;if(cur===start)break;}
    if(cur===start&&vertices.length>=3&&signedArea(vertices)>tol*tol)rings.push({vertices,segmentIds:ids});
  }
  return rings;
}

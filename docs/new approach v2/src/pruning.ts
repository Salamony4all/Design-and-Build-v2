import RBush from "rbush";
import type { Aabb, Segment } from "./types.js";
const DROP=/(TXT|TEXT|DIM|ANNO|ANNOT|GRID|TITLE|BORDER|SHEET|HATCH|LEADER)/i;
export const keepLayer=(name:string):boolean=>!DROP.test(name);
type Indexed=Aabb & {segment:Segment};
export function buildIndex(segments:readonly Segment[]):RBush<Indexed>{
  const tree=new RBush<Indexed>();
  tree.load(segments.filter(s=>keepLayer(s.layer)).map(segment=>({
    minX:Math.min(segment.a.x,segment.b.x),minY:Math.min(segment.a.y,segment.b.y),
    maxX:Math.max(segment.a.x,segment.b.x),maxY:Math.max(segment.a.y,segment.b.y),segment
  })));
  return tree;
}
// Endpoint-connected components. Selects structural core by total edge length, not frame area.
export function structuralCore(segments:readonly Segment[], tolerance:number):Segment[]{
  const buckets=new Map<string,number[]>();
  const k=(x:number,y:number)=>`${Math.round(x/tolerance)},${Math.round(y/tolerance)}`;
  segments.forEach((s,i)=>{for(const p of [s.a,s.b]){const z=k(p.x,p.y),a=buckets.get(z)??[];a.push(i);buckets.set(z,a);}});
  const seen=new Uint8Array(segments.length); let best:number[]=[]; let bestScore=-Infinity;
  for(let seed=0;seed<segments.length;seed++){if(seen[seed])continue; const stack=[seed], cc:number[]=[]; let length=0;
    while(stack.length){const i=stack.pop()!;if(seen[i])continue;seen[i]=1;cc.push(i);const s=segments[i]!;length+=Math.hypot(s.b.x-s.a.x,s.b.y-s.a.y);
      for(const p of [s.a,s.b]) for(const j of buckets.get(k(p.x,p.y))??[]) if(!seen[j]) stack.push(j);
    }
    // Penalize tiny components while retaining long, richly connected building geometry.
    const score=length*Math.log2(cc.length+2); if(score>bestScore){bestScore=score;best=cc;}
  }
  return best.map(i=>segments[i]!);
}

import type { Vec2 } from "./types.js";
import { canonicalNumber, cross, dist, dot, signedArea, sub } from "./numeric.js";
function rotate<T>(a:readonly T[],k:number):T[]{return [...a.slice(k),...a.slice(0,k)];}
function lexMin(tokens:readonly string[]):string {let best="";for(let k=0;k<tokens.length;k++){const s=rotate(tokens,k).join(";");if(k===0||s<best)best=s;}return best;}
function orientationSignature(v:readonly Vec2[]):string{
  const n=v.length, lengths=v.map((p,i)=>dist(p,v[(i+1)%n]!)); const perimeter=lengths.reduce((a,b)=>a+b,0); if(perimeter===0)throw new Error("Degenerate loop");
  const t:string[]=[];for(let i=0;i<n;i++){const prev=sub(v[(i-1+n)%n]!,v[i]!),next=sub(v[(i+1)%n]!,v[i]!);const lp=Math.hypot(prev.x,prev.y),ln=Math.hypot(next.x,next.y);if(lp===0||ln===0)throw new Error("Repeated vertex");
    // acos(dot) is mirror invariant; edge ratio normalized by total perimeter is scale invariant.
    const angle=Math.acos(Math.max(-1,Math.min(1,dot(prev,next)/(lp*ln))));
    t.push(`${canonicalNumber(angle)}|${canonicalNumber(lengths[i]!/perimeter)}`);
  } return lexMin(t);
}
// Mirror normalization compares both traversal directions. FNV-1a 64 is stable, fast, non-cryptographic.
export function canonicalSignature(vertices:readonly Vec2[]):string{
  const v=signedArea(vertices)<0?[...vertices].reverse():[...vertices]; const f=orientationSignature(v),r=orientationSignature([...v].reverse());return f<r?f:r;
}
export function topologicalHash(vertices:readonly Vec2[]):string{
  const s=canonicalSignature(vertices);let h=0xcbf29ce484222325n;for(let i=0;i<s.length;i++){h^=BigInt(s.charCodeAt(i));h=BigInt.asUintN(64,h*0x100000001b3n);}return `topo64:${h.toString(16).padStart(16,"0")}`;
}

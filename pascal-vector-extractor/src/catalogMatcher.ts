import { canonicalSignature, topologicalHash } from './invariantHash'
import type { Vec2 } from './types'

export interface FootprintDescriptor {
  readonly ring: readonly Vec2[]
  readonly holes?: readonly (readonly Vec2[])[]
  readonly bounds: readonly [number, number]
  readonly area: number
  readonly compactness: number
  readonly radial: readonly number[]
  readonly topology: string
}
export interface CatalogPrototype {
  readonly catalogId: string
  readonly assetUrl: string
  readonly category: string
  readonly dimensions: readonly [number, number, number]
  readonly footprint: FootprintDescriptor
  readonly attachment?: 'floor'|'wall'|'ceiling'|'surface'
}
export interface CatalogMatch { prototype:CatalogPrototype; score:number; reasons:Readonly<Record<string,number>> }

function area(v:readonly Vec2[]):number { let a=0; for(let i=0;i<v.length;i++){const p=v[i]!,q=v[(i+1)%v.length]!;a+=p.x*q.y-q.x*p.y} return Math.abs(a)/2 }
function perimeter(v:readonly Vec2[]):number { let s=0; for(let i=0;i<v.length;i++){const p=v[i]!,q=v[(i+1)%v.length]!;s+=Math.hypot(q.x-p.x,q.y-p.y)}return s }
function radial(v:readonly Vec2[],n=32):number[]{const cx=v.reduce((s,p)=>s+p.x,0)/v.length,cy=v.reduce((s,p)=>s+p.y,0)/v.length;const rs=v.map(p=>Math.hypot(p.x-cx,p.y-cy));const m=Math.max(...rs)||1;return Array.from({length:n},(_,i)=>rs[Math.floor(i*rs.length/n)]!/m)}
export function describeFootprint(ring:readonly Vec2[],holes:readonly (readonly Vec2[])[]=[]):FootprintDescriptor{
 const xs=ring.map(p=>p.x),ys=ring.map(p=>p.y),a=area(ring)-holes.reduce((s,h)=>s+area(h),0),p=perimeter(ring)
 return {ring,holes,bounds:[Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)],area:a,compactness:p?p*p/(4*Math.PI*a):Infinity,radial:radial(ring),topology:`${topologicalHash(ring)}:${holes.length}`}
}
const rel=(a:number,b:number)=>Math.abs(a-b)/Math.max(Math.abs(a),Math.abs(b),1e-9)
function cyclicL1(a:readonly number[],b:readonly number[]):number{let best=Infinity;for(let k=0;k<a.length;k++){let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]!-b[(i+k)%b.length]!);best=Math.min(best,s/a.length)}return best}
export function matchCatalog(q:FootprintDescriptor,catalog:readonly CatalogPrototype[],maxScore=.24):CatalogMatch|null{
 let best:CatalogMatch|null=null
 for(const p of catalog){
  const dims=Math.min((rel(q.bounds[0],p.footprint.bounds[0])+rel(q.bounds[1],p.footprint.bounds[1]))/2,(rel(q.bounds[0],p.footprint.bounds[1])+rel(q.bounds[1],p.footprint.bounds[0]))/2)
  const reasons={topology:q.topology===p.footprint.topology?0:1,dimensions:dims,area:rel(q.area,p.footprint.area),compactness:rel(q.compactness,p.footprint.compactness),radial:cyclicL1(q.radial,p.footprint.radial)}
  const score=.38*reasons.topology+.27*reasons.dimensions+.15*reasons.area+.08*reasons.compactness+.12*reasons.radial
  if(!best||score<best.score)best={prototype:p,score,reasons}
 }
 return best&&best.score<=maxScore?best:null
}

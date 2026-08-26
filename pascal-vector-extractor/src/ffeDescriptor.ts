import type { Vec2 } from './types'
import type { ShapeDescriptor } from './ffeTypes'
const area=(v:readonly Vec2[])=>Math.abs(v.reduce((s,p,i)=>{const q=v[(i+1)%v.length]!;return s+p.x*q.y-q.x*p.y},0))/2
const perimeter=(v:readonly Vec2[])=>v.reduce((s,p,i)=>{const q=v[(i+1)%v.length]!;return s+Math.hypot(q.x-p.x,q.y-p.y)},0)
const q=(x:number,step:number)=>Math.round(x/step)*step
export function descriptor(footprint:readonly Vec2[],hull:readonly Vec2[],length:number,width:number,subLoops:readonly (readonly Vec2[])[]):ShapeDescriptor{const a=area(footprint),ha=area(hull),p=perimeter(footprint),aspect=length/Math.max(width,1e-9),solidity=a/Math.max(ha,1e-9),compact=4*Math.PI*a/Math.max(p*p,1e-9);const depths=[subLoops.length];const token=`ar=${q(aspect,.01).toFixed(2)}|sol=${q(solidity,.01).toFixed(2)}|iso=${q(compact,.01).toFixed(2)}|loops=${subLoops.length}|depth=${depths.join(',')}`;return{aspectRatio:aspect,solidity,compactness:compact,subLoops:subLoops.length,holeDepthHistogram:depths,token}}

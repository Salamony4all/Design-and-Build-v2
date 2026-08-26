import RBush from 'rbush'
import type { Aabb, Vec2 } from './types'
import type { FfePrimitive, ObjectCloud } from './ffeTypes'
type Entry=Aabb&{i:number}
function segDist(a:Vec2,b:Vec2,c:Vec2,d:Vec2):number{
 const pointSeg=(p:Vec2,x:Vec2,y:Vec2)=>{const vx=y.x-x.x,vy=y.y-x.y,l=vx*vx+vy*vy;if(l===0)return Math.hypot(p.x-x.x,p.y-x.y);const t=Math.max(0,Math.min(1,((p.x-x.x)*vx+(p.y-x.y)*vy)/l));return Math.hypot(p.x-(x.x+t*vx),p.y-(x.y+t*vy))}
 return Math.min(pointSeg(a,c,d),pointSeg(b,c,d),pointSeg(c,a,b),pointSeg(d,a,b))
}
export function clusterRoom(roomId:string,p:readonly FfePrimitive[],epsilon=0.1,minPts=1):ObjectCloud[]{
 const tree=new RBush<Entry>();tree.load(p.map((x,i)=>({minX:x.bbox.minX,minY:x.bbox.minY,maxX:x.bbox.maxX,maxY:x.bbox.maxY,i})))
 const labels=new Int32Array(p.length).fill(-1);let cid=0
 const neighbors=(i:number)=>{const q=p[i]!,e={minX:q.bbox.minX-epsilon,minY:q.bbox.minY-epsilon,maxX:q.bbox.maxX+epsilon,maxY:q.bbox.maxY+epsilon};return tree.search(e).map(x=>x.i).filter(j=>segDist(q.a,q.b,p[j]!.a,p[j]!.b)<=epsilon).sort((a,b)=>a-b)}
 for(let i=0;i<p.length;i++){if(labels[i]!==-1)continue;const n=neighbors(i);if(n.length<minPts){labels[i]=-2;continue}labels[i]=cid;const queue=[...n];for(let q=0;q<queue.length;q++){const j=queue[q]!;if(labels[j]===-2)labels[j]=cid;if(labels[j]!==-1)continue;labels[j]=cid;const n2=neighbors(j);if(n2.length>=minPts)for(const k of n2)if(!queue.includes(k))queue.push(k)}cid++}
 return Array.from({length:cid},(_,id)=>({id:`${roomId}:cloud:${id}`,roomId,primitives:p.filter((_,i)=>labels[i]===id)})).filter(c=>c.primitives.length>0)
}

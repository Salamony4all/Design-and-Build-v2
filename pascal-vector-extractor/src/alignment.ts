import type { Segment, Transform2, Vec2 } from "./types";
// Length-weighted axial circular mean: angle and angle+PI are equivalent.
export function dominantAxis(segments:readonly Segment[]):number{
  let x=0,y=0; for(const s of segments){const dx=s.b.x-s.a.x,dy=s.b.y-s.a.y,w=Math.hypot(dx,dy);if(w===0)continue;const a=Math.atan2(dy,dx);x+=w*Math.cos(2*a);y+=w*Math.sin(2*a);} return .5*Math.atan2(y,x);
}
export function lineIntersection(a:Segment,b:Segment):Vec2|null{
  const r={x:a.b.x-a.a.x,y:a.b.y-a.a.y},s={x:b.b.x-b.a.x,y:b.b.y-b.a.y}; const d=r.x*s.y-r.y*s.x;if(Math.abs(d)<1e-12)return null;
  const q={x:b.a.x-a.a.x,y:b.a.y-a.a.y},t=(q.x*s.y-q.y*s.x)/d; return {x:a.a.x+t*r.x,y:a.a.y+t*r.y};
}
export function alignmentFromAnchors(primary:Segment, secondary:Segment):Transform2{
  const o=lineIntersection(primary,secondary); if(!o)throw new Error("Grid anchors are parallel"); const a=Math.atan2(primary.b.y-primary.a.y,primary.b.x-primary.a.x); return {c:Math.cos(-a),s:Math.sin(-a),tx:o.x,ty:o.y};
}
export function applyTransform(p:Vec2,t:Transform2):Vec2{const x=p.x-t.tx,y=p.y-t.ty;return{x:t.c*x-t.s*y,y:t.s*x+t.c*y};}

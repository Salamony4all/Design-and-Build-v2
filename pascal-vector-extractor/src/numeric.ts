import type { Vec2 } from "./types";
export const EPS=1e-9;
export const q=(v:number,tol:number):number=>Math.round(v/tol)*tol;
export const key=(p:Vec2,tol:number):string=>`${Math.round(p.x/tol)},${Math.round(p.y/tol)}`;
export const sub=(a:Vec2,b:Vec2):Vec2=>({x:a.x-b.x,y:a.y-b.y});
export const dot=(a:Vec2,b:Vec2):number=>a.x*b.x+a.y*b.y;
export const cross=(a:Vec2,b:Vec2):number=>a.x*b.y-a.y*b.x;
export const len=(v:Vec2):number=>Math.hypot(v.x,v.y);
export const dist=(a:Vec2,b:Vec2):number=>len(sub(a,b));
export function signedArea(v:readonly Vec2[]):number { let a=0; for(let i=0;i<v.length;i++){const p=v[i]!,n=v[(i+1)%v.length]!;a+=p.x*n.y-n.x*p.y;} return a/2; }
export function canonicalNumber(v:number, places=10):string { const n=Number(v.toFixed(places)); return Object.is(n,-0)?"0":String(n); }

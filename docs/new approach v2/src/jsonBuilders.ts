import type { CatalogRegistry, GroupNode, ItemNode, SceneNode, Vec2, WallNode } from "./types.js";
export function matrixColumnMajor(x:number,y:number,z:number,yaw:number,sx=1,sy=1,sz=1):readonly number[]{const c=Math.cos(yaw),s=Math.sin(yaw),nz=(v:number)=>Object.is(v,-0)?0:v;return [nz(c*sx),nz(s*sx),0,0,nz(-s*sy),nz(c*sy),0,0,0,0,sz,0,x,y,z,1];}
export function wall(id:string,path:readonly Vec2[],height:number,thickness:number):WallNode{return{id,type:"Wall",centerline:path,height,thickness};}
export function item(id:string,hash:string,catalog:CatalogRegistry,x:number,y:number,z:number,yaw:number):ItemNode{const e=catalog[hash];if(!e)throw new Error(`Unmapped topology: ${hash}`);return{id,type:"Item",catalogId:e.catalogId,topologicalHash:hash,matrix:matrixColumnMajor(x,y,z,yaw)};}
export function pascalScene(siteId:string,buildingId:string,levelId:string,elevation:number,nodes:readonly SceneNode[]):GroupNode{
 const walls=nodes.filter(n=>n.type==="Wall"),slabs=nodes.filter(n=>n.type==="Slab"),items=nodes.filter(n=>n.type==="Item");
 return{id:siteId,type:"Site",name:"Site",children:[{id:buildingId,type:"Building",name:"Building",children:[{id:levelId,type:"Level",name:"Level",elevation,children:[{id:`${levelId}:walls`,type:"Walls",name:"Walls",children:walls},{id:`${levelId}:slabs`,type:"Slabs",name:"Slabs",children:slabs},{id:`${levelId}:items`,type:"Items",name:"Items",children:items}]}]}]};
}
export function catalogMapping(registry:CatalogRegistry):object{return{schema:"pascal.catalog-map/1",entries:registry};}
export function stableJson(value:unknown):string{return JSON.stringify(value,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v,2);}

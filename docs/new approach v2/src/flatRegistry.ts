export interface RenderRecord { id:string; assetUrl:string; matrix:Float32Array; visible:boolean; dirty:boolean }
// Non-reactive structure: stable dense array for render-loop iteration + O(1) ID lookup.
export class FlatRenderRegistry {
  readonly records:RenderRecord[]=[]; private readonly byId=new Map<string,number>();
  upsert(id:string,assetUrl:string,matrix:ArrayLike<number>):RenderRecord{if(matrix.length!==16)throw new Error("matrix must contain 16 values");const idx=this.byId.get(id);if(idx!==undefined){const r=this.records[idx]!;r.assetUrl=assetUrl;r.matrix.set(matrix);r.dirty=true;return r;}const r={id,assetUrl,matrix:Float32Array.from(matrix),visible:true,dirty:true};this.byId.set(id,this.records.length);this.records.push(r);return r;}
  remove(id:string):boolean{const i=this.byId.get(id);if(i===undefined)return false;const last=this.records.pop()!;this.byId.delete(id);if(i<this.records.length){this.records[i]=last;this.byId.set(last.id,i);}return true;}
  forEachVisible(fn:(r:RenderRecord,index:number)=>void):void{for(let i=0;i<this.records.length;i++){const r=this.records[i]!;if(r.visible)fn(r,i);}}
}

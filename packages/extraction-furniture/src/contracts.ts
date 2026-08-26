export type Point = { x: number; y: number };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type Segment = {
  id: string;
  a: Point;
  b: Point;
  sourceOperationId?: string;
  claimedBy?: 'wall' | 'window' | 'door' | 'annotation' | 'slab';
};
export type CubicCurve = {
  id: string;
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
  sourceOperationId?: string;
  claimedBy?: Segment['claimedBy'];
};
export type CapturedGeometry = {
  segments: Segment[];
  curves: CubicCurve[];
  mmPerUnit: number;
  sourceHash: string;
};
export type Verdict = 'ACCEPT' | 'REVIEW' | 'REJECT';
export const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x+b.x)/2, y:(a.y+b.y)/2 });
export const angle = (a: Point, b: Point) => Math.atan2(b.y-a.y,b.x-a.x);
export const normAngle = (value: number) => {
  let v = value % Math.PI;
  if (v < 0) v += Math.PI;
  return v;
};
export const angleDelta = (a: number,b: number) => {
  const d=Math.abs(normAngle(a)-normAngle(b));
  return Math.min(d,Math.PI-d);
};
export const quant = (v:number, step=1e-4) => Math.round(v/step)*step;
export const deterministicId = (prefix:string, values:Array<string|number>) => {
  const s=values.join('|'); let h=2166136261;
  for (let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
  return `${prefix}_${(h>>>0).toString(16).padStart(8,'0')}`;
};

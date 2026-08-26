import { resolvePascalFurniture } from './pascal-furniture-catalog';
export type P2=[number,number];
export interface ZoneLike { id?:string; name?:string; boundary?:P2[] }
export interface FurnitureLike { id?:string; type:string; pos:P2; width?:number; depth?:number; rotation?:number; zoneId?:string; confidence?:number }
const inside=(p:P2,poly:P2[])=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if(((a[1]>p[1])!==(b[1]>p[1]))&&(p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1]+1e-12)+a[0]))c=!c;}return c};
const area=(p:P2[])=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1]},0)/2);
const dist=(a:P2,b:P2)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export function assignZone(pos:P2,zones:ZoneLike[]):ZoneLike|null{return zones.filter(z=>z.boundary&&z.boundary.length>=3&&inside(pos,z.boundary)).sort((a,b)=>area(a.boundary!)-area(b.boundary!))[0]||null}
export function sanitizeFurniture(items:FurnitureLike[],zones:ZoneLike[],floorBoundary:P2[]|undefined){
 const accepted:any[]=[];const review:any[]=[];const seen:any[]=[];
 for(const f of items||[]){
  const resolved=resolvePascalFurniture(f.type);const zone=assignZone(f.pos,zones);
  const inFloor=!floorBoundary||floorBoundary.length<3||inside(f.pos,floorBoundary);
  const confidence=Math.min(f.confidence??.6,resolved.confidence||.35,zone?1:.65,inFloor?1:.2);
  if(!resolved.def||!inFloor||confidence<.55){review.push({...f,reason:!resolved.def?'UNKNOWN_PASCAL_ASSET':!inFloor?'OUTSIDE_FLOOR':'LOW_CONFIDENCE',confidence});continue}
  const w=f.width??resolved.def.widthM,d=f.depth??resolved.def.depthM;
  const duplicate=seen.find(x=>x.slug===resolved.def!.slug&&dist(x.pos,f.pos)<Math.max(.25,Math.min(w,d)*.35));
  if(duplicate){review.push({...f,reason:'DUPLICATE_FURNITURE',confidence});continue}
  seen.push({slug:resolved.def.slug,pos:f.pos});
  accepted.push({...f,type:`catalog:${resolved.def.slug}`,width:w,depth:d,height:resolved.def.heightM,zoneId:zone?.id||f.zoneId,zoneName:zone?.name,confidence});
 }
 return {accepted,review};
}

// ── V3 furniture decision policy (spec §13-§15) ──────────────────────────────
// One decision function for the whole pipeline. AUTO_ACCEPT, REVIEW, REJECT as
// defined in the prompt spec; never silently omits review items. Reuses the same
// catalogue-constrained resolution so no second asset mapping exists.
export type FurnitureDecision = 'accepted' | 'review' | 'rejected';

export interface FurnitureAudit {
  detected: number;
  verified: number;
  accepted: number;
  review: number;
  rejected: number;
  installed: number;
  duplicatesRemoved: number;
  unknownAsset: number;
  assetNotDeployed: number;
  outsideFloor: number;
  missingZone: number;
  frameMismatch: number;
  invalidDimensions: number;
}

export interface FurnitureCandidate extends FurnitureLike {
  type: string; // catalogue slug or 'catalog:<slug>'
  height?: number;
  zoneName?: string;
  reason?: string;
  decision?: FurnitureDecision;
  sourceEntityId?: string;
  frameId?: string;
}

export interface FurnitureV3Result {
  accepted: FurnitureCandidate[];
  review: FurnitureCandidate[];
  rejected: FurnitureCandidate[];
  audit: FurnitureAudit;
}

const emptyAudit = (): FurnitureAudit => ({
  detected: 0, verified: 0, accepted: 0, review: 0, rejected: 0, installed: 0,
  duplicatesRemoved: 0, unknownAsset: 0, assetNotDeployed: 0, outsideFloor: 0,
  missingZone: 0, frameMismatch: 0, invalidDimensions: 0,
});

const sourceEntity = (c: FurnitureCandidate): string =>
  `fe_${c.type}@${Math.round((c.pos?.[0] ?? 0) * 100)}_${Math.round((c.pos?.[1] ?? 0) * 100)}_${Math.round((c.rotation ?? 0))}`;

/**
 * V3 split: detect->verify->sanitize->split into accepted/review/rejected.
 * `verifiedCount` is the count of items entering verification (for the audit).
 * `frameId` (when provided) requires furniture to share the run's SourceFrame;
 * a mismatch sends the item to REVIEW with reason FRAME_MISMATCH.
 */
export function sanitizeFurnitureV3(
  items: FurnitureLike[],
  opts: { zones: ZoneLike[]; floorBoundary?: P2[]; frameId?: string; verifiedCount?: number },
): FurnitureV3Result {
  const audit = emptyAudit();
  audit.detected = items?.length ?? 0;
  audit.verified = opts.verifiedCount ?? audit.detected;
  const accepted: FurnitureCandidate[] = [];
  const review: FurnitureCandidate[] = [];
  const rejected: FurnitureCandidate[] = [];
  const seen: { slug?: string; pos: P2 }[] = [];

  for (const raw of items ?? []) {
    const f: FurnitureCandidate = { ...(raw as FurnitureCandidate) };
    const resolved = resolvePascalFurniture(f.type);
    const zone = assignZone(f.pos, opts.zones);
    const inFloor = !opts.floorBoundary || opts.floorBoundary.length < 3 || inside(f.pos, opts.floorBoundary);
    const modelConf = f.confidence ?? 0.6;
    const matchConf = resolved.confidence || 0.35;
    const conf = Math.min(modelConf, matchConf, zone ? 1 : 0.65, inFloor ? 1 : 0.2);

    const hasAsset = !!resolved.def;
    const deployed = !!resolved.def; // catalogue IS the deployed manifest
    const finite = f.pos && Number.isFinite(f.pos[0]) && Number.isFinite(f.pos[1]);
    const w = f.width ?? resolved.def?.widthM ?? 0;
    const d = f.depth ?? resolved.def?.depthM ?? 0;
    const plausible = w > 0 && d > 0 && w <= 20 && d <= 20;
    const frameOk = !opts.frameId || f.frameId === undefined || f.frameId === opts.frameId;

    f.sourceEntityId = sourceEntity(f);
    f.frameId = opts.frameId;

    // REJECT conditions (spec §14)
    if (!hasAsset) { audit.unknownAsset++; audit.rejected++; f.reason = 'UNKNOWN_PASCAL_ASSET'; rejected.push({ ...f, decision: 'rejected', reason: 'UNKNOWN_PASCAL_ASSET' }); continue; }
    if (!deployed) { audit.assetNotDeployed++; audit.rejected++; f.reason = 'ASSET_NOT_DEPLOYED'; rejected.push({ ...f, decision: 'rejected', reason: 'ASSET_NOT_DEPLOYED' }); continue; }
    if (!finite) { audit.rejected++; f.reason = 'NON_FINITE_COORDS'; rejected.push({ ...f, decision: 'rejected', reason: 'NON_FINITE_COORDS' }); continue; }
    if (!inFloor) { audit.outsideFloor++; audit.rejected++; f.reason = 'OUTSIDE_FLOOR'; rejected.push({ ...f, decision: 'rejected', reason: 'OUTSIDE_FLOOR' }); continue; }
    if (!plausible) { audit.invalidDimensions++; audit.rejected++; f.reason = 'INVALID_DIMENSIONS'; rejected.push({ ...f, decision: 'rejected', reason: 'INVALID_DIMENSIONS' }); continue; }
    if (conf < 0.55) { audit.rejected++; f.reason = 'LOW_CONFIDENCE'; rejected.push({ ...f, decision: 'rejected', reason: 'LOW_CONFIDENCE' }); continue; }
    if (!frameOk) { audit.frameMismatch++; f.reason = 'FRAME_MISMATCH'; review.push({ ...f, decision: 'review', reason: 'FRAME_MISMATCH' }); continue; }

    // Duplicate detection (cross-pass) — confirmed duplicate is REJECT
    const dup = seen.find((x) => x.slug === resolved.def!.slug && dist(x.pos, f.pos) < Math.max(0.25, Math.min(w, d) * 0.35));
    if (dup) { audit.duplicatesRemoved++; audit.rejected++; f.reason = 'DUPLICATE_FURNITURE'; rejected.push({ ...f, decision: 'rejected', reason: 'DUPLICATE_FURNITURE' }); continue; }
    seen.push({ slug: resolved.def!.slug, pos: f.pos });

    if (!zone) audit.missingZone++;

    // AUTO_ACCEPT vs REVIEW (spec §14). A confirmed alias match IS the deployed
    // asset, so it does NOT force review — only low confidence, missing zone,
    // undefined rotation, or non-positive dimensions do.
    const isReview =
      conf < 0.75 ||
      !zone ||
      (f.rotation === undefined || f.rotation === null) ||
      w <= 0 || d <= 0;
    if (isReview) {
      review.push({ ...f, decision: 'review', reason: f.reason ?? (!zone ? 'MISSING_ZONE' : conf < 0.75 ? 'LOW_CONFIDENCE' : 'UNCERTAIN_ROTATION') });
      audit.review++;
    } else {
      accepted.push({ ...f, type: `catalog:${resolved.def!.slug}`, width: w, depth: d, height: resolved.def!.heightM, zoneId: zone?.id || f.zoneId, zoneName: zone?.name, confidence: conf, decision: 'accepted' });
      audit.accepted++;
    }
  }
  return { accepted, review, rejected, audit };
}

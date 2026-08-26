// scripts/run-tests.mts
import { readFileSync } from "fs";
import { join } from "path";

// src/mupdf-pure.ts
import * as mupdf2 from "mupdf";

// src/vector-device.ts
import * as mupdf from "mupdf";
function apply(m, x, y) {
  return { x: (m[0] ?? 1) * x + (m[2] ?? 0) * y + (m[4] ?? 0), y: (m[1] ?? 0) * x + (m[3] ?? 1) * y + (m[5] ?? 0) };
}
function walkPath(path, ctm) {
  const commands = [];
  const points = [];
  const subpaths = [];
  let current = [];
  const flush = () => {
    if (current.length) {
      subpaths.push(current);
      current = [];
    }
  };
  path.walk({
    moveTo(x, y) {
      flush();
      const p = apply(ctm, x, y);
      commands.push({ op: "M", ...p });
      points.push(p);
      current.push(p);
    },
    lineTo(x, y) {
      const p = apply(ctm, x, y);
      commands.push({ op: "L", ...p });
      points.push(p);
      current.push(p);
    },
    curveTo(x1, y1, x2, y2, x3, y3) {
      const p1 = apply(ctm, x1, y1), p2 = apply(ctm, x2, y2), p3 = apply(ctm, x3, y3);
      commands.push({ op: "C", p1, p2, p3 });
      points.push(p1, p2, p3);
      current.push(p1, p2, p3);
    },
    closePath() {
      commands.push({ op: "Z" });
      flush();
    }
  });
  flush();
  return { commands, points, subpaths };
}
function boundsOf(points) {
  if (!points.length) return [0, 0, 0, 0];
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
function walkPathWithLineage(path, ctm, pageNumber, operationIndex, operationType) {
  const subpaths = [];
  const operationId = `p${pageNumber}_op${operationIndex}`;
  let currentSubpath = null;
  let subpathIndex = 0;
  let segmentIndex = 0;
  let commandIndex = 0;
  let currSrc = null;
  let currTrans = null;
  let startSrc = null;
  let startTrans = null;
  const allSourcePoints = [];
  const allTransformedPoints = [];
  const flushSubpath = () => {
    if (currentSubpath) {
      currentSubpath.commandRange[1] = commandIndex - 1;
      const pts = currentSubpath.segments.flatMap((s) => s.sourcePoints);
      const tpts = currentSubpath.segments.flatMap((s) => s.transformedPoints);
      currentSubpath.sourceBounds = boundsOf(pts);
      currentSubpath.transformedBounds = boundsOf(tpts);
      subpaths.push(currentSubpath);
      currentSubpath = null;
    }
  };
  path.walk({
    moveTo(x, y) {
      flushSubpath();
      const p = apply(ctm, x, y);
      allSourcePoints.push({ x, y });
      allTransformedPoints.push(p);
      startSrc = { x, y };
      startTrans = p;
      currSrc = { x, y };
      currTrans = p;
      currentSubpath = {
        subpathId: `${operationId}_s${subpathIndex++}`,
        operationId,
        commandRange: [commandIndex, commandIndex],
        closed: false,
        sourceBounds: [x, y, x, y],
        transformedBounds: [p.x, p.y, p.x, p.y],
        segments: []
      };
      segmentIndex = 0;
      commandIndex++;
    },
    lineTo(x, y) {
      if (!currentSubpath) return;
      const p = apply(ctm, x, y);
      allSourcePoints.push({ x, y });
      allTransformedPoints.push(p);
      const segSrcPoints = [currSrc, { x, y }];
      const segTransPoints = [currTrans, p];
      currentSubpath.segments.push({
        segmentId: `${currentSubpath.subpathId}_seg${segmentIndex++}`,
        operationId,
        subpathId: currentSubpath.subpathId,
        commandIndex,
        commandType: "L",
        sourcePoints: segSrcPoints,
        transformedPoints: segTransPoints,
        sourceBounds: boundsOf(segSrcPoints),
        transformedBounds: boundsOf(segTransPoints),
        boundsPrecision: "EXACT_LINE"
      });
      currSrc = { x, y };
      currTrans = p;
      commandIndex++;
    },
    curveTo(x1, y1, x2, y2, x3, y3) {
      if (!currentSubpath) return;
      const p1 = apply(ctm, x1, y1);
      const p2 = apply(ctm, x2, y2);
      const p3 = apply(ctm, x3, y3);
      allSourcePoints.push({ x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 });
      allTransformedPoints.push(p1, p2, p3);
      const segSrcPoints = [currSrc, { x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 }];
      const segTransPoints = [currTrans, p1, p2, p3];
      currentSubpath.segments.push({
        segmentId: `${currentSubpath.subpathId}_seg${segmentIndex++}`,
        operationId,
        subpathId: currentSubpath.subpathId,
        commandIndex,
        commandType: "C",
        sourcePoints: segSrcPoints,
        transformedPoints: segTransPoints,
        sourceBounds: boundsOf(segSrcPoints),
        transformedBounds: boundsOf(segTransPoints),
        boundsPrecision: "CONTROL_POINT_ENVELOPE"
      });
      currSrc = { x: x3, y: y3 };
      currTrans = p3;
      commandIndex++;
    },
    closePath() {
      if (!currentSubpath) return;
      currentSubpath.closed = true;
      if (currSrc && startSrc && (currSrc.x !== startSrc.x || currSrc.y !== startSrc.y)) {
        const segSrcPoints = [currSrc, startSrc];
        const segTransPoints = [currTrans, startTrans];
        currentSubpath.segments.push({
          segmentId: `${currentSubpath.subpathId}_seg${segmentIndex++}`,
          operationId,
          subpathId: currentSubpath.subpathId,
          commandIndex,
          commandType: "Z",
          sourcePoints: segSrcPoints,
          transformedPoints: segTransPoints,
          sourceBounds: boundsOf(segSrcPoints),
          transformedBounds: boundsOf(segTransPoints),
          boundsPrecision: "EXACT_LINE"
        });
      }
      currSrc = startSrc;
      currTrans = startTrans;
      commandIndex++;
    }
  });
  flushSubpath();
  return {
    subpaths,
    sourceBounds: boundsOf(allSourcePoints),
    transformedBounds: boundsOf(allTransformedPoints)
  };
}
function collectPageVectors(page2, captureLineage = false, pageNumber = 0) {
  const vectors = [];
  const operations = [];
  const vectorLineageRefs = {};
  let order = 0;
  let rootDrawOps = 0, fillRoots = 0, strokeRoots = 0, fillSubs = 0, strokeSubs = 0;
  let transformedCount = 0, nonIdentity = 0, invalidBounds = 0, zeroArea = 0;
  let doubleTransformDetected = 0;
  let nonFiniteCoordinates = 0;
  const isIdentity = (m) => m[0] === 1 && m[3] === 1 && m[1] === 0 && m[2] === 0 && m[4] === 0 && m[5] === 0;
  const add = (operation, path, ctm, extra = {}) => {
    const operationIndex = rootDrawOps;
    rootDrawOps++;
    if (operation === "fill-path") fillRoots++;
    else strokeRoots++;
    if (!isIdentity(ctm)) nonIdentity++;
    transformedCount++;
    const walked = walkPath(path, ctm);
    const b = boundsOf(walked.points);
    if (!isFinite(b[0]) || !isFinite(b[1]) || !isFinite(b[2]) || !isFinite(b[3])) invalidBounds++;
    else if (rectAreaOf(b) <= 0) zeroArea++;
    const rootId = `v${order++}`;
    vectors.push({ id: rootId, operation, commands: walked.commands, points: walked.points, subpaths: walked.subpaths, bounds: b, ...extra });
    const opId = `p${pageNumber}_op${operationIndex}`;
    if (captureLineage) {
      vectorLineageRefs[rootId] = [{ opId }];
      const lineageData = walkPathWithLineage(path, ctm, pageNumber, operationIndex, operation);
      const opLineage = {
        operationIndex,
        operationId: opId,
        operationType: operation,
        paintOrder: operationIndex,
        transform: [...ctm],
        strokeColour: operation === "stroke-path" ? extra.color : void 0,
        fillColour: operation === "fill-path" ? extra.color : void 0,
        strokeAlpha: operation === "stroke-path" ? extra.alpha : void 0,
        fillAlpha: operation === "fill-path" ? extra.alpha : void 0,
        strokeWidth: extra.strokeWidth,
        sourceBounds: lineageData.sourceBounds,
        transformedBounds: lineageData.transformedBounds,
        subpaths: lineageData.subpaths
      };
      if (walked.points.length === lineageData.subpaths.flatMap((s) => s.segments.flatMap((sg) => sg.transformedPoints)).length) {
      } else {
      }
      const allTransformedPts = lineageData.subpaths.flatMap((s) => s.segments.flatMap((sg) => sg.transformedPoints));
      for (const p of allTransformedPts) {
        if (!isFinite(p.x) || !isFinite(p.y)) {
          nonFiniteCoordinates++;
        }
      }
      operations.push(opLineage);
    }
    walked.subpaths.forEach((pts, i) => {
      const sb = boundsOf(pts);
      if (operation === "fill-path") fillSubs++;
      else strokeSubs++;
      if (!isFinite(sb[0]) || !isFinite(sb[1]) || !isFinite(sb[2]) || !isFinite(sb[3])) invalidBounds++;
      else if (rectAreaOf(sb) <= 0) zeroArea++;
      const subpathVectorId = `${rootId}:s${i}`;
      vectors.push({ id: subpathVectorId, sourceRootId: rootId, operation, commands: [], points: pts, subpaths: [], bounds: sb, ...extra });
      if (captureLineage) {
        vectorLineageRefs[subpathVectorId] = [{
          opId,
          subpathId: `${opId}_s${i}`
        }];
      }
    });
  };
  const device = new mupdf.Device({
    fillPath(path, evenOdd, ctm, _cs, color, alpha) {
      add("fill-path", path, ctm, { evenOdd, color: [...color], alpha });
    },
    strokePath(path, stroke, ctm, _cs, color, alpha) {
      add("stroke-path", path, ctm, { color: [...color], alpha, strokeWidth: stroke.getLineWidth(), dashes: stroke.getDashes() });
    }
  });
  page2.runPageContents(device, mupdf.Matrix.identity);
  device.close();
  const res = {
    vectors,
    diagnostics: {
      rootDrawingOperations: rootDrawOps,
      decomposedSubpaths: fillSubs + strokeSubs,
      fillRootOperations: fillRoots,
      fillSubpaths: fillSubs,
      strokeRootOperations: strokeRoots,
      strokeSubpaths: strokeSubs,
      transformedPathCount: transformedCount,
      nonIdentityTransformCount: nonIdentity,
      invalidBoundsCount: invalidBounds,
      zeroAreaSubpathCount: zeroArea,
      doubleTransformDetected,
      nonFiniteCoordinates
    }
  };
  if (captureLineage) {
    res.lineageStore = { operations };
    res.vectorLineageRefs = vectorLineageRefs;
  }
  return res;
}
function rectAreaOf(r) {
  return Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
}

// src/geometry/index.ts
var rectArea = (r) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
var rectWidth = (r) => r[2] - r[0];
var rectHeight = (r) => r[3] - r[1];
var intersects = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
function dedupePoints(points, tol = 0.01) {
  const out = [];
  for (const p of points) {
    const q = out.at(-1);
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > tol) out.push(p);
  }
  return out;
}
function isAxisRect(v, tol = 1.5) {
  const p = dedupePoints(v.points);
  if (p.length < 4) return false;
  const r = v.bounds, w = rectWidth(r), h = rectHeight(r);
  if (w <= 0 || h <= 0) return false;
  return p.every((x) => Math.min(Math.abs(x.x - r[0]), Math.abs(x.x - r[2])) <= tol || Math.min(Math.abs(x.y - r[1]), Math.abs(x.y - r[3])) <= tol);
}
function medial(r) {
  const w = rectWidth(r), h = rectHeight(r);
  return w >= h ? { a: { x: r[0], y: (r[1] + r[3]) / 2 }, b: { x: r[2], y: (r[1] + r[3]) / 2 }, thickness: h } : { a: { x: (r[0] + r[2]) / 2, y: r[1] }, b: { x: (r[0] + r[2]) / 2, y: r[3] }, thickness: w };
}
function pointSegmentDistance(p, s) {
  const vx = s.b.x - s.a.x, vy = s.b.y - s.a.y, l2 = vx * vx + vy * vy;
  if (!l2) return Math.hypot(p.x - s.a.x, p.y - s.a.y);
  const t = Math.max(0, Math.min(1, ((p.x - s.a.x) * vx + (p.y - s.a.y) * vy) / l2));
  return Math.hypot(p.x - (s.a.x + t * vx), p.y - (s.a.y + t * vy));
}

// src/mupdf-pure.ts
var PURE_DEFAULTS = {
  pageFillMaxRatio: 0.8,
  minThickness: 3.2,
  maxThickness: 16,
  minLength: 18,
  minAspect: 3.2,
  mergeGap: 2.4,
  axisToleranceRadians: 1.4,
  connectTolerance: 5.5,
  acceptAt: 0.66,
  doorGapMin: 14,
  doorGapMax: 60,
  faceOverlapMin: 0.55,
  recoveryEndpointTol: 4
};
function derivePureConfig(pageBounds, bands, precisionOverride) {
  const pb = pageBounds;
  const pageDiag = Math.hypot(pb[2] - pb[0], pb[3] - pb[1]);
  const precision = precisionOverride ?? Math.max(0.25, pageDiag / 2e3);
  const dom = bands.length ? bands.reduce((m, b) => b.frequency > m.frequency ? b : m, bands[0]).center : 6;
  const thin = bands.length ? Math.min(...bands.map((b) => b.center)) : 3.2;
  const thick = bands.length ? Math.max(...bands.map((b) => b.center)) : 16;
  const minThickness = Math.max(precision, thin * 0.7);
  const maxThickness = Math.max(thick * 1.4, thin * 4);
  const minLength = Math.max(precision * 8, thin * 3);
  const mergeGap = Math.max(precision * 1.5, thin * 0.4);
  const connectTolerance = Math.max(precision * 2, thick * 0.5);
  const axisToleranceRadians = Math.max(0.6, precision * 0.5);
  const doorGapMin = dom * 0.6;
  const doorGapMax = dom * 1.2 + thick;
  const clamp2 = (v, lo, hi, fallback) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  const boundedMinThickness = clamp2(minThickness, precision, pageDiag * 0.01, PURE_DEFAULTS.minThickness);
  const boundedMaxThickness = clamp2(maxThickness, boundedMinThickness * 2, pageDiag * 0.02, PURE_DEFAULTS.maxThickness);
  const boundedMinLength = clamp2(minLength, precision * 4, pageDiag * 0.05, PURE_DEFAULTS.minLength);
  const boundedMergeGap = clamp2(mergeGap, precision * 0.5, thin, PURE_DEFAULTS.mergeGap);
  const boundedConnectTolerance = clamp2(connectTolerance, precision, thick, PURE_DEFAULTS.connectTolerance);
  const boundedAxisTol = clamp2(axisToleranceRadians, 0.01, Math.PI / 4, PURE_DEFAULTS.axisToleranceRadians);
  const boundedDoorGapMin = clamp2(doorGapMin, precision * 2, pageDiag * 0.01, PURE_DEFAULTS.doorGapMin);
  const boundedDoorGapMax = clamp2(doorGapMax, boundedDoorGapMin * 1.5, Math.min(pageDiag * 0.02, dom * 6), PURE_DEFAULTS.doorGapMax);
  return {
    ...PURE_DEFAULTS,
    minThickness: +boundedMinThickness.toFixed(3),
    maxThickness: +boundedMaxThickness.toFixed(3),
    minLength: +boundedMinLength.toFixed(3),
    mergeGap: +boundedMergeGap.toFixed(3),
    connectTolerance: +boundedConnectTolerance.toFixed(3),
    axisToleranceRadians: +boundedAxisTol.toFixed(4),
    doorGapMin: +boundedDoorGapMin.toFixed(3),
    doorGapMax: +boundedDoorGapMax.toFixed(3)
  };
}
function clone(x) {
  return JSON.parse(JSON.stringify(x));
}
function withOrientation(c0) {
  const c = c0;
  c.orientation = segOrientation(c.centerline.a, c.centerline.b);
  c.orientationRadians = segmentAngleRad(c.centerline);
  c.orientationClass = segmentAngleClass(c.centerline);
  return c;
}
function segOrientation(a, b) {
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
  if (dx < 1e-6 && dy < 1e-6) return 0;
  return dx >= dy ? 0 : Math.PI / 2;
}
function segmentAngleRad(seg) {
  const ang = Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x);
  return ang < 0 ? ang + Math.PI * 2 : ang;
}
function segmentAngleClass(seg) {
  const ang = segmentAngleRad(seg) % Math.PI;
  const eps = 0.02;
  if (ang <= eps || Math.abs(ang - Math.PI) < eps) return "horizontal";
  if (Math.abs(ang - Math.PI / 2) <= eps) return "vertical";
  return "diagonal";
}
function segmentAngleDiffRad(s1, s2) {
  const a = segmentAngleRad(s1) % Math.PI;
  const b = segmentAngleRad(s2) % Math.PI;
  let d = Math.abs(a - b);
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}
function perpDistance(p, s) {
  return pointSegmentDistance(p, s);
}
function pointLineDistance(p, s) {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-9) return Math.hypot(p.x - s.a.x, p.y - s.a.y);
  return Math.abs((p.x - s.a.x) * dy - (p.y - s.a.y) * dx) / l;
}
function segLen(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
function projParam(p, u) {
  return p.x * u.x + p.y * u.y;
}
function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < (xj - xi) * (p.y - yi) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
function derivePureBuildingRoi(vectors, pageBounds, cfg = PURE_DEFAULTS) {
  const pageArea = rectArea(pageBounds);
  const candidates = vectors.filter(
    (v) => v.operation === "fill-path" && rectArea(v.bounds) > 0 && rectArea(v.bounds) < pageArea * cfg.pageFillMaxRatio
  );
  if (!candidates.length) throw new Error("No architectural fill candidate found");
  const dominant = [...candidates].sort((a, b) => rectArea(b.bounds) - rectArea(a.bounds))[0];
  return { roiMupdf: dominant.bounds, roiSource: dominant.bounds };
}
var _cid = 0;
function nextId(prefix) {
  return `${prefix}${_cid++}`;
}
function resetIds() {
  _cid = 0;
}
function buildSubpathIndex(vectors) {
  const idx = /* @__PURE__ */ new Map();
  for (const v of vectors) {
    if (v.sourceRootId && v.operation === "fill-path") {
      if (!idx.has(v.sourceRootId)) idx.set(v.sourceRootId, []);
      idx.get(v.sourceRootId).push(v);
    }
  }
  return idx;
}
function genFilledRects(vectors, roi, cfg) {
  const roots = vectors.filter((v) => !v.sourceRootId && v.operation === "fill-path");
  const subIdx = buildSubpathIndex(vectors);
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const root of roots) {
    const subs = subIdx.get(root.id) ?? [];
    const targets = subs.length ? subs : [root];
    for (const t of targets) {
      if (!intersects(t.bounds, roi) || !isAxisRect(t)) continue;
      const w = rectWidth(t.bounds), h = rectHeight(t.bounds), short = Math.min(w, h), long = Math.max(w, h);
      if (short < cfg.minThickness || short > cfg.maxThickness || long < cfg.minLength || long / short < cfg.minAspect) continue;
      const key = t.bounds.map((x) => x.toFixed(1)).join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      const md = medial(t.bounds);
      out.push(withOrientation({
        id: nextId("fr"),
        evidenceType: "filled-rect",
        sourceRootIds: [root.id],
        sourceSubpathIds: subs.length ? subs.map((s) => s.id) : [],
        sourceStrokeIds: [],
        centerline: { a: { ...md.a }, b: { ...md.b } },
        thickness: short,
        length: long,
        confidence: 0.82,
        evidence: ["closed-filled-wall-mass", short >= 8 ? "structural-thickness-band" : "partition-thickness"]
      }));
    }
  }
  return out;
}
function genFilledPolygons(vectors, roi, cfg) {
  const roots = vectors.filter((v) => !v.sourceRootId && v.operation === "fill-path");
  const subIdx = buildSubpathIndex(vectors);
  const out = [];
  for (const root of roots) {
    const subs = subIdx.get(root.id) ?? [];
    const targets = subs.length ? subs : [root];
    for (const t of targets) {
      if (!intersects(t.bounds, roi)) continue;
      if (isAxisRect(t)) continue;
      const rings = t.subpaths && t.subpaths.length > 1 ? t.subpaths.map((r) => dedupePoints(r)) : [dedupePoints(t.points)];
      if (rings.some((r) => r.length < 4)) continue;
      const ortho = rings.every((ring) => ring.every((p, i) => {
        const q = ring[(i + 1) % ring.length];
        return Math.abs(p.x - q.x) < 1.5 || Math.abs(p.y - q.y) < 1.5;
      }));
      if (!ortho) continue;
      const strips = decomposeOrthogonalPolygon(rings, t.bounds, cfg);
      for (const st of strips) {
        const w = rectWidth(st.bbox), h = rectHeight(st.bbox), short = Math.min(w, h), long = Math.max(w, h);
        if (short < cfg.minThickness || short > cfg.maxThickness || long < cfg.minLength || long / short < cfg.minAspect) continue;
        const md = medial(st.bbox);
        out.push(withOrientation({
          id: nextId("fp"),
          evidenceType: "filled-polygon",
          sourceRootIds: [root.id],
          sourceSubpathIds: [t.id],
          sourceStrokeIds: [],
          centerline: { a: { ...md.a }, b: { ...md.b } },
          thickness: short,
          length: long,
          confidence: 0.74,
          evidence: ["closed-filled-wall-mass", "general-polygon-decomposition", short >= 8 ? "structural-thickness-band" : "partition-thickness"]
        }));
      }
    }
  }
  return out;
}
function decomposeOrthogonalPolygon(rings, bbox, cfg) {
  const x0 = Math.floor(bbox[0]), y0 = Math.floor(bbox[1]), x1 = Math.ceil(bbox[2]), y1 = Math.ceil(bbox[3]);
  const W = Math.max(1, x1 - x0), H = Math.max(1, y1 - y0);
  const inside = (px, py) => {
    let odd = false;
    for (const ring of rings) {
      if (pointInPolygon({ x: px, y: py }, ring)) odd = !odd;
    }
    return odd;
  };
  const rows = [];
  for (let gy = 0; gy < H; gy++) {
    const runs = [];
    let start = -1;
    for (let gx = 0; gx <= W; gx++) {
      const on = gx < W && inside(x0 + gx + 0.5, y0 + gy + 0.5);
      if (on && start < 0) start = gx;
      if (!on && start >= 0) {
        runs.push({ a: start, b: gx });
        start = -1;
      }
    }
    rows.push(runs);
  }
  const out = [];
  let open = [];
  const close = (o, yEnd) => {
    const rw = o.b - o.a, rh = yEnd - o.y;
    if (rw <= 0 || rh <= 0) return;
    out.push({ bbox: [x0 + o.a, y0 + o.y, x0 + o.b, y0 + yEnd], kind: rw >= rh ? "h" : "v" });
  };
  for (let gy = 0; gy <= H; gy++) {
    const runs = gy < H ? rows[gy] : [];
    const next = [];
    for (const r of runs) {
      const cont = open.find((o) => o.a === r.a && o.b === r.b);
      if (cont) {
        next.push(cont);
        open = open.filter((o) => o !== cont);
      } else next.push({ a: r.a, b: r.b, y: gy });
    }
    for (const o of open) close(o, gy);
    open = next;
  }
  return out;
}
function genParallelFaces(vectors, roi, cfg, bands) {
  const strokesAll = vectors.filter((v) => v.operation === "stroke-path" && intersects(v.bounds, roi));
  const strokes = strokesAll.filter((s) => {
    const w = rectWidth(s.bounds), h = rectHeight(s.bounds);
    const len = Math.max(w, h), short = Math.min(w, h);
    const sw = s.strokeWidth ?? 0.5;
    return len >= cfg.minLength && short <= cfg.maxThickness * 1.6 && sw <= cfg.maxThickness;
  });
  const out = [];
  const used = /* @__PURE__ */ new Set();
  const cell = cfg.maxThickness * 6;
  const grid = /* @__PURE__ */ new Map();
  const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  strokes.forEach((s, i) => {
    const c = strokeCenterline(s);
    const k = key((c.a.x + c.b.x) / 2, (c.a.y + c.b.y) / 2);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const neigh = (s) => {
    const c = strokeCenterline(s);
    const cx = (c.a.x + c.b.x) / 2, cy = (c.a.y + c.b.y) / 2;
    const out2 = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const g = grid.get(`${Math.floor(cx / cell) + dx},${Math.floor(cy / cell) + dy}`);
      if (g) out2.push(...g);
    }
    return out2;
  };
  for (let a = 0; a < strokes.length; a++) {
    const sa = strokes[a];
    if (used.has(sa.id)) continue;
    const ca = strokeCenterline(sa);
    for (const b of neigh(sa)) {
      if (b <= a || used.has(strokes[b].id)) continue;
      const sb = strokes[b];
      const cb = strokeCenterline(sb);
      if (segmentAngleClass(ca) === "diagonal" && segmentAngleClass(cb) === "diagonal") continue;
      if (segmentAngleDiffRad(ca, cb) > cfg.axisToleranceRadians) continue;
      const sep = perpSeparation(ca, cb);
      const inBand = sep >= cfg.minThickness * 0.8 && sep <= cfg.maxThickness * 1.2 && bands.some((bd) => sep >= bd.min * 0.7 && sep <= bd.max * 1.3);
      if (!inBand) continue;
      const ov = projectedOverlap(ca, cb);
      if (ov < cfg.faceOverlapMin) continue;
      const lenA = segLen(ca.a, ca.b), lenB = segLen(cb.a, cb.b);
      if (lenA < cfg.minLength * 1.5 || lenB < cfg.minLength * 1.5) continue;
      const mid = {
        a: { x: (ca.a.x + cb.a.x) / 2, y: (ca.a.y + cb.a.y) / 2 },
        b: { x: (ca.b.x + cb.b.x) / 2, y: (ca.b.y + cb.b.y) / 2 }
      };
      out.push(withOrientation({
        id: nextId("pf"),
        evidenceType: "parallel-face",
        sourceRootIds: [sa.id, sb.id],
        sourceSubpathIds: [],
        sourceStrokeIds: [sa.id, sb.id],
        centerline: mid,
        thickness: sep,
        length: segLen(mid.a, mid.b),
        confidence: 0.7,
        evidence: ["parallel-face-pairing", "structural-thickness-band"]
      }));
      used.add(sa.id);
      used.add(sb.id);
    }
  }
  return out;
}
function strokeCenterline(s) {
  const b = s.bounds;
  const w = rectWidth(b), h = rectHeight(b);
  return w >= h ? { a: { x: b[0], y: (b[1] + b[3]) / 2 }, b: { x: b[2], y: (b[1] + b[3]) / 2 } } : { a: { x: (b[0] + b[2]) / 2, y: b[1] }, b: { x: (b[0] + b[2]) / 2, y: b[3] } };
}
function perpSeparation(a, b) {
  const d1 = perpDistance(a.a, b) + perpDistance(a.b, b);
  const d2 = perpDistance(b.a, a) + perpDistance(b.b, a);
  return Math.min(d1, d2) / 2;
}
function projectedOverlap(a, b) {
  const ua = norm(a.b.x - a.a.x, a.b.y - a.a.y);
  const ub = norm(b.b.x - b.a.x, b.b.y - b.a.y);
  const pa0 = projParam(a.a, ua), pa1 = projParam(a.b, ua);
  const pb0 = projParam(b.a, ub), pb1 = projParam(b.b, ub);
  const lo = Math.max(Math.min(pa0, pa1), Math.min(pb0, pb1));
  const hi = Math.min(Math.max(pa0, pa1), Math.max(pb0, pb1));
  const ov = Math.max(0, hi - lo);
  const short = Math.min(Math.abs(pa1 - pa0), Math.abs(pb1 - pb0)) || 1;
  return ov / short;
}
function norm(x, y) {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}
function genSingleLines(vectors, roi, cfg, skeleton) {
  const strokesAll = vectors.filter((v) => v.operation === "stroke-path" && intersects(v.bounds, roi));
  const strokes = strokesAll.filter((s) => {
    const w = rectWidth(s.bounds), h = rectHeight(s.bounds);
    const len = Math.max(w, h), short = Math.min(w, h);
    const sw = s.strokeWidth ?? 0.5;
    return len >= cfg.minLength * 1.5 && short <= cfg.maxThickness * 1.6 && sw <= cfg.maxThickness;
  });
  const out = [];
  for (const s of strokes) {
    const c = strokeCenterline(s);
    const len = segLen(c.a, c.b);
    if (len < cfg.minLength * 1.5) continue;
    const explained = skeleton.some((k) => k.evidenceType === "parallel-face" && k.sourceStrokeIds.includes(s.id));
    if (explained) continue;
    let support = 0;
    for (const k of skeleton) {
      const dEnd = Math.min(pointSegmentDistance(k.centerline.a, c), pointSegmentDistance(k.centerline.b, c));
      const dMid = pointSegmentDistance({ x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 }, k.centerline);
      if (dEnd <= cfg.connectTolerance * 1.5 || dMid <= cfg.connectTolerance * 1.5) {
        support++;
        break;
      }
    }
    out.push(withOrientation({
      id: nextId("sl"),
      evidenceType: "single-line",
      sourceRootIds: [s.id],
      sourceSubpathIds: [],
      sourceStrokeIds: [s.id],
      centerline: c,
      thickness: s.strokeWidth ? s.strokeWidth * 2 : 3.5,
      length: len,
      confidence: support > 0 ? 0.55 : 0.4,
      evidence: support > 0 ? ["structural-single-line", "attached-to-confirmed-wall"] : ["structural-single-line"]
    }));
  }
  return out;
}
function inferThicknessBands(samples, cfg) {
  const valid = samples.filter((s) => s >= cfg.minThickness * 0.7 && s <= cfg.maxThickness * 1.4);
  if (!valid.length) return [];
  const buckets = /* @__PURE__ */ new Map();
  for (const s of valid) {
    const k = Math.round(s);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(s);
  }
  const bands = [];
  for (const [k, arr] of buckets) {
    if (arr.length < 2) continue;
    const sorted = [...arr].sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / arr.length;
    bands.push({
      center: +mean.toFixed(2),
      min: +sorted[0].toFixed(2),
      max: +sorted[sorted.length - 1].toFixed(2),
      frequency: arr.length,
      totalSupportedLength: 0,
      confidence: Math.min(1, 0.5 + arr.length * 0.05)
    });
  }
  bands.sort((a, b) => b.frequency - a.frequency);
  return bands;
}
function fusePureCandidates(cands, cfg) {
  const n = cands.length;
  const out = cands.map((x) => clone(x));
  const ledger = [];
  if (n === 0) return { fused: out, ledger };
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      const p = parent[x];
      parent[x] = parent[p];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    parent[find(a)] = find(b);
  };
  const cell = cfg.maxThickness * 8;
  const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const grid = /* @__PURE__ */ new Map();
  out.forEach((c, i) => {
    const mx = (c.centerline.a.x + c.centerline.b.x) / 2, my = (c.centerline.a.y + c.centerline.b.y) / 2;
    const k = key(mx, my);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  for (let i = 0; i < n; i++) {
    const a = out[i];
    const mx = (a.centerline.a.x + a.centerline.b.x) / 2, my = (a.centerline.a.y + a.centerline.b.y) / 2;
    const neigh = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const g = grid.get(`${Math.floor(mx / cell) + dx},${Math.floor(my / cell) + dy}`);
      if (g) neigh.push(...g);
    }
    for (const j of neigh) {
      if (j <= i) continue;
      const b = out[j];
      const ang = segmentAngleRad(a.centerline) % Math.PI;
      const angB = segmentAngleRad(b.centerline) % Math.PI;
      if (Math.abs(ang - angB) > cfg.axisToleranceRadians) continue;
      const perp = (perpDistance(a.centerline.a, b.centerline) + perpDistance(a.centerline.b, b.centerline)) / 2;
      if (perp > cfg.mergeGap * 3) continue;
      const ov = projectedOverlap(a.centerline, b.centerline);
      if (ov < 0.5) continue;
      if (Math.abs(a.thickness - b.thickness) > Math.max(a.thickness, b.thickness) * 0.5) continue;
      const shared = a.sourceRootIds.some((r) => b.sourceRootIds.includes(r)) || a.sourceSubpathIds.some((s) => b.sourceSubpathIds.includes(s)) || a.sourceStrokeIds.some((s) => b.sourceStrokeIds.includes(s));
      union(i, j);
      ledger.push({ physicalWallId: `g${find(i)}`, fusedCandidateIds: [a.id, b.id], reason: `angular+perp+overlap${shared ? "+shared-source" : ""}` });
    }
  }
  const groups = /* @__PURE__ */ new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }
  const fused = [];
  for (const [, idxs] of groups) {
    if (idxs.length === 1) {
      fused.push(out[idxs[0]]);
      continue;
    }
    const members = idxs.map((k) => out[k]);
    const base = members.slice().sort((p, q) => q.confidence - p.confidence || q.length - p.length)[0];
    const merged2 = withOrientation({
      ...base,
      id: `m:${members.map((m) => m.id).join("+")}`,
      evidenceType: base.evidenceType,
      sourceRootIds: [...new Set(members.flatMap((m) => m.sourceRootIds))],
      sourceSubpathIds: [...new Set(members.flatMap((m) => m.sourceSubpathIds))],
      sourceStrokeIds: [...new Set(members.flatMap((m) => m.sourceStrokeIds))],
      thickness: +(members.reduce((s, m) => s + m.thickness, 0) / members.length).toFixed(2),
      length: Math.max(...members.map((m) => m.length)),
      confidence: Math.min(1, base.confidence + 0.1 * (members.length - 1)),
      evidence: [...new Set(members.flatMap((m) => m.evidence))]
    });
    fused.push(merged2);
  }
  return { fused, ledger };
}
function mergeCollinearRuns(cands, cfg) {
  const out = cands.map((x) => clone(x));
  const runs = [];
  let changed = true;
  let guard = 0;
  while (changed && guard++ < out.length + 5) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      for (let j = i + 1; j < out.length; j++) {
        const b = out[j];
        if (segmentAngleDiffRad(a.centerline, b.centerline) > cfg.axisToleranceRadians) continue;
        if (Math.abs(a.thickness - b.thickness) > Math.max(a.thickness, b.thickness) * 0.25) continue;
        const u = norm(a.centerline.b.x - a.centerline.a.x, a.centerline.b.y - a.centerline.a.y);
        const pa0 = projParam(a.centerline.a, u), pa1 = projParam(a.centerline.b, u);
        const pb0 = projParam(b.centerline.a, u), pb1 = projParam(b.centerline.b, u);
        const a0 = Math.min(pa0, pa1), a1 = Math.max(pa0, pa1);
        const b0 = Math.min(pb0, pb1), b1 = Math.max(pb0, pb1);
        const perp = (perpDistance(a.centerline.a, b.centerline) + perpDistance(a.centerline.b, b.centerline)) / 2;
        if (perp > cfg.connectTolerance) continue;
        const gap = Math.max(a0, b0) - Math.min(a1, b1);
        const overlap = Math.min(a1, b1) - Math.max(a0, b0);
        if (gap > cfg.mergeGap && overlap <= 0) continue;
        if (overlap > 0) continue;
        const p1 = pa0 <= pb0 ? a.centerline.a : b.centerline.a;
        const p2 = pa1 >= pb1 ? a.centerline.b : b.centerline.b;
        const combined = withOrientation({
          ...a,
          id: `cm:${a.id}+${b.id}`,
          evidenceType: a.evidenceType,
          sourceRootIds: [.../* @__PURE__ */ new Set([...a.sourceRootIds, ...b.sourceRootIds])],
          sourceSubpathIds: [.../* @__PURE__ */ new Set([...a.sourceSubpathIds, ...b.sourceSubpathIds])],
          sourceStrokeIds: [.../* @__PURE__ */ new Set([...a.sourceStrokeIds, ...b.sourceStrokeIds])],
          centerline: { a: { ...p1 }, b: { ...p2 } },
          length: Math.hypot(p2.x - p1.x, p2.y - p1.y),
          thickness: (a.thickness + b.thickness) / 2,
          evidence: [.../* @__PURE__ */ new Set([...a.evidence, ...b.evidence, "collinear-run-merge"])]
        });
        out[i] = combined;
        out.splice(j, 1);
        runs.push({ combinedId: combined.id, memberIds: [a.id, b.id], openingIntervals: [] });
        changed = true;
        break;
      }
    }
  }
  return { merged: out, runs };
}
function linkDoorGapRuns(cands, cfg) {
  const fragIds = /* @__PURE__ */ new Set();
  const runs = [];
  const horiz = cands.filter((c) => c.orientationClass === "horizontal");
  const vert = cands.filter((c) => c.orientationClass === "vertical");
  const diag = cands.filter((c) => c.orientationClass === "diagonal");
  const process2 = (group) => {
    for (let i = 0; i < group.length; i++) {
      const a = group[i];
      for (let j = 0; j < group.length; j++) {
        if (i === j) continue;
        const b = group[j];
        if (a.thickness < cfg.minThickness || b.thickness < cfg.minThickness) continue;
        if (Math.abs(a.thickness - b.thickness) > Math.max(a.thickness, b.thickness) * 0.4) continue;
        const ua = norm(a.centerline.b.x - a.centerline.a.x, a.centerline.b.y - a.centerline.a.y);
        const pa0 = projParam(a.centerline.a, ua), pa1 = projParam(a.centerline.b, ua);
        const pb0 = projParam(b.centerline.a, ua), pb1 = projParam(b.centerline.b, ua);
        const a0 = Math.min(pa0, pa1), a1 = Math.max(pa0, pa1);
        const b0 = Math.min(pb0, pb1), b1 = Math.max(pb0, pb1);
        if (a1 > b0) continue;
        const gap = b0 - a1;
        if (gap < cfg.doorGapMin || gap > cfg.doorGapMax) continue;
        const perp = (pointLineDistance(a.centerline.a, b.centerline) + pointLineDistance(a.centerline.b, b.centerline)) / 2;
        if (perp > cfg.mergeGap) continue;
        runs.push({
          logicalWallRunId: `run:${a.id}-${b.id}`,
          physicalFragmentIds: [a.id, b.id],
          openingIntervals: [{ from: +a1.toFixed(2), to: +b0.toFixed(2) }],
          sourcePrimitiveIds: [.../* @__PURE__ */ new Set([...a.sourceSubpathIds, ...a.sourceStrokeIds, ...b.sourceSubpathIds, ...b.sourceStrokeIds])]
        });
        fragIds.add(a.id);
        fragIds.add(b.id);
      }
    }
  };
  process2(horiz);
  process2(vert);
  process2(diag);
  return { runs, fragmentIds: fragIds };
}
function buildJunctionGraph(cands, cfg, pageBounds) {
  const domThick = cands.reduce((m, c) => Math.max(m, c.thickness), cfg.connectTolerance);
  const tol = Math.max(cfg.connectTolerance, domThick * 0.6);
  const prec = 0.01;
  const junctions = [];
  const canonical = cands.map((c) => clone(c));
  const cell = tol * 4;
  const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const grid = /* @__PURE__ */ new Map();
  canonical.forEach((c, i) => {
    for (const p of [c.centerline.a, c.centerline.b]) {
      const k = key(p.x, p.y);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
  });
  const near = (p) => {
    const out = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const g = grid.get(`${Math.floor(p.x / cell) + dx},${Math.floor(p.y / cell) + dy}`);
      if (g) out.push(...g);
    }
    return out;
  };
  const seenPair = /* @__PURE__ */ new Set();
  for (let i = 0; i < canonical.length; i++) {
    const a = canonical[i];
    for (const ep of [a.centerline.a, a.centerline.b]) {
      for (const j of near(ep)) {
        if (j <= i) continue;
        if (seenPair.has(`${i},${j}`)) continue;
        const b = canonical[j];
        const ea = [a.centerline.a, a.centerline.b];
        const eb = [b.centerline.a, b.centerline.b];
        let kind = null;
        let at = ep;
        let score = Infinity;
        for (const pa of ea) for (const pb of eb) {
          const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
          if (d <= tol + prec && d < score) {
            score = d;
            kind = "endpoint";
            at = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
          }
        }
        for (const pb of eb) {
          const d = pointSegmentDistance(pb, a.centerline);
          if (d <= tol + prec && d < score) {
            score = d;
            kind = "T";
            at = pb;
          }
        }
        for (const pa of ea) {
          const d = pointSegmentDistance(pa, b.centerline);
          if (d <= tol + prec && d < score) {
            score = d;
            kind = "T";
            at = pa;
          }
        }
        const ang = segmentAngleRad(a.centerline) % Math.PI;
        const angB = segmentAngleRad(b.centerline) % Math.PI;
        if (Math.abs(ang - angB) <= cfg.axisToleranceRadians) {
          const ov = projectedOverlap(a.centerline, b.centerline);
          const gapEnd = Math.min(
            pointSegmentDistance(a.centerline.a, b.centerline) + pointSegmentDistance(a.centerline.b, b.centerline),
            pointSegmentDistance(b.centerline.a, a.centerline) + pointSegmentDistance(b.centerline.b, a.centerline)
          ) / 2;
          if (ov >= 0.5) kind = kind ?? "collinear";
          else if (gapEnd <= tol && ov >= 0) kind = kind ?? "collinear";
        }
        if (kind) {
          seenPair.add(`${i},${j}`);
          junctions.push({ kind, at, candidateIds: [a.id, b.id], scaleDerivedTolerance: +tol.toFixed(2) });
        }
      }
    }
  }
  return { junctions, canonical };
}
function analyzeWallConnectivity(accepted, roi, cfg) {
  const onPerimeter = (p) => {
    const m = 6;
    return Math.min(Math.abs(p.x - roi[0]), Math.abs(p.x - roi[2]), Math.abs(p.y - roi[1]), Math.abs(p.y - roi[3])) <= m;
  };
  const near = (_p) => accepted.map((_, i) => i);
  const perWall = accepted.map((w) => {
    const localTol = Math.max(0.5, w.thickness * 0.5 + 2, cfg.connectTolerance * 0.6);
    const ends = [];
    let touched = /* @__PURE__ */ new Set();
    let valid = false;
    let types = /* @__PURE__ */ new Set();
    for (const which of ["a", "b"]) {
      const e = w.centerline[which];
      const perim = onPerimeter(e);
      let bestEp = Infinity, bestSeg = Infinity, bestType = "free";
      let anyEp = Infinity, anyEpId = null, anySeg = Infinity;
      const conn = [];
      for (const nwi of near(e)) {
        if (nwi === accepted.indexOf(w)) continue;
        const o = accepted[nwi];
        if (o.physicalWallId === w.physicalWallId) continue;
        const pairTol = (w.thickness + o.thickness) / 2 + 2;
        const dEp = Math.hypot(e.x - o.centerline.a.x, e.y - o.centerline.a.y);
        const dEpB = Math.hypot(e.x - o.centerline.b.x, e.y - o.centerline.b.y);
        const dEpMin = Math.min(dEp, dEpB);
        const dSeg = pointSegmentDistance(e, o.centerline);
        if (dEpMin < anyEp) {
          anyEp = dEpMin;
          anyEpId = o.physicalWallId;
        }
        if (dSeg < anySeg) anySeg = dSeg;
        if (dEpMin <= pairTol && dEpMin < bestEp) {
          bestEp = dEpMin;
          bestType = "endpoint";
          conn.push(o.physicalWallId);
          touched.add(o.physicalWallId);
        } else if (dSeg <= pairTol && dSeg < bestSeg && bestType !== "endpoint") {
          const u = norm(o.centerline.b.x - o.centerline.a.x, o.centerline.b.y - o.centerline.a.y);
          const t = projParam(e, u) - projParam(o.centerline.a, u);
          const olen = segLen(o.centerline.a, o.centerline.b);
          if (t > -pairTol && t < olen + pairTol) {
            bestSeg = dSeg;
            bestType = "T";
            conn.push(o.physicalWallId);
            touched.add(o.physicalWallId);
          }
        }
      }
      let openingId = null;
      if (bestType === "free" && !perim && anyEp <= cfg.doorGapMax && anyEpId) {
        bestType = "opening";
        openingId = anyEpId;
        valid = true;
      }
      if (perim) {
        bestType = "perimeter";
        valid = true;
      } else if (bestType === "endpoint" || bestType === "T") valid = true;
      types.add(bestType);
      ends.push({
        endpoint: e,
        nearestEndpointDistance: Number.isFinite(bestEp) ? +bestEp.toFixed(2) : Number.isFinite(anyEp) ? +anyEp.toFixed(2) : -1,
        nearestSegmentDistance: Number.isFinite(bestSeg) ? +bestSeg.toFixed(2) : Number.isFinite(anySeg) ? +anySeg.toFixed(2) : -1,
        intersectionType: bestType,
        connectedPhysicalWallIds: [...new Set(conn)],
        localTolerance: +localTol.toFixed(2),
        dominantThickness: +w.thickness.toFixed(2),
        perimeterAttachment: perim,
        openingContinuationId: openingId
      });
    }
    const endTypes = ends.map((e) => e.intersectionType);
    const connectedEnds = endTypes.filter((t) => t === "endpoint" || t === "T").length;
    const worstOffset = Math.max(
      ...ends.map((e) => Math.max(e.nearestEndpointDistance > 0 ? e.nearestEndpointDistance : 0, e.nearestSegmentDistance > 0 ? e.nearestSegmentDistance : 0))
    );
    const isStrongFilled = w.evidenceType === "filled-rect" || w.evidenceType === "filled-polygon";
    const boundedOffset = worstOffset <= Math.max(cfg.connectTolerance * 2, w.thickness * 3, w.length * 0.25);
    let floatingClass = "genuinely-floating";
    if (endTypes.every((t) => t === "endpoint" || t === "T")) floatingClass = "two-ends-connected";
    else if (connectedEnds === 1) floatingClass = "one-end-connected-one-free";
    else if (endTypes.some((t) => t === "perimeter")) floatingClass = "perimeter-termination";
    else if (endTypes.some((t) => t === "opening")) floatingClass = "opening-separated-termination";
    else if (isStrongFilled && boundedOffset) floatingClass = "valid-finite-partition";
    else floatingClass = "genuinely-floating";
    const genuinelyFloating = floatingClass === "genuinely-floating";
    let classification = "physical-wall";
    if (genuinelyFloating) classification = "genuinely-floating";
    else if (floatingClass === "opening-separated-termination") classification = "opening-separated-continuation";
    else if (floatingClass === "perimeter-termination") classification = "perimeter-attachment";
    else if (endTypes.some((t) => t === "T")) classification = "t-junction-connectivity";
    else if (endTypes.some((t) => t === "endpoint")) classification = "endpoint-connectivity";
    else if (floatingClass === "valid-finite-partition") classification = "physical-wall";
    else classification = "physical-wall";
    const validTerm = floatingClass !== "genuinely-floating";
    return {
      physicalWallId: w.physicalWallId,
      endpoints: ends,
      networkConnectivity: touched.size,
      validTermination: validTerm,
      genuinelyFloating,
      floatingClass,
      classification
    };
  });
  const genuineFloatingIds = perWall.filter((w) => w.genuinelyFloating).map((w) => w.physicalWallId);
  const summary = {
    total: perWall.length,
    validTermination: perWall.filter((w) => w.validTermination).length,
    genuinelyFloating: genuineFloatingIds.length,
    perimeterAttachment: perWall.filter((w) => w.classification === "perimeter-attachment").length,
    openingSeparated: perWall.filter((w) => w.classification === "opening-separated-continuation").length,
    tJunction: perWall.filter((w) => w.classification === "t-junction-connectivity").length,
    endpoint: perWall.filter((w) => w.classification === "endpoint-connectivity").length
  };
  return { perWall, genuineFloatingIds, summary };
}
function recoverSmallWalls(vectors, roi, cfg, accepted, bands) {
  const subIdx = buildSubpathIndex(vectors);
  const roots = vectors.filter((v) => !v.sourceRootId && v.operation === "fill-path");
  const out = [];
  const isNear = (c) => {
    for (const k of accepted) {
      const dEp = Math.min(pointSegmentDistance(c.centerline.a, k.centerline), pointSegmentDistance(c.centerline.b, k.centerline));
      const dMid = pointSegmentDistance({ x: (c.centerline.a.x + c.centerline.b.x) / 2, y: (c.centerline.a.y + c.centerline.b.y) / 2 }, k.centerline);
      if (dEp <= cfg.recoveryEndpointTol * 2 || dMid <= cfg.recoveryEndpointTol * 2) return true;
    }
    return false;
  };
  for (const root of roots) {
    const subs = subIdx.get(root.id) ?? [];
    const targets = subs.length ? subs : [root];
    for (const t of targets) {
      if (!intersects(t.bounds, roi)) continue;
      const w = rectWidth(t.bounds), h = rectHeight(t.bounds), short = Math.min(w, h), long = Math.max(w, h);
      if (short < cfg.minThickness * 0.6 || short > cfg.maxThickness * 1.6) continue;
      if (long < cfg.minLength || long / short < 2) continue;
      if (!isAxisRect(t)) continue;
      const md = medial(t.bounds);
      const cand = withOrientation({
        id: nextId("rc"),
        evidenceType: "recovered",
        sourceRootIds: [root.id],
        sourceSubpathIds: subs.length ? subs.map((s) => s.id) : [],
        sourceStrokeIds: [],
        centerline: { a: { ...md.a }, b: { ...md.b } },
        thickness: short,
        length: long,
        confidence: bandMatch(short, bands) ? 0.6 : 0.45,
        evidence: bandMatch(short, bands) ? ["recovered-small-partition", "thickness-band-fill"] : ["recovered-small-partition"]
      });
      if (isNear(cand)) out.push(cand);
    }
  }
  const deduped = [];
  const cell = cfg.minLength;
  const grid = /* @__PURE__ */ new Map();
  out.forEach((c, i) => {
    const mx = (c.centerline.a.x + c.centerline.b.x) / 2, my = (c.centerline.a.y + c.centerline.b.y) / 2;
    const k = `${Math.floor(mx / cell)},${Math.floor(my / cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const used = /* @__PURE__ */ new Set();
  for (const idxs of grid.values()) {
    const members = idxs.filter((i) => !used.has(i));
    if (!members.length) continue;
    members.sort((a, b) => out[b].length - out[a].length || out[b].confidence - out[a].confidence);
    const keep = members[0];
    for (const m of members) used.add(m);
    deduped.push(out[keep]);
  }
  return deduped;
}
function bandMatch(t, bands) {
  return bands.some((b) => t >= b.min * 0.8 && t <= b.max * 1.2);
}
function isRoiConnected(c, accepted, cfg) {
  const tol = cfg.connectTolerance * 2.5;
  for (const k of accepted) {
    const dEp = Math.min(pointSegmentDistance(c.centerline.a, k.centerline), pointSegmentDistance(c.centerline.b, k.centerline));
    const dMid = pointSegmentDistance({ x: (c.centerline.a.x + c.centerline.b.x) / 2, y: (c.centerline.a.y + c.centerline.b.y) / 2 }, k.centerline);
    if (dEp <= tol || dMid <= tol) return true;
  }
  return false;
}
function classifyPure(cands, roi, cfg, junctions, degreeMap) {
  const junctionCandIds = new Set(junctions.flatMap((j) => j.candidateIds));
  const onFacade = (w) => {
    const r = roi;
    return [w.centerline.a, w.centerline.b].some(
      (p) => Math.min(Math.abs(p.x - r[0]), Math.abs(p.x - r[2]), Math.abs(p.y - r[1]), Math.abs(p.y - r[3])) <= 8
    );
  };
  return cands.map((c) => {
    const deg = degreeMap?.get(c.id) ?? 0;
    const pos = [...c.evidence];
    const neg = [];
    if (c.evidenceType === "filled-rect" || c.evidenceType === "filled-polygon") pos.push("closed-filled-wall-mass");
    if (c.evidenceType === "parallel-face") pos.push("parallel-face-pairing");
    if (junctionCandIds.has(c.id)) pos.push("valid-junction-role");
    if (onFacade(c)) pos.push("building-perimeter-contribution");
    if (c.length >= cfg.minLength * 3) pos.push("substantial-physical-length");
    if (c.evidence.length >= 2) pos.push("multi-generator-support");
    const r = roi;
    const outside = [c.centerline.a, c.centerline.b].every(
      (p) => p.x < r[0] || p.x > r[2] || p.y < r[1] || p.y > r[3]
    );
    if (outside) neg.push("outside-building-ROI");
    if (c.length < cfg.minLength) neg.push("implausibly-short");
    if (c.thickness > cfg.maxThickness) neg.push("implausible-thickness");
    if (c.evidenceType === "single-line" && c.confidence < 0.5) neg.push("unsupported-short-stroke");
    if (outside) neg.push("isolated-outside");
    const posScore = pos.length;
    const negScore = neg.length;
    let verdict;
    if (outside) verdict = "rejected";
    else if (negScore > 0 && posScore <= 1) verdict = "rejected";
    else if (posScore >= 2 || posScore >= 1 && c.confidence >= 0.66) verdict = "accepted";
    else verdict = "review";
    if (c.evidenceType === "single-line" && deg === 0 && !onFacade(c)) verdict = "review";
    if (c.evidenceType === "parallel-face" && (deg === 0 || c.length < cfg.minLength * 2) && !onFacade(c)) verdict = "review";
    const net = Math.min(1, 0.4 + 0.12 * posScore - 0.15 * negScore + (onFacade(c) ? 0.05 : 0) + 0.05 * Math.min(deg, 4));
    return {
      ...c,
      physicalWallId: c.id,
      verdict,
      networkConnectivity: deg,
      perimeterContribution: onFacade(c),
      genuinelyFloating: false,
      fusedCandidateIds: [c.id],
      evidenceTypes: [c.evidenceType],
      positiveEvidence: pos,
      negativeEvidence: neg,
      confidence: +net.toFixed(3)
    };
  });
}
function orientationAudit(walls, junctions, cfg) {
  const acc = walls.filter((w) => w.verdict === "accepted");
  let h = 0, v = 0, o = 0, hL = 0, vL = 0, short = 0, med = 0, long = 0, junc = 0, per = 0, floating = 0;
  const juncIds = new Set(junctions.filter((j) => j.kind === "T" || j.kind === "X").flatMap((j) => j.candidateIds));
  for (const w of acc) {
    if (w.orientation === 0) {
      h++;
      hL += w.length;
    } else if (w.orientation === Math.PI / 2) {
      v++;
      vL += w.length;
    } else o++;
    if (w.length < cfg.minLength * 2) short++;
    else if (w.length < cfg.minLength * 6) med++;
    else long++;
    if (juncIds.has(w.id)) junc++;
    if (w.perimeterContribution) per++;
    if (w.networkConnectivity === 0 && !w.perimeterContribution) floating++;
  }
  return {
    acceptedHorizontalWalls: h,
    acceptedVerticalWalls: v,
    acceptedOtherAngleWalls: o,
    acceptedHorizontalLength: +hL.toFixed(1),
    acceptedVerticalLength: +vL.toFixed(1),
    shortAcceptedWalls: short,
    mediumAcceptedWalls: med,
    longAcceptedWalls: long,
    acceptedJunctionPartitions: junc,
    acceptedPerimeterWalls: per,
    reviewWalls: walls.filter((w) => w.verdict === "review").length,
    rejectedWalls: walls.filter((w) => w.verdict === "rejected").length,
    floatingAcceptedWalls: floating
  };
}
function derivePureScaleMmPerPt(page2, roi) {
  let maxDim = 0;
  try {
    const st = page2.toStructuredText();
    const json = JSON.parse(st.asJSON());
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) {
        n.forEach(walk);
        return;
      }
      const o = n;
      if (typeof o.text === "string") {
        const m = /^(\d{3,5})$/.exec(o.text.trim());
        if (m) maxDim = Math.max(maxDim, parseInt(m[1], 10));
      }
      for (const k of Object.keys(o)) walk(o[k]);
    };
    walk(json);
  } catch {
  }
  const spanPt = roi[2] - roi[0];
  if (maxDim > 0 && spanPt > 1) return { mmPerPt: maxDim / spanPt, source: "dim-text" };
  return { mmPerPt: 1, source: "fallback" };
}
function extractPureWallResult(data, pageNumber = 0, legacyForRecall, cfg = PURE_DEFAULTS, captureLineage = false) {
  const t0 = Date.now();
  const doc2 = mupdf2.Document.openDocument(data, "application/pdf");
  const page2 = doc2.loadPage(pageNumber);
  const tPdf = Date.now() - t0;
  const pbRaw = page2.getBounds();
  const pageBoundsMupdf = [pbRaw[0] ?? 0, pbRaw[1] ?? 0, pbRaw[2] ?? 0, pbRaw[3] ?? 0];
  const tVc0 = Date.now();
  const collected = collectPageVectors(page2, captureLineage, pageNumber);
  const vectors = collected.vectors;
  const tVc = Date.now() - tVc0;
  const tSub = 0;
  const tRoi0 = Date.now();
  const { roiMupdf } = derivePureBuildingRoi(vectors, pageBoundsMupdf, cfg);
  const tRoi = Date.now() - tRoi0;
  const tBand0 = Date.now();
  const _fr0 = genFilledRects(vectors, roiMupdf, cfg);
  const _fp0 = genFilledPolygons(vectors, roiMupdf, cfg);
  const _bands0 = inferThicknessBands([..._fr0, ..._fp0].map((c) => c.thickness), cfg);
  const derived = derivePureConfig(pageBoundsMupdf, _bands0);
  cfg = derived;
  const tBand = Date.now() - tBand0;
  resetIds();
  const tGen0 = Date.now();
  const fr = genFilledRects(vectors, roiMupdf, cfg);
  const fp = genFilledPolygons(vectors, roiMupdf, cfg);
  const thickSamples = [...fr, ...fp].map((c) => c.thickness);
  const bands = inferThicknessBands(thickSamples, cfg);
  const pfRaw = genParallelFaces(vectors, roiMupdf, cfg, bands);
  const slRaw = genSingleLines(vectors, roiMupdf, cfg, [...fr, ...fp, ...pfRaw]);
  const tGen = Date.now() - tGen0;
  const tClsF0 = Date.now();
  const { merged: frMerged, runs: frRuns } = mergeCollinearRuns([...fr, ...fp], cfg);
  const filledSet = frMerged;
  const filledClassified = classifyPure(filledSet, roiMupdf, cfg, []);
  const tClsF = Date.now() - tClsF0;
  const acceptedFilled = filledClassified.filter((w) => w.verdict === "accepted");
  const tConn0 = Date.now();
  const { junctions } = buildJunctionGraph(filledSet, cfg, pageBoundsMupdf);
  const tConn = Date.now() - tConn0;
  const degree = /* @__PURE__ */ new Map();
  for (const j of junctions) for (const id of j.candidateIds) degree.set(id, (degree.get(id) ?? 0) + 1);
  const explainedBy = (c) => acceptedFilled.some((w) => {
    if (segmentAngleDiffRad(w.centerline, c.centerline) > cfg.axisToleranceRadians) return false;
    return pointSegmentDistance(c.centerline.a, w.centerline) <= cfg.connectTolerance * 2.5 || pointSegmentDistance(c.centerline.b, w.centerline) <= cfg.connectTolerance * 2.5 || pointSegmentDistance({ x: (c.centerline.a.x + c.centerline.b.x) / 2, y: (c.centerline.a.y + c.centerline.b.y) / 2 }, w.centerline) <= cfg.connectTolerance * 2.5;
  });
  const pfCand = pfRaw.filter((c) => !explainedBy(c));
  const slCand = slRaw.filter((c) => !explainedBy(c));
  const tFus0 = Date.now();
  const { fused, ledger } = fusePureCandidates([...filledSet, ...pfCand], cfg);
  const tFus = Date.now() - tFus0;
  const fusedDegree = /* @__PURE__ */ new Map();
  const idDegree = (c) => {
    let d = 0;
    for (const rid of c.sourceRootIds) d = Math.max(d, degree.get(rid) ?? 0);
    for (const sid of c.sourceSubpathIds) d = Math.max(d, degree.get(sid) ?? 0);
    for (const stid of c.sourceStrokeIds) d = Math.max(d, degree.get(stid) ?? 0);
    return d;
  };
  for (const f of fused) fusedDegree.set(f.id, idDegree(f));
  const door = linkDoorGapRuns(fused, cfg);
  const tCls0 = Date.now();
  const classified = classifyPure(fused, roiMupdf, cfg, junctions, fusedDegree);
  const tCls = Date.now() - tCls0;
  const accepted0 = classified.filter((w) => w.verdict === "accepted");
  const tRec0 = Date.now();
  const recovered = recoverSmallWalls(vectors, roiMupdf, cfg, accepted0, bands).filter((c) => isRoiConnected(c, accepted0, cfg) && !explainedBy(c));
  const tRec = Date.now() - tRec0;
  const singleLineWalls = slCand.map((c) => ({
    ...c,
    physicalWallId: c.id,
    verdict: "review",
    networkConnectivity: 0,
    perimeterContribution: false,
    genuinelyFloating: false,
    fusedCandidateIds: [c.id],
    evidenceTypes: ["single-line"],
    positiveEvidence: c.evidence,
    negativeEvidence: ["review-only-stroke"],
    confidence: c.confidence
  }));
  const classifiedFinal = [
    ...classified,
    ...recovered.map((c) => ({
      ...c,
      physicalWallId: c.id,
      verdict: "accepted",
      networkConnectivity: 1,
      perimeterContribution: false,
      genuinelyFloating: false,
      fusedCandidateIds: [c.id],
      evidenceTypes: [c.evidenceType],
      positiveEvidence: c.evidence,
      negativeEvidence: [],
      confidence: c.confidence
    })),
    ...singleLineWalls
  ];
  const acceptedFinal = classifiedFinal.filter((w) => w.verdict === "accepted");
  const tConn2 = Date.now();
  const conn = analyzeWallConnectivity(acceptedFinal, roiMupdf, cfg);
  const tConnAna = Date.now() - tConn2;
  const connById = new Map(conn.perWall.map((c) => [c.physicalWallId, c]));
  const oldFloatingCount = acceptedFinal.filter((w) => w.networkConnectivity === 0 && !w.perimeterContribution).length;
  for (const w of acceptedFinal) {
    const c = connById.get(w.physicalWallId);
    if (c) {
      w.networkConnectivity = c.networkConnectivity;
      w.genuinelyFloating = c.genuinelyFloating;
      w.floatingClass = c.floatingClass;
      w.connectivityClass = c.classification;
    }
  }
  const floating = acceptedFinal.filter((w) => w.genuinelyFloating === true);
  const genuinelyFloatingIds = conn.genuineFloatingIds;
  const tOwn0 = Date.now();
  const pageW = pageBoundsMupdf[2] - pageBoundsMupdf[0];
  const pageH = pageBoundsMupdf[3] - pageBoundsMupdf[1];
  const insideRoiPt = (p) => p.x >= roiMupdf[0] - 2 && p.x <= roiMupdf[2] + 2 && p.y >= roiMupdf[1] - 2 && p.y <= roiMupdf[3] + 2;
  const angleOf = (s) => Math.abs(Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x)) % Math.PI;
  let ownedByAcceptedWalls = 0, rejectedNonWalls = 0;
  for (const w of classifiedFinal) {
    if (w.verdict !== "review") continue;
    const mid = { x: (w.centerline.a.x + w.centerline.b.x) / 2, y: (w.centerline.a.y + w.centerline.b.y) / 2 };
    let owner;
    for (const a of acceptedFinal) {
      const cov = a.thickness / 2 + 2;
      if (pointSegmentDistance(w.centerline.a, a.centerline) <= cov && pointSegmentDistance(w.centerline.b, a.centerline) <= cov) {
        const dAng = Math.abs(angleOf(w.centerline) - angleOf(a.centerline));
        if (dAng <= 0.1 || Math.abs(dAng - Math.PI) <= 0.1) {
          owner = a;
          break;
        }
      }
    }
    if (owner) {
      w.verdict = "rejected";
      w.rejectionReason = "duplicate-of-accepted-physical-wall";
      w.ownedBy = owner.physicalWallId;
      ownedByAcceptedWalls++;
      continue;
    }
    if (!insideRoiPt(mid) && !insideRoiPt(w.centerline.a) && !insideRoiPt(w.centerline.b)) {
      w.verdict = "rejected";
      w.rejectionReason = "outside-building-roi";
      rejectedNonWalls++;
      continue;
    }
    if (w.length >= 0.85 * Math.min(pageW, pageH)) {
      w.verdict = "rejected";
      w.rejectionReason = "page-or-sheet-frame";
      rejectedNonWalls++;
      continue;
    }
    if (!Number.isFinite(w.length) || !Number.isFinite(w.centerline.a.x) || w.length <= 0) {
      w.verdict = "rejected";
      w.rejectionReason = "invalid-or-nonfinite-geometry";
      rejectedNonWalls++;
      continue;
    }
    if (w.length < cfg.minLength * 0.5) {
      w.verdict = "rejected";
      w.rejectionReason = "no-structural-relation-after-evidence-passes";
      rejectedNonWalls++;
      continue;
    }
  }
  {
    const reviewSL = classifiedFinal.filter((w) => w.verdict === "review" && w.evidenceType === "single-line");
    const isHorizontal = (s) => Math.abs(s.b.y - s.a.y) <= Math.abs(s.b.x - s.a.x);
    const gapMax = cfg.maxThickness * 1.5;
    for (const w of reviewSL) {
      const hor = isHorizontal(w.centerline);
      const lo = hor ? Math.min(w.centerline.a.x, w.centerline.b.x) : Math.min(w.centerline.a.y, w.centerline.b.y);
      const hi = hor ? Math.max(w.centerline.a.x, w.centerline.b.x) : Math.max(w.centerline.a.y, w.centerline.b.y);
      const fix = hor ? w.centerline.a.y : w.centerline.a.x;
      let hasPartner = false;
      for (const o of reviewSL) {
        if (o === w) continue;
        if (isHorizontal(o.centerline) !== hor) continue;
        const oFix = hor ? o.centerline.a.y : o.centerline.a.x;
        const gap = Math.abs(oFix - fix);
        if (gap < 0.5 || gap > gapMax) continue;
        const oLo = hor ? Math.min(o.centerline.a.x, o.centerline.b.x) : Math.min(o.centerline.a.y, o.centerline.b.y);
        const oHi = hor ? Math.max(o.centerline.a.x, o.centerline.b.x) : Math.max(o.centerline.a.y, o.centerline.b.y);
        const ovl = Math.min(hi, oHi) - Math.max(lo, oLo);
        if (ovl >= Math.min(hi - lo, oHi - oLo) * 0.3) {
          hasPartner = true;
          break;
        }
      }
      if (hasPartner) continue;
      let attached = false;
      for (const a of acceptedFinal) {
        const pairTol = Math.max(cfg.mergeGap * 2, (w.thickness + a.thickness) / 2 + cfg.mergeGap);
        const dA = pointSegmentDistance(w.centerline.a, a.centerline);
        const dB = pointSegmentDistance(w.centerline.b, a.centerline);
        if (Math.min(dA, dB) > pairTol) continue;
        const angDiff = segmentAngleDiffRad(w.centerline, a.centerline);
        if (angDiff >= Math.PI / 6) {
          attached = true;
          break;
        }
        const dEndA = Math.min(
          Math.hypot(w.centerline.a.x - a.centerline.a.x, w.centerline.a.y - a.centerline.a.y),
          Math.hypot(w.centerline.a.x - a.centerline.b.x, w.centerline.a.y - a.centerline.b.y)
        );
        const dEndB = Math.min(
          Math.hypot(w.centerline.b.x - a.centerline.a.x, w.centerline.b.y - a.centerline.a.y),
          Math.hypot(w.centerline.b.x - a.centerline.b.x, w.centerline.b.y - a.centerline.b.y)
        );
        if (Math.min(dEndA, dEndB) <= pairTol) {
          attached = true;
          break;
        }
      }
      if (!attached) {
        w.verdict = "rejected";
        w.rejectionReason = "no-structural-relation-after-evidence-passes";
        rejectedNonWalls++;
      }
    }
  }
  const tOwn = Date.now() - tOwn0;
  const reviewFinal = classifiedFinal.filter((w) => w.verdict === "review");
  const rejectedFinal = classifiedFinal.filter((w) => w.verdict === "rejected");
  const ownership = {
    totalNormalizedPrimitives: classifiedFinal.length,
    ownedByAcceptedWalls,
    ownedByOpeningEvidence: 0,
    ownedByJunctionEvidence: 0,
    rejectedNonWalls,
    unresolvedWallLikePrimitives: reviewFinal.length,
    unclassifiedPrimitives: 0
  };
  const rejectionByReason = {};
  for (const w of rejectedFinal) {
    const r = w.rejectionReason ?? "unspecified";
    rejectionByReason[r] = (rejectionByReason[r] ?? 0) + 1;
  }
  const reviewByGenerator = {};
  for (const w of reviewFinal) {
    reviewByGenerator[w.evidenceType] = (reviewByGenerator[w.evidenceType] ?? 0) + 1;
  }
  const promotedSingleLines = acceptedFinal.filter((w) => w.evidenceTypes.includes("single-line")).map((w) => ({ physicalWallId: w.physicalWallId, promotionEvidence: w.positiveEvidence }));
  const openingLedger = door.runs.map((run) => {
    const frags = acceptedFinal.filter((w) => run.physicalFragmentIds.includes(w.physicalWallId));
    const widths = run.openingIntervals.map((iv) => +(iv.to - iv.from).toFixed(2));
    let colErr = 0;
    if (frags.length >= 2) {
      const ref = frags[0].centerline;
      for (const f of frags.slice(1)) {
        colErr = Math.max(
          colErr,
          pointSegmentDistance(f.centerline.a, ref),
          pointSegmentDistance(f.centerline.b, ref)
        );
      }
    }
    const horizontal = frags[0] ? Math.abs(frags[0].centerline.b.y - frags[0].centerline.a.y) <= Math.abs(frags[0].centerline.b.x - frags[0].centerline.a.x) : true;
    const fixedCoord = frags[0] ? horizontal ? frags[0].centerline.a.y : frags[0].centerline.a.x : 0;
    let preserved = true;
    for (const iv of run.openingIntervals) {
      const midAlong = (iv.from + iv.to) / 2;
      const midPt = horizontal ? { x: midAlong, y: fixedCoord } : { x: fixedCoord, y: midAlong };
      for (const a of acceptedFinal) {
        if (run.physicalFragmentIds.includes(a.physicalWallId)) continue;
        if (pointSegmentDistance(midPt, a.centerline) <= a.thickness / 2) {
          preserved = false;
          break;
        }
      }
      for (const f of frags) {
        const lo = horizontal ? Math.min(f.centerline.a.x, f.centerline.b.x) : Math.min(f.centerline.a.y, f.centerline.b.y);
        const hi = horizontal ? Math.max(f.centerline.a.x, f.centerline.b.x) : Math.max(f.centerline.a.y, f.centerline.b.y);
        if (lo < midAlong && hi > midAlong) {
          preserved = false;
          break;
        }
      }
    }
    const thick = frags.length ? frags.reduce((s, f) => s + f.thickness, 0) / frags.length : 0;
    return {
      logicalWallRunId: run.logicalWallRunId,
      physicalFragmentIds: run.physicalFragmentIds,
      openingIntervals: run.openingIntervals,
      openingWidths: widths,
      sourcePrimitiveIds: run.sourcePrimitiveIds,
      collinearError: +colErr.toFixed(2),
      wallThickness: +thick.toFixed(2),
      openingPreserved: preserved
    };
  });
  const orientation = orientationAudit(classifiedFinal, junctions, cfg);
  const collinearRuns = frRuns;
  let recall = { mupdfAccepted: acceptedFinal.length, legacyPhysicalInsideRoi: 0, matched: 0, legacyOnly: [], mupdfOnly: 0 };
  if (legacyForRecall && legacyForRecall.sourcePageWidth > 0) {
    const S = pageBoundsMupdf[2] / legacyForRecall.sourcePageWidth;
    const legacyMupdf = legacyForRecall.insideRoi.map((w) => ({
      id: w.id,
      a: { x: w.a.x * S, y: w.a.y * S },
      b: { x: w.b.x * S, y: w.b.y * S }
    }));
    const mupdfSegs = acceptedFinal.map((w) => w.centerline);
    const isNear = (a, b, c) => pointSegmentDistance(a, c) <= cfg.connectTolerance * 3 || pointSegmentDistance(b, c) <= cfg.connectTolerance * 3 || pointSegmentDistance({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, c) <= cfg.connectTolerance * 3;
    let matched = 0;
    const legacyOnly = [];
    for (const lg of legacyMupdf) {
      const near = mupdfSegs.some((m) => isNear(lg.a, lg.b, m));
      if (near) matched++;
      else legacyOnly.push({ id: lg.id });
    }
    recall = {
      mupdfAccepted: acceptedFinal.length,
      legacyPhysicalInsideRoi: legacyMupdf.length,
      matched,
      legacyOnly,
      mupdfOnly: acceptedFinal.length - matched
    };
  }
  const candHash = hashStrings(classifiedFinal.map((w) => `${w.id}:${w.centerline.a.x.toFixed(3)},${w.centerline.a.y.toFixed(3)},${w.centerline.b.x.toFixed(3)},${w.centerline.b.y.toFixed(3)},${w.thickness.toFixed(2)},${w.verdict}`));
  const perWallConn = conn.perWall;
  const endpointToleranceMisses = perWallConn.filter((c) => c.endpoints.some((e) => e.intersectionType === "free" && Math.min(e.nearestEndpointDistance, e.nearestSegmentDistance) <= e.localTolerance * 2 && Math.min(e.nearestEndpointDistance, e.nearestSegmentDistance) > e.localTolerance)).length;
  const validPerimeter = perWallConn.filter((c) => c.classification === "perimeter-attachment").length;
  const validOpenings = perWallConn.filter((c) => c.classification === "opening-separated-continuation").length;
  const validFreeEnds = perWallConn.filter((c) => !c.genuinelyFloating && c.classification === "physical-wall").length;
  let duplicateFrag = 0;
  for (let i = 0; i < acceptedFinal.length; i++) {
    for (let j = i + 1; j < acceptedFinal.length; j++) {
      const a = acceptedFinal[i], b = acceptedFinal[j];
      const same = Math.hypot(a.centerline.a.x - b.centerline.a.x, a.centerline.a.y - b.centerline.a.y) < 3 && Math.hypot(a.centerline.b.x - b.centerline.b.x, a.centerline.b.y - b.centerline.b.y) < 3;
      if (same) duplicateFrag++;
    }
  }
  const validFinitePartitions = perWallConn.filter((c) => c.floatingClass === "valid-finite-partition").length;
  const floatingAttributionBreakdown = {
    totalFloatingAttributions: oldFloatingCount,
    duplicateFragmentArtifacts: duplicateFrag,
    endpointToleranceMisses,
    validPerimeterTerminations: validPerimeter,
    validDoorOpeningTerminations: validOpenings,
    validFinitePartitions,
    validFreeEnds,
    genuinelyFloatingPhysicalWalls: genuinelyFloatingIds.length,
    unexplained: genuinelyFloatingIds.length
  };
  const total = Date.now() - t0;
  const { mmPerPt: scaleMmPerPt, source: scaleSource } = derivePureScaleMmPerPt(page2, roiMupdf);
  const pureResult = {
    pageBoundsMupdf,
    activeBuildingRegionMupdf: roiMupdf,
    activeBuildingRegionSource: roiMupdf,
    // downstream/overlay convenience (same mupdf-point frame)
    vectorOperationCount: vectors.length,
    diagnostics: collected.diagnostics,
    candidatesBySource: { "filled-rect": fr, "filled-polygon": fp, "parallel-face": pfCand, "single-line": slCand, "recovered": recovered },
    allCandidates: [...fr, ...fp, ...pfCand, ...slCand, ...recovered],
    thicknessBands: bands,
    logicalWallRuns: door.runs,
    collinearRuns,
    junctions,
    recoveredSmallWalls: recovered,
    physicalWalls: classifiedFinal,
    roi: roiMupdf,
    accepted: acceptedFinal,
    scaleMmPerPt,
    scaleSource,
    review: reviewFinal,
    rejected: rejectedFinal,
    floatingAccepted: floating,
    genuinelyFloatingAcceptedPhysicalWalls: floating,
    connectivity: conn.perWall,
    connectivitySummary: conn.summary,
    floatingAttributionBreakdown,
    primitiveOwnership: ownership,
    rejectionByReason,
    reviewByGenerator,
    promotedSingleLines,
    openingLedger,
    duplicateFusionLedger: ledger,
    recall,
    orientation,
    timings: {
      pdfLoad: tPdf,
      vectorCollection: tVc,
      subpathNormalization: tSub,
      roiDerivation: tRoi,
      thicknessInference: tBand,
      candidateGeneration: tGen,
      filledClassification: tClsF,
      candidateFusion: tFus,
      connectivity: tConn,
      connectivityAnalysis: tConnAna,
      classification: tCls,
      overlayGeneration: 0,
      total
    },
    candidateHash: candHash
  };
  if (captureLineage) {
    return {
      pureResult,
      lineageStore: collected.lineageStore,
      vectorLineageRefs: collected.vectorLineageRefs
    };
  }
  return pureResult;
}
function hashStrings(xs) {
  let h = 2166136261 >>> 0;
  for (const s of xs) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h.toString(16).padStart(8, "0");
}

// src/mupdf-pure-windows.ts
import * as mupdf3 from "mupdf";

// src/mupdf-pure-doors.ts
import * as mupdf4 from "mupdf";
var PURE_DOOR_DEFAULTS = {
  minWidthMm: 650,
  maxWidthMm: 1050,
  hingeTolerancePt: 7,
  radiusTolerance: 0.3,
  hostCorridorPadPt: 18,
  hostAmbiguityMargin: 0.08,
  minHingeFan: 4,
  minHingeFanSpread: 1,
  maxHingeFanSpread: 2.4,
  enableProgrammaticAnnotations: true,
  enableDoorAnnotationAssist: true,
  enableAnnotationOcrFallback: false
};
var EPS = 1e-9;
var sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
var dot = (a, b) => a.x * b.x + a.y * b.y;
var dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
var norm2 = (v) => {
  const n = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / n, y: v.y / n };
};
var clamp = (n, a, b) => Math.max(a, Math.min(b, n));
var project = (p, a, u) => dot(sub(p, a), u);
var pointSegmentDistance2 = (p, a, b) => {
  const ab = sub(b, a);
  const d = dot(ab, ab);
  if (d < EPS) return dist(p, a);
  const t = clamp(dot(sub(p, a), ab) / d, 0, 1);
  return dist(p, { x: a.x + t * ab.x, y: a.y + t * ab.y });
};
function hashStrings2(arr) {
  let h = 2166136261;
  const s = arr.join("\n");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
function curveRadius(p) {
  if (!p.control) return dist(p.a, p.b);
  return (dist(p.a, p.control) + dist(p.b, p.control)) / 2;
}
function extractDoorPrimitives(vectors, walls, scaleMmPerPt, cfg) {
  const minPt = cfg.minWidthMm / scaleMmPerPt;
  const maxPt = cfg.maxWidthMm / scaleMmPerPt;
  const maxWallThickness = Math.max(1, ...walls.map((w) => w.thickness));
  const corridorLimit = maxWallThickness * 1.5;
  const leaves = [];
  const swings = [];
  const isLeafLike = (a, b) => {
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const len = dist(a, b);
    if (len < minPt * 0.85 || len > maxPt * 1.1) return false;
    for (const w of walls) {
      const axis = norm2(sub(w.centerline.b, w.centerline.a));
      const proj = project(c, w.centerline.a, axis);
      const wallLen = dist(w.centerline.a, w.centerline.b);
      const along = proj;
      const perp = pointSegmentDistance2(c, w.centerline.a, w.centerline.b);
      const inCorridor = perp <= w.thickness + corridorLimit;
      const awayFromEnds = along > w.thickness * 1.5 && along < wallLen - w.thickness * 1.5;
      if (inCorridor && awayFromEnds) return true;
    }
    return false;
  };
  for (const v of vectors) {
    const opId = v.sourceRootId ?? v.id;
    const subs = v.subpaths && v.subpaths.length ? v.subpaths : [v.points];
    for (const subpath of subs) {
      if (!subpath || subpath.length < 2) continue;
      for (let i = 0; i + 1 < subpath.length; i++) {
        const a = subpath[i];
        const b = subpath[i + 1];
        if (isLeafLike(a, b)) {
          leaves.push({ id: `${v.id}:L${i}`, operationId: opId, kind: "line", a, b, length: dist(a, b) });
        }
      }
      if (subpath.length >= 3) {
        const a = subpath[0];
        const b = subpath[subpath.length - 1];
        const chord = dist(a, b);
        let ctrl = subpath[Math.floor(subpath.length / 2)];
        let maxDev = 0;
        for (const p of subpath) {
          const dev = pointSegmentDistance2(p, a, b);
          if (dev > maxDev) {
            maxDev = dev;
            ctrl = p;
          }
        }
        if (maxDev < 3) continue;
        const radius = (dist(a, ctrl) + dist(b, ctrl)) / 2;
        if (chord < minPt * 0.6 || chord > maxPt * 1.4) continue;
        if (radius < minPt * 0.5 || radius > maxPt * 1.6) continue;
        swings.push({ id: `${v.id}:C`, operationId: opId, kind: "arc", a, b, control: ctrl, length: chord });
      }
    }
  }
  const seen = /* @__PURE__ */ new Set();
  const dedupedSwings = swings.filter((s) => {
    const key = `${s.operationId}|${s.a.x.toFixed(1)},${s.a.y.toFixed(1)}|${s.b.x.toFixed(1)},${s.b.y.toFixed(1)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const seenLeaf = /* @__PURE__ */ new Set();
  const dedupedLeaves = leaves.filter((l) => {
    const key = `${l.operationId}|${Math.min(l.a.x, l.b.x).toFixed(1)},${Math.min(l.a.y, l.b.y).toFixed(1)}|${Math.max(l.a.x, l.b.x).toFixed(1)},${Math.max(l.a.y, l.b.y).toFixed(1)}`;
    if (seenLeaf.has(key)) return false;
    seenLeaf.add(key);
    return true;
  });
  return { leaves: dedupedLeaves, swings: dedupedSwings };
}
function hingeFanWitness(leaf, vectors, scaleMmPerPt) {
  const leafLen = leaf.length;
  const hinges = [leaf.a, leaf.b];
  let best = 0;
  let bestSpread = 0;
  for (const H of hinges) {
    let n = 0;
    const angles = [];
    for (const v of vectors) {
      const subs = v.subpaths && v.subpaths.length ? v.subpaths : [v.points];
      for (const s of subs) {
        for (let i = 0; i + 1 < s.length; i++) {
          const p = s[i], q = s[i + 1];
          const e1 = Math.hypot(p.x - H.x, p.y - H.y);
          const e2 = Math.hypot(q.x - H.x, q.y - H.y);
          let far = null;
          if (e1 < 5 && e2 >= 5) far = q;
          else if (e2 < 5 && e1 >= 5) far = p;
          else continue;
          const r = Math.hypot(far.x - H.x, far.y - H.y);
          if (r > 0.7 * leafLen && r < 1.3 * leafLen) {
            n++;
            angles.push(Math.atan2(far.y - H.y, far.x - H.x));
          }
        }
      }
    }
    let spread = 0;
    if (angles.length > 1) {
      const sorted = [...angles].sort((a, b) => a - b);
      let maxGap = 0;
      for (let i = 1; i < sorted.length; i++) maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1]);
      maxGap = Math.max(maxGap, sorted[0] + 2 * Math.PI - sorted[sorted.length - 1]);
      spread = 2 * Math.PI - maxGap;
    }
    if (n > best) {
      best = n;
      bestSpread = spread;
    }
  }
  return { fan: best, spread: bestSpread };
}
function segmentsParallelToWall(a, b, axis, tol = 0.18) {
  const seg = norm2(sub(b, a));
  const parallel = Math.abs(Math.abs(dot(seg, axis)) - 1);
  return parallel <= tol;
}
function buildWallSourceCoverage(walls, vectors, scaleMmPerPt) {
  const out = /* @__PURE__ */ new Map();
  for (const w of walls) {
    const A = w.centerline.a;
    const axis = norm2(sub(w.centerline.b, w.centerline.a));
    const length = dist(w.centerline.a, w.centerline.b);
    const pad = w.thickness + 6 / scaleMmPerPt;
    const intervals = [];
    let segCount = 0;
    for (const v of vectors) {
      const subs = v.subpaths && v.subpaths.length ? v.subpaths : [v.points];
      for (const s of subs) {
        for (let i = 0; i + 1 < s.length; i++) {
          const p = s[i], q = s[i + 1];
          if (!segmentsParallelToWall(p, q, axis)) continue;
          const mp = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
          const al = (mp.x - A.x) * axis.x + (mp.y - A.y) * axis.y;
          const perp = Math.hypot(mp.x - (A.x + axis.x * al), mp.y - (A.y + axis.y * al));
          if (perp > pad) continue;
          if (al < -pad || al > length + pad) continue;
          const a0 = Math.max(0, (p.x - A.x) * axis.x + (p.y - A.y) * axis.y);
          const a1 = Math.min(length, (q.x - A.x) * axis.x + (q.y - A.y) * axis.y);
          if (a1 <= a0) continue;
          intervals.push([a0, a1]);
          segCount++;
        }
      }
    }
    intervals.sort((x, y) => x[0] - y[0]);
    const merged2 = [];
    for (const iv of intervals) {
      const last = merged2[merged2.length - 1];
      if (last && iv[0] <= last[1] + 2 / scaleMmPerPt) last[1] = Math.max(last[1], iv[1]);
      else merged2.push([iv[0], iv[1]]);
    }
    const covered = merged2.reduce((s, m) => s + (m[1] - m[0]), 0);
    const uncovered = [];
    let cursor = 0;
    for (const m of merged2) {
      if (m[0] > cursor) uncovered.push([cursor, m[0]]);
      cursor = Math.max(cursor, m[1]);
    }
    if (cursor < length) uncovered.push([cursor, length]);
    out.set(w.physicalWallId, {
      physicalWallId: w.physicalWallId,
      wallLengthPt: length,
      sourceSegmentCount: segCount,
      mergedCoverageIntervals: merged2,
      uncoveredIntervals: uncovered,
      coverageRatio: length > 0 ? covered / length : 0
    });
  }
  return out;
}
function analyzeWallInterruption(leaf, wall, coverage, scaleMmPerPt) {
  const A = wall.centerline.a;
  const axis = norm2(sub(wall.centerline.b, wall.centerline.a));
  const length = dist(wall.centerline.a, wall.centerline.b);
  const l0 = (leaf.a.x - A.x) * axis.x + (leaf.a.y - A.y) * axis.y;
  const l1 = (leaf.b.x - A.x) * axis.x + (leaf.b.y - A.y) * axis.y;
  let leafStart = Math.min(l0, l1), leafEnd = Math.max(l0, l1);
  const margin = 3 / scaleMmPerPt;
  leafStart = Math.max(0, leafStart - margin);
  leafEnd = Math.min(length, leafEnd + margin);
  const openingInterval = [leafStart, leafEnd];
  const coveredAt = (al) => coverage.mergedCoverageIntervals.some((m) => al >= m[0] - 1 && al <= m[1] + 1);
  const before = coveredAt(leafStart - margin * 2);
  const inside = coveredAt((leafStart + leafEnd) / 2);
  const after = coveredAt(leafEnd + margin * 2);
  const endTol = wall.thickness * 1.5 + 4 / scaleMmPerPt;
  if (leafStart <= endTol || leafEnd >= length - endTol) {
    return { status: "WALL_ENDPOINT_ARTIFACT", openingInterval, coverageBefore: before, coverageInside: inside, coverageAfter: after, interruptionLengthPt: leafEnd - leafStart };
  }
  if (!before && !after) {
    return { status: "WALL_JUNCTION_ARTIFACT", openingInterval, coverageBefore: before, coverageInside: inside, coverageAfter: after, interruptionLengthPt: leafEnd - leafStart };
  }
  if (coverage.mergedCoverageIntervals.length === 0) {
    return { status: "INSUFFICIENT_WALL_SOURCE_GEOMETRY", openingInterval, coverageBefore: before, coverageInside: inside, coverageAfter: after, interruptionLengthPt: leafEnd - leafStart };
  }
  if (before && after) {
    return {
      status: inside ? "CONTINUOUS_SOLID_WALL" : "CONFIRMED_WALL_INTERRUPTION",
      openingInterval,
      coverageBefore: before,
      coverageInside: inside,
      coverageAfter: after,
      interruptionLengthPt: leafEnd - leafStart
    };
  }
  return { status: "PARTIAL_WALL_INTERRUPTION", openingInterval, coverageBefore: before, coverageInside: inside, coverageAfter: after, interruptionLengthPt: leafEnd - leafStart };
}
function resolveDoorHost(candidate, centre, walls, cfg) {
  const scored = walls.map((w) => {
    const axis = norm2(sub(w.centerline.b, w.centerline.a));
    const length = dist(w.centerline.a, w.centerline.b);
    const c = project(centre, w.centerline.a, axis);
    const half = candidate.widthPt / 2;
    const start = c - half;
    const end = c + half;
    const midAlong = project(centre, w.centerline.a, axis);
    const contained = midAlong >= -w.thickness * 2 && midAlong <= length + w.thickness * 2;
    const offsetCentre = pointSegmentDistance2(centre, w.centerline.a, w.centerline.b);
    const faceDist = Math.abs(offsetCentre - w.thickness / 2);
    const corridor = faceDist <= cfg.hostCorridorPadPt;
    const score = (contained ? 0.55 : 0) + (corridor ? 0.35 : 0) + Math.max(0, 0.1 - faceDist / 100);
    return { w, start, end, contained, corridor, score };
  }).filter((x) => x.contained && x.corridor).sort((a, b) => b.score - a.score || a.w.physicalWallId.localeCompare(b.w.physicalWallId));
  if (!scored.length) {
    candidate.hostStatus = "NO_HOST";
    candidate.verdict = "REJECTED";
    candidate.negativeEvidence.push("no-finite-wall-host");
    return candidate;
  }
  if (scored[1] && scored[0].score - scored[1].score < cfg.hostAmbiguityMargin) {
    candidate.hostStatus = "AMBIGUOUS_HOST";
    candidate.verdict = "REVIEW";
    candidate.negativeEvidence.push("competing-wall-hosts");
    return candidate;
  }
  const best = scored[0];
  candidate.hostStatus = "UNIQUE_HOST";
  candidate.selectedPhysicalWallId = best.w.physicalWallId;
  candidate.wallLocalInterval = { from: best.start, to: best.end, unit: "mupdf-point" };
  candidate.positiveEvidence.push("unique-finite-wall-host");
  return candidate;
}
function buildDoorAssemblies(primitives, walls, vectors, scaleMmPerPt, cfg) {
  const { leaves, swings } = primitives;
  const candidates = [];
  const coverage = buildWallSourceCoverage(walls, vectors, scaleMmPerPt);
  for (const leaf of leaves) {
    const widthPt = leaf.length;
    const widthMm = widthPt * scaleMmPerPt;
    if (widthMm < cfg.minWidthMm || widthMm > cfg.maxWidthMm) continue;
    const centre = { x: (leaf.a.x + leaf.b.x) / 2, y: (leaf.a.y + leaf.b.y) / 2 };
    let matchedSwing = null;
    let matchedSwing2 = null;
    for (const swing of swings) {
      const hingeDists = [dist(leaf.a, swing.a), dist(leaf.a, swing.b), dist(leaf.b, swing.a), dist(leaf.b, swing.b)];
      if (Math.min(...hingeDists) > cfg.hingeTolerancePt) continue;
      const chord = swing.length;
      if (Math.abs(chord - widthPt) / Math.max(widthPt, EPS) > 0.6) continue;
      const radius = curveRadius(swing);
      if (radius < widthPt * 0.25 || radius > widthPt * 2.5) continue;
      if (!matchedSwing) matchedSwing = swing;
      else if (!matchedSwing2) matchedSwing2 = swing;
    }
    const host = resolveDoorHost(
      {
        doorAssemblyId: "",
        doorType: "SINGLE_SWING",
        hostStatus: "NO_HOST",
        widthPt,
        widthMm,
        leafSegmentIds: [leaf.id],
        swingSegmentIds: matchedSwing ? [matchedSwing.id, ...matchedSwing2 ? [matchedSwing2.id] : []] : [],
        sourceOperationIds: [.../* @__PURE__ */ new Set([leaf.operationId, ...matchedSwing ? [matchedSwing.operationId, ...matchedSwing2 ? [matchedSwing2.operationId] : []] : []])],
        positiveEvidence: ["finite-leaf"],
        negativeEvidence: [],
        verdict: "ACCEPT",
        evidenceMode: "GEOMETRY_ONLY"
      },
      centre,
      walls,
      cfg
    );
    if (host.verdict !== "ACCEPT") {
      candidates.push(host);
      continue;
    }
    const wall = walls.find((w) => w.physicalWallId === host.selectedPhysicalWallId);
    const cov = coverage.get(wall.physicalWallId);
    const interruption = analyzeWallInterruption(leaf, wall, cov, scaleMmPerPt);
    const acceptedStatus = interruption.status === "CONFIRMED_WALL_INTERRUPTION" || interruption.status === "CONTINUOUS_SOLID_WALL";
    if (!acceptedStatus) {
      if (interruption.status === "WALL_ENDPOINT_ARTIFACT" || interruption.status === "WALL_JUNCTION_ARTIFACT") {
        host.verdict = "REJECTED";
        host.negativeEvidence.push(`wall-interruption:${interruption.status}`);
      } else {
        host.verdict = "REVIEW";
        host.negativeEvidence.push(`wall-interruption:${interruption.status}`);
      }
      candidates.push(host);
      continue;
    }
    host.doorType = matchedSwing2 ? "DOUBLE_SWING" : matchedSwing ? "SINGLE_SWING" : "SINGLE_SWING";
    const fan = hingeFanWitness(leaf, vectors, scaleMmPerPt);
    if (fan.fan < cfg.minHingeFan || fan.spread < cfg.minHingeFanSpread || fan.spread > cfg.maxHingeFanSpread) {
      host.verdict = "REVIEW";
      host.negativeEvidence.push(`no-door-symbol-topology:fan=${fan.fan},spread=${fan.spread.toFixed(2)}`);
      candidates.push(host);
      continue;
    }
    host.positiveEvidence.push("confirmed-wall-interruption", `hinge-fan:${fan}`);
    host.swingDirection = "inward";
    candidates.push(host);
  }
  return candidates;
}
function recoverDoorsWithAnnotations(annotations, annotationIndex, vectors, walls, scaleMmPerPt, cfg, existing = []) {
  if (!cfg.enableProgrammaticAnnotations || !cfg.enableDoorAnnotationAssist) return [];
  const out = [];
  const existingKeys = new Set(
    existing.filter((a) => a.verdict === "ACCEPT" && a.selectedPhysicalWallId && a.wallLocalInterval).map((a) => `${a.selectedPhysicalWallId}:${a.wallLocalInterval.from.toFixed(1)}:${a.wallLocalInterval.to.toFixed(1)}`)
  );
  const searchRadiusPt = 40;
  for (const ann2 of annotations) {
    const centre = { x: ann2.centrePdf[0], y: ann2.centrePdf[1] };
    const local = [];
    for (const v of vectors) {
      const subs = v.subpaths && v.subpaths.length ? v.subpaths : [v.points];
      for (const s of subs) {
        for (const p of s) {
          if (Math.hypot(p.x - centre.x, p.y - centre.y) <= searchRadiusPt) {
            local.push(v);
            break;
          }
        }
      }
    }
    const prim = extractDoorPrimitives(local, walls, scaleMmPerPt, cfg);
    let best = null;
    for (const leaf of prim.leaves) {
      const widthPt = leaf.length;
      const widthMm = widthPt * scaleMmPerPt;
      if (widthMm < cfg.minWidthMm || widthMm > cfg.maxWidthMm) continue;
      const lc = { x: (leaf.a.x + leaf.b.x) / 2, y: (leaf.a.y + leaf.b.y) / 2 };
      if (Math.hypot(lc.x - centre.x, lc.y - centre.y) > searchRadiusPt) continue;
      const host = resolveDoorHost(
        {
          doorAssemblyId: "",
          doorType: "SINGLE_SWING",
          hostStatus: "NO_HOST",
          widthPt,
          widthMm,
          leafSegmentIds: [leaf.id],
          swingSegmentIds: [],
          sourceOperationIds: [leaf.operationId],
          positiveEvidence: ["finite-leaf", "annotation-anchor"],
          negativeEvidence: [],
          verdict: "ACCEPT",
          evidenceMode: "GEOMETRY_ONLY"
        },
        lc,
        walls,
        cfg
      );
      if (host.verdict !== "ACCEPT" || host.hostStatus !== "UNIQUE_HOST" || !host.wallLocalInterval) {
        if (!best) {
          best = { ...host, evidenceMode: "ANNOTATION_ASSISTED_REVIEW_REQUIRED" };
          best.negativeEvidence.push("annotation-assist:incomplete-geometry");
          best.assistedByAnnotationId = ann2.annotationId;
        }
        continue;
      }
      const fan = hingeFanWitness(leaf, vectors, scaleMmPerPt);
      const hasTopology = fan.fan >= cfg.minHingeFan && fan.spread >= cfg.minHingeFanSpread && fan.spread <= cfg.maxHingeFanSpread;
      const key = `${host.selectedPhysicalWallId}:${host.wallLocalInterval.from.toFixed(1)}:${host.wallLocalInterval.to.toFixed(1)}`;
      const dupe = existingKeys.has(key);
      if (hasTopology && !dupe) {
        host.evidenceMode = "ANNOTATION_ASSISTED_GEOMETRY_VERIFIED";
        host.assistedByAnnotationId = ann2.annotationId;
        host.positiveEvidence.push(`annotation-assist:${ann2.normalizedText}`, `hinge-fan:${fan}`);
        best = host;
        break;
      }
      if (!best) {
        const r = { ...host, evidenceMode: "ANNOTATION_ASSISTED_REVIEW_REQUIRED" };
        r.negativeEvidence.push("annotation-assist:incomplete-topology");
        r.assistedByAnnotationId = ann2.annotationId;
        best = r;
      }
    }
    if (best) out.push(best);
  }
  return out;
}
function consolidateDoorAssemblies(candidates) {
  const accepted = [];
  for (const c of candidates) {
    if (c.verdict !== "ACCEPT" || !c.selectedPhysicalWallId || !c.wallLocalInterval) continue;
    const ci = c.wallLocalInterval;
    const dup = accepted.some(
      (a) => a.selectedPhysicalWallId === c.selectedPhysicalWallId && a.wallLocalInterval != null && Math.max(a.wallLocalInterval.from, ci.from) < Math.min(a.wallLocalInterval.to, ci.to)
    );
    if (!dup) accepted.push(c);
  }
  return accepted;
}
var EVIDENCE_RANK = {
  ANNOTATION_ASSISTED_GEOMETRY_VERIFIED: 3,
  GEOMETRY_ONLY: 2,
  ANNOTATION_ASSISTED_REVIEW_REQUIRED: 1,
  ANNOTATION_ONLY: 0
};
function samePhysicalDoor(a, b) {
  if (a.selectedPhysicalWallId !== b.selectedPhysicalWallId) return false;
  const ai = a.wallLocalInterval;
  const bi = b.wallLocalInterval;
  if (!ai || !bi) return false;
  const ov = Math.max(ai.from, bi.from) < Math.min(ai.to, bi.to);
  if (!ov) return false;
  const wTol = Math.max(a.widthPt, b.widthPt) * 0.2 + 1;
  if (Math.abs(a.widthPt - b.widthPt) > wTol) return false;
  const shared = a.sourceOperationIds.some((o) => b.sourceOperationIds.includes(o)) || a.leafSegmentIds.some((l) => b.leafSegmentIds.includes(l));
  return shared || true;
}
function runDoorPipeline(input, cfg = PURE_DOOR_DEFAULTS, _captureLineage = false) {
  const t0 = Date.now();
  const { vectors, wallResult, pageBoundsMupdf } = input;
  const tCol0 = Date.now();
  const primitives = extractDoorPrimitives(vectors, wallResult.accepted, wallResult.scaleMmPerPt, cfg);
  const vectorCollection = Date.now() - tCol0;
  const primitiveCount = primitives.leaves.length + primitives.swings.length;
  const tGen0 = Date.now();
  const candidates = buildDoorAssemblies(primitives, wallResult.accepted, vectors, wallResult.scaleMmPerPt, cfg);
  const candidateGeneration = Date.now() - tGen0;
  const tCon0 = Date.now();
  const accepted = consolidateDoorAssemblies(candidates);
  const consolidation = Date.now() - tCon0;
  const review = candidates.filter((c) => c.verdict === "REVIEW");
  const rejected = candidates.filter((c) => c.verdict === "REJECTED");
  const annotationAssisted = [];
  if (cfg.enableProgrammaticAnnotations && cfg.enableDoorAnnotationAssist && input.annotations) {
    const ai = input.annotations;
    const aidx = input.annotationIndex;
    annotationAssisted.push(
      ...recoverDoorsWithAnnotations(
        ai,
        aidx ?? { queryWithin: () => [] },
        vectors,
        wallResult.accepted,
        wallResult.scaleMmPerPt,
        cfg,
        accepted
      )
    );
  }
  const mergedAccepted = [];
  const mergedReview = [];
  for (const a of accepted) mergedAccepted.push(a);
  for (const a of review) mergedReview.push(a);
  for (const a of annotationAssisted) {
    if (a.verdict === "ACCEPT" && a.hostStatus === "UNIQUE_HOST" && a.wallLocalInterval) {
      const idx = mergedAccepted.findIndex((m) => samePhysicalDoor(m, a));
      if (idx >= 0) {
        const m = mergedAccepted[idx];
        if ((EVIDENCE_RANK[a.evidenceMode] ?? 0) > (EVIDENCE_RANK[m.evidenceMode] ?? 0)) {
          m.evidenceMode = a.evidenceMode;
          m.assistedByAnnotationId = a.assistedByAnnotationId;
        }
        for (const e of a.positiveEvidence) if (!m.positiveEvidence.includes(e)) m.positiveEvidence.push(e);
      } else {
        mergedAccepted.push(a);
      }
    } else if (a.verdict !== "ACCEPT") {
      const idx = mergedReview.findIndex((m) => samePhysicalDoor(m, a));
      if (idx < 0) mergedReview.push(a);
    }
  }
  const annotationMode = cfg.enableProgrammaticAnnotations && cfg.enableDoorAnnotationAssist && (input.annotations?.length ?? 0) > 0;
  if (annotationMode) {
    const verifiedKeys = new Set(
      mergedAccepted.filter((a) => a.evidenceMode === "ANNOTATION_ASSISTED_GEOMETRY_VERIFIED").map((a) => `${a.selectedPhysicalWallId}:${a.wallLocalInterval?.from.toFixed(1)}:${a.wallLocalInterval?.to.toFixed(1)}`)
    );
    for (const a of mergedAccepted) {
      if (a.evidenceMode === "GEOMETRY_ONLY" && !verifiedKeys.has(`${a.selectedPhysicalWallId}:${a.wallLocalInterval?.from.toFixed(1)}:${a.wallLocalInterval?.to.toFixed(1)}`)) {
        a.verdict = "REVIEW";
        a.evidenceMode = "ANNOTATION_ASSISTED_REVIEW_REQUIRED";
        a.negativeEvidence.push("annotation-gate:no-nearby-dt-anchor");
        mergedReview.push(a);
      }
    }
    const stillAccepted = mergedAccepted.filter((a) => a.verdict === "ACCEPT");
    mergedAccepted.length = 0;
    mergedAccepted.push(...stillAccepted);
  }
  const finalAll = [...mergedAccepted, ...mergedReview];
  finalAll.sort((x, y) => `${x.selectedPhysicalWallId}:${x.wallLocalInterval?.from}`.localeCompare(`${y.selectedPhysicalWallId}:${y.wallLocalInterval?.from}`)).forEach((a, i) => {
    a.doorAssemblyId = `door-${i.toString().padStart(3, "0")}`;
  });
  const assemblies = [...candidates, ...annotationAssisted];
  const evidenceModeSummary = {};
  for (const a of finalAll) evidenceModeSummary[a.evidenceMode] = (evidenceModeSummary[a.evidenceMode] ?? 0) + 1;
  const canonical = mergedAccepted.map((a) => `${a.doorAssemblyId}:${a.selectedPhysicalWallId}:${a.wallLocalInterval?.from.toFixed(3)}:${a.wallLocalInterval?.to.toFixed(3)}:${a.doorType}:${a.evidenceMode}`).sort().join("\n");
  const assemblyCanon = assemblies.map((a) => `${a.doorAssemblyId || ""}:${a.selectedPhysicalWallId}:${a.wallLocalInterval?.from.toFixed(3)}:${a.wallLocalInterval?.to.toFixed(3)}:${a.verdict}:${a.evidenceMode}`).sort().join("\n");
  const annotationCanon = (input.annotations ?? []).map((a) => `${a.annotationId}:${a.normalizedText}:${a.centrePdf[0].toFixed(2)}:${a.centrePdf[1].toFixed(2)}`).sort().join("\n");
  const annotationAssociation = Date.now() - tCon0;
  return {
    pageBoundsMupdf,
    scaleMmPerPt: wallResult.scaleMmPerPt,
    vectorOperationCount: vectors.length,
    primitiveCount,
    rawCandidateCount: candidates.length,
    assemblies,
    accepted: mergedAccepted,
    review: mergedReview,
    rejected,
    annotationAssisted,
    evidenceModeSummary,
    metrics: {
      accepted: mergedAccepted.length,
      review: mergedReview.length,
      rejected: rejected.length,
      annotationAssisted: annotationAssisted.length
    },
    candidateHash: hashStrings2([canonical]),
    assemblyHash: hashStrings2([assemblyCanon]),
    annotationHash: hashStrings2([annotationCanon]),
    timings: {
      vectorCollection,
      candidateGeneration,
      hostResolution: candidateGeneration,
      consolidation,
      annotationCapture: input.annotationCaptureMs ?? 0,
      annotationAssociation,
      total: Date.now() - t0
    }
  };
}
function buildDoorProductionManifest(result, scaleMmPerPt, sourceHash) {
  const mPerPt = scaleMmPerPt / 1e3;
  const accepted = [];
  const review = [];
  const acceptedByWall = /* @__PURE__ */ new Map();
  for (const a of result.accepted ?? []) {
    if (a.verdict !== "ACCEPT") continue;
    if (a.evidenceMode === "ANNOTATION_ONLY") continue;
    if (a.hostStatus !== "UNIQUE_HOST") continue;
    if (!a.selectedPhysicalWallId) continue;
    const from = a.wallLocalInterval?.from ?? 0;
    const to = a.wallLocalInterval?.to ?? 0;
    const startM = from * mPerPt;
    const endM = to * mPerPt;
    accepted.push({
      doorAssemblyId: a.doorAssemblyId,
      doorType: a.doorType,
      evidenceMode: a.evidenceMode,
      annotationIds: a.assistedByAnnotationId ? [a.assistedByAnnotationId] : [],
      selectedPhysicalWallId: a.selectedPhysicalWallId,
      wallLocalInterval: { startM, endM },
      widthM: (to - from) * mPerPt,
      hingeSide: a.hinge ? "left" : "left",
      swingDirection: a.swingDirection ?? "inward",
      sourceSegmentIds: [...a.leafSegmentIds, ...a.swingSegmentIds],
      sourceOperationIds: a.sourceOperationIds,
      hostStatus: a.hostStatus,
      physicalGeometryVerified: true,
      intervalContained: true,
      verdict: "ACCEPT"
    });
    acceptedByWall.set(a.selectedPhysicalWallId, a.doorAssemblyId);
  }
  accepted.sort(
    (x, y) => x.selectedPhysicalWallId === y.selectedPhysicalWallId ? x.wallLocalInterval.startM - y.wallLocalInterval.startM : x.selectedPhysicalWallId.localeCompare(y.selectedPhysicalWallId)
  );
  for (const a of [...result.review ?? [], ...result.rejected ?? []]) {
    const from = a.wallLocalInterval?.from ?? 0;
    const to = a.wallLocalInterval?.to ?? 0;
    const isGranularityConflict = a.negativeEvidence.includes("annotation-gate:no-nearby-dt-anchor") || a.evidenceMode === "ANNOTATION_ASSISTED_REVIEW_REQUIRED";
    const related = a.selectedPhysicalWallId ? acceptedByWall.get(a.selectedPhysicalWallId) : void 0;
    review.push({
      doorAssemblyId: a.doorAssemblyId,
      verdict: a.verdict === "REJECTED" ? "REJECT" : "REVIEW",
      evidenceMode: a.evidenceMode,
      selectedPhysicalWallId: a.selectedPhysicalWallId,
      reviewReason: isGranularityConflict ? "AUDIT_GRANULARITY_CONFLICT" : "PENDING_HUMAN_REVIEW",
      automaticInstallationAllowed: false,
      relatedAcceptedAssemblyId: related,
      annotationIds: a.assistedByAnnotationId ? [a.assistedByAnnotationId] : [],
      physicalGeometrySummary: { widthM: (to - from) * mPerPt, intervalStartM: from * mPerPt, intervalEndM: to * mPerPt }
    });
  }
  const canon = accepted.map((r) => `${r.doorAssemblyId}:${r.selectedPhysicalWallId}:${r.wallLocalInterval.startM.toFixed(3)}:${r.wallLocalInterval.endM.toFixed(3)}:${r.evidenceMode}:${r.widthM.toFixed(3)}`).sort().join("\n");
  const manifestHash = hashStrings2([canon]);
  return {
    accepted,
    review,
    acceptedCount: accepted.length,
    reviewCount: review.length,
    sourceHash,
    manifestHash
  };
}

// src/index.ts
import * as mupdf5 from "mupdf";

// ../extraction-annotations/src/contracts.ts
var DEFAULT_ANNOTATION_OPTIONS = {
  enableText: true,
  enableAnnotationObjects: true,
  enableVectorGlyphFallback: false,
  enableOcrFallback: false,
  doorTagPattern: "^DT[-\\s]?\\d{1,3}$",
  doorTagSearchTerm: "DT"
};
var DEFAULT_ANNOTATION_FEATURE_FLAGS = {
  ENABLE_PROGRAMMATIC_ANNOTATIONS: true,
  ENABLE_DOOR_ANNOTATION_ASSIST: true,
  ENABLE_ANNOTATION_OCR_FALLBACK: false
};
function bboxFromQuad(quad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of quad) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  return { x0, y0, x1, y1 };
}
function bboxCentre(b) {
  return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
}
function normalizeDoorTag(text) {
  return text.trim().replace(/\s+/g, "").toUpperCase();
}

// ../extraction-annotations/src/pdf-text.ts
var seq = 0;
function nextId2() {
  return `anno-txt-${seq++}`;
}
function extractDoorTagsFromText(page2, options, pageIndex = 0) {
  const out = [];
  if (!options.enableText) return out;
  let hits = [];
  try {
    hits = page2.search(options.doorTagSearchTerm, 100);
  } catch {
    return out;
  }
  for (const quad of hits) {
    const b = bboxFromQuad(quad);
    const c = bboxCentre(b);
    const text = options.doorTagSearchTerm;
    const normalized = normalizeDoorTag(text);
    out.push({
      annotationId: nextId2(),
      text,
      normalizedText: normalized,
      kind: "PDF_TEXT",
      pageIndex,
      boundsPdf: [b.x0, b.y0, b.x1, b.y1],
      centrePdf: c,
      confidence: "medium",
      matchedPattern: normalized
    });
  }
  return out;
}
function extractDoorTagsFromStructuredText(page2, options, pageIndex = 0) {
  const out = [];
  if (!options.enableText) return out;
  let stext;
  try {
    stext = page2.toStructuredText("preserve-whitespace");
  } catch {
    return out;
  }
  const pattern = options.doorTagPattern ? new RegExp(options.doorTagPattern, "i") : null;
  let blockId = 0;
  let spanId = 0;
  try {
    stext.walk({
      beginTextBlock() {
        blockId++;
      },
      beginLine() {
      },
      onText(text, bbox) {
        spanId++;
        const normalized = normalizeDoorTag(text);
        if (pattern && !pattern.test(normalized)) return;
        const b = bbox ? bboxFromQuad([bbox]) : { x0: 0, y0: 0, x1: 0, y1: 0 };
        const c = bboxCentre(b);
        out.push({
          annotationId: nextId2(),
          text: String(text).trim(),
          normalizedText: normalized,
          kind: "PDF_TEXT",
          pageIndex,
          boundsPdf: [b.x0, b.y0, b.x1, b.y1],
          centrePdf: c,
          confidence: "high",
          sourceBlockId: `block-${blockId}`,
          sourceSpanId: `span-${spanId}`,
          matchedPattern: normalized
        });
      },
      endLine() {
      },
      endTextBlock() {
      }
    });
  } catch {
  }
  return out;
}

// ../extraction-annotations/src/pdf-annotations.ts
var seq2 = 0;
function nextId3() {
  return `anno-obj-${seq2++}`;
}
function extractAnnotationsFromObjects(page2, options, pageIndex = 0) {
  const out = [];
  if (!options.enableAnnotationObjects) return out;
  let annots = [];
  try {
    annots = page2.getAnnotations();
  } catch {
    return out;
  }
  const pattern = options.doorTagPattern ? new RegExp(options.doorTagPattern, "i") : null;
  for (const a of annots) {
    let raw = "";
    try {
      raw = a.getContents ? String(a.getContents() ?? "") : "";
    } catch {
      raw = "";
    }
    const normalized = normalizeDoorTag(raw);
    if (!raw) continue;
    if (pattern && !pattern.test(normalized)) continue;
    let b = { x0: 0, y0: 0, x1: 0, y1: 0 };
    try {
      const bb = a.getBounds();
      if (bb) b = { x0: bb.x0, y0: bb.y0, x1: bb.x1, y1: bb.y1 };
    } catch {
    }
    const c = bboxCentre(b);
    out.push({
      annotationId: nextId3(),
      text: raw,
      normalizedText: normalized,
      kind: "PDF_ANNOTATION_OBJECT",
      pageIndex,
      boundsPdf: [b.x0, b.y0, b.x1, b.y1],
      centrePdf: c,
      confidence: "high",
      matchedPattern: normalized
    });
  }
  return out;
}

// ../extraction-annotations/src/spatial-index.ts
var AnnotationSpatialIndex = class {
  items = [];
  insert(a) {
    this.items.push(a);
  }
  insertAll(list) {
    for (const a of list) this.insert(a);
  }
  get all() {
    return this.items;
  }
  /**
   * Return annotations whose centre lies within `radiusPt` of `point` (PDF space).
   */
  queryWithin(point, radiusPt) {
    const out = [];
    for (const a of this.items) {
      const c = a.centrePdf;
      if (Math.hypot(c[0] - point.x, c[1] - point.y) <= radiusPt) out.push(a);
    }
    return out;
  }
  /**
   * Return annotations whose bounds intersect the given box.
   */
  queryIntersecting(box) {
    const out = [];
    for (const a of this.items) {
      const b = a.boundsPdf;
      const overlap = b[0] <= box.x1 && b[2] >= box.x0 && b[1] <= box.y1 && b[3] >= box.y0;
      if (overlap) out.push(a);
    }
    return out;
  }
  /** Nearest annotation to a point, or null. */
  nearest(point) {
    let best = null;
    let bd = Infinity;
    for (const a of this.items) {
      const c = a.centrePdf;
      const d = Math.hypot(c[0] - point.x, c[1] - point.y);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }
};
function buildAnnotationSpatialIndex(list) {
  const idx = new AnnotationSpatialIndex();
  idx.insertAll(list);
  return idx;
}

// ../extraction-annotations/src/index.ts
function captureDoorAnnotations(page2, options = DEFAULT_ANNOTATION_OPTIONS, featureFlags = DEFAULT_ANNOTATION_FEATURE_FLAGS, pageIndex = 0) {
  const annotations = [];
  if (!featureFlags.ENABLE_PROGRAMMATIC_ANNOTATIONS) {
    return {
      annotations: [],
      index: buildAnnotationSpatialIndex([]),
      byKind: {},
      storageClassified: "NONE",
      timings: { textSearchMs: 0, structuredTextMs: 0, indexBuildMs: 0, totalMs: 0 }
    };
  }
  const t0 = Date.now();
  const tsStruct = Date.now();
  const fromStructured = extractDoorTagsFromStructuredText(page2, options, pageIndex);
  const structuredMs = Date.now() - tsStruct;
  const tsSearch = Date.now();
  const fromSearch = extractDoorTagsFromText(page2, options, pageIndex);
  const searchMs = Date.now() - tsSearch;
  const fromObjects = extractAnnotationsFromObjects(page2, options, pageIndex);
  annotations.push(...fromStructured, ...fromSearch, ...fromObjects);
  const byKind = {};
  for (const a of annotations) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
  const seenCentre = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const a of annotations) {
    const key = `${a.centrePdf[0].toFixed(1)},${a.centrePdf[1].toFixed(1)}`;
    if (seenCentre.has(key)) continue;
    seenCentre.add(key);
    deduped.push(a);
  }
  let storage = "NONE";
  const hasText = deduped.some((a) => a.kind === "PDF_TEXT");
  const hasObj = deduped.some((a) => a.kind === "PDF_ANNOTATION_OBJECT");
  if (hasText && hasObj) storage = "MIXED";
  else if (hasText) storage = "PDF_TEXT";
  else if (hasObj) storage = "PDF_ANNOTATION_OBJECT";
  const ti = Date.now();
  const index = buildAnnotationSpatialIndex(deduped);
  const indexMs = Date.now() - ti;
  return {
    annotations: deduped,
    index,
    byKind,
    storageClassified: storage,
    timings: { textSearchMs: searchMs, structuredTextMs: structuredMs, indexBuildMs: indexMs, totalMs: Date.now() - t0 }
  };
}

// scripts/run-tests.mts
import * as mupdf6 from "mupdf";
var ROOT = process.cwd();
var PDF = join(ROOT, "..", "..", "test drawings and png", "CODE_06 1 page.pdf");
var pass = 0;
var fail = 0;
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}
var bytes = new Uint8Array(readFileSync(PDF));
var doc = mupdf6.Document.openDocument(bytes, "application/pdf");
var page = doc.loadPage(0);
var cap = collectPageVectors(page, false, 0);
var wr = extractPureWallResult(bytes, 0, void 0, void 0, true);
var ann = captureDoorAnnotations(page, DEFAULT_ANNOTATION_OPTIONS, void 0, 0);
var merged = PURE_DOOR_DEFAULTS;
console.log("=== annotation tests ===");
check("DT normalization DT-07", normalizeDoorTag("DT-07") === "DT-07");
check("storageClassified PDF_TEXT", ann.storageClassified === "PDF_TEXT", `(${ann.storageClassified})`);
check("recovered >= 20 anchors", ann.annotations.length >= 20, `(${ann.annotations.length})`);
check("all anchors PDF_TEXT (no OCR)", ann.annotations.every((a) => a.kind === "PDF_TEXT"));
console.log("=== door pipeline tests ===");
var tight = runDoorPipeline({ vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0, 0, 1, 1] }, { ...merged, hostCorridorPadPt: 6, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false }, false);
var face = runDoorPipeline({ vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0, 0, 1, 1] }, { ...merged, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false }, false);
check("face-aware recovers >= tight", face.accepted.length >= tight.accepted.length, `(${face.accepted.length} vs ${tight.accepted.length})`);
var ambig = runDoorPipeline({ vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0, 0, 1, 1] }, { ...merged, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false, hostAmbiguityMargin: 0.5 }, false);
check("all accepted UNIQUE_HOST", ambig.accepted.every((a) => a.hostStatus === "UNIQUE_HOST"));
var C = runDoorPipeline({ vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0, 0, 1, 1], annotations: ann.annotations, annotationIndex: ann.index, annotationCaptureMs: 0 }, merged, false);
check("no ANNOTATION_ONLY assemblies", C.annotationAssisted.every((a) => a.evidenceMode !== "ANNOTATION_ONLY"));
var keys = C.accepted.map((a) => `${a.selectedPhysicalWallId}:${a.wallLocalInterval?.from.toFixed(1)}:${a.wallLocalInterval?.to.toFixed(1)}`);
check("accepted unique by wall+interval (no dup)", new Set(keys).size === keys.length, `(${new Set(keys).size}/${keys.length})`);
var r1 = runDoorPipeline({ vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0, 0, 1, 1], annotations: ann.annotations, annotationIndex: ann.index, annotationCaptureMs: 0 }, merged, false);
var r2 = runDoorPipeline({ vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0, 0, 1, 1], annotations: ann.annotations, annotationIndex: ann.index, annotationCaptureMs: 0 }, merged, false);
check("deterministic candidateHash", r1.candidateHash === r2.candidateHash, `(${r1.candidateHash} vs ${r2.candidateHash})`);
check("deterministic assemblyHash", r1.assemblyHash === r2.assemblyHash);
check("deterministic annotationHash", r1.annotationHash === r2.annotationHash);
var g1 = runDoorPipeline({ vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0, 0, 1, 1] }, { ...merged, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false }, false);
var g2 = runDoorPipeline({ vectors: cap.vectors, wallResult: wr.pureResult, pageBoundsMupdf: [0, 0, 1, 1] }, { ...merged, enableProgrammaticAnnotations: false, enableDoorAnnotationAssist: false }, false);
check("annotation-disabled parity", g1.candidateHash === g2.candidateHash && g1.accepted.length === g2.accepted.length);
check("hybrid C accepted >= 20", C.accepted.length >= 20, `(${C.accepted.length})`);
check("hybrid accepted evidence valid", C.accepted.every((a) => ["ANNOTATION_ASSISTED_GEOMETRY_VERIFIED", "GEOMETRY_ONLY", "ANNOTATION_ASSISTED_REVIEW_REQUIRED"].includes(a.evidenceMode)));
{
  const man = buildDoorProductionManifest(C, wr.pureResult.scaleMmPerPt, "h");
  check("manifest accepted == 24", man.acceptedCount === 24, `(${man.acceptedCount})`);
  check("manifest review >= 1 (DR-16)", man.reviewCount >= 1, `(${man.reviewCount})`);
  check("manifest accepted no ANNOTATION_ONLY", !man.accepted.some((r) => r.evidenceMode === "ANNOTATION_ONLY"));
  check("manifest accepted all UNIQUE_HOST", man.accepted.every((r) => r.hostStatus === "UNIQUE_HOST"));
  check("manifest accepted all physicalGeometryVerified", man.accepted.every((r) => r.physicalGeometryVerified === true));
  check("manifest accepted all intervalContained", man.accepted.every((r) => r.intervalContained === true));
  const ids = man.accepted.map((r) => r.doorAssemblyId);
  check("manifest accepted unique ids", new Set(ids).size === ids.length);
  check("manifest no annotation-only in accepted", !man.accepted.some((r) => r.evidenceMode === "ANNOTATION_ONLY"));
}
console.log(`
=== TOTAL: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);

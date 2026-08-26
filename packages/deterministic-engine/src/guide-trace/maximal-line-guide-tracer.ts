import type {
  Axis, GuideTraceGraph, HostedGap, MaximalFace, RawMaximalLine,
  TraceJunction, WallBand,
} from './guide-trace-types';

export interface TraceBuildOptions {
  coordinateToleranceM?: number;
  mergeGapToleranceM?: number;
  minimumFaceLengthM?: number;
  minimumConfigurationSupport?: number;
  singleSourceConfirmConfidence?: number;
  minimumWallThicknessM?: number;
  maximumWallThicknessM?: number;
  minimumPairOverlapRatio?: number;
  minimumPairOverlapM?: number;
  junctionToleranceM?: number;
  minimumComponentSize?: number;
}

const DEFAULTS: Required<TraceBuildOptions> = {
  coordinateToleranceM: 0.035,
  mergeGapToleranceM: 0.20,
  minimumFaceLengthM: 0.40,
  minimumConfigurationSupport: 2,
  singleSourceConfirmConfidence: 0.90,
  minimumWallThicknessM: 0.07,
  maximumWallThicknessM: 0.36,
  minimumPairOverlapRatio: 0.65,
  minimumPairOverlapM: 0.45,
  junctionToleranceM: 0.16,
  minimumComponentSize: 2,
};

const round = (v: number, places = 4) => Number(v.toFixed(places));
const stableId = (prefix: string, values: Array<string | number>) =>
  `${prefix}_${values.map(v => typeof v === 'number' ? Math.round(v * 1000) : v).join('_')}`;

interface CoordCluster { axis: Axis; lines: RawMaximalLine[]; }

function median(values: number[]): number {
  const a = [...values].sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

function clusterCoordinates(lines: RawMaximalLine[], tol: number): CoordCluster[] {
  const out: CoordCluster[] = [];
  for (const axis of ['H', 'V'] as Axis[]) {
    const sorted = lines.filter(l => l.axis === axis).sort((a, b) => a.coordinateM - b.coordinateM);
    for (const line of sorted) {
      let best: CoordCluster | undefined;
      let bestDistance = Infinity;
      for (const c of out) {
        if (c.axis !== axis) continue;
        const center = median(c.lines.map(x => x.coordinateM));
        const d = Math.abs(center - line.coordinateM);
        if (d <= tol && d < bestDistance) { best = c; bestDistance = d; }
      }
      if (best) best.lines.push(line);
      else out.push({ axis, lines: [line] });
    }
  }
  return out;
}

function mergeIntervals(cluster: CoordCluster, opts: Required<TraceBuildOptions>): MaximalFace[] {
  const coordinateM = median(cluster.lines.map(l => l.coordinateM));
  const intervals = [...cluster.lines].sort((a, b) => a.startM - b.startM);
  const groups: RawMaximalLine[][] = [];
  for (const line of intervals) {
    const current = groups[groups.length - 1];
    if (!current) { groups.push([line]); continue; }
    const end = Math.max(...current.map(x => x.endM));
    if (line.startM <= end + opts.mergeGapToleranceM) current.push(line);
    else groups.push([line]);
  }
  const faces: MaximalFace[] = [];
  for (const group of groups) {
    const startM = Math.min(...group.map(x => x.startM));
    const endM = Math.max(...group.map(x => x.endM));
    const lengthM = endM - startM;
    if (lengthM < opts.minimumFaceLengthM) continue;
    const configs = new Set(group.map(x => x.detectorConfigId));
    const sourceConf = Math.max(...group.map(x => x.confidence));
    // Confidence: single-detector evidence keeps its own confidence (no consensus dilution);
    // multi-detector fusion blends. The admission GATE below decides confirmation.
    const confidence = configs.size <= 1
      ? sourceConf
      : Math.min(1, 0.55 * configs.size / Math.max(opts.minimumConfigurationSupport, 3) + 0.45 * sourceConf);
    // Admissibility (do NOT globally lower single-source admission):
    //  - multi-detector consensus (>= minimumConfigurationSupport) confirms; OR
    //  - single source ONLY when explicitly classified as wall/structure/partition evidence
    //    AND confidence >= singleSourceConfirmConfidence (default 0.90).
    // Unclassified PDF vectors (confidence 0.72) stay unresolved unless fused by guide
    // planes or graph closure.
    const hasWallClass = group.some(x => x.vectorClass === 'wall' || x.vectorClass === 'structure' || x.vectorClass === 'partition');
    const confirmedByConsensus = configs.size >= opts.minimumConfigurationSupport;
    const confirmedBySingleSource = configs.size === 1 && hasWallClass && sourceConf >= opts.singleSourceConfirmConfidence;
    const status = confirmedByConsensus || confirmedBySingleSource ? 'confirmed' : 'unresolved';
    faces.push({
      id: stableId('face', [cluster.axis, coordinateM, startM, endM]),
      axis: cluster.axis,
      coordinateM: round(coordinateM),
      startM: round(startM), endM: round(endM), lengthM: round(lengthM),
      configurationSupport: configs.size,
      sourceIds: [...new Set(group.flatMap(x => [x.id, ...(x.sourceId ? [x.sourceId] : [])]))].sort(),
      confidence: round(confidence, 3), status,
    });
  }
  return faces;
}

function buildFaces(lines: RawMaximalLine[], opts: Required<TraceBuildOptions>): MaximalFace[] {
  return clusterCoordinates(lines, opts.coordinateToleranceM)
    .flatMap(c => mergeIntervals(c, opts))
    .sort((a, b) => a.axis.localeCompare(b.axis) || a.coordinateM - b.coordinateM || a.startM - b.startM);
}

function overlap(a: MaximalFace, b: MaximalFace) {
  const length = Math.max(0, Math.min(a.endM, b.endM) - Math.max(a.startM, b.startM));
  const ratio = length / Math.max(0.001, Math.min(a.lengthM, b.lengthM));
  return { length, ratio };
}

function pairFaces(faces: MaximalFace[], opts: Required<TraceBuildOptions>): WallBand[] {
  type Candidate = { i: number; j: number; score: number; thickness: number; overlap: number; ratio: number };
  const candidates: Candidate[] = [];
  for (let i = 0; i < faces.length; i++) {
    const a = faces[i]!;
    if (a.status !== 'confirmed') continue;
    for (let j = i + 1; j < faces.length; j++) {
      const b = faces[j]!;
      if (a.axis !== b.axis || b.status !== 'confirmed') continue;
      const thickness = Math.abs(a.coordinateM - b.coordinateM);
      if (thickness < opts.minimumWallThicknessM || thickness > opts.maximumWallThicknessM) continue;
      const ov = overlap(a, b);
      if (ov.length < opts.minimumPairOverlapM || ov.ratio < opts.minimumPairOverlapRatio) continue;
      const thicknessScore = 1 - Math.min(1, Math.abs(thickness - 0.18) / 0.22);
      const score = 0.68 * ov.ratio + 0.22 * thicknessScore + 0.10 * Math.min(a.confidence, b.confidence);
      candidates.push({ i, j, score, thickness, overlap: ov.length, ratio: ov.ratio });
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.overlap - a.overlap || a.i - b.i || a.j - b.j);
  const used = new Set<number>();
  const bands: WallBand[] = [];
  for (const c of candidates) {
    if (used.has(c.i) || used.has(c.j)) continue;
    used.add(c.i); used.add(c.j);
    const a = faces[c.i]!, b = faces[c.j]!;
    const start = Math.max(a.startM, b.startM), end = Math.min(a.endM, b.endM);
    const coordinate = (a.coordinateM + b.coordinateM) / 2;
    const centerlineStart: [number, number] = a.axis === 'H' ? [start, coordinate] : [coordinate, start];
    const centerlineEnd: [number, number] = a.axis === 'H' ? [end, coordinate] : [coordinate, end];
    bands.push({
      id: stableId('band', [a.axis, coordinate, start, end, c.thickness]),
      axis: a.axis, nearFace: a, farFace: b,
      centerlineStart: centerlineStart.map(x => round(x)) as [number, number],
      centerlineEnd: centerlineEnd.map(x => round(x)) as [number, number],
      thicknessM: round(c.thickness, 3), overlapRatio: round(c.ratio, 3),
      confidence: round(c.score, 3), sourceIds: [...new Set([...a.sourceIds, ...b.sourceIds])].sort(),
      status: c.score >= 0.72 ? 'confirmed' : 'unresolved',
    });
  }
  return bands;
}

function bandInterval(b: WallBand) {
  return b.axis === 'H'
    ? { coordinate: b.centerlineStart[1], start: Math.min(b.centerlineStart[0], b.centerlineEnd[0]), end: Math.max(b.centerlineStart[0], b.centerlineEnd[0]) }
    : { coordinate: b.centerlineStart[0], start: Math.min(b.centerlineStart[1], b.centerlineEnd[1]), end: Math.max(b.centerlineStart[1], b.centerlineEnd[1]) };
}

function bandsTouch(a: WallBand, b: WallBand, tol: number): boolean {
  const ai = bandInterval(a), bi = bandInterval(b);
  if (a.axis !== b.axis) {
    const h = a.axis === 'H' ? ai : bi; const v = a.axis === 'V' ? ai : bi;
    return v.coordinate >= h.start - tol && v.coordinate <= h.end + tol &&
      h.coordinate >= v.start - tol && h.coordinate <= v.end + tol;
  }
  return Math.abs(ai.coordinate - bi.coordinate) <= tol &&
    Math.max(ai.start, bi.start) <= Math.min(ai.end, bi.end) + tol;
}

function components(bands: WallBand[], tol: number): number[][] {
  const adj = bands.map(() => new Set<number>());
  for (let i = 0; i < bands.length; i++) for (let j = i + 1; j < bands.length; j++) {
    if (bandsTouch(bands[i]!, bands[j]!, tol)) { adj[i]!.add(j); adj[j]!.add(i); }
  }
  const seen = new Set<number>(); const out: number[][] = [];
  for (let i = 0; i < bands.length; i++) {
    if (seen.has(i)) continue;
    const stack = [i], group: number[] = []; seen.add(i);
    while (stack.length) {
      const u = stack.pop()!; group.push(u);
      for (const v of adj[u]!) if (!seen.has(v)) { seen.add(v); stack.push(v); }
    }
    out.push(group);
  }
  return out.sort((a, b) => b.length - a.length);
}

function endpointSupport(bands: WallBand[], tol: number) {
  let supported = 0; const dangling: Array<{ bandId: string; point: [number, number] }> = [];
  for (const band of bands) for (const point of [band.centerlineStart, band.centerlineEnd] as [number, number][]) {
    const probe: WallBand = { ...band, centerlineStart: point, centerlineEnd: point };
    const ok = bands.some(other => other.id !== band.id && bandsTouch(probe, other, tol));
    if (ok) supported++; else dangling.push({ bandId: band.id, point });
  }
  return { rate: supported / Math.max(1, bands.length * 2), dangling };
}

function buildJunctions(bands: WallBand[], tol: number): TraceJunction[] {
  const junctions = new Map<string, TraceJunction>();
  for (let i = 0; i < bands.length; i++) for (let j = i + 1; j < bands.length; j++) {
    const a = bands[i]!, b = bands[j]!;
    if (!bandsTouch(a, b, tol)) continue;
    let point: [number, number];
    if (a.axis !== b.axis) {
      const h = a.axis === 'H' ? bandInterval(a) : bandInterval(b);
      const v = a.axis === 'V' ? bandInterval(a) : bandInterval(b);
      point = [v.coordinate, h.coordinate];
    } else {
      const ai = bandInterval(a), bi = bandInterval(b);
      const along = Math.max(ai.start, bi.start);
      point = a.axis === 'H' ? [along, (ai.coordinate + bi.coordinate) / 2] : [(ai.coordinate + bi.coordinate) / 2, along];
    }
    const key = `${Math.round(point[0] / tol)},${Math.round(point[1] / tol)}`;
    const existing = junctions.get(key);
    if (existing) existing.incidentBandIds = [...new Set([...existing.incidentBandIds, a.id, b.id])].sort();
    else junctions.set(key, { id: stableId('junction', point), point: [round(point[0]), round(point[1])], incidentBandIds: [a.id, b.id].sort() });
  }
  return [...junctions.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function buildGuideTraceGraph(
  rawLines: RawMaximalLine[],
  options: TraceBuildOptions = {},
): GuideTraceGraph {
  const opts = { ...DEFAULTS, ...options };
  const faces = buildFaces(rawLines, opts);
  const wallBands = pairFaces(faces, opts);
  const comps = components(wallBands, opts.junctionToleranceM);
  const principal = new Set(comps[0] ?? []);
  const support = endpointSupport(wallBands, opts.junctionToleranceM);

  // Geometry admission: principal component is primary; small components remain unresolved.
  const acceptedBands = wallBands.filter((b, i) => principal.has(i) && b.status === 'confirmed');
  const acceptedIds = new Set(acceptedBands.map(b => b.id));
  const rejectedBands = wallBands.filter(b => !acceptedIds.has(b.id)).map(b => ({ ...b, status: 'unresolved' as const }));
  acceptedBands.forEach(b => { b.componentId = 'component_1'; });
  comps.slice(1).forEach((group, ci) => group.forEach(i => { wallBands[i]!.componentId = `component_${ci + 2}`; }));
  const acceptedSupport = endpointSupport(acceptedBands, opts.junctionToleranceM);
  const junctions = buildJunctions(acceptedBands, opts.junctionToleranceM);
  const hostedGaps: HostedGap[] = []; // populated only after complete-run coverage analysis

  return {
    faces, wallBands, acceptedBands, rejectedBands, junctions, hostedGaps,
    metrics: {
      rawLineCount: rawLines.length,
      maximalFaceCount: faces.length,
      wallBandCount: wallBands.length,
      acceptedBandCount: acceptedBands.length,
      graphComponentCount: comps.length,
      principalComponentRate: round((comps[0]?.length ?? 0) / Math.max(1, wallBands.length), 3),
      endpointSupportRate: round(acceptedSupport.rate, 3),
      danglingEndpointCount: acceptedSupport.dangling.length,
    },
  };
}

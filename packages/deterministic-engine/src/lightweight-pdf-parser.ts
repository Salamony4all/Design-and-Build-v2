import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { IngestionResult, VectorPrimitive, DetectedSymbol, ScheduleTable } from './router';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure absolute disk path for the PDF.js worker module as a file:// URL
const workerPath = path.join(__dirname, '../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).toString();

const PT_PER_M = 72 / 0.0254;
const IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];

const roundVal = (n: number, p = 4) => Number(Number(n).toFixed(p));
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const getDistance = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const multiplyMatrices = (a: number[], b: number[]) => (pdfjs as any).Util.transform(a, b) as number[];
const applyMatrix = (m: number[], p: [number, number]) => {
  if (!p || p[0] === undefined || p[1] === undefined) return [0, 0] as [number, number];
  return (pdfjs as any).Util.applyTransform(p, m) as [number, number];
};
const normalizeString = (s: any) => String(s || '').replace(/\s+/g, ' ').trim();
const getUnique = <T>(a: T[]): T[] => [...new Set(a)];

function parseScale(text: string, fallback = 50) {
  const m = text.match(/(?:SCALE\s*)?1\s*:\s*(\d+(?:\.\d+)?)/i);
  return m ? Number(m[1]) : fallback;
}

function toMeters(pt: number, ppm: number) {
  return roundVal(pt / ppm);
}

function pdfToScenePoint(point: [number, number], pageView: number[], ppm: number): [number, number] {
  const v0 = pageView[0] ?? 0;
  const v3 = pageView[3] ?? 0;
  return [toMeters(point[0] - v0, ppm), toMeters(v3 - point[1], ppm)];
}

function matrixScale(m: number[]) {
  return (Math.hypot(m[0] ?? 1, m[1] ?? 0) + Math.hypot(m[2] ?? 0, m[3] ?? 1)) / 2;
}

function segmentLayer(widthM: number, lengthM: number) {
  if (widthM >= 0.12 || lengthM > 2.2) return 'A-WALL';
  if (widthM >= 0.06) return 'I-WALL';
  return 'A-FURN';
}

interface PathPart {
  type: 'line' | 'curve';
  points: [[number, number], [number, number]];
  controls?: [[number, number], [number, number]];
}

function pathCommands(packed: Float32Array, ctm: number[]): PathPart[] {
  if (!packed) return [];
  const out: PathPart[] = [];
  let k = 0;
  let cur: [number, number] | null = null;
  let start: [number, number] | null = null;
  
  const readPoint = (): [number, number] => {
    const x = packed[k++];
    const y = packed[k++];
    if (x === undefined || y === undefined) return [0, 0];
    return [x, y];
  };
  
  while (k < packed.length) {
    const op = packed[k++];
    if (op === 0) { // moveTo
      cur = readPoint();
      start = cur;
    } 
    else if (op === 1) { // lineTo
      const p = readPoint();
      if (cur) {
        out.push({ type: 'line', points: [cur, p] });
      }
      cur = p;
    } 
    else if (op === 2) { // bezierCurveTo
      const c1 = readPoint();
      const c2 = readPoint();
      const p = readPoint();
      if (cur) {
        out.push({ type: 'curve', points: [cur, p], controls: [c1, c2] });
      }
      cur = p;
    } 
    else if (op === 3) { // closePath
      if (cur && start) {
        out.push({ type: 'line', points: [cur, start] });
      }
      cur = start;
    } 
    else if (op === 4) { // rectangle
      const x = packed[k++] ?? 0;
      const y = packed[k++] ?? 0;
      const w = packed[k++] ?? 0;
      const h = packed[k++] ?? 0;
      const ps: [number, number][] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      for (let i = 0; i < 4; i++) {
        const pCurrent = ps[i];
        const pNext = ps[(i + 1) % 4];
        if (pCurrent && pNext) {
          out.push({ type: 'line', points: [pCurrent, pNext] });
        }
      }
      cur = ps[0] ?? null;
      start = ps[0] ?? null;
    } 
    else {
      break;
    }
  }
  return out;
}

function isRoomLike(s: string) {
  return /\b(?:BED UNIT|COMMON ROOM|TOILET|CORRIDOR|LINEN|KITCHEN|OFFICE|LOBBY|STORE|STAIR|SHAFT)\b/i.test(s);
}

function classifySymbol(text: string) {
  const t = text.toUpperCase();
  if (/BED/.test(t)) return 'bed';
  if (/TOILET|WC\b/.test(t)) return 'toilet';
  if (/SINK|BASIN/.test(t)) return 'sink';
  if (/LOCKER/.test(t)) return 'locker';
  if (/CLOSET|WARDROBE/.test(t)) return 'closet';
  if (/DESK|TABLE/.test(t)) return 'desk';
  if (/CHAIR/.test(t)) return 'chair';
  return null;
}

interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  matrix: number[];
}

function inferRoi(textItems: TextItem[], view: number[]): number[] {
  const v0 = view[0] ?? 0;
  const v1 = view[1] ?? 0;
  const v2 = view[2] ?? 0;
  const v3 = view[3] ?? 0;

  const anchors = textItems.filter(t => isRoomLike(t.str));
  if (!anchors.length) {
    return [v0, v1, v2, v3];
  }
  const xs = anchors.map(x => x.x);
  const ys = anchors.map(x => x.y);
  const marginX = (v2 - v0) * 0.28;
  const marginY = (v3 - v1) * 0.30;
  return [
    Math.max(v0, Math.min(...xs) - marginX),
    Math.max(v1, Math.min(...ys) - marginY),
    Math.min(v2, Math.max(...xs) + marginX),
    Math.min(v3, Math.max(...ys) + marginY)
  ];
}

function insideRoi(points: [number, number][], roi: number[]): boolean {
  if (!points || !roi) return false;
  const r0 = roi[0] ?? 0;
  const r1 = roi[1] ?? 0;
  const r2 = roi[2] ?? 0;
  const r3 = roi[3] ?? 0;
  return points.some(pt => {
    if (!pt || pt[0] === undefined || pt[1] === undefined) return false;
    const [x, y] = pt;
    return x >= r0 && x <= r2 && y >= r1 && y <= r3;
  });
}

function inferScheduleTables(pageTexts: { pageText: string }[]): ScheduleTable[] {
  const full = pageTexts.map(p => p.pageText || '').join('\n');
  const doorMatches = getUnique(full.match(/\bD[0-9]{1,3}\b/g) || []);
  const windowTypes = getUnique(full.match(/\bW[0-9]{1,3}\b/g) || []);
  
  const tables: ScheduleTable[] = [];
  if (doorMatches.length) {
    tables.push({
      id: 'sched_door_1',
      type: 'door_schedule',
      headers: ['Door Mark'],
      rows: doorMatches.map(x => [x]),
      confidence: 0.92
    });
  }
  if (windowTypes.length) {
    tables.push({
      id: 'sched_window_1',
      type: 'window_schedule',
      headers: ['Window Mark'],
      rows: windowTypes.map(x => [x]),
      confidence: 0.90
    });
  }
  return tables;
}

export async function parsePdfLightweight(filePath: string): Promise<IngestionResult> {
  const fileData = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({
    data: fileData,
    disableWorker: true,
    useSystemFonts: true,
    disableFontFace: true
  } as any).promise;
  
  const selectedPages: any[] = [];
  
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const view = page.view; // [x, y, w, h]
    const textContent = await page.getTextContent();
    const opList = await page.getOperatorList();
    
    const textItems = textContent.items
      .filter((i: any) => normalizeString(i.str))
      .map((i: any) => ({
        str: normalizeString(i.str),
        x: i.transform[4],
        y: i.transform[5],
        w: i.width || 0,
        h: i.height || 0,
        matrix: i.transform
      }));
      
    const pageText = textItems.map(x => x.str).join(' ');
    const scale = parseScale(pageText, 50);
    const ppm = PT_PER_M / scale;
    const roi = inferRoi(textItems, view);
    
    let ctm = [...IDENTITY_MATRIX];
    let lineWidth = 1;
    const stack: Array<{ ctm: number[]; lineWidth: number }> = [];
    const pending: Array<{ type: 'line' | 'curve'; points: [number, number][]; controls?: [number, number][] }> = [];
    const painted: Array<{ type: 'line' | 'curve'; points: [number, number][]; controls?: [number, number][]; lineWidthPt: number }> = [];
    
    const paint = () => {
      for (const p of pending) {
        painted.push({ ...p, lineWidthPt: lineWidth * matrixScale(ctm) });
      }
      pending.length = 0;
    };
    
    const OPS = pdfjs.OPS as Record<string, number>;
    
    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];
      
      if (fn === OPS.save) {
        stack.push({ ctm: [...ctm], lineWidth });
      } 
      else if (fn === OPS.restore) {
        const s = stack.pop();
        if (s) {
          ctm = s.ctm;
          lineWidth = s.lineWidth;
        }
      } 
      else if (fn === OPS.transform) {
        ctm = multiplyMatrices(ctm, args);
      } 
      else if (fn === OPS.setLineWidth) {
        lineWidth = Number(args[0]) || 1;
      } 
      else if (fn === OPS.constructPath) {
        if (!args[1] || !args[1][0]) continue;
        const parts = pathCommands(args[1][0], ctm);
        const actionCode = args[0];
        
        const isStroke = [OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(actionCode);
        if (isStroke) {
          for (const part of parts) {
            painted.push({ ...part, lineWidthPt: lineWidth * matrixScale(ctm) });
          }
        }
      } 
      else if ([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(fn)) {
        paint();
      } 
      else if ([OPS.endPath, OPS.fill, OPS.eoFill].includes(fn)) {
        pending.length = 0;
      }
    }

    
    const seen = new Set<string>();
    const vectors: VectorPrimitive[] = [];
    
    for (const p of painted) {
      const ctmPoints = p.points;
      
      // 2. Filter by ROI
      if (!insideRoi(ctmPoints, roi)) continue;
      
      // 3. Convert to scene points in meters
      const pt0 = ctmPoints[0];
      const pt1 = ctmPoints[1];
      if (!pt0 || !pt1) continue;

      const scenePts = [pdfToScenePoint(pt0, view, ppm), pdfToScenePoint(pt1, view, ppm)];
      const s0 = scenePts[0];
      const s1 = scenePts[1];
      if (!s0 || !s1) continue;

      const len = getDistance(s0, s1);
      if (len < 0.08 || len > 40) continue;
      
      const widthM = Math.max(0.001, p.lineWidthPt / ppm);
      
      // Axis-aligned bounding key for deduplication
      const q = (pt: [number, number]) => pt.map(v => Math.round(v / 0.002));
      const qa = q(s0);
      const qb = q(s1);
      if (!qa || !qb || qa[0] === undefined || qa[1] === undefined || qb[0] === undefined || qb[1] === undefined) continue;

      const key = `${p.type}:${(qa[0] < qb[0] || (qa[0] === qb[0] && qa[1] <= qb[1])) ? `${qa[0]}|${qa[1]}|${qb[0]}|${qb[1]}` : `${qb[0]}|${qb[1]}|${qa[0]}|${qa[1]}`}`;
      
      if (seen.has(key)) continue;
      seen.add(key);
      
      const ctrlPts = p.controls ? p.controls.map(pt => pdfToScenePoint(pt, view, ppm)) : undefined;
      
      vectors.push({
        layer: segmentLayer(widthM, len),
        type: p.type,
        points: [s0, s1],
        controlPoints: ctrlPts,
        confidence: clamp01(0.72 + (len > 1 ? 0.12 : 0) + (widthM > 0.03 ? 0.08 : 0))
      });
    }
    
    // Add text labels
    const r0 = roi[0] ?? 0;
    const r1 = roi[1] ?? 0;
    const r2 = roi[2] ?? 0;
    const r3 = roi[3] ?? 0;

    for (const t of textItems) {
      if (t.x < r0 || t.x > r2 || t.y < r1 || t.y > r3) continue;
      const pos = pdfToScenePoint([t.x, t.y], view, ppm);
      vectors.push({
        layer: 'ANNOTATION',
        type: 'text',
        points: [pos, pos],
        text: t.str,
        position: pos,
        confidence: 0.98
      });
    }
    
    // Add detected symbols
    const detectedSymbols: DetectedSymbol[] = [];
    for (const t of textItems) {
      const klass = classifySymbol(t.str);
      if (!klass) continue;
      
      const p = pdfToScenePoint([t.x, t.y], view, ppm);
      const sw = klass === 'bed' ? 2.0 : 0.8;
      const sd = klass === 'bed' ? 1.0 : 0.7;
      
      detectedSymbols.push({
        class: klass,
        confidence: 0.85,
        bbox: [p[0], p[1], sw, sd, 0.0]
      });
    }
    
    selectedPages.push({
      pageNumber: pageNum,
      view,
      pageText,
      scale,
      ppm,
      vectors,
      detectedSymbols
    });
  }
  
  if (!selectedPages.length) {
    throw new Error('No pages selected or parsed');
  }
  
  // Identify the primary drawing sheet by selecting the page containing the most vector line/curve geometry
  let primaryPage = selectedPages[0];
  let maxVectorsCount = selectedPages[0].vectors.filter((x: VectorPrimitive) => x.type !== 'text').length;
  
  for (let i = 1; i < selectedPages.length; i++) {
    const vectorsCount = selectedPages[i].vectors.filter((x: VectorPrimitive) => x.type !== 'text').length;
    if (vectorsCount > maxVectorsCount) {
      maxVectorsCount = vectorsCount;
      primaryPage = selectedPages[i];
    }
  }
  
  const allVectors = primaryPage.vectors;
  const allSymbols = primaryPage.detectedSymbols;
  
  return {
    track: allVectors.filter((x: VectorPrimitive) => x.type !== 'text').length ? 'vector' : 'raster',
    vectorPrimitives: allVectors,
    detectedSymbols: allSymbols,
    tables: inferScheduleTables(selectedPages),
    confidence: allVectors.filter((x: VectorPrimitive) => x.type !== 'text').length > 50 ? 0.96 : 0.85,
    pageWidth: roundVal(((primaryPage.view[2] ?? 0) - (primaryPage.view[0] ?? 0)) / primaryPage.ppm),
    pageHeight: roundVal(((primaryPage.view[3] ?? 0) - (primaryPage.view[1] ?? 0)) / primaryPage.ppm),
    pointsPerMeter: roundVal(primaryPage.ppm, 4)
  };
}

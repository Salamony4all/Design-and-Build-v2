import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as mupdf from 'mupdf';
import { createCanvas } from '@napi-rs/canvas';
import { collectPageVectors } from '../../extraction-mupdf/src/vector-device.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PDF_PATH = join(ROOT, '..', '..', 'apps', 'design-build-editor', 'public', 'CODE_06.pdf');
const GOLDEN_WALLS_PATH = join(ROOT, '..', '..', 'apps', 'design-build-editor', 'tests/fixtures/code06-pure-mupdf-golden.json');
const MANIFEST_PATH = join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2', 'blind-review-manifest.json');
const OUTPUT_DIR = join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2');
const CANDIDATES_OUTPUT_PATH = join(ROOT, 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.1', 'code06-automatic-window-output.json');

async function main() {
  console.log('Starting visual asset generation...');
  
  if (!existsSync(PDF_PATH)) {
    throw new Error(`PDF not found at ${PDF_PATH}`);
  }
  if (!existsSync(GOLDEN_WALLS_PATH)) {
    throw new Error(`Golden walls not found at ${GOLDEN_WALLS_PATH}`);
  }
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Manifest not found at ${MANIFEST_PATH}`);
  }
  if (!existsSync(CANDIDATES_OUTPUT_PATH)) {
    throw new Error(`Candidates output not found at ${CANDIDATES_OUTPUT_PATH}`);
  }

  // Load inputs
  const pdfBuffer = readFileSync(PDF_PATH);
  const goldenWalls = JSON.parse(readFileSync(GOLDEN_WALLS_PATH, 'utf8'));
  const wallsMap = new Map((goldenWalls.accepted || []).map(w => [w.physicalWallId, w]));
  
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const regions = manifest.regions || [];
  
  const candidatesData = JSON.parse(readFileSync(CANDIDATES_OUTPUT_PATH, 'utf8'));
  const candidatesMap = new Map((candidatesData.candidates || []).map(c => [c.candidateId, c]));

  // Open PDF via MuPDF
  const doc = mupdf.Document.openDocument(new Uint8Array(pdfBuffer), 'application/pdf');
  const page = doc.loadPage(0);
  
  // Set CropBox to full sheet
  page.setPageBox('CropBox', [0, 0, 2383.92, 1683.72]);
  
  const CS_SRGB = new mupdf.ColorSpace(0);
  
  // Render full page at scale 4 for high-res crops
  const SCALE = 4;
  console.log('Rendering full page at SCALE=4 (this may take a few seconds)...');
  const pagePix4 = page.toPixmap([SCALE, 0, 0, SCALE, 0, 0], CS_SRGB);
  const srcW4 = pagePix4.getWidth();
  const srcH4 = pagePix4.getHeight();
  const srcBuf4 = new Uint8Array(pagePix4.getPixels().buffer);
  console.log(`Full page rendered: ${srcW4}x${srcH4} px`);
  
  // Render full page at scale 1 for locators
  console.log('Rendering full page at SCALE=1 for locators...');
  const pagePix1 = page.toPixmap([1, 0, 0, 1, 0, 0], CS_SRGB);
  const srcW1 = pagePix1.getWidth();
  const srcH1 = pagePix1.getHeight();
  const srcBuf1 = new Uint8Array(pagePix1.getPixels().buffer);
  console.log(`Full page rendered (scale 1): ${srcW1}x${srcH1} px`);
  
  // Collect original page vector lines
  console.log('Collecting page vectors...');
  const vectorCollection = collectPageVectors(page, true, 0);
  const vectors = vectorCollection.vectors || [];
  console.log(`Collected ${vectors.length} vector elements`);

  const margin = 80; // context margin in PDF points

  // Prepare full-page locator canvas once (reused across all 25 regions)
  const canvasLocator = createCanvas(srcW1, srcH1);
  const ctxLocator = canvasLocator.getContext('2d');
  const imgDataLocator = ctxLocator.createImageData(srcW1, srcH1);
  const dstBufLocator = imgDataLocator.data;
  for (let j = 0; j < dstBufLocator.length; j++) {
    dstBufLocator[j] = srcBuf1[j];
  }

  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    const regionIndexStr = String(i).padStart(3, '0');
    console.log(`Processing region ${region.anonymousRegionId} (index ${regionIndexStr})...`);
    
    const wall = wallsMap.get(region.physicalWallId);
    if (!wall) {
      console.warn(`WARNING: Wall ${region.physicalWallId} not found for region ${region.anonymousRegionId}`);
      continue;
    }
    
    // Compute region endpoints in Stage A Space
    const ax = wall.a.x, ay = wall.a.y;
    const bx = wall.b.x, by = wall.b.y;
    const len = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    
    const start_A = region.rawIntervalUnion.start;
    const end_A = region.rawIntervalUnion.end;
    
    const pStart_A = { x: ax + start_A * ux, y: ay + start_A * uy };
    const pEnd_A = { x: ax + end_A * ux, y: ay + end_A * uy };
    
    // Page coordinates (CropBox relative, Y top-down)
    const x_page_start = pStart_A.x / 0.75 - 259;
    const x_page_end = pEnd_A.x / 0.75 - 259;
    const y_page_start = 1395.72 - pStart_A.y / 0.75;
    const y_page_end = 1395.72 - pEnd_A.y / 0.75;
    
    const xMin = Math.min(x_page_start, x_page_end);
    const xMax = Math.max(x_page_start, x_page_end);
    const yMin = Math.min(y_page_start, y_page_end);
    const yMax = Math.max(y_page_start, y_page_end);
    
    // Apply context margin
    const x0_page = Math.max(0, xMin - margin);
    const x1_page = Math.min(2124.92, xMax + margin);
    const y0_page = Math.max(0, yMin - margin);
    const y1_page = Math.min(1395.72, yMax + margin);
    
    const w = x1_page - x0_page;
    const h = y1_page - y0_page;
    
    // Coordinates transform helper: Instrument -> Page -> SVG
    const toSvg = (x_instr, y_instr) => {
      const px = (x_instr + 259) / 0.75 - 259;
      const py = 1395.72 - (y_instr + 288) / 0.75;
      return {
        x: px - x0_page,
        y: py - y0_page
      };
    };
    
    // -------------------------------------------------------------
    // 1. Generate region-XX-source.png
    // -------------------------------------------------------------
    const px0_4 = Math.round(x0_page * SCALE);
    const py0_4 = Math.round(y0_page * SCALE);
    const pw_4 = Math.round(w * SCALE);
    const ph_4 = Math.round(h * SCALE);
    
    const canvasSource = createCanvas(pw_4, ph_4);
    const ctxSource = canvasSource.getContext('2d');
    const imgDataSource = ctxSource.createImageData(pw_4, ph_4);
    const dstBufSource = imgDataSource.data;
    
    for (let y = 0; y < ph_4; y++) {
      const srcRow = (py0_4 + y) * srcW4;
      const dstRow = y * pw_4;
      for (let x = 0; x < pw_4; x++) {
        const si = (srcRow + px0_4 + x) * 4;
        const di = (dstRow + x) * 4;
        dstBufSource[di] = srcBuf4[si] ?? 255;
        dstBufSource[di + 1] = srcBuf4[si + 1] ?? 255;
        dstBufSource[di + 2] = srcBuf4[si + 2] ?? 255;
        dstBufSource[di + 3] = srcBuf4[si + 3] ?? 255;
      }
    }
    ctxSource.putImageData(imgDataSource, 0, 0);
    writeFileSync(join(OUTPUT_DIR, `region-${regionIndexStr}-source.png`), canvasSource.toBuffer('image/png'));
    
    // -------------------------------------------------------------
    // 2. Generate region-XX-locator.png
    // -------------------------------------------------------------
    // Restore base image on the shared locator canvas
    ctxLocator.putImageData(imgDataLocator, 0, 0);
    
    // Highlight region bounds on the locator canvas
    ctxLocator.strokeStyle = 'rgba(239, 68, 68, 0.8)';
    ctxLocator.lineWidth = 1.5;
    ctxLocator.strokeRect(x0_page, y0_page, w, h);
    ctxLocator.fillStyle = 'rgba(239, 68, 68, 0.15)';
    ctxLocator.fillRect(x0_page, y0_page, w, h);
    
    writeFileSync(join(OUTPUT_DIR, `region-${regionIndexStr}-locator.png`), canvasLocator.toBuffer('image/png'));

    // -------------------------------------------------------------
    // Helper to format colors
    // -------------------------------------------------------------
    const formatColor = (col) => {
      if (!col) return '#000000';
      const r = Math.round(col[0] * 255);
      const g = Math.round(col[1] * 255);
      const b = Math.round(col[2] * 255);
      return `rgb(${r},${g},${b})`;
    };
    
    // -------------------------------------------------------------
    // 3. Generate region-XX-source-operations.svg
    // -------------------------------------------------------------
    let sourceOpsSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n`;
    for (const v of vectors) {
      if (!v.bounds) continue;
      // Transform vector bounds to page space
      const vx0_page = (v.bounds[0] + 259) / 0.75 - 259;
      const vx1_page = (v.bounds[2] + 259) / 0.75 - 259;
      const vy0_page = 1395.72 - (v.bounds[3] + 288) / 0.75;
      const vy1_page = 1395.72 - (v.bounds[1] + 288) / 0.75;
      
      // Check overlap
      const overlap = !(vx1_page < x0_page || vx0_page > x1_page || vy1_page < y0_page || vy0_page > y1_page);
      if (!overlap) continue;
      
      // Build path data
      let d = '';
      
      for (const cmd of v.commands) {
        if (cmd.op === 'M') {
          const pt = toSvg(cmd.x, cmd.y);
          d += `M ${pt.x.toFixed(2)} ${pt.y.toFixed(2)} `;
        } else if (cmd.op === 'L') {
          const pt = toSvg(cmd.x, cmd.y);
          d += `L ${pt.x.toFixed(2)} ${pt.y.toFixed(2)} `;
        } else if (cmd.op === 'C') {
          const pt1 = toSvg(cmd.p1.x, cmd.p1.y);
          const pt2 = toSvg(cmd.p2.x, cmd.p2.y);
          const pt3 = toSvg(cmd.p3.x, cmd.p3.y);
          d += `C ${pt1.x.toFixed(2)} ${pt1.y.toFixed(2)}, ${pt2.x.toFixed(2)} ${pt2.y.toFixed(2)}, ${pt3.x.toFixed(2)} ${pt3.y.toFixed(2)} `;
        } else if (cmd.op === 'Z') {
          d += 'Z ';
        }
      }
      
      if (!d) continue;
      
      const stroke = v.operation === 'stroke-path' ? (v.color ? formatColor(v.color) : '#000000') : 'none';
      const fill = v.operation === 'fill-path' ? (v.color ? formatColor(v.color) : '#000000') : 'none';
      const strokeWidth = v.strokeWidth ? (v.strokeWidth / 0.75).toFixed(2) : '1.00';
      const opacity = v.alpha !== undefined ? v.alpha : 1.0;
      
      sourceOpsSvg += `  <path d="${d.trim()}" stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}" opacity="${opacity}" />\n`;
    }
    sourceOpsSvg += '</svg>';
    writeFileSync(join(OUTPUT_DIR, `region-${regionIndexStr}-source-operations.svg`), sourceOpsSvg);

    // -------------------------------------------------------------
    // 4. Generate region-XX-host-wall.svg
    // -------------------------------------------------------------
    const wallA_instr = { x: wall.a.x - 259, y: wall.a.y - 288 };
    const wallB_instr = { x: wall.b.x - 259, y: wall.b.y - 288 };
    const wallA_svg = toSvg(wallA_instr.x, wallA_instr.y);
    const wallB_svg = toSvg(wallB_instr.x, wallB_instr.y);
    const thickness_svg = wall.thickness / 0.75;
    
    let hostWallSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n`;
    hostWallSvg += `  <line x1="${wallA_svg.x.toFixed(2)}" y1="${wallA_svg.y.toFixed(2)}" x2="${wallB_svg.x.toFixed(2)}" y2="${wallB_svg.y.toFixed(2)}" stroke="#cbd5e1" stroke-width="${thickness_svg.toFixed(2)}" opacity="0.4" stroke-linecap="butt" />\n`;
    hostWallSvg += `  <line x1="${wallA_svg.x.toFixed(2)}" y1="${wallA_svg.y.toFixed(2)}" x2="${wallB_svg.x.toFixed(2)}" y2="${wallB_svg.y.toFixed(2)}" stroke="#64748b" stroke-width="1.5" stroke-dasharray="4 3" />\n`;
    hostWallSvg += '</svg>';
    writeFileSync(join(OUTPUT_DIR, `region-${regionIndexStr}-host-wall.svg`), hostWallSvg);

    // -------------------------------------------------------------
    // 5. Generate region-XX-raw-interval.svg
    // -------------------------------------------------------------
    const uStart = region.rawIntervalUnion.start;
    const uEnd = region.rawIntervalUnion.end;
    
    const pStart_union_A = { x: ax + uStart * ux, y: ay + uStart * uy };
    const pEnd_union_A = { x: ax + uEnd * ux, y: ay + uEnd * uy };
    
    const pStart_union_instr = { x: pStart_union_A.x - 259, y: pStart_union_A.y - 288 };
    const pEnd_union_instr = { x: pEnd_union_A.x - 259, y: pEnd_union_A.y - 288 };
    
    const pStart_union_svg = toSvg(pStart_union_instr.x, pStart_union_instr.y);
    const pEnd_union_svg = toSvg(pEnd_union_instr.x, pEnd_union_instr.y);
    
    let rawIntervalSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n`;
    rawIntervalSvg += `  <line x1="${pStart_union_svg.x.toFixed(2)}" y1="${pStart_union_svg.y.toFixed(2)}" x2="${pEnd_union_svg.x.toFixed(2)}" y2="${pEnd_union_svg.y.toFixed(2)}" stroke="#3b82f6" stroke-width="4.5" opacity="0.6" stroke-linecap="round" />\n`;
    
    if (region.rawIntervalIntersection) {
      const uiStart = region.rawIntervalIntersection.start;
      const uiEnd = region.rawIntervalIntersection.end;
      const pStart_int_A = { x: ax + uiStart * ux, y: ay + uiStart * uy };
      const pEnd_int_A = { x: ax + uiEnd * ux, y: ay + uiEnd * uy };
      
      const pStart_int_instr = { x: pStart_int_A.x - 259, y: pStart_int_A.y - 288 };
      const pEnd_int_instr = { x: pEnd_int_A.x - 259, y: pEnd_int_A.y - 288 };
      
      const pStart_int_svg = toSvg(pStart_int_instr.x, pStart_int_instr.y);
      const pEnd_int_svg = toSvg(pEnd_int_instr.x, pEnd_int_instr.y);
      
      rawIntervalSvg += `  <line x1="${pStart_int_svg.x.toFixed(2)}" y1="${pStart_int_svg.y.toFixed(2)}" x2="${pEnd_int_svg.x.toFixed(2)}" y2="${pEnd_int_svg.y.toFixed(2)}" stroke="#1d4ed8" stroke-width="6" opacity="0.8" stroke-linecap="round" />\n`;
    }
    rawIntervalSvg += '</svg>';
    writeFileSync(join(OUTPUT_DIR, `region-${regionIndexStr}-raw-interval.svg`), rawIntervalSvg);

    // -------------------------------------------------------------
    // 6. Generate region-XX-candidates.svg
    // -------------------------------------------------------------
    let candidatesSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n`;
    const candIds = region.constituentCandidateIds || [];
    for (let cIdx = 0; cIdx < candIds.length; cIdx++) {
      const cId = candIds[cIdx];
      const cand = candidatesMap.get(cId);
      if (!cand || !cand.finiteWallInterval) continue;
      
      const cStart = cand.finiteWallInterval.start;
      const cEnd = cand.finiteWallInterval.end;
      
      const pStart_c_A = { x: ax + cStart * ux, y: ay + cStart * uy };
      const pEnd_c_A = { x: ax + cEnd * ux, y: ay + cEnd * uy };
      
      const pStart_c_instr = { x: pStart_c_A.x - 259, y: pStart_c_A.y - 288 };
      const pEnd_c_instr = { x: pEnd_c_A.x - 259, y: pEnd_c_A.y - 288 };
      
      const pStart_c_svg = toSvg(pStart_c_instr.x, pStart_c_instr.y);
      const pEnd_c_svg = toSvg(pEnd_c_instr.x, pEnd_c_instr.y);
      
      const candColors = [
        '#f97316', '#10b981', '#ec4899', '#8b5cf6', '#3b82f6',
        '#ef4444', '#14b8a6', '#f59e0b', '#a855f7', '#6366f1'
      ];
      const color = candColors[cIdx % candColors.length];
      
      candidatesSvg += `  <line x1="${pStart_c_svg.x.toFixed(2)}" y1="${pStart_c_svg.y.toFixed(2)}" x2="${pEnd_c_svg.x.toFixed(2)}" y2="${pEnd_c_svg.y.toFixed(2)}" stroke="${color}" stroke-width="3" opacity="0.8" stroke-linecap="round" />\n`;
    }
    candidatesSvg += '</svg>';
    writeFileSync(join(OUTPUT_DIR, `region-${regionIndexStr}-candidates.svg`), candidatesSvg);

    // -------------------------------------------------------------
    // 7. Generate region-XX-opening-region.svg
    // -------------------------------------------------------------
    let openingRegionSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n`;
    openingRegionSvg += `  <line x1="${pStart_union_svg.x.toFixed(2)}" y1="${pStart_union_svg.y.toFixed(2)}" x2="${pEnd_union_svg.x.toFixed(2)}" y2="${pEnd_union_svg.y.toFixed(2)}" stroke="#10b981" stroke-width="7" opacity="0.5" stroke-linecap="round" />\n`;
    openingRegionSvg += '</svg>';
    writeFileSync(join(OUTPUT_DIR, `region-${regionIndexStr}-opening-region.svg`), openingRegionSvg);
  }
  
  console.log('Visual asset generation complete! All files written to:', OUTPUT_DIR);
}

main().catch(err => {
  console.error('Asset generation failed:', err);
  process.exit(1);
});

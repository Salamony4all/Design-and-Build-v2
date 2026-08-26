import * as mupdf from 'mupdf';
import * as fs from 'fs';
import * as path from 'path';

const pdfPath = 'c:/Users/Salam/App/Design-And-Build-Stable-5d93e63/test drawings and png/CODE_06 1 page.pdf';
const data = new Uint8Array(fs.readFileSync(pdfPath));
const doc = mupdf.Document.openDocument(data, 'application/pdf');
import { extractPureWallResult } from '../src/index';

// Extract all vector drawing paths on page
const pageDoc = doc.loadPage(0);
const bounds = pageDoc.getBounds();
console.log('Bounds:', bounds);

// Walk structured text
console.log('\n--- Text Elements ---');
const st = pageDoc.toStructuredText();
let tCount = 0;
st.walk({
  onLine(l) {
    const t = l.text().trim();
    if (t.length > 0) {
      console.log(`text="${t}" bbox=[${l.bbox.map((n: number) => n.toFixed(1)).join(', ')}]`);
      tCount++;
    }
  }
});
console.log('Total text elements:', tCount);

// Look at stair region in vector drawing
// Central region: x around (306 + 1768)/2 = 1037, y around (376 + 1170)/2 = 773
const r = extractPureWallResult(data, 0);
console.log('\n--- Walls in Central Staircase Core ---');
for (const w of r.accepted) {
  const cx = (w.centerline.a.x + w.centerline.b.x) / 2;
  const cy = (w.centerline.a.y + w.centerline.b.y) / 2;
  if (cx >= 800 && cx <= 1300 && cy >= 600 && cy <= 1000) {
    console.log(`Wall pt: a=(${w.centerline.a.x.toFixed(1)}, ${w.centerline.a.y.toFixed(1)}) b=(${w.centerline.b.x.toFixed(1)}, ${w.centerline.b.y.toFixed(1)}) len=${w.length.toFixed(1)} thick=${w.thickness.toFixed(1)}`);
  }
}



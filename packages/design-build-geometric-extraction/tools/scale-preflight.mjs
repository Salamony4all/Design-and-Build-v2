// Print all text elements
import { readFileSync } from 'fs';
import * as mupdf from 'mupdf';

const pdfPath = 'c:/Users/Mohamad60025/Desktop/App/Design And Build/apps/design-build-editor/public/CODE_06.pdf';
const buf = readFileSync(pdfPath);
const doc = mupdf.Document.openDocument(new Uint8Array(buf), 'application/pdf');
const page = doc.loadPage(0);
const st = page.toStructuredText();
const stJson = JSON.parse(st.asJSON());

const texts = [];
function walk(n) {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) { n.forEach(walk); return; }
  if (typeof n.text === 'string') {
    texts.push({ text: n.text, bbox: n.bbox });
  }
  for (const k of Object.keys(n)) walk(n[k]);
}
walk(stJson);

console.log('=== ALL TEXTS ===');
console.log(texts);

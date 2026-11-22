// One-off TOOL: dumps every captured vector whose bounds touch any answer-key door
// neighbourhood. Skipped unless DUMP_DOORS=1.
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { collectPageVectors } from '../../src/index';

const ROOT = process.cwd();
const PDF = join(ROOT, '..', '..', 'test drawings and png', 'CODE_06 1 page.pdf');
const OUT = join(ROOT, 'tests', 'fixtures', 'code06-doors');

it.skipIf(process.env.DUMP_DOORS !== '1')('dump door vectors', async () => {
  const mupdf = await import('mupdf');
  const bytes = new Uint8Array(readFileSync(PDF));
  const doc = mupdf.Document.openDocument(bytes as any, 'application/pdf');
  const page = (doc as any).loadPage(0);
  const cap = collectPageVectors(page, false, 0);
  const key = JSON.parse(readFileSync(join(OUT, 'door-answer-key.json'), 'utf8'));
  const R = 75;
  const boxes = key.doors.map((d: any) => {
    const cx = (d.jambA[0] + d.jambB[0]) / 2, cy = (d.jambA[1] + d.jambB[1]) / 2;
    return [cx - R, cy - R, cx + R, cy + R];
  });
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const out: any[] = [];
  for (const v of cap.vectors as any[]) {
    const b = v.bounds;
    const bb = Array.isArray(b) ? b : [b.x0 ?? b.minX, b.y0 ?? b.minY, b.x1 ?? b.maxX, b.y1 ?? b.maxY];
    const hit = boxes.some((x: number[]) => bb[0] <= x[2] && bb[2] >= x[0] && bb[1] <= x[3] && bb[3] >= x[1]);
    if (!hit) continue;
    if (bb[2] - bb[0] > 400 || bb[3] - bb[1] > 400) continue;
    out.push({
      id: v.id, root: v.sourceRootId, op: v.operation, color: v.color, w: v.strokeWidth, dashes: v.dashes,
      cmds: (v.commands ?? []).map((c: any) => c.op).join(''),
      subpaths: (v.subpaths && v.subpaths.length ? v.subpaths : [v.points]).map((s: any[]) => s.map((p) => [r1(p.x), r1(p.y)])),
    });
  }
  writeFileSync(join(OUT, '_vectors-near-doors.json'), JSON.stringify(out));
  console.log('vectors dumped:', out.length, 'of', cap.vectors.length);
}, 600000);

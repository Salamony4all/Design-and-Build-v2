// TOOL (not a regression test): the training data for the layer-free furniture model.
//
// Every drawing that keeps its CAD layers labels itself. Its linework is read with the
// layers hidden, exactly as a layer-free drawing is read (detectFurniture, mode 'broad'),
// and each piece traced is labelled with the family of the layer most of its ink is drawn
// on (furniture, plant, sanitary, equipment, joinery) or 'none'. The layered reading of the
// same page is the answer key. Drawings without layers are read too, with no label, so
// the trained model can be checked on them by eye.
//
// A drawing only labels itself when its linework sits on named layers: one that keeps
// everything on "0" or "Layer 1" says nothing about what is furniture and stays unlabelled.
//
// Skipped unless SYMBOL_DATASET=1. Run from packages/extraction-mupdf:
//   SYMBOL_DATASET=1 npx vitest run tests/tools/symbol-dataset.test.ts
// Optional: SYMBOL_PDFS="a.pdf,b.pdf" (more drawings), SYMBOL_ONLY="carlow,kapiti" (name filter),
//           SYMBOL_OUT (default ../../tmp/symbol-dataset.json), SYMBOL_APPEND=1 (keep the other
//           drawings already in the output: a long list can be read a few drawings per run,
//           which keeps memory low).
// Then: python3 tests/tools/train-symbol-model.py ../../tmp/symbol-dataset.json
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import {
  arcWalls,
  collectPageVectors,
  detectCurvedWalls,
  extractPureWallResult,
  furnitureTextsFromStructuredText,
  mupdf,
  PURE_DOOR_DEFAULTS,
  runDoorPipeline,
  type MuVector,
} from '../../src/index';
import { detectFurniture, furnitureFamily, isFurnitureLayer, type BroadPieceRow } from '../../src/furniture-blocks';
import { SYMBOL_CLASSES, SYMBOL_FEATURES } from '../../src/furniture-symbol-reader';

const ROOT = join(process.cwd(), '..', '..');
const OUT = process.env.SYMBOL_OUT ?? join(ROOT, 'tmp', 'symbol-dataset.json');
const ONLY = (process.env.SYMBOL_ONLY ?? '').split(',').filter(Boolean);
/** Layers that name nothing: a drawing kept on these does not label itself. */
const CATCH_ALL_LAYER_RE = /^(0|layer\s*\d*|defpoints)?$/i;
/** Share of a drawing's linework that must sit on named layers for it to label itself. */
const NAMED_SHARE = 0.8;
/** Pages looked at in a long document. */
const MAX_PAGES = 25;
/** Pieces the layered reading must find on a further page of a document for it to count as a furnished plan. */
const MIN_KEY_PIECES = 5;

function drawings(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const full = join(dir, f);
      if (statSync(full).isDirectory()) walk(full);
      else if (f.toLowerCase().endsWith('.pdf')) files.push(full);
    }
  };
  walk(join(ROOT, 'test drawings and png'));
  for (const extra of [join(ROOT, 'tmp', 'fbo-lounge.pdf'), ...(process.env.SYMBOL_PDFS ?? '').split(',').filter(Boolean)]) {
    if (existsSync(extra)) files.push(extra);
  }
  return [...new Set(files)].filter((f) => !ONLY.length || ONLY.some((k) => basename(f).toLowerCase().includes(k.toLowerCase())));
}

type Any = Record<string, any>;

/** The pages of a document worth reading: the plan page the extraction route picks, and every other page drawn on furniture layers (kept only if it turns out to be a furnished plan). */
function planPages(bytes: Uint8Array): number[] {
  const doc = mupdf.Document.openDocument(bytes as never, 'application/pdf') as Any;
  const count: number = typeof doc.countPages === 'function' ? doc.countPages() : 1;
  if (count <= 1) { doc.destroy?.(); return [0]; }
  const scored: { idx: number; score: number; furniture: boolean }[] = [];
  for (let i = 0; i < Math.min(count, MAX_PAGES); i++) {
    try {
      const p = doc.loadPage(i);
      const c = collectPageVectors(p, false, i);
      const st = p.toStructuredText('preserve-whitespace');
      const txt = String(st.asText?.() ?? '');
      st.destroy?.();
      const boost = /\b(floor\s*plan|proposed\s*ground|ground\s*floor|first\s*floor|layout\s*plan|ga\s*plan|kitchen|wardrobe|banquette|booth)\b/i.test(txt)
        ? 2.5
        : /\b(cover|title\s*sheet|table\s*of\s*contents|general\s*notes|schedule)\b/i.test(txt) ? 0.4 : 1.0;
      const onFurniture = c.vectors.filter((v: MuVector) => v.layer && isFurnitureLayer(v.layer)).length;
      scored.push({ idx: i, score: c.vectors.length * boost, furniture: onFurniture >= 20 });
      p.destroy?.();
    } catch { scored.push({ idx: i, score: 0, furniture: false }); }
  }
  doc.destroy?.();
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  let best: { idx: number; walls: number; score: number } | null = null;
  for (const cand of ranked.slice(0, 6)) {
    try {
      const n = extractPureWallResult(bytes, cand.idx, undefined, undefined, true)?.pureResult?.accepted?.length ?? 0;
      if (n > 0 && (!best || n > best.walls || (n === best.walls && cand.score > best.score))) best = { idx: cand.idx, walls: n, score: cand.score };
    } catch { /* not a plan page */ }
  }
  const picked = best ? best.idx : (ranked[0]?.idx ?? 0);
  return [picked, ...scored.filter((s) => s.furniture && s.idx !== picked).map((s) => s.idx)];
}

/** What the extraction route hands to furniture detection for one page. */
function pageInput(bytes: Uint8Array, pageIndex: number) {
  const doc = mupdf.Document.openDocument(bytes as never, 'application/pdf') as Any;
  const page = doc.loadPage(pageIndex);
  const cap = collectPageVectors(page, false, pageIndex);
  const pure = extractPureWallResult(bytes, pageIndex, undefined, undefined, true).pureResult as Any;
  const mPerPt = pure.scaleMmPerPt / 1000;
  const accepted: Any[] = (pure.accepted ?? []).filter((w: Any) => w?.centerline?.a && w?.centerline?.b);
  let within: [number, number, number, number] | undefined;
  if (accepted.length >= 4) {
    const xs = accepted.flatMap((w) => [w.centerline.a.x, w.centerline.b.x]);
    const ys = accepted.flatMap((w) => [w.centerline.a.y, w.centerline.b.y]);
    const m = 1 / mPerPt;
    within = [Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m];
  }
  let texts: ReturnType<typeof furnitureTextsFromStructuredText> = [];
  try {
    const st = page.toStructuredText('preserve-whitespace');
    texts = furnitureTextsFromStructuredText(st.asJSON());
    st.destroy?.();
  } catch { texts = []; }
  const walls = accepted.map((w) => ({ a: w.centerline.a, b: w.centerline.b, t: w.thickness }));
  const claimed = new Set<string>();
  const claim = (id: unknown) => { if (typeof id === 'string' && id) claimed.add(id.split(':')[0]); };
  for (const w of accepted) for (const k of ['sourceRootIds', 'sourceSubpathIds', 'sourceStrokeIds']) for (const id of w?.[k] ?? []) claim(id);
  let curved: Any = { segments: [], podDoors: [] };
  if (pure.scaleSource !== 'fallback') {
    let cw: [number, number, number, number] | undefined;
    if (within) { const m = 2 / mPerPt; cw = [within[0] - m, within[1] - m, within[2] + m, within[3] + m]; }
    try { curved = detectCurvedWalls({ vectors: cap.vectors, scaleMmPerPt: pure.scaleMmPerPt, within: cw }); } catch { /* no curved walls */ }
  }
  for (const s of curved.segments ?? []) for (const id of s?.sourceOperationIds ?? []) claim(id);
  const facingWalls = [...arcWalls(curved.segments ?? []), ...(curved.podDoors ?? []).map((d: Any) => ({ a: d.start, b: d.end, t: d.thicknessM / mPerPt }))];
  try {
    const dr = runDoorPipeline({ vectors: cap.vectors, wallResult: pure, pageBoundsMupdf: page.getBounds(), annotations: [], annotationIndex: undefined, annotationCaptureMs: 0 } as never, PURE_DOOR_DEFAULTS, false) as Any;
    for (const a of dr.assemblies ?? []) for (const id of a.sourceOperationIds ?? []) claim(id);
  } catch { /* no doors */ }
  const vectors: MuVector[] = cap.vectors;
  page.destroy?.();
  doc.destroy?.();
  return { vectors, scaleMmPerPt: pure.scaleMmPerPt as number, scaleSource: String(pure.scaleSource), within, texts, walls: [...walls, ...facingWalls], wallCount: walls.length, claimed };
}

const rows: Any[] = [];
const docsRead = new Set<string>();

describe.skipIf(process.env.SYMBOL_DATASET !== '1')('symbol dataset', () => {
  it('has drawings to read', () => {
    expect(drawings().length).toBeGreaterThan(0);
  });

  for (const file of drawings()) {
    it(basename(file), () => {
      const bytes = new Uint8Array(readFileSync(file));
      const doc = basename(file).replace(/\.pdf$/i, '').replace(/\s+/g, '_');
      docsRead.add(doc);
      const pages = planPages(bytes);
      pages.forEach((pageIndex, nth) => {
        const name = nth === 0 ? doc : `${doc}@p${pageIndex + 1}`;
        const inp = pageInput(bytes, pageIndex);
        if (inp.scaleSource === 'fallback' || inp.wallCount < 4) { console.log(name.padEnd(40), 'skipped (no scale or walls)'); return; }
        const mPerPt = inp.scaleMmPerPt / 1000;
        const roots = inp.vectors.filter((v) => !v.sourceRootId);
        const layerOf = new Map<string, string>();
        for (const v of roots) if (v.layer) layerOf.set(v.id, v.layer);
        const named = roots.filter((v) => v.layer && !CATCH_ALL_LAYER_RE.test(v.layer.trim())).length;
        const layered = named >= NAMED_SHARE * roots.length;
        if (nth > 0 && !layered) return;
        const input = { vectors: inp.vectors, scaleMmPerPt: inp.scaleMmPerPt, within: inp.within, texts: inp.texts, walls: inp.walls };
        const key = layered ? detectFurniture({ ...input, mode: 'layered' }).pieces : [];
        // A further page only teaches when it is a furnished plan itself: elevations and
        // details drawn on the same layers would label real furniture linework 'none'.
        if (nth > 0 && key.length < MIN_KEY_PIECES) return;
        let got: BroadPieceRow[] = [];
        const stripped = inp.vectors.map((v) => (v.layer ? { ...v, layer: undefined } : v));
        const read = detectFurniture(
          { ...input, vectors: stripped, claimedVectorIds: inp.claimed, mode: 'broad' },
          undefined,
          { broadPieces: (b) => { got = b; } },
        );
        const labels: Record<string, number> = {};
        const found = new Set<string>();
        got.forEach((row, i) => {
          let label: string | null = null, furnShare = 0;
          if (layered) {
            const ink = new Map<string, number>();
            let total = 0;
            row.vectorIds.forEach((id, k) => {
              const layer = layerOf.get(id) ?? '';
              const l = row.vectorInk[k];
              ink.set(layer, (ink.get(layer) ?? 0) + l);
              total += l;
              if (isFurnitureLayer(layer)) furnShare += l;
            });
            furnShare /= Math.max(1e-9, total);
            const top = [...ink].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
            const fam = isFurnitureLayer(top) ? furnitureFamily(top) : 'none';
            label = fam === 'fixture' ? 'none' : fam;
            labels[label] = (labels[label] ?? 0) + 1;
          }
          const match = key.find((g) => Math.hypot(g.center.x - row.center.x, g.center.y - row.center.y) * mPerPt <= 0.25 && Math.abs(g.widthM - row.widthM) <= Math.max(0.15, 0.2 * g.widthM));
          if (match) found.add(match.id);
          const v = row.verdict;
          const kinds: Record<string, string | null> = {};
          for (const [fam, k] of Object.entries(row.kindByFamily)) kinds[fam] = k ? k.kind : null;
          rows.push({
            doc, drawing: name, i, label, furnShare: Math.round(furnShare * 100) / 100, x: v.x, rule: v.rejected, copy: v.copy, repeats: v.repeats, plain: v.plain,
            kinds, grammar: row.grammar, named: row.named, thin: row.thin, keyId: match?.id ?? null, keyKind: match?.kind ?? null,
            pen: row.pen, mPerPt, center: row.center, w: row.widthM, d: row.depthM, shape: row.shape,
            outline: row.outline.filter((_, k) => k % Math.ceil(row.outline.length / 24) === 0), text: v.insideText ?? row.label ?? null,
          });
        });
        const b = read.diagnostics.broad;
        console.log(
          name.padEnd(40), layered ? `key ${String(found.size).padStart(3)}/${String(key.length).padStart(3)}` : 'no layers  ',
          '| candidates', String(got.length).padStart(5), '| kept', String(read.pieces.length).padStart(4), `(${b?.known ?? 0}+${b?.custom ?? 0})`,
          layered ? JSON.stringify(labels) : '',
        );
      });
    }, 600_000);
  }

  afterAll(() => {
    if (!docsRead.size) return;
    let all = rows;
    if (process.env.SYMBOL_APPEND === '1' && existsSync(OUT)) {
      const before = JSON.parse(readFileSync(OUT, 'utf8')) as { features: string[]; rows: Any[] };
      if (JSON.stringify(before.features) === JSON.stringify(SYMBOL_FEATURES)) all = [...before.rows.filter((r) => !docsRead.has(r.doc)), ...rows];
    }
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ features: SYMBOL_FEATURES, classes: SYMBOL_CLASSES, rows: all }));
    console.log('wrote', OUT, all.length, 'pieces,', rows.length, 'of them read now');
  });
});

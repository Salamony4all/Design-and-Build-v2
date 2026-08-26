// tools/migration/capture-golden-multipass.mjs
// CS3 §7 golden capture — runs the REAL legacy Gemini Multipass pipeline
// (apps/editor/src/lib/orchestration/gemini-pipeline.ts, imported READ-ONLY)
// with the exact ChatBox.runBimPipeline pass sequencing, against real inputs.
//
// SANITIZATION: API key is read from apps/editor/.env and NEVER written to any
// output. Fixtures store hashes, metadata, prompts (public), parsed results.
//
// Usage: node tools/migration/capture-golden-multipass.mjs <pdf|png|jpeg> <inputPath> <outName>

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as mupdf from 'mupdf';

const [, , kind, inputPath, outName] = process.argv;
if (!kind || !inputPath || !outName) {
  console.error('usage: node capture-golden-multipass.mjs <pdf|png|jpeg> <input> <outName>');
  process.exit(1);
}

// ── Load legacy pipeline (read-only import; tools/migration is an allowed ref) ──
const legacy = await import(
  new URL('../../apps/editor/src/lib/orchestration/gemini-pipeline.ts', import.meta.url).href
);
const { getShellPrompt, getCorePrompt, getFitoutPrompt, getFFEPrompt, executePass } = legacy;

// ── Resolve API key (name only in fixtures) ──
function loadEnvKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  for (const p of ['apps/editor/.env', '.env']) {
    try {
      const txt = fs.readFileSync(p, 'utf8');
      const m = txt.match(/^GEMINI_API_KEY=(.*)$/m);
      if (m && m[1].trim()) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch {}
  }
  return null;
}
const apiKey = loadEnvKey();
if (!apiKey) {
  console.error('BLOCKED: GEMINI_API_KEY not found (env or apps/editor/.env). Cannot run real legacy golden.');
  process.exit(2);
}

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ── Prepare input image exactly as legacy would ──
// Legacy ChatBox multipass consumes IMAGES. PDFs are rendered page-1 → PNG
// (pdf-to-image.ts uses pdfjs scale 2.0; harness uses MuPDF at the same 2.0
// scale — documented adapter difference; the CAPTURED PNG becomes the canonical
// golden input for both old and new pipelines, so parity compares identical bytes).
const rawInput = fs.readFileSync(inputPath);
let imageBuf, mimeType, pagePrep = null;
if (kind === 'pdf') {
  const doc = mupdf.Document.openDocument(rawInput, 'application/pdf');
  const page = doc.loadPage(0);
  const pix = page.toPixmap(mupdf.Matrix.scale(2.0, 2.0), mupdf.ColorSpace.DeviceRGB, false, true);
  imageBuf = Buffer.from(pix.asPNG());
  mimeType = 'image/png';
  pagePrep = {
    method: 'mupdf toPixmap scale 2.0 (legacy: pdfjs getViewport scale 2.0 → canvas PNG)',
    page: 1,
    widthPx: pix.getWidth(),
    heightPx: pix.getHeight(),
    note: 'EXPECTED_ADAPTER_CHANGE: renderer differs (pdfjs vs mupdf); captured PNG is the canonical golden input reused byte-identically by clean-pipeline parity.',
  };
} else if (kind === 'png') {
  imageBuf = rawInput; mimeType = 'image/png';
} else {
  imageBuf = rawInput; mimeType = 'image/jpeg';
}
const base64 = imageBuf.toString('base64');

// ── Model: resolved from ACTIVE DYNAMIC CONFIGURATION (§6), never a silent default ──
// Selection source mirrors the legacy UI path: ModelSelector → /api/models discovery
// → user picks model → /api/extract GOOGLE_MODEL_MAP ('gemini-2.5-series' → 'gemini-2.5-flash').
const MODEL = process.env.AI_GOLDEN_MODEL_ID || process.env.GOLDEN_MODEL;
const PROVIDER_ID = process.env.AI_GOLDEN_PROVIDER_ID || 'google';
if (!MODEL) {
  console.error('AI_MODEL_NOT_CONFIGURED: set AI_GOLDEN_MODEL_ID (explicit model from the active provider selection). No hard-coded fallback.');
  process.exit(4);
}

// ── Execute the EXACT runBimPipeline sequence ──
const passes = [];
const t0 = Date.now();
async function runPass(passId, prompt, tolerated) {
  const started = Date.now();
  const rec = { passId, order: passes.length + 1, model: MODEL, promptSha256: sha256(prompt),
    promptLength: prompt.length, tolerated, status: 'running' };
  passes.push(rec);
  try {
    const parsed = await executePass(base64, mimeType, apiKey, prompt, MODEL);
    rec.status = 'completed';
    rec.durationMs = Date.now() - started;
    rec.parsed = parsed;
    rec.parsedSha256 = sha256(JSON.stringify(parsed));
    return parsed;
  } catch (e) {
    rec.status = 'failed';
    rec.durationMs = Date.now() - started;
    rec.error = String(e && e.message || e).slice(0, 500);
    if (!tolerated) throw e;
    return null;
  }
}

let cumulativeWalls = [];
// Phase 1+2: shell (tolerated) ‖ core (required)
const [shellRes, coreRes] = await Promise.all([
  runPass('shell', getShellPrompt(), true),
  runPass('core', getCorePrompt(), false),
]);
if (coreRes && coreRes.walls) cumulativeWalls = [...coreRes.walls];
// Phase 3+4: fitout ‖ ffe with wallsContext (both tolerated — allSettled)
const [fitoutRes, ffeRes] = await Promise.all([
  runPass('fitout', getFitoutPrompt(cumulativeWalls), true),
  runPass('ffe', getFFEPrompt(cumulativeWalls), true),
]);

// ── Merge summary (counts per category, as the legacy scene bridge would see) ──
function counts(r) {
  if (!r) return null;
  return { walls: (r.walls||[]).length, openings: (r.openings||[]).length,
    furniture: (r.furniture||[]).length, floors: (r.floors||[]).length,
    ceilings: (r.ceilings||[]).length, zones: (r.zones||[]).length };
}

const fixture = {
  golden: outName,
  capturedAt: new Date().toISOString(),
  legacyPipeline: 'apps/editor/src/lib/orchestration/gemini-pipeline.ts',
  legacyPipelineSha256: sha256(fs.readFileSync('apps/editor/src/lib/orchestration/gemini-pipeline.ts')),
  provider: { id: PROVIDER_ID, type: 'google', transport: '@google/genai generateContent', credentialRef: 'GEMINI_API_KEY (env name only)',
    selection: { historicalLegacyDefault: 'gemini-2.0-flash', historicalDefaultStatus: 'unavailable (404 from live API)',
      selectedParityProvider: PROVIDER_ID, selectedParityModel: MODEL,
      providerSelectionSource: 'active dynamic configuration (models.list discovery -> explicit selection)',
      promptsChanged: false, passOrderChanged: false } },
  model: MODEL,
  modelParameters: { temperature: 'provider-default (legacy sets none)', maxTokens: 'provider-default (Google path)', responseFormat: 'raw text -> parseAIResponse' },
  input: {
    kind, sourceFile: path.basename(inputPath), sourceSha256: sha256(rawInput),
    imageMimeType: mimeType, imageSha256: sha256(imageBuf), imageBytes: imageBuf.length,
    pagePreparation: pagePrep,
  },
  attachmentOrdering: ['<primary image only — legacy runBimPipeline sends images[0] to every pass>'],
  passSequence: ['shell||core', 'fitout||ffe(wallsContext)'],
  wallsContextSize: cumulativeWalls.length,
  passes,
  totalDurationMs: Date.now() - t0,
  resultCounts: { shell: counts(shellRes), core: counts(coreRes), fitout: counts(fitoutRes), ffe: counts(ffeRes) },
  finalAiResult: { shell: shellRes, core: coreRes, fitout: fitoutRes, ffe: ffeRes },
};

const outDir = 'packages/extraction-ai/tests/fixtures';
fs.mkdirSync(outDir, { recursive: true });
// Persist golden input image alongside fixture for byte-identical replay
fs.writeFileSync(path.join(outDir, `${outName}-input.${mimeType === 'image/png' ? 'png' : 'jpg'}`), imageBuf);
const json = JSON.stringify(fixture, null, 2);
if (json.includes(apiKey)) { console.error('SANITIZATION FAILURE: key leaked'); process.exit(3); }
fs.writeFileSync(path.join(outDir, `${outName}.json`), json);
console.log(JSON.stringify({ ok: true, outName,
  passes: passes.map(p => ({ passId: p.passId, status: p.status, ms: p.durationMs, err: p.error || null })),
  counts: fixture.resultCounts, totalMs: fixture.totalDurationMs }, null, 1));

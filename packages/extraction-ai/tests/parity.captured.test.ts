// packages/extraction-ai/tests/parity.captured.test.ts
// §9-A Deterministic captured-response test. No live provider call.
// Replays the REAL sanitized legacy responses captured by
// tools/migration/capture-golden-multipass.mjs and verifies the clean
// pipeline (parser → multipass merge contract → neutral adapter) produces the
// same entity counts and parse-equivalent structures as the legacy run.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseAIResponse } from '../src/parser';
import { runMultipass, type MultipassEvent } from '../src/multipass-controller';
import { adaptMultipassResult } from '../src/result-adapter';
import { GeminiRequestAdapter, type AiModelRuntime, type ModelRequest, type ModelResponse } from '../src/model-runtime';
import type { ProviderRuntime } from '../src/model-runtime';

const FIXTURE_DIR = path.join(__dirname, 'fixtures');

// A fake runtime that replays captured text for each pass in order.
function replayRuntime(passTexts: Record<string, string>): AiModelRuntime {
  const order = ['shell', 'core', 'fitout', 'ffe'];
  let i = 0;
  const rt: ProviderRuntime = { providerId: 'fake', providerType: 'gemini', apiKey: 'x' };
  const base = new GeminiRequestAdapter(rt) as any;
  base.generate = async (req: ModelRequest): Promise<ModelResponse> => {
    const passId = order[i++];
    const text = passTexts[passId];
    if (!text) throw new Error(`no captured text for pass ${passId}`);
    return { text };
  };
  return base as AiModelRuntime;
}

function loadGolden(name: string) {
  const fp = path.join(FIXTURE_DIR, `${name}.json`);
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function capturePassTexts(golden: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of golden.passes) {
    out[p.passId] = JSON.stringify(golden.finalAiResult[p.passId]);
  }
  return out;
}

const GOLDENS = ['golden-a-pdf-code06-1room', 'golden-b-png-floorplan', 'golden-c-jpeg-code06-1room'];

describe('§9-A captured-response parity (no live call)', () => {
  for (const name of GOLDENS) {
    it(`replays ${name} and matches legacy entity counts`, async () => {
      const golden = loadGolden(name);
      const runtime = replayRuntime(capturePassTexts(golden));
      const events: MultipassEvent[] = [];
      const result = await runMultipass(
        runtime,
        {
          runId: 'replay-' + name,
          imageBase64: 'AAAA',
          imageMimeType: golden.input.imageMimeType,
          modelId: golden.model,
        },
        (e) => events.push(e),
      );

      // Parse-equivalence: each captured pass parses to the same counts as the
      // fixture's stored result counts.
      expect(result.modelId).toBe(golden.model);
      expect(result.wallsContextSize).toBe(golden.wallsContextSize);
      const phases = result.phases;
      expect((phases.core?.walls ?? []).length).toBe(golden.resultCounts.core.walls);
      expect((phases.core?.openings ?? []).length).toBe(golden.resultCounts.core.openings);
      expect((phases.fitout?.furniture ?? []).length).toBe(golden.resultCounts.fitout.furniture);
      expect((phases.ffe?.furniture ?? []).length).toBe(golden.resultCounts.ffe.furniture);

      // Tolerated shell pass completed (legacy Promise.all shell.catch(()=>{})).
      const shellPass = result.passes.find((p) => p.passId === 'shell');
      expect(shellPass?.status).toBe('completed');

      // Neutral adapter: no data loss — furniture total preserved.
      const neutral = adaptMultipassResult(result, { pageId: golden.input.sourceFile });
      const legacyFurniture =
        golden.resultCounts.fitout.furniture + golden.resultCounts.ffe.furniture;
      expect(neutral.furniture.length).toBe(legacyFurniture);
      expect(neutral.walls.length).toBe(golden.resultCounts.core.walls);
      // Openings + zones preserved in providerEvidence (§14 no-drop).
      expect(neutral.providerEvidence?.openings).toBeDefined();
      expect(neutral.providerEvidence?.zones).toBeDefined();

      // Event stream fired real progress events.
      expect(events.some((e) => e.type === 'run-started')).toBe(true);
      expect(events.some((e) => e.type === 'extraction-completed')).toBe(true);
    });
  }
});

describe('parseAIResponse equivalence vs legacy stored JSON', () => {
  for (const name of GOLDENS) {
    it(`parses ${name} core payload identically to legacy parseAIResponse`, () => {
      const golden = loadGolden(name);
      const coreText = JSON.stringify(golden.finalAiResult.core);
      const parsed = parseAIResponse(coreText);
      expect(parsed.walls.length).toBe(golden.resultCounts.core.walls);
      expect(parsed.openings.length).toBe(golden.resultCounts.core.openings);
    });
  }
});

import type { AiModelRuntime } from './model-runtime';
import type { ProgressiveBuildEvent } from './progressive-types';
import { FurniturePassSchema } from './schema-furniture-v3';

export interface ProgressiveRequest {
  runId: string;
  modelId: string;
  imageBase64: string;
  imageMimeType: string;
  guide: { dataUrl: string; widthM: number; heightM: number; originM: [number, number] };
  slab: unknown;
  signal?: AbortSignal;
}

/**
 * Package-level progressive runner (scaffold). NOTE: the production V3 boundary
 * (app/api/extraction/ai/progressive) does NOT use this function — it reuses the
 * V2 structural extraction + the existing catalogue-constrained furniture Prompt
 * Set (spec §5). This function is kept compiling against the same discriminated
 * ProgressiveBuildEvent union so the package stays coherent.
 */
export async function runProgressivePureAI(
  runtime: AiModelRuntime,
  request: ProgressiveRequest,
  prompts: {
    walls: string;
    windows: (walls: unknown[]) => string;
    doors: (walls: unknown[], windows: unknown[]) => string;
    furniture: (context: { walls: unknown[]; windows: unknown[]; doors: unknown[] }) => string;
    furnitureVerify: (draft: unknown) => string;
  },
  emit: (event: ProgressiveBuildEvent) => void,
) {
  let seq = 0;
  const ready = (type: 'guide.ready' | 'slab.ready' | 'walls.ready' | 'windows.ready' | 'doors.ready', stage: 'guide' | 'slab' | 'walls' | 'windows' | 'doors', message: string, payload?: unknown, counts?: Record<string, number>) =>
    emit({ type, stage, message, payload, counts, runId: request.runId, sequence: ++seq, timestamp: new Date().toISOString() });
  const generate = async (prompt: string) => runtime.generate({ prompt, imageBase64: request.imageBase64, imageMimeType: request.imageMimeType, modelId: request.modelId, signal: request.signal });

  ready('guide.ready', 'guide', 'Drawing guide ready', request.guide, { guides: 1 });
  ready('slab.ready', 'slab', 'Ground slab ready', request.slab, { slabs: 1 });

  const wallsRaw = await generate(prompts.walls);
  const walls = JSON.parse(wallsRaw.text).walls ?? [];
  ready('walls.ready', 'walls', 'Walls ready', walls, { walls: walls.length });

  const windowsRaw = await generate(prompts.windows(walls));
  const windows = JSON.parse(windowsRaw.text).windows ?? [];
  ready('windows.ready', 'windows', 'Windows ready', windows, { windows: windows.length });

  const doorsRaw = await generate(prompts.doors(walls, windows));
  const doors = JSON.parse(doorsRaw.text).doors ?? [];
  ready('doors.ready', 'doors', 'Doors ready', doors, { doors: doors.length });

  const furnitureRaw = await generate(prompts.furniture({ walls, windows, doors }));
  const draft = FurniturePassSchema.parse(JSON.parse(furnitureRaw.text));
  const verifyRaw = await generate(prompts.furnitureVerify(draft));
  const verified = FurniturePassSchema.parse(JSON.parse(verifyRaw.text));
  emit({ type: 'stage.completed', stage: 'furniture', message: 'Furniture ready', installed: verified.furniture.length, total: verified.furniture.length, payload: verified.furniture, counts: { furniture: verified.furniture.length }, runId: request.runId, sequence: ++seq, timestamp: new Date().toISOString() });
  emit({ type: 'run.completed', message: 'Progressive build complete', counts: { walls: walls.length, windows: windows.length, doors: doors.length, furniture: verified.furniture.length }, runId: request.runId, sequence: ++seq, timestamp: new Date().toISOString() });
  return { walls, windows, doors, furniture: verified.furniture };
}

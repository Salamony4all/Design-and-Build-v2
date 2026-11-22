// features/render/render-presets.ts
// Shared (client + server) definitions for geometry-locked photoreal renders:
// style presets, quality tiers, supported aspect ratios and the prompt builder.
// Pure module: no DOM, no Node APIs, so it is safe to import from the API route,
// the browser and unit tests.

export const RENDER_PROMPT_VERSION = 'geo-lock-v4';

export type RenderStyleId = 'daylight' | 'golden-hour' | 'overcast' | 'dusk' | 'clay';

export interface RenderStyle {
  id: RenderStyleId;
  label: string;
  icon: string;
  hint: string;
  /** Lighting and mood, written as photographic direction. */
  lighting: string;
  /** Overrides the default material palette when set. */
  materials?: string;
}

export const RENDER_STYLES: readonly RenderStyle[] = [
  {
    id: 'daylight',
    label: 'Daylight',
    icon: '☀️',
    hint: 'Bright and true to life',
    lighting:
      'Clear late-morning daylight from a high sun, soft-edged natural shadows, gentle sky fill light, neutral white balance.',
  },
  {
    id: 'golden-hour',
    label: 'Golden hour',
    icon: '🌅',
    hint: 'Warm, low sun',
    lighting:
      'Warm golden-hour sunlight from a low sun angle, long soft shadows across the floors, warm bounce light, inviting mood.',
  },
  {
    id: 'overcast',
    label: 'Soft overcast',
    icon: '☁️',
    hint: 'Even light, no harsh shadows',
    lighting:
      'Soft overcast sky light, even diffuse illumination, very soft contact shadows, calm neutral tones.',
  },
  {
    id: 'dusk',
    label: 'Dusk',
    icon: '🌙',
    hint: 'Warm interior glow',
    lighting:
      'Blue-hour dusk: deep blue ambient light outside, warm 3000K interior lighting glowing from the rooms, balanced exposure with no blown highlights.',
  },
  {
    id: 'clay',
    label: 'Clay model',
    icon: '⚪',
    hint: 'White presentation model',
    lighting: 'Soft studio light from above with gentle ambient occlusion in corners and along wall bases.',
    materials:
      'Render it as a pristine white architectural presentation model: matte white walls, light warm-grey floors, frosted clear acrylic in window openings, no colours and no textures.',
  },
];

export type RenderTierId = 'fast' | 'balanced' | 'pro';

export interface RenderTier {
  id: RenderTierId;
  label: string;
  /** Gemini model id used for this tier. */
  model: string;
  /** Human name of the model. */
  modelLabel: string;
  /** Gemini imageConfig.imageSize ('1K' | '2K'), when the model accepts it. */
  imageSize?: '1K' | '2K';
  /** Approximate list price per image in USD (Gemini API, standard tier). */
  approxUsd: number;
  /** Typical wall-clock seconds, used to pace the progress bar. */
  etaSec: number;
}

export const RENDER_TIERS: Readonly<Record<RenderTierId, RenderTier>> = {
  fast: {
    id: 'fast',
    label: 'Fast',
    model: 'gemini-3.1-flash-lite-image',
    modelLabel: 'Nano Banana 2 Lite',
    imageSize: '1K',
    approxUsd: 0.034,
    etaSec: 9,
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    model: 'gemini-3.1-flash-image',
    modelLabel: 'Nano Banana 2',
    imageSize: '1K',
    approxUsd: 0.067,
    etaSec: 22,
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    model: 'gemini-3-pro-image',
    modelLabel: 'Nano Banana Pro',
    imageSize: '2K',
    approxUsd: 0.134,
    etaSec: 40,
  },
};

/** Image models the render route may call (tier models plus known aliases). */
export const ALLOWED_RENDER_MODELS: ReadonlySet<string> = new Set([
  ...Object.values(RENDER_TIERS).map((t) => t.model),
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
  'gemini-nano-banana-2.1',
  'nano-banana-pro-preview',
]);

/** Models that accept generationConfig.imageConfig.imageSize. */
export function modelSupportsImageSize(model: string): boolean {
  return !model.startsWith('gemini-2.5');
}

export interface AspectChoice {
  label: string;
  ratio: number;
}

/** Aspect ratios accepted by every Gemini image model we use. */
export const SUPPORTED_ASPECTS: readonly AspectChoice[] = [
  { label: '1:1', ratio: 1 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '2:3', ratio: 2 / 3 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '5:4', ratio: 5 / 4 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '21:9', ratio: 21 / 9 },
];

export function isSupportedAspect(label: string): boolean {
  return SUPPORTED_ASPECTS.some((a) => a.label === label);
}

/** Closest supported aspect ratio, compared in log space (crop loss is symmetric). */
export function nearestAspect(width: number, height: number): AspectChoice {
  const r = width / Math.max(1, height);
  let best = SUPPORTED_ASPECTS[0];
  let bestD = Infinity;
  for (const a of SUPPORTED_ASPECTS) {
    const d = Math.abs(Math.log(r / a.ratio));
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

/** Centre crop of a width x height frame to the given ratio. */
export function centreCrop(width: number, height: number, ratio: number): { x: number; y: number; w: number; h: number } {
  if (width / height > ratio) {
    const w = Math.round(height * ratio);
    return { x: Math.round((width - w) / 2), y: 0, w, h: height };
  }
  const h = Math.round(width / ratio);
  return { x: 0, y: Math.round((height - h) / 2), w: width, h };
}

/** Rectangle in normalized frame coordinates (0..1, origin top-left). */
export interface NormRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Crop that frames `focus` (the building's on-screen box) with a margin, grown
 * to the nearest supported aspect ratio and kept inside the frame. Cropping never
 * changes the perspective — it only spends the model's pixels on the building.
 */
export function focusCrop(
  width: number,
  height: number,
  focus: NormRect,
  marginFrac = 0.06,
): { x: number; y: number; w: number; h: number; aspect: AspectChoice } {
  let x0 = Math.max(0, Math.min(1, focus.x0)) * width;
  let x1 = Math.max(0, Math.min(1, focus.x1)) * width;
  let y0 = Math.max(0, Math.min(1, focus.y0)) * height;
  let y1 = Math.max(0, Math.min(1, focus.y1)) * height;
  const m = Math.max(16, marginFrac * Math.max(x1 - x0, y1 - y0));
  x0 = Math.max(0, x0 - m);
  y0 = Math.max(0, y0 - m);
  x1 = Math.min(width, x1 + m);
  y1 = Math.min(height, y1 + m);
  let w = x1 - x0;
  let h = y1 - y0;
  if (w < 48 || h < 48) {
    const aspect = nearestAspect(width, height);
    return { ...centreCrop(width, height, aspect.ratio), aspect };
  }
  const aspect = nearestAspect(w, h);
  const r = aspect.ratio;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  if (w / h < r) {
    w = Math.min(width, h * r);
    h = w / r;
  } else {
    h = Math.min(height, w / r);
    w = h * r;
  }
  const x = Math.round(Math.min(Math.max(0, cx - w / 2), width - w));
  const y = Math.round(Math.min(Math.max(0, cy - h / 2), height - h));
  return { x, y, w: Math.round(w), h: Math.round(h), aspect };
}

/** 'cutaway' = roofless model seen from above; 'eye-level' = near-horizontal camera. */
export type ViewKind = 'cutaway' | 'eye-level';

export interface GeometryLockPromptOptions {
  style: RenderStyleId;
  viewKind: ViewKind;
  furnish: boolean;
  /** A second image (edge map of the same view) is attached. */
  withEdgeGuide: boolean;
  /** A floor-plan reference image is attached after the view (and edge map). */
  withPlan: boolean;
  /** Free text from the user; applied only where it does not touch geometry. */
  note?: string;
  /** Retry after the geometry check failed: tighten the instructions. */
  strict?: boolean;
}

const DEFAULT_MATERIALS =
  'Walls in smooth warm-white painted plaster; cut wall tops as clean flat light-grey sections; floors in light natural oak inside rooms; ' +
  'windows with clear glass, subtle reflections and slim dark-grey aluminium frames; doors in light wood with simple metal handles.';

export function getRenderStyle(id: string): RenderStyle {
  return RENDER_STYLES.find((s) => s.id === id) ?? RENDER_STYLES[0];
}

export function clampNote(note: string | undefined, max = 400): string {
  return (note ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Prompt for re-skinning an exact 3D model view without moving any geometry.
 * The model is told what is locked (camera, walls, openings), what may change
 * (materials, light) and how the optional reference images relate to the view.
 */
export function buildGeometryLockPrompt(o: GeometryLockPromptOptions): string {
  const style = getRenderStyle(o.style);
  const note = clampNote(o.note);
  const imageRefs = o.withEdgeGuide || o.withPlan;
  const lines: string[] = [];

  lines.push(
    `Turn ${imageRefs ? 'image 1' : 'this image'} — a view of a precise 3D architectural model built from measured construction drawings — into a photorealistic architectural visualization of the very same scene. Its geometry is exact and must survive unchanged.`,
  );

  lines.push('');
  lines.push('GEOMETRY LOCK (identical to the input, pixel-aligned):');
  lines.push('1. Camera: same viewpoint, perspective, focal length, framing and crop. Do not zoom, pan, rotate, tilt or re-compose.');
  lines.push('2. Walls: every wall keeps its exact position, length, thickness, height and corners; the room layout stays the same.');
  lines.push(
    '3. Openings: every door and window stays exactly where it is, with the same width and the same count. Window openings get glass in slim frames; door openings get a door leaf or stay an open passage, as in the model.',
  );
  lines.push('4. Never add, remove, move, merge, split, resize or straighten any wall, door, window, column, slab or room.');
  if (o.viewKind === 'cutaway') {
    lines.push(
      '5. This is a roofless cutaway seen from above: keep it open-top. No roof, ceiling, beams, upper floor or extra storey; wall tops stay flat cut sections.',
    );
  } else {
    lines.push('5. Show only the building that is in the model: no extra storeys, roof shapes, extensions or neighbouring buildings.');
  }
  lines.push(
    '6. The model is complete. Everything outside its outer walls is empty background: keep it plain and empty, as in the input. Never add rooms, walls, floors, furniture or buildings outside the model, and never fill or "complete" an empty area.',
  );

  if (o.withEdgeGuide) {
    lines.push('');
    lines.push(
      'Image 2 is an edge map of the same view (dark lines on white). Each line is a real edge of the model: the wall, door and window edges in your render must sit exactly on these lines. Never draw the lines themselves.',
    );
  }
  if (o.withPlan) {
    lines.push('');
    lines.push(
      `Image ${o.withEdgeGuide ? 3 : 2} is the 2D floor plan of this building, for reference only: use it to understand what each room is (kitchen, bathroom, bedroom, living) and where furniture goes. Never draw the plan, its text, dimensions or hatching.`,
    );
  }

  lines.push('');
  lines.push('CHANGE ONLY: surface materials, textures, lighting, shadows, reflections and photographic realism.');
  lines.push(`Lighting: ${style.lighting}`);
  lines.push(`Materials: ${style.materials ?? DEFAULT_MATERIALS}`);
  lines.push(
    o.furnish
      ? 'Furnishing: furnish each room for its use with realistic furniture standing on the floor inside that room. Furniture goes only inside the rooms of the model — nothing outside its outer walls (no terraces, gardens, plants or outdoor furniture). It must never block, cover or alter any door or window opening, and must not hide wall corners.'
      : 'Furnishing: leave the rooms unfurnished with clean empty floors, so the architecture reads clearly.',
  );
  if (note) {
    lines.push(`Client request (apply only where it changes no geometry): ${note}`);
  }
  if (o.strict) {
    lines.push('');
    lines.push(
      'STRICT: a previous attempt drifted from the model. Trace the input exactly, as a locked underlay, and only re-skin its surfaces — every edge must land where it is in the input.',
    );
  }
  lines.push('');
  lines.push(
    'Output: one photorealistic image with exactly the same framing and aspect ratio as the input — high-end architectural photography, sharp detail, realistic materials. No text, labels, dimensions, watermarks, people or vehicles.',
  );
  return lines.join('\n');
}

/** Picks a style from free text typed in the chat ("golden hour", "night", …). */
export function styleFromText(text: string): RenderStyleId {
  const t = text.toLowerCase();
  if (/golden|sunset|sunrise|warm sun/.test(t)) return 'golden-hour';
  if (/night|dusk|evening|blue hour/.test(t)) return 'dusk';
  if (/overcast|cloud|soft light|diffuse/.test(t)) return 'overcast';
  if (/clay|white model|massing|maquette/.test(t)) return 'clay';
  return 'daylight';
}

/** True when chat text asks for furniture. */
export function furnishFromText(text: string): boolean {
  return /furnish|furniture|sofa|bed|kitchen units|decor|interior design/.test(text.toLowerCase());
}

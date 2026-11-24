// features/render/render-presets.ts
// Shared (client + server) definitions for geometry-locked photoreal renders:
// style presets, quality tiers, supported aspect ratios and the prompt builder.
// Pure module: no DOM, no Node APIs, so it is safe to import from the API route,
// the browser and unit tests.

export const RENDER_PROMPT_VERSION = 'geo-lock-v7';

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

/**
 * Reference pictures one render may carry besides the view and its line drawing, per
 * tier. Nano Banana 2 takes up to 10 object pictures (14 images in all), Pro up to 6
 * objects and 14 in all; the Lite model is not made for many references, so it gets few.
 */
export const REFERENCE_BUDGET: Readonly<Record<RenderTierId, { total: number; products: number; looks: number }>> = {
  fast: { total: 4, products: 4, looks: 1 },
  balanced: { total: 10, products: 10, looks: 2 },
  pro: { total: 9, products: 6, looks: 3 },
};

/** Look references at most, across tiers (what the panel lets you add). */
export const MAX_LOOK_REFERENCES = 3;

/** How many look references and product pictures to send: the client's looks first, products fill the rest. */
export function referencePlan(tier: RenderTierId, looksWanted: number, productsWanted: number): { looks: number; products: number } {
  const b = REFERENCE_BUDGET[tier] ?? REFERENCE_BUDGET.fast;
  const looks = Math.max(0, Math.min(looksWanted, b.looks));
  const products = Math.max(0, Math.min(productsWanted, b.products, b.total - looks));
  return { looks, products };
}

/** "image 5", "images 5 and 6", "images 5, 6 and 7". */
export function imageList(indices: readonly number[]): string {
  const n = [...indices];
  if (n.length <= 1) return `image ${n[0] ?? ''}`.trim();
  return `images ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

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

/** Render frames offered in the panel: the screen's own shape, or a fixed photo format. */
export const RENDER_FRAMES = [
  { id: 'screen', label: 'Screen', hint: 'What you see, cropped to the nearest format' },
  { id: '16:9', label: '16:9', hint: 'Wide' },
  { id: '3:2', label: '3:2', hint: 'Classic photo' },
  { id: '1:1', label: '1:1', hint: 'Square' },
  { id: '4:5', label: '4:5', hint: 'Portrait' },
  { id: '9:16', label: '9:16', hint: 'Tall' },
] as const;
export type RenderFrameId = (typeof RENDER_FRAMES)[number]['id'];

export function isRenderFrame(id: unknown): id is RenderFrameId {
  return RENDER_FRAMES.some((f) => f.id === id);
}

/** Aspect of a fixed frame (undefined for "screen"). */
export function frameAspect(id: RenderFrameId): AspectChoice | undefined {
  return id === 'screen' ? undefined : SUPPORTED_ASPECTS.find((a) => a.label === id);
}

/**
 * Viewfinder: the largest rectangle of `ratio` (width / height) that fits in the
 * free box, centred in it. Pixel coordinates; null when nothing usable fits.
 */
export function viewfinderRect(
  free: { x0: number; y0: number; x1: number; y1: number },
  ratio: number,
): { x: number; y: number; w: number; h: number } | null {
  const fw = free.x1 - free.x0;
  const fh = free.y1 - free.y0;
  if (fw < 40 || fh < 40 || !(ratio > 0)) return null;
  let w = fw;
  let h = w / ratio;
  if (h > fh) {
    h = fh;
    w = h * ratio;
  }
  return { x: free.x0 + (fw - w) / 2, y: free.y0 + (fh - h) / 2, w, h };
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

/**
 * Largest crop of `ratio` centred on (cx, cy) — the camera's optical centre —
 * that stays inside the image. A crop centred there keeps the photo's natural
 * perspective (horizon in the middle for a level camera), which image models
 * reproduce instead of "re-centring" the shot.
 */
export function cropCentredAt(
  width: number,
  height: number,
  ratio: number,
  cx: number,
  cy: number,
): { x: number; y: number; w: number; h: number } {
  const x = Math.min(Math.max(cx, 0), width);
  const y = Math.min(Math.max(cy, 0), height);
  const halfW = Math.min(x, width - x);
  const halfH = Math.min(y, height - y);
  let w = 2 * halfW;
  let h = w / ratio;
  if (h > 2 * halfH) {
    h = 2 * halfH;
    w = h * ratio;
  }
  if (w < 48 || h < 48) return centreCrop(width, height, ratio);
  return { x: Math.round(x - w / 2), y: Math.round(y - h / 2), w: Math.round(w), h: Math.round(h) };
}

/**
 * Angles a crop of the camera's view covers, in degrees. `fovDeg` is the
 * vertical field of the whole canvas, `aspect` its width / height, `principal`
 * the optical centre in normalized canvas coordinates (it moves with the lens
 * shift) and `crop` the kept part, also normalized.
 */
export function cropFieldOfView(fovDeg: number, aspect: number, principal: { x: number; y: number }, crop: NormRect): { h: number; v: number } {
  const t = Math.tan((fovDeg * Math.PI) / 360) * 2;
  const deg = (r: number) => (r * 180) / Math.PI;
  const v = Math.atan((crop.y1 - principal.y) * t) - Math.atan((crop.y0 - principal.y) * t);
  const h = Math.atan((crop.x1 - principal.x) * t * aspect) - Math.atan((crop.x0 - principal.x) * t * aspect);
  return { h: deg(h), v: deg(v) };
}

/** A door or window seen in the render view (normalized to the cropped image). */
export interface OpeningInView {
  kind: 'door' | 'window';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** "Visible openings, left to right: …" for the prompt, from the 3D scene (never guessed from pixels). */
export function describeOpenings(openings: readonly OpeningInView[]): string {
  if (!openings.length) return 'No door or window is visible in this view: do not add any.';
  const sorted = [...openings].sort((a, b) => a.x0 + a.x1 - (b.x0 + b.x1));
  const doors = sorted.filter((o) => o.kind === 'door').length;
  const windows = sorted.length - doors;
  const count = [windows ? `${windows} window${windows > 1 ? 's' : ''}` : '', doors ? `${doors} door${doors > 1 ? 's' : ''}` : '']
    .filter(Boolean)
    .join(' and ');
  if (sorted.length > 8) return `Exactly ${count} are visible, where the input shows them; there are no other doors or windows in view.`;
  const where = (o: OpeningInView) => {
    const c = (o.x0 + o.x1) / 2;
    return c < 0.34 ? 'on the left' : c > 0.66 ? 'on the right' : 'in the centre';
  };
  return `Exactly ${count} ${sorted.length > 1 ? 'are' : 'is'} visible, left to right: ${sorted.map((o) => `a ${o.kind} ${where(o)}`).join(', ')}. There are no other doors or windows in view.`;
}

/** 'cutaway' = roofless model seen from above; 'eye-level' = near-horizontal camera; 'interior' = standing inside a room (walk mode). */
export type ViewKind = 'cutaway' | 'eye-level' | 'interior';

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
  /** Interior views: lens of the view (35 mm-equivalent). */
  lensMm?: number;
  /** Interior views: close the open-top rooms with a plain ceiling. */
  ceiling?: boolean;
  /** The ceiling is already drawn in the input (added to the 3D view for the capture). */
  ceilingInView?: boolean;
  /** Image 2 is a line drawing made from the 3D model (not an edge map of the picture). */
  lineGuide?: boolean;
  /** The view is a parallel (orthographic, e.g. isometric) projection, not a perspective. */
  parallel?: boolean;
  /** Numbers of the attached look references (materials, colours and mood to follow). */
  looks?: readonly number[];
  /** Angles the input covers, in degrees. */
  fovDeg?: { h: number; v: number };
  /** Camera pitch in degrees (positive = looking up). */
  pitchDeg?: number;
  /** Doors and windows visible in the input, from the 3D scene. */
  openings?: readonly OpeningInView[];
  /** Furniture stand-ins in view (pieces placed from the drawing) and the products they carry. */
  furniture?: PromptFurniture;
}

/** One product of the furniture schedule, as its stand-ins appear in the view. */
export interface PromptFurnitureProduct {
  label: string;
  /** Colour its stand-ins wear in the view ('red', 'blue', …). */
  colour: string;
  /** Kinds of its stand-ins ('seat', 'table', …). */
  kinds: readonly string[];
  count: number;
  /** Where its stand-ins are in the view ('on the left', …). */
  where?: string;
  /** Its own photo, cut out, stands on a coloured pad at each place (instead of a solid stand-in). */
  photo?: boolean;
  /** Number of the attached picture of the product, when one is sent. */
  imageIndex?: number;
}

/** Stand-ins of one kind that carry no product. */
export interface PromptPlainFurniture {
  kind: string;
  count: number;
  where?: string;
}

export interface PromptFurniture {
  /** Stand-ins in view, with or without a product. */
  standIns: number;
  products: readonly PromptFurnitureProduct[];
  /** Stand-ins without a product, by kind. */
  plain?: readonly PromptPlainFurniture[];
  /** Stand-ins seen through glass walls. */
  behindGlass?: number;
}

const KIND_NOUN: Record<string, readonly [string, string]> = {
  seat: ['chair', 'chairs'],
  sofa: ['sofa', 'sofas'],
  table: ['table', 'tables'],
  'side-table': ['side table', 'side tables'],
  desk: ['desk', 'desks'],
  bed: ['bed', 'beds'],
  storage: ['storage unit', 'storage units'],
  plant: ['plant', 'plants'],
  screen: ['screen', 'screens'],
  sanitary: ['sanitary fitting', 'sanitary fittings'],
  equipment: ['piece of equipment', 'pieces of equipment'],
  joinery: ['joinery unit', 'joinery units'],
};

/** "chair" / "chairs" for stand-ins of one kind, "piece(s)" for a mix. */
export function standInNoun(kinds: readonly string[], count: number): string {
  const known = [...new Set(kinds)].map((k) => KIND_NOUN[k]).filter(Boolean);
  const pair = known.length === 1 ? known[0] : (['piece', 'pieces'] as const);
  return count === 1 ? pair[0] : pair[1];
}

/** Where a group of stand-ins sits across the view. */
export function whereInView(r: { x0: number; x1: number }): string {
  if (r.x1 - r.x0 > 0.6) return 'across the view';
  const c = (r.x0 + r.x1) / 2;
  return c < 0.34 ? 'on the left' : c > 0.66 ? 'on the right' : 'in the centre';
}

/** Part of the view a spot is in (front = near the bottom of the view, back = near the top). */
export function viewZone(s: { x: number; y: number }): string {
  const col = s.x < 0.34 ? 'left' : s.x > 0.66 ? 'right' : 'centre';
  const row = s.y < 0.4 ? 'back' : s.y > 0.72 ? 'front' : '';
  return row ? `${row} ${col}` : col;
}

const zonePhrase = (z: string) => (z === 'centre' ? 'in the centre' : z === 'left' || z === 'right' ? `on the ${z}` : `at the ${z}`);

const FACING_PHRASES: Record<string, string> = {
  camera: 'facing the camera',
  away: 'facing away from the camera',
  left: 'facing left',
  right: 'facing right',
  'left-near': 'turned to the left, towards the camera',
  'right-near': 'turned to the right, towards the camera',
  'left-far': 'turned to the left, away from the camera',
  'right-far': 'turned to the right, away from the camera',
  down: 'facing the bottom of the image',
  up: 'facing the top of the image',
  'down-left': 'facing down and to the left',
  'down-right': 'facing down and to the right',
  'up-left': 'facing up and to the left',
  'up-right': 'facing up and to the right',
};

/** How a piece's facing in the view is said in the prompt ('' when unknown). */
export function facingPhrase(f: string | undefined): string {
  return (f && FACING_PHRASES[f]) || '';
}

type Spot = { x: number; y: number; facing?: string; by?: string };

/**
 * How a few pieces face, said once: their common way ("facing left"), the way most of
 * them face ("mostly facing the camera"), seats around tables ("each turned to face its
 * table"), or '' when they face every way or the drawing does not tell.
 */
function groupFacing(list: readonly Spot[]): string {
  const tally = new Map<string, number>();
  for (const s of list) {
    const f = facingPhrase(s.facing);
    if (f) tally.set(f, (tally.get(f) ?? 0) + 1);
  }
  if (!tally.size) return '';
  const [top, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (n === list.length) return top;
  if (n >= list.length * 0.6) return `mostly ${top}`;
  if (list.every((s) => s.by === 'table')) return 'each turned to face its table';
  return '';
}

/**
 * Where a group stands, from its spots: "at the front left", "2 at the back left, 1 in
 * the centre", or "across the view" when it is spread all over. `count` is the group's
 * size (spots may be fewer). Spots that know which way their piece faces add it, place
 * by place: "2 at the back left, facing the camera; 1 on the right, facing left".
 */
export function spotsWhere(spots: readonly Spot[], count = spots.length): string {
  if (!spots.length) return '';
  const byZone = new Map<string, Spot[]>();
  for (const s of spots) {
    const z = viewZone(s);
    const list = byZone.get(z) ?? [];
    list.push(s);
    byZone.set(z, list);
  }
  const zones = [...byZone.entries()].sort((a, b) => b[1].length - a[1].length);
  const all = spots.length === count;
  const facing = spots.some((s) => facingPhrase(s.facing));
  const withWay = (place: string, list: readonly Spot[], sep = ', ') => {
    const f = facing ? groupFacing(list) : '';
    return f ? `${place}${sep}${f}` : place;
  };
  if (zones.length === 1) return withWay(zonePhrase(zones[0][0]), zones[0][1]);
  // Spread wide, the zones still tell two products of one kind apart.
  if (zones.length > 5) return withWay('across the view', spots, '; ');
  return zones.map(([z, list]) => withWay(all ? `${list.length} ${zonePhrase(z)}` : zonePhrase(z), list)).join(facing ? '; ' : ', ');
}

const promptText = (s: string, max: number) => s.replace(/[\s"]+/g, ' ').trim().slice(0, max);

const DEFAULT_MATERIALS =
  'Walls in smooth warm-white painted plaster; cut wall tops as clean flat light-grey sections; floors in light natural oak inside rooms; ' +
  'windows with clear glass, subtle reflections and slim dark-grey aluminium frames; doors in light wood with simple metal handles.';

/**
 * Inside views with a known list of openings: leave out the material notes for
 * kinds that are not in view (a "windows with clear glass" note invites the
 * model to add a window to a blank wall).
 */
function materialsFor(materials: string, o: Pick<GeometryLockPromptOptions, 'viewKind' | 'openings'>): string {
  if (o.viewKind !== 'interior' || !o.openings) return materials;
  const hasWindow = o.openings.some((x) => x.kind === 'window');
  const hasDoor = o.openings.some((x) => x.kind === 'door');
  const parts = materials
    .replace(/\.$/, '')
    .split(/;\s*/)
    .filter((part) => !((!hasWindow && /^windows?\b/i.test(part)) || (!hasDoor && /^doors?\b/i.test(part))));
  return `${parts.join('; ')}.`;
}

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
  const furniture = o.furniture && o.furniture.standIns > 0 ? o.furniture : null;
  // A white presentation model takes no materials from elsewhere.
  const looks = style.materials ? [] : (o.looks ?? []).filter((n) => n > 1);
  const imageRefs = o.withEdgeGuide || o.withPlan || looks.length > 0 || !!furniture?.products.some((p) => p.imageIndex);
  const lines: string[] = [];

  lines.push(
    `Turn ${imageRefs ? 'image 1' : 'this image'} — a view of a precise 3D architectural model built from measured construction drawings — into a photorealistic architectural visualization of the very same scene. Its geometry is exact and must survive unchanged.`,
  );

  lines.push('');
  lines.push('GEOMETRY LOCK (identical to the input, pixel-aligned):');
  if (o.parallel && o.viewKind !== 'interior') {
    lines.push('1. Camera: same viewpoint, angle, framing and crop. Do not zoom, pan, rotate, tilt or re-compose.');
    lines.push(
      '   This is a parallel projection (axonometric, like an isometric drawing), not a perspective photograph: parallel edges stay parallel and vertical edges stay vertical across the whole image, and equal heights stay equal near and far — no vanishing points, no perspective convergence and no lens distortion. Keep it a parallel projection.',
    );
  } else {
    lines.push('1. Camera: same viewpoint, perspective, focal length, framing and crop. Do not zoom, pan, rotate, tilt or re-compose.');
  }
  if (o.viewKind === 'interior') {
    const mm = o.lensMm && o.lensMm > 0 ? Math.round(o.lensMm) : 0;
    const lens = mm ? `${mm < 17 ? 'an ultra-wide' : 'a wide'} ${mm} mm lens (full-frame equivalent)` : 'a wide-angle lens';
    const fov = o.fovDeg && o.fovDeg.v > 0 ? `, covering about ${Math.round(o.fovDeg.v)}° from top to bottom and ${Math.round(o.fovDeg.h)}° across` : '';
    lines.push(`   This is an interior photograph taken at eye height (about 1.6 m) with ${lens}${fov}.`);
    const pitch = o.pitchDeg ?? 0;
    lines.push(
      Math.abs(pitch) < 3
        ? '   The camera is level and the shot is centred on it: vertical lines stay vertical and the horizon stays where it is. Keep this exact perspective — do not crop in, zoom, re-centre or straighten it.'
        : `   The camera looks ${pitch > 0 ? 'up' : 'down'} by about ${Math.round(Math.abs(pitch))}°, so vertical lines converge as in the input. Keep this exact perspective — do not crop in, zoom, re-centre or straighten it.`,
    );
  }
  lines.push('2. Walls: every wall keeps its exact position, length, thickness, height and corners; the room layout stays the same.');
  lines.push(
    '3. Openings: every door and window stays exactly where it is, with the same width and the same count. Window openings get glass in slim frames; door openings get a door leaf or stay an open passage, as in the model.',
  );
  if (o.viewKind === 'interior' && o.openings) lines.push(`   ${describeOpenings(o.openings)}`);
  if (o.viewKind === 'interior') {
    lines.push(
      '   Blank wall surfaces stay blank: never put a door, window, niche, panel or picture on a wall that shows none in the input — including the large wall surfaces close to the camera.',
    );
  }
  lines.push('4. Never add, remove, move, merge, split, resize or straighten any wall, door, window, column, slab or room.');
  if (o.viewKind === 'cutaway') {
    lines.push(
      '5. This is a roofless cutaway seen from above: keep it open-top. No roof, ceiling, beams, upper floor or extra storey; wall tops stay flat cut sections.',
    );
  } else if (o.viewKind === 'interior') {
    lines.push(
      o.ceiling === false
        ? '5. We stand inside the building. Keep the rooms open above the walls (no ceiling), exactly as in the input.'
        : o.ceilingInView
          ? '5. We stand inside the building. The flat ceiling in the input rests on top of the walls: keep it a plain flat white ceiling at exactly that height, with a few small recessed lights. Nothing above or below it: no beams, bulkheads, lowered sections or skylights.'
          : '5. We stand inside the building. The model has no ceilings: close the rooms with a plain flat white ceiling resting exactly on top of the existing walls, with a few simple recessed lights. Add nothing else above the walls: no beams, bulkheads, lowered sections, skylights or upper floors.',
    );
  } else {
    lines.push('5. Show only the building that is in the model: no extra storeys, roof shapes, extensions or neighbouring buildings.');
  }
  lines.push(
    o.viewKind === 'interior'
      ? '6. The model is complete: never add rooms, walls, wall stubs, partitions, alcoves, columns or openings. Every wall face and corner in your render is one that is in the input, and where the input shows open floor it stays open.'
      : '6. The model is complete. Everything outside its outer walls is empty background: keep it plain and empty, as in the input. Never add rooms, walls, floors, furniture or buildings outside the model, and never fill or "complete" an empty area.',
  );

  if (o.withEdgeGuide) {
    lines.push('');
    lines.push(
      o.lineGuide
        ? 'Image 2 is a line drawing made directly from the 3D model, in exactly the same view: every line is a real edge — wall corners, ends and tops, where walls meet the floor (and the ceiling), and door and window frames. Every wall, door and window edge in your render must lie on one of these lines, and none may appear where image 2 has no line. Never draw the lines themselves.'
        : 'Image 2 is an edge map of the same view (dark lines on white). Each line is a real edge of the model: the wall, door and window edges in your render must sit exactly on these lines. Never draw the lines themselves.',
    );
  }
  if (o.withPlan) {
    lines.push('');
    lines.push(
      `Image ${o.withEdgeGuide ? 3 : 2} is the 2D floor plan of this building, for reference only: use it to understand what each room is (kitchen, bathroom, bedroom, living) and where furniture goes. Never draw the plan, its text, dimensions or hatching.`,
    );
  }
  if (looks.length) {
    lines.push('');
    const which = imageList(looks);
    lines.push(
      `LOOK REFERENCES: ${which.charAt(0).toUpperCase()}${which.slice(1)} ${looks.length === 1 ? 'is a picture' : 'are pictures'} the client chose for the look. Take only ${looks.length === 1 ? 'its' : 'their'} materials, colours, finishes, textures and mood, and apply them to the surfaces of this model. Glass walls, glass doors and windows stay clear glass. Never copy ${looks.length === 1 ? 'its' : 'their'} layout, architecture, walls, doors, windows, furniture, camera angle or any text.`,
    );
  }

  const photoPieces = furniture ? furniture.products.filter((p) => p.photo).reduce((n, p) => n + p.count, 0) : 0;
  if (furniture) {
    const blocks = Math.max(0, furniture.standIns - photoPieces);
    const coded = furniture.products.filter((p) => !p.photo);
    const plain = (furniture.plain ?? []).filter((k) => k.count > 0);
    lines.push('');
    lines.push('FURNITURE IN THE MODEL:');
    if (blocks > 0) {
      lines.push(
        `The plain solid blocks standing on the floor in image 1 are furniture stand-ins placed from the construction drawing (${blocks} in view). Each marks the exact position, footprint, height and orientation of one real piece of furniture: render every stand-in as that real piece, in place, at the same size and facing the same way. A raised back marks the back of a seat, sofa or bed; a desk is open on the side where its user sits.`,
      );
    }
    if (photoPieces > 0) {
      // The photos stand without their coloured pads: those are a code for the 3D model only.
      lines.push(
        `Cut-out photos stand upright on the floor in image 1 (${photoPieces} in view): each is a real product from the project's furniture schedule, standing exactly where its photo stands, and the photo shows exactly which product it is, with its design, colours and materials. Render each as that real product: a solid three-dimensional piece of furniture at real size, standing on the floor at that spot, never as a flat photo, card, cut-out or poster. Turn each the way it faces in the list below; its photo stands turned with it: a photo seen straight on is a product facing the camera, a photo seen at an angle is a product turned that way, and a plain grey silhouette is a product seen from behind. Where no way is given, turn it naturally (chairs towards their table or into the room). Where a photo shows a set of pieces, render the one piece that fits its spot.`,
      );
    }
    lines.push('Never move, merge or leave out a piece, and add no furniture where the input shows open floor.');
    if (furniture.behindGlass && furniture.behindGlass > 0) {
      lines.push(
        `Some of this furniture (${furniture.behindGlass} in view) stands behind glass walls: every glass wall, glass door and frame stays exactly where it is, clear and unbroken, and that furniture is seen through the glass — never remove or open up the glass to show it.`,
      );
    }
    if (furniture.products.length) {
      if (coded.length) {
        lines.push(
          "Coloured stand-ins are specific products from the project's furniture schedule. The colour is only a code that tells which product it is: render the product's own design, materials and colours, never the code colour.",
        );
      }
      const productImages = furniture.products.map((p) => p.imageIndex).filter((n): n is number => !!n);
      if (productImages.length) {
        lines.push(`The product pictures (${imageList(productImages)}) are catalogue photos of single products: take only the product from each, never its background, text or framing.`);
      }
      for (const p of furniture.products) {
        const where = p.where ? `, ${promptText(p.where, 240)}` : '';
        const label = promptText(p.label, 140);
        if (p.photo) {
          const ref = p.imageIndex ? ` — more detail in image ${p.imageIndex}` : '';
          lines.push(`- ${label}: the ${standInNoun(p.kinds, p.count)} shown by ${p.count === 1 ? 'its photo' : 'their photos'} (${p.count}${where})${ref}.`);
        } else {
          const ref = p.imageIndex ? ` — copy its design, materials and colours from image ${p.imageIndex}` : '';
          lines.push(`- The ${promptText(p.colour, 20)} ${standInNoun(p.kinds, p.count)} (${p.count}${where}): ${label}${ref}.`);
        }
      }
    }
    const codedCount = coded.reduce((n, p) => n + p.count, 0);
    if (plain.length) {
      const placeOf = (where?: string) => {
        const w = where ? promptText(where, 240) : '';
        return !w ? '' : /^\d/.test(w) ? ` (${w})` : ` ${w}`;
      };
      const list = plain
        .slice(0, 6)
        .map((k) => `${k.count} ${standInNoun([k.kind], k.count)}${placeOf(k.where)}`)
        .join('; ');
      const kinds = new Set(plain.map((k) => k.kind));
      const notes = [kinds.has('plant') ? 'plants as real, leafy potted plants' : '', kinds.has('screen') ? 'screens as slim wall-mounted displays' : '']
        .filter(Boolean)
        .join(', ');
      lines.push(
        `Stand-ins without a product: ${list}. Render each as a simple, neutral contemporary piece of its kind${notes ? ` (${notes})` : ''}.`,
      );
    } else if (furniture.products.length && blocks > codedCount) {
      lines.push('Off-white stand-ins carry no product: render them as simple, neutral contemporary furniture of their kind.');
    }
  }

  lines.push('');
  lines.push('CHANGE ONLY: surface materials, textures, lighting, shadows, reflections and photographic realism.');
  lines.push(`Lighting: ${style.lighting}`);
  const materials = materialsFor(style.materials ?? DEFAULT_MATERIALS, o);
  lines.push(
    looks.length
      ? `Materials: as in the look reference${looks.length === 1 ? '' : 's'} (${imageList(looks)}); for any surface ${looks.length === 1 ? 'it does' : 'they do'} not show: ${materials.charAt(0).toLowerCase()}${materials.slice(1)}`
      : `Materials: ${materials}`,
  );
  lines.push(
    furniture
      ? `Furnishing: only the furniture of the stand-ins${photoPieces ? ' and photos' : ''} above (soft cushions and a few small accessories on it are fine) — nothing else on the floors, no rugs.`
      : o.furnish
        ? 'Furnishing: furnish each room for its use with realistic furniture standing on the floor inside that room. Furniture goes only inside the rooms of the model — nothing outside its outer walls (no terraces, gardens, plants or outdoor furniture). It must never block, cover or alter any door or window opening, and must not hide wall corners.'
        : o.viewKind === 'interior'
          ? 'Furnishing: none. Every room stays completely empty — no furniture, beds, desks, chairs, shelves, rugs or appliances — so the architecture reads clearly.'
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

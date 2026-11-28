import { describe, expect, it } from 'vitest';
import {
  ALLOWED_RENDER_MODELS,
  REFERENCE_BUDGET,
  RENDER_FRAMES,
  RENDER_TIERS,
  SUPPORTED_ASPECTS,
  buildGeometryLockPrompt,
  centreCrop,
  clampNote,
  cropCentredAt,
  cropFieldOfView,
  describeOpenings,
  frameAspect,
  furnishFromText,
  imageList,
  isRenderFrame,
  isSupportedAspect,
  modelSupportsImageSize,
  nearestAspect,
  referencePlan,
  spotsWhere,
  facingPhrase,
  standInNoun,
  styleFromText,
  viewZone,
  viewfinderRect,
  whereInView,
} from './render-presets';

describe('aspect ratios', () => {
  it('picks the nearest supported ratio', () => {
    expect(nearestAspect(1920, 1080).label).toBe('16:9');
    expect(nearestAspect(618, 682).label).toBe('1:1');
    expect(nearestAspect(1000, 1500).label).toBe('2:3');
    expect(nearestAspect(2400, 1000).label).toBe('21:9');
    expect(nearestAspect(1280, 1024).label).toBe('5:4');
  });

  it('centre-crops to the ratio without leaving the frame', () => {
    for (const [w, h] of [[1448, 1600], [1920, 1080], [800, 800], [1000, 2200]]) {
      const a = nearestAspect(w, h);
      const c = centreCrop(w, h, a.ratio);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(w);
      expect(c.y + c.h).toBeLessThanOrEqual(h);
      expect(Math.abs(c.w / c.h - a.ratio)).toBeLessThan(0.01);
    }
  });

  it('only accepts the ten ratios every image model supports', () => {
    expect(SUPPORTED_ASPECTS).toHaveLength(10);
    expect(isSupportedAspect('16:9')).toBe(true);
    expect(isSupportedAspect('1:4')).toBe(false);
  });
});

describe('tiers', () => {
  it('every tier model is allowed and the cheap one is the default fast tier', () => {
    for (const t of Object.values(RENDER_TIERS)) expect(ALLOWED_RENDER_MODELS.has(t.model)).toBe(true);
    expect(RENDER_TIERS.fast.model).toBe('gemini-3.1-flash-lite-image');
    expect(RENDER_TIERS.fast.approxUsd).toBeLessThan(0.05);
  });

  it('sends more references with the models made for them', () => {
    expect(referencePlan('fast', 0, 9)).toEqual({ looks: 0, products: 8 });
    expect(referencePlan('fast', 3, 9)).toEqual({ looks: 1, products: 7 });
    expect(referencePlan('balanced', 2, 12)).toEqual({ looks: 2, products: 8 });
    expect(referencePlan('balanced', 0, 12)).toEqual({ looks: 0, products: 10 });
    expect(referencePlan('pro', 3, 12)).toEqual({ looks: 3, products: 6 });
    expect(referencePlan('pro', 0, 2)).toEqual({ looks: 0, products: 2 });
    // With the view and the line drawing, never past the 14 images a request takes.
    for (const b of Object.values(REFERENCE_BUDGET)) expect(b.total + 2).toBeLessThanOrEqual(14);
    expect(imageList([5])).toBe('image 5');
    expect(imageList([5, 6, 7])).toBe('images 5, 6 and 7');
  });

  it('knows which models take imageSize', () => {
    expect(modelSupportsImageSize('gemini-3.1-flash-lite-image')).toBe(true);
    expect(modelSupportsImageSize('gemini-2.5-flash-image')).toBe(false);
  });
});

describe('geometry-lock prompt', () => {
  const base = { style: 'daylight' as const, viewKind: 'cutaway' as const, furnish: false, withEdgeGuide: false, withPlan: false };

  it('locks camera, walls and openings and allows only surface changes', () => {
    const p = buildGeometryLockPrompt(base);
    expect(p).toMatch(/GEOMETRY LOCK/);
    expect(p).toMatch(/same viewpoint, perspective, focal length, framing and crop/);
    expect(p).toMatch(/every door and window stays exactly where it is/);
    expect(p).toMatch(/Never add, remove, move, merge, split, resize or straighten/);
    expect(p).toMatch(/CHANGE ONLY: surface materials/);
    expect(p).toMatch(/unfurnished/);
    expect(p).not.toMatch(/Image 2/);
  });

  it('keeps cutaway views roofless; eye-level views get no roof clause', () => {
    expect(buildGeometryLockPrompt(base)).toMatch(/roofless cutaway/);
    expect(buildGeometryLockPrompt({ ...base, viewKind: 'eye-level' })).not.toMatch(/roofless/);
  });

  it('numbers the reference images in the order they are sent', () => {
    const both = buildGeometryLockPrompt({ ...base, withEdgeGuide: true, withPlan: true, furnish: true });
    expect(both).toMatch(/Image 2 is an edge map/);
    expect(both).toMatch(/Image 3 is the 2D floor plan/);
    expect(both).toMatch(/Turn image 1/);
    const planOnly = buildGeometryLockPrompt({ ...base, withPlan: true, furnish: true });
    expect(planOnly).toMatch(/Image 2 is the 2D floor plan/);
    expect(planOnly).toMatch(/furnish each room/);
  });

  it('adds the user note as a geometry-safe request, trimmed', () => {
    const p = buildGeometryLockPrompt({ ...base, note: '  polished   concrete floors  ' });
    expect(p).toMatch(/Client request \(apply only where it changes no geometry\): polished concrete floors/);
    expect(clampNote('x'.repeat(900)).length).toBe(400);
  });

  it('tightens the lock on a retry and swaps materials for the clay look', () => {
    expect(buildGeometryLockPrompt({ ...base, strict: true })).toMatch(/STRICT/);
    expect(buildGeometryLockPrompt({ ...base, style: 'clay' })).toMatch(/white architectural presentation model/);
  });
});

describe('chat text helpers', () => {
  it('maps words to looks', () => {
    expect(styleFromText('Change to warm golden hour sunset lighting')).toBe('golden-hour');
    expect(styleFromText('Night architectural scene with warm interior lighting')).toBe('dusk');
    expect(styleFromText('make it a clay model')).toBe('clay');
    expect(styleFromText('Add luxury polished Italian marble flooring')).toBe('daylight');
  });

  it('detects furniture requests', () => {
    expect(furnishFromText('add furniture please')).toBe(true);
    expect(furnishFromText('golden hour')).toBe(false);
  });
});

describe('focusCrop', () => {
  it('frames the building with a margin at a supported ratio, inside the frame', async () => {
    const { focusCrop } = await import('./render-presets');
    const c = focusCrop(1600, 1000, { x0: 0.55, y0: 0.5, x1: 0.85, y1: 0.95 });
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.x + c.w).toBeLessThanOrEqual(1600);
    expect(c.y + c.h).toBeLessThanOrEqual(1000);
    expect(Math.abs(c.w / c.h - c.aspect.ratio)).toBeLessThan(0.01);
    // The building box (880..1360 x 500..950) stays inside the crop.
    expect(c.x).toBeLessThanOrEqual(880);
    expect(c.x + c.w).toBeGreaterThanOrEqual(1360);
    expect(c.y).toBeLessThanOrEqual(500);
    // Much tighter than the full frame.
    expect(c.w * c.h).toBeLessThan(0.45 * 1600 * 1000);
  });

  it('falls back to the full frame for a tiny focus box', async () => {
    const { focusCrop } = await import('./render-presets');
    const c = focusCrop(1600, 1000, { x0: 0.5, y0: 0.5, x1: 0.51, y1: 0.51 });
    expect(c.w).toBeGreaterThan(1000);
  });
});

describe('render frames and inside views', () => {
  it('fits the largest frame of the chosen format in the free box, centred', () => {
    const r = viewfinderRect({ x0: 8, y0: 220, x1: 385, y1: 660 }, 16 / 9)!;
    expect(r.w).toBeCloseTo(377, 6);
    expect(r.h).toBeCloseTo(377 / (16 / 9), 6);
    expect(r.x).toBeCloseTo(8, 6);
    expect(r.y + r.h / 2).toBeCloseTo((220 + 660) / 2, 6);
    const tall = viewfinderRect({ x0: 0, y0: 0, x1: 400, y1: 300 }, 9 / 16)!;
    expect(tall.h).toBeCloseTo(300, 6);
    expect(tall.w).toBeCloseTo(300 * (9 / 16), 6);
    expect(viewfinderRect({ x0: 0, y0: 0, x1: 30, y1: 300 }, 1)).toBeNull();
  });

  it('maps every fixed frame to a supported model format', () => {
    for (const f of RENDER_FRAMES) {
      if (f.id === 'screen') expect(frameAspect(f.id)).toBeUndefined();
      else expect(isSupportedAspect(frameAspect(f.id)!.label)).toBe(true);
    }
    expect(isRenderFrame('16:9')).toBe(true);
    expect(isRenderFrame('2:1')).toBe(false);
  });

  it('tells the model about the lens and the missing ceiling inside the building', () => {
    const p = buildGeometryLockPrompt({ style: 'daylight', viewKind: 'interior', furnish: false, withEdgeGuide: false, withPlan: false, lensMm: 18, ceiling: true });
    expect(p).toMatch(/eye height/);
    expect(p).toMatch(/18 mm/);
    expect(p).toMatch(/plain flat white ceiling/);
    expect(p).not.toMatch(/roofless cutaway/);
    const open = buildGeometryLockPrompt({ style: 'daylight', viewKind: 'interior', furnish: false, withEdgeGuide: false, withPlan: false, ceiling: false });
    expect(open).toMatch(/open above the walls/);
    expect(open).not.toMatch(/plain flat white ceiling/);
    const outside = buildGeometryLockPrompt({ style: 'daylight', viewKind: 'eye-level', furnish: false, withEdgeGuide: false, withPlan: false });
    expect(outside).not.toMatch(/eye height \(about 1\.6 m\)/);
  });
});

describe('inside views: framing and prompt facts', () => {
  it('centres the crop on the camera, as large as fits', () => {
    // 900 x 1600 canvas, optical centre 46% down: a 9:16 crop centred there.
    const c = cropCentredAt(900, 1600, 9 / 16, 450, 736);
    expect(c.y + c.h / 2).toBeCloseTo(736, 0);
    expect(c.x + c.w / 2).toBeCloseTo(450, 0);
    expect(c.h).toBeCloseTo(1472, 0);
    expect(c.w / c.h).toBeCloseTo(9 / 16, 2);
    // An optical centre outside the image falls back to the plain centre crop.
    expect(cropCentredAt(900, 1600, 9 / 16, 0, 0)).toEqual(centreCrop(900, 1600, 9 / 16));
  });

  it('measures the angles a crop covers, lens shift included', () => {
    const full = cropFieldOfView(90, 1, { x: 0.5, y: 0.5 }, { x0: 0, y0: 0, x1: 1, y1: 1 });
    expect(full.v).toBeCloseTo(90, 6);
    expect(full.h).toBeCloseTo(90, 6);
    // The upper half of a 90° view, centred on the axis: 45° up.
    const upper = cropFieldOfView(90, 1, { x: 0.5, y: 0.5 }, { x0: 0, y0: 0, x1: 1, y1: 0.5 });
    expect(upper.v).toBeCloseTo(45, 6);
    // Same crop height off the axis covers less (the edges are compressed).
    const off = cropFieldOfView(90, 1, { x: 0.5, y: 0.8 }, { x0: 0, y0: 0, x1: 1, y1: 0.5 });
    expect(off.v).toBeLessThan(45);
  });

  it('lists the doors and windows in view, left to right, and says there are no others', () => {
    const s = describeOpenings([
      { kind: 'door', x0: 0.8, y0: 0.3, x1: 0.9, y1: 0.7 },
      { kind: 'window', x0: 0.05, y0: 0.2, x1: 0.2, y1: 0.5 },
    ]);
    expect(s).toBe('Exactly 1 window and 1 door are visible, left to right: a window on the left, a door on the right. There are no other doors or windows in view.');
    expect(describeOpenings([])).toMatch(/No door or window is visible/);
  });

  it('builds the inside prompt from the capture: closed ceiling, line drawing, field of view, level camera, openings', () => {
    const p = buildGeometryLockPrompt({
      style: 'daylight', viewKind: 'interior', furnish: false, withEdgeGuide: true, withPlan: false, lensMm: 13, ceiling: true,
      ceilingInView: true, lineGuide: true, fovDeg: { h: 64, v: 104 }, pitchDeg: 0.5,
      openings: [{ kind: 'door', x0: 0.7, y0: 0.3, x1: 0.8, y1: 0.8 }],
    });
    expect(p).toMatch(/ultra-wide 13 mm lens/);
    expect(p).toMatch(/104° from top to bottom and 64° across/);
    expect(p).toMatch(/camera is level/);
    expect(p).toMatch(/flat ceiling in the input rests on top of the walls/);
    expect(p).not.toMatch(/close the rooms with a plain flat white ceiling/);
    expect(p).toMatch(/line drawing made directly from the 3D model/);
    expect(p).toMatch(/Exactly 1 door is visible/);
    expect(p).toMatch(/no furniture, beds, desks/);
    expect(p).toMatch(/Blank wall surfaces stay blank/);
    // Only a door in view: no window material note to tempt the model.
    expect(p).not.toMatch(/windows with clear glass/);
    expect(p).toMatch(/doors in light wood/);
    const tilted = buildGeometryLockPrompt({ style: 'daylight', viewKind: 'interior', furnish: false, withEdgeGuide: false, withPlan: false, pitchDeg: 14 });
    expect(tilted).toMatch(/looks up by about 14°/);
    expect(tilted).not.toMatch(/line drawing/);
  });
});

describe('furniture stand-ins and real products', () => {
  it('names stand-ins by kind and place', () => {
    expect(standInNoun(['seat'], 12)).toBe('chairs');
    expect(standInNoun(['seat', 'seat'], 1)).toBe('chair');
    expect(standInNoun(['seat', 'table'], 3)).toBe('pieces');
    expect(standInNoun(['mystery'], 2)).toBe('pieces');
    expect(whereInView({ x0: 0.05, x1: 0.2 })).toBe('on the left');
    expect(whereInView({ x0: 0.4, x1: 0.6 })).toBe('in the centre');
    expect(whereInView({ x0: 0.7, x1: 0.95 })).toBe('on the right');
    expect(whereInView({ x0: 0.1, x1: 0.9 })).toBe('across the view');
  });

  it('says where in the view a group stands, front to back', () => {
    expect(viewZone({ x: 0.1, y: 0.9 })).toBe('front left');
    expect(viewZone({ x: 0.5, y: 0.55 })).toBe('centre');
    expect(viewZone({ x: 0.8, y: 0.2 })).toBe('back right');
    expect(spotsWhere([{ x: 0.1, y: 0.9 }, { x: 0.2, y: 0.8 }])).toBe('at the front left');
    expect(spotsWhere([{ x: 0.5, y: 0.5 }])).toBe('in the centre');
    expect(spotsWhere([{ x: 0.1, y: 0.2 }, { x: 0.15, y: 0.3 }, { x: 0.5, y: 0.6 }])).toBe('2 at the back left, 1 in the centre');
    expect(spotsWhere([{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.6 }], 9)).toBe('at the back left, in the centre');
    expect(spotsWhere([{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.6 }, { x: 0.9, y: 0.9 }, { x: 0.9, y: 0.1 }])).toBe(
      '1 at the back left, 1 in the centre, 1 at the front right, 1 at the back right',
    );
    const everywhere = [0.1, 0.5, 0.9].flatMap((x) => [0.2, 0.55, 0.9].map((y) => ({ x, y })));
    expect(spotsWhere(everywhere)).toBe('across the view');
    expect(spotsWhere([])).toBe('');
  });

  it('says which way the pieces face where the drawing shows it', () => {
    expect(facingPhrase('camera')).toBe('facing the camera');
    expect(facingPhrase('left-far')).toBe('turned to the left, away from the camera');
    expect(facingPhrase(undefined)).toBe('');
    expect(spotsWhere([{ x: 0.1, y: 0.2, facing: 'camera' }, { x: 0.2, y: 0.3, facing: 'camera' }])).toBe('at the back left, facing the camera');
    expect(spotsWhere([{ x: 0.1, y: 0.2, facing: 'camera' }, { x: 0.2, y: 0.3, facing: 'camera' }, { x: 0.8, y: 0.5, facing: 'left' }])).toBe(
      '2 at the back left, facing the camera; 1 on the right, facing left',
    );
    // seen from straight above, by the image
    expect(spotsWhere([{ x: 0.5, y: 0.5, facing: 'down' }])).toBe('in the centre, facing the bottom of the image');
    // spread all over: how most of them face
    const many = [0.1, 0.5, 0.9].flatMap((x) => [0.2, 0.55, 0.9].map((y, i) => ({ x, y, facing: i === 2 ? 'left' : 'camera' })));
    expect(spotsWhere(many)).toBe('across the view; mostly facing the camera');
    // chairs turned to their tables all around the view
    const round = [0.1, 0.5, 0.9].flatMap((x) => [0.2, 0.55, 0.9].map((y, i) => ({ x, y, facing: ['left', 'camera', 'right-far'][i], by: 'table' })));
    expect(spotsWhere(round)).toBe('across the view; each turned to face its table');
    // place by place, each with its own way
    expect(spotsWhere([{ x: 0.8, y: 0.2, facing: 'left', by: 'table' }, { x: 0.85, y: 0.25, facing: 'right', by: 'table' }, { x: 0.1, y: 0.5, facing: 'camera' }])).toBe(
      '2 at the back right, each turned to face its table; 1 on the left, facing the camera',
    );
  });

  it('turns stand-ins into the schedule\'s products, with their pictures', () => {
    const p = buildGeometryLockPrompt({
      style: 'daylight', viewKind: 'cutaway', furnish: false, withEdgeGuide: true, withPlan: false,
      furniture: {
        standIns: 20,
        products: [
          { label: 'Vitra · Eames "Plastic" Chair', colour: 'red', kinds: ['seat'], count: 12, where: 'across the view', imageIndex: 3 },
          { label: 'Narbutas · Nova table', colour: 'blue', kinds: ['table'], count: 1, where: 'on the left' },
        ],
      },
    });
    expect(p).toMatch(/Turn image 1/);
    expect(p).toMatch(/neutral 3D architectural massing stand-ins .* \(20 in view\)/);
    expect(p).toMatch(/- chairs \(12, across the view\): Vitra · Eames Plastic Chair — replace stand-in with exact design silhouette & finish from image 3\./);
    expect(p).toMatch(/- table \(1, on the left\): Narbutas · Nova table\./);
    expect(p).toMatch(/authoritative catalogue photos of matched manufacturer products/);
    expect(p).toMatch(/Off-white stand-ins carry no matched product/);
    expect(p).toMatch(/Furnishing: only the furniture of the stand-ins/);
    expect(p).not.toMatch(/leave the rooms unfurnished/);
  });

  it('renders the product photos as the real products, without pads or code colours', () => {
    const p = buildGeometryLockPrompt({
      style: 'daylight', viewKind: 'cutaway', furnish: false, withEdgeGuide: true, withPlan: false,
      furniture: {
        standIns: 10,
        products: [
          { label: 'Vitra · Repos', colour: 'red', kinds: ['seat'], count: 7, where: 'in the centre', photo: true, imageIndex: 3 },
          { label: 'Hay · Revolver', colour: 'blue', kinds: ['seat'], count: 3, photo: false },
        ],
      },
    });
    expect(p).toMatch(/Cut-out photos stand upright on the floor in image 1 \(7 in view\)/);
    expect(p).toMatch(/never as a flat photo, card, cut-out or poster/);
    expect(p).toMatch(/render the one piece that fits its spot/);
    expect(p).toMatch(/Turn each the way it faces in the list below; its photo stands turned with it/);
    expect(p).toMatch(/a plain grey silhouette is a product seen from behind/);
    expect(p).toMatch(/- Vitra · Repos: the chairs shown by their photos \(7, in the centre\) — more detail in image 3\./);
    expect(p).not.toMatch(/\bred\b|\bpads?\b/);
    expect(p).toMatch(/- chairs \(3\): Hay · Revolver\./);
    expect(p).toMatch(/Matched 3D stand-ins correspond to the real BOQ products/);
    expect(p).toMatch(/neutral 3D architectural massing stand-ins .* \(3 in view\)/);
    expect(p).not.toMatch(/Off-white stand-ins/);
    expect(p).toMatch(/Furnishing: only the furniture of the stand-ins and photos above .* no rugs\./);
    const onlyPhotos = buildGeometryLockPrompt({
      style: 'daylight', viewKind: 'interior', furnish: false, withEdgeGuide: false, withPlan: false,
      furniture: { standIns: 2, products: [{ label: 'Las · Mia', colour: 'pink', kinds: ['desk'], count: 2, photo: true }] },
    });
    expect(onlyPhotos).not.toMatch(/neutral 3D architectural massing stand-ins/);
    expect(onlyPhotos).not.toMatch(/Matched 3D stand-ins|pink/);
    expect(onlyPhotos).toMatch(/- Las · Mia: the desks shown by their photos \(2\)\./);
  });

  it('names the stand-ins without a product by kind and place', () => {
    const p = buildGeometryLockPrompt({
      style: 'daylight', viewKind: 'interior', furnish: false, withEdgeGuide: false, withPlan: false,
      furniture: {
        standIns: 9,
        products: [{ label: 'B&T · Kav', colour: 'red', kinds: ['seat'], count: 2, where: 'in the centre', photo: true }],
        plain: [
          { kind: 'plant', count: 4, where: 'at the front right' },
          { kind: 'sofa', count: 3, where: '2 at the back left, 1 in the centre' },
        ],
      },
    });
    expect(p).toMatch(/\(7 in view\)/);
    expect(p).toMatch(/Stand-ins without a matched product: 4 plants at the front right; 3 sofas \(2 at the back left, 1 in the centre\)\. Render each as a clean, neutral contemporary architectural piece .* \(plants as real, leafy potted plants\)\./);
    expect(p).not.toMatch(/Off-white stand-ins/);
    expect(p).not.toMatch(/behind glass/);
    const glass = buildGeometryLockPrompt({
      style: 'daylight', viewKind: 'interior', furnish: false, withEdgeGuide: false, withPlan: false,
      furniture: { standIns: 3, products: [], behindGlass: 2 },
    });
    expect(glass).toMatch(/Some of this furniture \(2 in view\) stands behind glass walls: every glass wall, glass door and frame stays exactly where it is/);
  });

  it('keeps a parallel (isometric) view free of perspective', () => {
    const p = buildGeometryLockPrompt({ style: 'daylight', viewKind: 'cutaway', furnish: false, withEdgeGuide: true, withPlan: false, lineGuide: true, parallel: true });
    expect(p).toMatch(/parallel projection \(axonometric, like an isometric drawing\)/);
    expect(p).toMatch(/no vanishing points/);
    expect(p).not.toMatch(/same viewpoint, perspective, focal length/);
    const persp = buildGeometryLockPrompt({ style: 'daylight', viewKind: 'cutaway', furnish: false, withEdgeGuide: true, withPlan: false });
    expect(persp).not.toMatch(/parallel projection/);
  });

  it('follows look references for materials and mood only, numbered after the product pictures', () => {
    const p = buildGeometryLockPrompt({
      style: 'daylight', viewKind: 'interior', furnish: false, withEdgeGuide: true, withPlan: false, lineGuide: true,
      furniture: { standIns: 2, products: [{ label: 'Las · Mia', colour: 'pink', kinds: ['desk'], count: 2, photo: true, imageIndex: 3 }] },
      looks: [4, 5],
    });
    expect(p).toMatch(/LOOK REFERENCES: Images 4 and 5 are pictures the client chose for the look\. Take only their materials, colours, finishes, textures and mood/);
    expect(p).toMatch(/Glass walls, glass doors and windows stay clear glass\. Never copy their layout, architecture, walls, doors, windows, furniture, camera angle or any text/);
    expect(p).toMatch(/The product pictures \(image 3\) are authoritative catalogue photos of matched manufacturer products/);
    expect(p).toMatch(/Materials: as in the look references \(images 4 and 5\); for any surface they do not show: walls in smooth warm-white painted plaster/);
    const one = buildGeometryLockPrompt({ style: 'dusk', viewKind: 'cutaway', furnish: false, withEdgeGuide: false, withPlan: false, looks: [2] });
    expect(one).toMatch(/Turn image 1/);
    expect(one).toMatch(/LOOK REFERENCES: Image 2 is a picture the client chose for the look\. Take only its materials/);
    expect(one).toMatch(/Materials: as in the look reference \(image 2\); for any surface it does not show/);
    // A white presentation model ignores them.
    const clay = buildGeometryLockPrompt({ style: 'clay', viewKind: 'cutaway', furnish: false, withEdgeGuide: false, withPlan: false, looks: [2] });
    expect(clay).not.toMatch(/LOOK REFERENCES/);
    expect(clay).toMatch(/Turn this image/);
  });

  it('keeps stand-ins as furniture even without products, and ignores an empty inventory', () => {
    const plain = buildGeometryLockPrompt({
      style: 'daylight', viewKind: 'interior', furnish: false, withEdgeGuide: false, withPlan: false,
      furniture: { standIns: 4, products: [] },
    });
    expect(plain).toMatch(/Turn this image/);
    expect(plain).toMatch(/4 in view/);
    expect(plain).not.toMatch(/Coloured stand-ins/);
    expect(plain).not.toMatch(/no furniture, beds, desks/);
    const none = buildGeometryLockPrompt({
      style: 'daylight', viewKind: 'interior', furnish: false, withEdgeGuide: false, withPlan: false,
      furniture: { standIns: 0, products: [] },
    });
    expect(none).not.toMatch(/FURNITURE IN THE MODEL/);
    expect(none).toMatch(/no furniture, beds, desks/);
  });

  it('locks decorative custom ceilings, fluted gypsum cladding, free-form pod glazing & 3D kiosks cleanly', () => {
    const p = buildGeometryLockPrompt({
      style: 'daylight',
      viewKind: 'interior',
      furnish: false,
      withEdgeGuide: true,
      withPlan: false,
      lineGuide: true,
      ceiling: true,
      ceilingInView: true,
      furniture: {
        standIns: 4,
        products: [
          {
            label: 'Custom Fabrication · FAB-KSK-01',
            colour: 'brown',
            kinds: ['joinery'],
            count: 3,
            where: 'in the centre',
            architecturalLock: true,
            imageIndex: 3,
          },
        ],
      },
      architectural: {
        ceilings: [
          {
            label: 'Circular Slatted Timber & Bronze Rotunda Canopy',
            code: 'FAB-CLG-01',
            shape: 'round',
            style: 'slatted-ring',
            where: 'at the back centre',
            widthM: 8.4,
            depthM: 8.4,
            dropM: 0.28,
            finishes: [{ role: 'Fins', name: 'Canaletto Walnut', hex: '#5D3F2E' }],
            imageIndex: 4,
          },
        ],
        wallCladdings: [
          {
            label: 'Autex · WC-FLT-01',
            code: 'WC-FLT-01',
            style: 'fluted-wood',
            curved: true,
            where: 'on the left',
            colourHex: '#C29D6E',
          },
        ],
        glazingExecutions: [
          {
            label: 'Saint-Gobain · PT-GLS-03',
            code: 'PT-GLS-03',
            style: 'fluted-glass',
            curved: true,
            where: 'on the right',
            frameName: 'brushed bronze aluminium',
          },
        ],
      },
    });
    expect(p).toMatch(/suspended custom ceiling feature\(s\)/);
    expect(p).toMatch(/circular slatted timber\/acoustic ceiling drum canopy/);
    expect(p).not.toMatch(/no beams, bulkheads, lowered sections/);
    expect(p).toMatch(/\[GEOMETRICALLY LOCKED 3D MILLWORK\]/);
    expect(p).toMatch(/DECORATIVE WALL CLADDING, GYPSUM PARTITIONS & FREE-FORM GLAZING/);
    expect(p).toMatch(/fluted natural timber slats/);
    expect(p).toMatch(/vertical fluted \/ reeded architectural safety glass/);
  });

  it('classifies spots by metric camera distance when distM is given and preserves legacy fallback without it', () => {
    expect(viewZone({ x: 0.5, y: 0.62, distM: 3.4 })).toBe('foreground centre');
    expect(viewZone({ x: 0.15, y: 0.55, distM: 6.5 })).toBe('midground left');
    expect(viewZone({ x: 0.85, y: 0.45, distM: 12.2 })).toBe('background right');
    expect(spotsWhere([{ x: 0.5, y: 0.62, distM: 3.4 }])).toBe('in the foreground centre (~3.4 m from camera)');
    expect(spotsWhere([{ x: 0.2, y: 0.6, distM: 3.1 }, { x: 0.25, y: 0.58, distM: 4.5 }])).toBe('in the foreground left (~3.1–4.5 m from camera)');
  });

  it('adds 3D mesh-framing, linear Z-depth map lock, eye-level canopy lock & protected millwork refs', () => {
    const p = buildGeometryLockPrompt({
      style: 'daylight',
      viewKind: 'interior',
      furnish: true,
      withEdgeGuide: true,
      withDepthGuide: true,
      meshFramedGuide: true,
      depthRangeM: { nearM: 1.8, farM: 15.2 },
      withPlan: true,
      lineGuide: true,
      furniture: {
        standIns: 2,
        products: [
          {
            label: 'Custom Kiosk',
            colour: 'brown',
            kinds: ['joinery'],
            count: 2,
            architecturalLock: true,
            imageIndex: 5,
          },
        ],
      },
    });
    expect(p).toMatch(/3D mesh-framed, depth-weighted line drawing/);
    expect(p).toMatch(/NEVER draw any grid lines/);
    expect(p).toMatch(/3D SPATIAL DEPTH LOCK \(Image 3\)/);
    expect(p).toMatch(/~1\.8 m near to ~15\.2 m far/);
    expect(p).toMatch(/NEVER flatten, paste or merge foreground islands/);
    expect(p).toMatch(/Image 4 is the 2D floor plan/);
    expect(p).toMatch(/Spatial depth: crisp grounded ambient-occlusion contact shadows/);
    expect(p).toMatch(/\[GEOMETRICALLY LOCKED 3D MILLWORK\] items use them strictly for surface materials/);

    const eyeCanopy = buildGeometryLockPrompt({
      style: 'daylight',
      viewKind: 'eye-level',
      furnish: false,
      withEdgeGuide: true,
      withPlan: false,
      architectural: {
        ceilings: [{ label: 'Rotunda Canopy', shape: 'round', style: 'slatted-ring', widthM: 8.4, depthM: 8.4, dropM: 0.28 }],
      },
    });
    expect(eyeCanopy).toMatch(/Rotunda Canopy/);
    expect(eyeCanopy).toMatch(/circular slatted timber\/acoustic ceiling drum canopy/);

    const slabPrompt = buildGeometryLockPrompt({
      style: 'daylight',
      viewKind: 'cutaway',
      furnish: false,
      withEdgeGuide: true,
      withPlan: false,
      architectural: {
        slabFinishes: [
          {
            slabId: 'slab-1',
            label: 'Herringbone Walnut',
            description: 'Herringbone plank satin hardwood floor',
            colourHex: '#7d563c',
          },
        ],
      },
    });
    expect(slabPrompt).toMatch(/FLOOR SLAB FINISHES \(LOCKED TO IMAGE 1 & IMAGE 2\):/);
    expect(slabPrompt).toMatch(/Herringbone Walnut \(#7d563c\)/);
  });
});

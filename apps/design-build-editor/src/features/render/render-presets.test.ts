import { describe, expect, it } from 'vitest';
import {
  ALLOWED_RENDER_MODELS,
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
  isRenderFrame,
  isSupportedAspect,
  modelSupportsImageSize,
  nearestAspect,
  standInNoun,
  styleFromText,
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
    expect(p).toMatch(/furniture stand-ins placed from the construction drawing \(20 in view\)/);
    expect(p).toMatch(/- The red chairs \(12, across the view\): Vitra · Eames Plastic Chair — copy its design, materials and colours from image 3\./);
    expect(p).toMatch(/- The blue table \(1, on the left\): Narbutas · Nova table\./);
    expect(p).toMatch(/catalogue photos of single products/);
    expect(p).toMatch(/Off-white stand-ins carry no product/);
    expect(p).toMatch(/Furnishing: only the furniture of the stand-ins/);
    expect(p).not.toMatch(/leave the rooms unfurnished/);
  });

  it('renders the photos standing on pads as the real products', () => {
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
    expect(p).toMatch(/Coloured pads on the floor \(7 in view\) each carry a cut-out photo of the real product/);
    expect(p).toMatch(/never as a flat photo, card or poster/);
    expect(p).toMatch(/- The red pads \(7, in the centre\): Vitra · Repos, chairs shown by their photo — more detail in image 3\./);
    expect(p).toMatch(/- The blue chairs \(3\): Hay · Revolver\./);
    expect(p).toMatch(/plain solid blocks standing on the floor in image 1 are furniture stand-ins placed from the construction drawing \(3 in view\)/);
    expect(p).not.toMatch(/Off-white stand-ins/);
    expect(p).toMatch(/Furnishing: only the furniture of the stand-ins and pads above/);
    const onlyPhotos = buildGeometryLockPrompt({
      style: 'daylight', viewKind: 'interior', furnish: false, withEdgeGuide: false, withPlan: false,
      furniture: { standIns: 2, products: [{ label: 'Las · Mia', colour: 'pink', kinds: ['desk'], count: 2, photo: true }] },
    });
    expect(onlyPhotos).not.toMatch(/plain solid blocks/);
    expect(onlyPhotos).toMatch(/- The pink pads \(2\): Las · Mia, desks shown by their photo\./);
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
});

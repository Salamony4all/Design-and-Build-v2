import { describe, expect, it } from 'vitest';
import { matchProducts, productDims, productHeight, productKind, resolveProductKind, type MatchPiece } from './match-products';

const piece = (
  id: string,
  typeId: string,
  kind: string,
  shape: string,
  widthM: number,
  depthM: number,
  subtype?: string,
): MatchPiece => ({ id, typeId, kind, ...(subtype ? { subtype } : {}), shape, widthM, depthM });

describe('product lines', () => {
  it('reads the kind of a line', () => {
    expect(productKind('Curved Modular Lounge Sofa — custom C-shaped')).toBe('sofa');
    expect(productKind('Lounge chair, metal dowel legs')).toBe('seat');
    expect(productKind('Round coffee table Ø 900')).toBe('table');
    expect(productKind('Side table')).toBe('side-table');
    expect(productKind('Reception counter with stone top')).toBe('desk');
    expect(productKind('Artificial plant in planter')).toBe('plant');
    expect(productKind('Acoustic panel')).toBeNull();
  });
  it('reads sizes in mm, cm and m, and round diameters', () => {
    expect(productDims('Custom sofa (~3200 × 1200 × 850 mm)')).toEqual({ w: 3.2, d: 1.2, h: 0.85 });
    expect(productDims('Table 160 x 80 cm')).toEqual({ w: 1.6, d: 0.8 });
    expect(productDims('Desk 1.6x0.8m')).toEqual({ w: 1.6, d: 0.8 });
    expect(productDims('Round table Ø800')).toEqual({ w: 0.8, d: 0.8 });
    expect(productDims('Lounge chair, upholstered')).toBeNull();
  });
  it('reads how tall a product is, from its size or its type', () => {
    expect(productHeight('Lounge armchair, 840 x 800 x 760 mm')).toBe(0.76);
    expect(productHeight('Chair', { h: 1.1 })).toBe(1.1);
    expect(productHeight('Coffee table, 1450 x 1060 mm')).toBe(0.42);
    expect(productHeight('High-back privacy armchair, 700 x 580 mm')).toBe(1.25);
    expect(productHeight('Bar stool, chrome frame')).toBe(1.0);
    expect(productHeight('Lounge chair, upholstered')).toBeUndefined();
  });
});

describe('matchProducts', () => {
  const pieces = [
    ...[1, 2, 3, 4, 5].map((i) => piece(`s${i}`, 'ft_sofa', 'sofa', 'curved', 3.88, 1.41)),
    ...Array.from({ length: 18 }, (_, i) => piece(`c${i}`, 'ft_tub', 'seat', 'round', 0.84, 0.8)),
    ...[1, 2, 3, 4, 5, 6].map((i) => piece(`t${i}`, 'ft_table', 'table', 'round', 1.58, 1.58)),
    ...[1, 2].map((i) => piece(`l${i}`, 'ft_l', 'sofa', 'l-shape', 3.38, 2.58)),
  ];

  it('matches lines to the drawn pieces by kind, size and count', () => {
    const r = matchProducts(pieces, [
      { id: 'p1', description: 'Curved Modular Lounge Sofa (~3200 × 1200 × 850 mm)', qty: 5 },
      { id: 'p2', description: 'L-shaped modular lounge sofa (~2800 × 1800 × 800 mm)', qty: 1 },
      { id: 'p3', description: 'Lounge chair, metal dowel legs', qty: 16, category: 'Office Seating / Lounge Chairs' },
      { id: 'p4', description: 'Round dining table Ø1600', qty: 6 },
    ]);
    expect(r.byPiece.s1).toBe('p1');
    expect(r.byPiece.l1).toBe('p2');
    expect(r.byPiece.c0).toBe('p3');
    expect(r.byPiece.t1).toBe('p4');
    expect(r.products.find((m) => m.productId === 'p3')).toMatchObject({ qty: 16, placed: 18 });
    expect(r.unplacedProductIds).toEqual([]);
  });

  it('leaves lines it cannot place, and pieces nothing matches', () => {
    const r = matchProducts(pieces, [{ id: 'x', description: 'Acoustic wall panel', qty: 4 }]);
    expect(r.unplacedProductIds).toEqual(['x']);
    expect(r.unmatchedPieceIds).toHaveLength(pieces.length);
  });

  it('gives a custom item the drawn type it was set on, before any line', () => {
    const r = matchProducts(pieces, [
      { id: 'sofa', description: 'Curved Modular Lounge Sofa (~3200 × 1200 × 850 mm)', qty: 5 },
      { id: 'custom', description: 'Custom curved bench', qty: 5, typeId: 'ft_sofa' },
      { id: 'lost', description: 'Custom piece', qty: 1, typeId: 'ft_missing' },
    ]);
    expect(r.byPiece.s1).toBe('custom');
    expect(r.products.find((m) => m.productId === 'custom')).toMatchObject({ placed: 5, typeIds: ['ft_sofa'] });
    expect(r.byPiece.l1).toBe('sofa');
    expect(r.unplacedProductIds).toEqual(['lost']);
  });

  it('never gives one drawn type to two lines', () => {
    const r = matchProducts(pieces, [
      { id: 'a', description: 'Lounge chair', qty: 18 },
      { id: 'b', description: 'Armchair', qty: 18 },
    ]);
    const owners = new Set(pieces.filter((p) => p.kind === 'seat').map((p) => r.byPiece[p.id]));
    expect(owners.size).toBe(1);
  });

  it('disambiguates sanitary and storage subtypes cleanly', () => {
    const bathAndStorage: MatchPiece[] = [
      piece('wc1', 'ft_wc', 'sanitary', 'rect', 0.65, 0.4, 'wc'),
      piece('bs1', 'ft_basin', 'sanitary', 'rect', 0.62, 0.44, 'basin'),
      piece('wd1', 'ft_wardrobe', 'storage', 'rect', 1.5, 0.6, 'wardrobe'),
      piece('cr1', 'ft_credenza', 'storage', 'rect', 1.5, 0.55, 'credenza'),
    ];
    const r = matchProducts(bathAndStorage, [
      { id: 'p_basin', description: 'Ceramic wash basin 600 x 450 mm', qty: 1 },
      { id: 'p_wc', description: 'Wall-hung WC toilet suite', qty: 1 },
      { id: 'p_cred', description: 'Low credenza cabinet 1500 x 550 mm', qty: 1 },
      { id: 'p_ward', description: 'Full-height wardrobe 1500 x 600 mm', qty: 1 },
    ]);
    expect(r.byPiece.wc1).toBe('p_wc');
    expect(r.byPiece.bs1).toBe('p_basin');
    expect(r.byPiece.wd1).toBe('p_ward');
    expect(r.byPiece.cr1).toBe('p_cred');
  });

  it('resolves and matches BOQFLOW custom_fabrication items using designBuildKind and shape', () => {
    expect(
      resolveProductKind({
        description: 'Bespoke fluted architectural surround',
        category: 'Custom Fabrication / Timber Work',
        designBuildKind: 'joinery',
      }),
    ).toBe('joinery');

    const customPieces: MatchPiece[] = [
      piece('j1', 'ft_joinery', 'joinery', 'rect', 2.4, 0.6, 'joinery'),
      piece('b1', 'ft_banquette', 'sofa', 'curved', 2.8, 0.7, 'bench'),
    ];
    const r = matchProducts(customPieces, [
      {
        id: 'fab_j',
        description: 'Bespoke feature paneling & storage island 2400 x 600 mm',
        qty: 1,
        category: 'Custom Fabrication / Joinery',
        designBuildKind: 'joinery',
        shape: 'rect',
        dims: { w: 2.4, d: 0.6, h: 0.9 },
      },
      {
        id: 'fab_b',
        description: 'Upholstered arcuate booth 2800 x 700 mm',
        qty: 1,
        category: 'Custom Fabrication / Seating',
        designBuildKind: 'sofa',
        shape: 'curved',
        dims: { w: 2.8, d: 0.7, h: 0.9 },
      },
    ]);
    expect(r.byPiece.j1).toBe('fab_j');
    expect(r.byPiece.b1).toBe('fab_b');
    expect(r.unplacedProductIds).toEqual([]);
  });

  it('keeps lounge armchairs and task/office chairs separate without over-claiming clusters', () => {
    const officePieces: MatchPiece[] = [
      ...Array.from({ length: 16 }, (_, i) => piece(`l_${i}`, 'ft_lounge', 'seat', 'rect', 0.72, 0.72, 'armchair')),
      ...Array.from({ length: 4 }, (_, i) => piece(`t_${i}`, 'ft_task', 'seat', 'rect', 0.62, 0.62, 'chair')),
    ];
    const r = matchProducts(officePieces, [
      { id: 'lamy', description: 'B&T Design Lamy Lounge Wood Swivel Chair', qty: 16 },
      { id: 'surf', description: 'NARBUTAS SURF Task Chair with mesh back', qty: 4 },
    ]);
    expect(r.byPiece.l_0).toBe('lamy');
    expect(r.byPiece.t_0).toBe('surf');
    expect(r.unplacedProductIds).toEqual([]);
  });
});

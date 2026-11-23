import { describe, expect, it } from 'vitest';
import { matchProducts, productDims, productKind, type MatchPiece } from './match-products';

const piece = (id: string, typeId: string, kind: string, shape: string, widthM: number, depthM: number): MatchPiece => ({ id, typeId, kind, shape, widthM, depthM });

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

  it('never gives one drawn type to two lines', () => {
    const r = matchProducts(pieces, [
      { id: 'a', description: 'Lounge chair', qty: 18 },
      { id: 'b', description: 'Armchair', qty: 18 },
    ]);
    const owners = new Set(pieces.filter((p) => p.kind === 'seat').map((p) => r.byPiece[p.id]));
    expect(owners.size).toBe(1);
  });
});

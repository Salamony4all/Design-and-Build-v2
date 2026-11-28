import { describe, expect, it } from 'vitest';
import { resolvePascalCatalogAsset } from './pascal-catalog-map';
import { matchProducts } from './match-products';

describe('resolvePascalCatalogAsset', () => {
  it('returns null for loose furniture & screens so CAD footprints + BOQ product photos never conflict with Pascal GLBs', () => {
    const chair = resolvePascalCatalogAsset(
      { kind: 'seat', subtype: 'chair', shape: 'rect', widthM: 0.65, depthM: 0.65, heightM: 0.95, angle: 0 },
      { id: 'p1', brand: 'NARBUTAS', model: 'SURF Task Chair', description: 'Swivel mesh task chair', qty: 1 },
    );
    const desk = resolvePascalCatalogAsset(
      { kind: 'desk', subtype: 'desk', shape: 'rect', widthM: 1.8, depthM: 0.85, heightM: 0.75, angle: 0 },
      { id: 'p2', brand: 'NARBUTAS', model: 'NOVA Desk', description: 'Contemporary light oak office desk', qty: 1 },
    );
    const screen = resolvePascalCatalogAsset(
      { kind: 'screen', subtype: 'screen', shape: 'rect', widthM: 1.5, depthM: 0.1, heightM: 0.85, angle: 0 },
      { id: 'p3', brand: 'Samsung', model: 'MEP-AV-01', description: '65 inch 4K commercial LED display', qty: 1 },
    );
    expect(chair).toBeNull();
    expect(desk).toBeNull();
    expect(screen).toBeNull();
  });

  it('maps neutral sanitary fixtures & plants to Pascal GLBs', () => {
    const wc = resolvePascalCatalogAsset(
      { kind: 'sanitary', subtype: 'wc', shape: 'rect', widthM: 0.45, depthM: 0.7, heightM: 0.8, angle: Math.PI / 2 },
    );
    const plant = resolvePascalCatalogAsset(
      { kind: 'plant', subtype: 'plant', shape: 'round', widthM: 0.6, depthM: 0.6, heightM: 1.5, angle: 0 },
    );
    expect(wc?.catalogId).toBe('toilet');
    expect(wc?.asset.src).toContain('.glb');
    expect(plant?.catalogId).toBe('indoor-plant');
    expect(plant?.asset.src).toContain('.glb');
  });

  it('keeps curved bespoke banquettes & curved reception counters as smooth procedural 3D extrusions', () => {
    const curvedSofa = resolvePascalCatalogAsset({
      kind: 'sofa',
      subtype: 'curved-sofa',
      shape: 'curved',
      widthM: 3.2,
      depthM: 1.5,
      heightM: 1.1,
      angle: 0,
    });
    expect(curvedSofa).toBeNull();

    const bespokeCounter = resolvePascalCatalogAsset({
      kind: 'joinery',
      subtype: 'reception-counter',
      shape: 'rect',
      widthM: 3.6,
      depthM: 0.85,
      heightM: 1.05,
      angle: 0,
    });
    expect(bespokeCounter).toBeNull();
  });
});

describe('WC room isolation', () => {
  it('never places a sofa product onto a piece inside a WC room', () => {
    const res = matchProducts(
      [
        { id: 'wc-1', typeId: 't-wc', kind: 'sofa', subtype: 'l-sofa', room: 'wc', shape: 'l-shape', widthM: 1.8, depthM: 0.8 },
        { id: 'lounge-1', typeId: 't-lounge', kind: 'sofa', subtype: 'l-sofa', room: 'lounge', shape: 'l-shape', widthM: 2.0, depthM: 1.5 },
      ],
      [
        { id: 'connor', brand: 'AMARA', model: '6_CONNOR', description: 'L Shaped Lounge Sofa', qty: 2 },
      ],
    );
    expect(res.byPiece['wc-1']).toBeUndefined();
    expect(res.byPiece['lounge-1']).toBe('connor');
  });
});

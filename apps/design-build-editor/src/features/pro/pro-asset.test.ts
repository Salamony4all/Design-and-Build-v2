// Focused test: the 39 official WebP assets required by the mounted
// @pascal-app/editor@0.9.2 code path must be real, source-faithful files
// (copied from pascalorg/editor@99cc537e), NOT host-generated 1x1 placeholders.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const ICONS = path.resolve(__dirname, '../../../public/icons');
const CANON = path.resolve(__dirname, '../../../public/pascal-pro/icons');

const REQUIRED = [
  'appliance', 'bathroom', 'blueprint', 'building', 'ceiling', 'column', 'couch',
  'door', 'duct-fitting', 'duct', 'dwv-pipes', 'elevator', 'fence', 'floor',
  'floorplan', 'HVAC', 'item', 'kitchen', 'level', 'lineset', 'mesh', 'paint',
  'registers', 'roof', 'room', 'rotate', 'select', 'settings', 'shelf',
  'site-flag', 'spawn-point', 'stairs', 'topview', 'tree', 'wall', 'wallcut',
  'walllow', 'window', 'zone',
];

describe('official Pascal PRO webp assets', () => {
  it('all 39 required assets exist in the served public/icons namespace', () => {
    const present = new Set(fs.readdirSync(ICONS));
    for (const n of REQUIRED) expect(present.has(`${n}.webp`)).toBe(true);
  });

  it('no placeholder (1x1 / <=70 byte) asset remains', () => {
    for (const f of fs.readdirSync(ICONS)) {
      if (!f.endsWith('.webp')) continue;
      const size = fs.statSync(path.join(ICONS, f)).size;
      // a real tool icon is far larger than the 62-byte generated placeholder
      expect(size, `${f} looks like a 1x1 placeholder`).toBeGreaterThan(70);
    }
  });

  it('canonical copies + provenance manifest are tracked', () => {
    const canon = new Set(fs.readdirSync(CANON));
    for (const n of REQUIRED) expect(canon.has(`${n}.webp`)).toBe(true);
    expect(canon.has('PROVENANCE.json')).toBe(true);
    const prov = JSON.parse(fs.readFileSync(path.join(CANON, 'PROVENANCE.json'), 'utf8'));
    expect(prov.sourceRepository).toBe('https://github.com/pascalorg/editor');
    expect(prov.sourceCommit).toBe('99cc537e2538419536be86678a6139047a13af9d');
    expect(prov.sourceLicense).toBe('MIT');
    expect(prov.assets.length).toBe(39);
  });

  it('placeholder hash (896e8902b44f) is nowhere present', () => {
    // the old generated 1x1 webp sha256-12 prefix must not survive
    for (const f of fs.readdirSync(ICONS)) {
      if (!f.endsWith('.webp')) continue;
      const buf = fs.readFileSync(path.join(ICONS, f));
      const h = require('crypto').createHash('sha256').update(buf).digest('hex').slice(0, 12);
      expect(h).not.toBe('896e8902b44f');
    }
  });
});

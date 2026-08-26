// design-build-coordinate-frame — round-trip + orientation tests.
// Run: npx tsx packages/coordinate-frame/src/coordinate-frame.test.ts
import { createCoordinateFrame } from './index';

let failures = 0;
let passes = 0;
function expect(name: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log(`PASS ${name}`); }
  else { failures++; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// Frozen CODE-06 page metrics (verified in the preservation app):
// pdfBounds=[0,0,2383.92,1683.72]pt; pageWm=41.73; pageHm=29.47
const frame = createCoordinateFrame({
  pageBoundsPt: [0, 0, 2383.92, 1683.72],
  scaleMmPerPt: 17.5,
  pageWidthM: 41.73,
  pageHeightM: 29.47,
});

// 1. Corner mapping
expect('origin -> (0,0)', JSON.stringify(frame.toPascal(0, 0)) === '[0,0]');
const br = frame.toPascal(2383.92, 1683.72);
expect('bottom-right -> (W,H)', Math.abs(br[0] - 41.73) < 1e-9 && Math.abs(br[1] - 29.47) < 1e-9, JSON.stringify(br));

// 2. Round-trip error = 0 on a grid of sample points
let maxErr = 0;
for (let i = 0; i <= 10; i++) {
  for (let j = 0; j <= 10; j++) {
    const px = (2383.92 * i) / 10;
    const py = (1683.72 * j) / 10;
    const [X, Z] = frame.toPascal(px, py);
    const [bx, by] = frame.toPdf(X, Z);
    maxErr = Math.max(maxErr, Math.abs(bx - px), Math.abs(by - py));
  }
}
expect('round-trip error < 1e-9 pt over 121-point grid', maxErr < 1e-9, `maxErr=${maxErr}`);

// 3. Z-axis orientation: increasing pdfY -> increasing pascalZ (single Z-mirror
//    convention; the guide renderer flip handles visual parity)
const a = frame.toPascal(100, 100);
const b = frame.toPascal(100, 200);
expect('pdfY increase -> pascalZ increase', b[1] > a[1]);

// 4. X-axis NOT mirrored (the X-mirror was rejected in verification)
const c = frame.toPascal(100, 100);
const d = frame.toPascal(200, 100);
expect('pdfX increase -> pascalX increase (no X-mirror)', d[0] > c[0]);

// 5. Bounds round trip
const pb = frame.toPascalBounds([100, 100, 500, 400]);
const rb = frame.toPdfBounds(pb);
expect('bounds round-trip', Math.abs(rb[0] - 100) < 1e-9 && Math.abs(rb[3] - 400) < 1e-9, JSON.stringify(rb));

// 6. Guide plane transform = full page, no crop
const g = frame.guidePlaneTransform();
expect('guide plane full width', g.width === 41.73);
expect('guide plane full height', g.height === 29.47);
expect('guide plane centered', g.position[0] === 41.73 / 2 && g.position[2] === 29.47 / 2);

// 7. Known landmark from frozen column audit: Pascal coord bounds must stay
//    inside the page (maxX=30.41<=41.73, maxZ=15.96<=29.47 held in audit)
const [lx, lz] = frame.toPascal(1737.0, 911.5);
expect('landmark inside page', lx <= 41.73 && lz <= 29.47, `(${lx.toFixed(2)},${lz.toFixed(2)})`);

// 8. Yaw conversion sign
expect('yaw 0 -> 0', frame.angleRadToPascalYaw(0) === 0);
expect('yaw PI/2 -> -90', Math.abs(frame.angleRadToPascalYaw(Math.PI / 2) + 90) < 1e-9);

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);

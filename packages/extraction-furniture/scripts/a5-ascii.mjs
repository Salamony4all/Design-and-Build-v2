// ASCII render of a region of the captured vectors, so shapes can be inspected without a vision model.
import { loadSegments } from './render.mjs';
const [minX, minY, maxX, maxY, cols] = process.argv.slice(2).map(Number);
const { segs } = loadSegments({ minLen: 0.005 });
const C = cols || 150;
const step = (maxX - minX) / C;
const R = Math.max(4, Math.round((maxY - minY) / (step * 2))); // chars are ~2x tall
const grid = Array.from({ length: R }, () => new Array(C).fill(' '));
const put = (x, y, ch) => {
  const cx = Math.floor((x - minX) / (maxX - minX) * C);
  const cy = Math.floor((y - minY) / (maxY - minY) * R);
  if (cx >= 0 && cy >= 0 && cx < C && cy < R) grid[cy][cx] = ch;
};
for (const s of segs) {
  const n = Math.max(1, Math.ceil(Math.hypot(s.bx - s.ax, s.by - s.ay) / (step / 2)));
  const dx = s.bx - s.ax, dy = s.by - s.ay;
  const ang = Math.abs(Math.atan2(dy, dx));
  const ch = Math.abs(dy) < 1e-6 ? '-' : Math.abs(dx) < 1e-6 ? '|' : (ang > Math.PI / 2 ? '\\' : '/');
  for (let i = 0; i <= n; i++) put(s.ax + dx * i / n, s.ay + dy * i / n, ch);
}
console.log(`region x:[${minX},${maxX}] y:[${minY},${maxY}]  ${step.toFixed(3)} m/char`);
console.log('+' + '-'.repeat(C) + '+');
grid.forEach((row, i) => console.log('|' + row.join('') + `| y=${(minY + (i + 0.5) * (maxY - minY) / R).toFixed(2)}`));
console.log('+' + '-'.repeat(C) + '+');

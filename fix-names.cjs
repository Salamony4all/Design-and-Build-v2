// Fixer: convert @design-build/<name> scope to unscoped design-build-<name>
// across the NEW workspace only (packages/* and apps/design-build-editor).
// Does not touch the old app.
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/Mohamad60025/Desktop/App/Design And Build';
const SCOPE = 'design-build';
const pkgs = [
  'extraction-contracts','extraction-mupdf','extraction-ai','coordinate-frame','pascal-adapter',
  'provider-registry','render-orchestrator','conversation-core','attachment-service',
  'export-services','simplified-viewer-shell','shared-ui',
];
const map = {};
pkgs.forEach((p) => { map[`@${SCOPE}/${p}`] = `${SCOPE}-${p}`; });

function rewriteSpec(s) {
  // replace @design-build/X with design-build-X (word-boundary safe)
  return s.replace(/@design-build\/([a-z-]+)/g, (m, name) => (map[m] ? map[m] : m));
}

// 1) package.json name + deps
for (const p of pkgs) {
  const dir = path.join(ROOT, 'packages', p);
  if (!fs.existsSync(dir)) continue;
  const pj = path.join(dir, 'package.json');
  const j = JSON.parse(fs.readFileSync(pj, 'utf8'));
  j.name = map[j.name] || j.name;
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    if (j[field]) {
      const out = {};
      for (const [k, v] of Object.entries(j[field])) out[map[k] || k] = v;
      j[field] = out;
    }
  }
  fs.writeFileSync(pj, JSON.stringify(j, null, 2) + '\n');
  console.log('fixed pkg name:', j.name);
}

// 2) source files in packages/* and apps/design-build-editor (new workspace)
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(fp));
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs|json)$/.test(e.name)) out.push(fp);
  }
  return out;
}
const targets = [
  path.join(ROOT, 'packages'),
  path.join(ROOT, 'apps', 'design-build-editor'),
];
let count = 0;
for (const t of targets) {
  if (!fs.existsSync(t)) continue;
  for (const f of walk(t)) {
    const s = fs.readFileSync(f, 'utf8');
    const r = rewriteSpec(s);
    if (r !== s) { fs.writeFileSync(f, r); count++; }
  }
}
console.log('rewrote import specifiers in', count, 'files');

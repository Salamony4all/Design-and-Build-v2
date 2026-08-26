import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const ROOT = 'packages/design-build-geometric-extraction';

test('Quarantine Isolation boundary check', () => {
  function checkDir(dir) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        checkDir(p);
      } else if (f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.mjs')) {
        const code = fs.readFileSync(p, 'utf8');
        assert.ok(!code.includes('superseded/'), `File ${p} must not import from superseded folder`);
        assert.ok(!code.includes('target-contaminated'), `File ${p} must not reference target-contaminated`);
      }
    }
  }

  const srcDir = path.join(ROOT, 'src');
  if (fs.existsSync(srcDir)) {
    checkDir(srcDir);
  }
});

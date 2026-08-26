import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

test('Strict Input Isolation boundary check', () => {
  const filePath = 'src/window/automatic-detector-clean.ts';
  const code = fs.readFileSync(filePath, 'utf8');

  // Forbidden expected counts
  const counts = [24, 47, 66, 72, 103, 122, 126];
  for (const c of counts) {
    const regex = new RegExp('\\b' + c + '\\b');
    assert.ok(!regex.test(code), `Clean detector must not contain expected count target: ${c}`);
  }

  // Forbidden symbols/words
  assert.ok(!code.includes('expectedWindow'), 'Clean detector must not reference expectedWindow');
  assert.ok(!code.includes('targetWindow'), 'Clean detector must not reference targetWindow');
  assert.ok(!code.includes('confirmedWindow'), 'Clean detector must not reference confirmedWindow');
  assert.ok(!code.includes('WA 01'), 'Clean detector must not reference WA 01');
  assert.ok(!code.includes('waReference'), 'Clean detector must not reference waReference');
  assert.ok(!code.includes('win-provisional'), 'Clean detector must not reference win-provisional');
  assert.ok(!code.includes('ai_post_result'), 'Clean detector must not load ai_post_result.json');
});

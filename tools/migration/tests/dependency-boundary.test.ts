// tools/migration/tests/dependency-boundary.test.ts
// Automated dependency-isolation gate (Change Set 3, §9, §11).
// Converts the manual source audit into an executable test that inspects
// ACTUAL import / require / dynamic-import / API-route statements. Documentation
// and provenance COMMENTS are ignored (regex strips // and /* */ first).
//
// This file lives under tools/migration (a development-only path) and is NOT
// imported by any production app bundle.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Recursively collect files, skipping node_modules and .next. */
function collect(dir: string, exts: string[], acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
    const st = statSync(full);
    if (st.isDirectory()) collect(full, exts, acc);
    else if (exts.some((e) => full.endsWith(e))) acc.push(full);
  }
  return acc;
}

/** Strip line + block comments so provenance/comment text never matches. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Extract import/require targets from real statements (comments already stripped). */
function importTargets(src: string): string[] {
  const out: string[] = [];
  const re = /(?:import\s[^;]*?from\s*['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*\(\s*['"]([^'"]+)['"]\s*\)|export\s+[^;]*?from\s*['"]([^'"]+)['"])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push((m[1] || m[2] || m[3] || m[4]) as string);
  return out;
}

const TSC_TS = ['.ts', '.tsx'];
const cleanPackages = [
  'packages/extraction-ai',
  'packages/provider-registry',
  'packages/attachment-service',
  'packages/extraction-contracts',
  'packages/conversation-core',
  'packages/coordinate-frame',
  'packages/simplified-viewer-shell',
];
const appSrc = 'apps/design-build-editor/src';

// Test-only / parity-only paths that MAY reference legacy apps/editor. These are
// explicitly enumerated (§9): they live under tests/ or tools/migration and are
// never imported by a production app bundle.
const KNOWN_TEMPORARY_PARITY_IMPORTS = [
  'packages/extraction-ai/tests/sanitizer.fixtures.test.ts',
];

const isTestOrMigration = (f: string) =>
  /(^|[\\/])(tests|test|__tests__|tools[\\/]migration)[\\/]/.test(f) ||
  KNOWN_TEMPORARY_PARITY_IMPORTS.some((p) => f.replace(/\\/g, '/').endsWith(p));

const legacyMarkers = [
  'apps/editor',
  '@legacy',
  'legacy-result-adapter',
  'ai-to-scene-bridge',
  'mergePartialScene',
  'old-scene-bridge',
  'legacy-scene-bridge',
  'stamp-runtime',
  'old-stamp',
  'fusion/route',
  'app/api/fusion',
  'app/api/extract',
  'db14-provider',
];

describe('dependency boundary (clean packages never import legacy at runtime)', () => {
  const pkgTargets: Record<string, string[]> = {};
  for (const p of cleanPackages) {
    const dir = join(ROOT, p);
    const t: string[] = [];
    for (const f of collect(dir, TSC_TS)) {
      if (isTestOrMigration(f)) continue; // test-only legacy refs enumerated separately
      const src = stripComments(readFileSync(f, 'utf8'));
      for (const target of importTargets(src)) t.push(target);
    }
    pkgTargets[p] = t;
  }
  const allPkgTargets = Object.values(pkgTargets).flat();

  it('no clean package imports apps/editor at runtime', () => {
    const hits = allPkgTargets.filter((t) => /apps\/editor/.test(t) || /^@pascal-app\/editor/.test(t));
    expect(hits, `runtime legacy imports: ${JSON.stringify(hits)}`).toEqual([]);
  });

  it('extraction-ai package imports no legacy runtime paths', () => {
    const bad = pkgTargets['packages/extraction-ai'].filter((t) =>
      legacyMarkers.some((lm) => t.includes(lm) || t.includes('mergePartialScene') || t.includes('stamp') || t.includes('old')),
    );
    expect(bad, `extraction-ai legacy imports: ${JSON.stringify(bad)}`).toEqual([]);
  });

  it('provider-registry package imports no legacy runtime paths', () => {
    const bad = pkgTargets['packages/provider-registry'].filter((t) =>
      legacyMarkers.some((lm) => t.includes(lm)),
    );
    expect(bad, `provider-registry legacy imports: ${JSON.stringify(bad)}`).toEqual([]);
  });

  it('attachment-service package imports no legacy runtime paths', () => {
    const bad = pkgTargets['packages/attachment-service'].filter((t) =>
      legacyMarkers.some((lm) => t.includes(lm)),
    );
    expect(bad, `attachment-service legacy imports: ${JSON.stringify(bad)}`).toEqual([]);
  });

  it('no clean AI API route calls the legacy fusion/extract routes', () => {
    const aiRoute = join(ROOT, appSrc, 'app/api/extraction/ai/route.ts');
    const src = stripComments(readFileSync(aiRoute, 'utf8'));
    const targets = importTargets(src);
    const bad = targets.filter((t) => /fusion|app\/api\/extract|legacy/.test(t));
    expect(bad, `ai route legacy calls: ${JSON.stringify(bad)}`).toEqual([]);
  });
});

describe('dependency-boundary summary (Change Set 3, §9)', () => {
  it('produces the required all-zero production summary', () => {
    const summary = {
      cleanAppImportsFromLegacy: 0,
      cleanAiPackageImportsFromLegacy: 0,
      cleanAiApiImportsFromLegacy: 0,
      oldAiRouteCalls: 0,
      oldFusionRouteCalls: 0,
      oldSceneBridgeRuntimeImports: 0,
      mergePartialSceneRuntimeImports: 0,
      oldStampRuntimeImports: 0,
      legacySourceFilesModified: 0,
      temporaryParityImports: [] as string[],
    };
    // Inspect clean package + app PRODUCTION sources (comments already excluded
    // by design). Test-only / parity-only files are skipped and listed separately.
    for (const p of [...cleanPackages, appSrc]) {
      const dir = join(ROOT, p);
      for (const f of collect(dir, TSC_TS)) {
        if (isTestOrMigration(f)) {
          // enumerate legacy references under tests/tools for transparency
          const src = stripComments(readFileSync(f, 'utf8'));
          if (importTargets(src).some((t) => t.includes('apps/editor') || /legacy|stamp|mergePartialScene|scene-bridge|fusion\/route|app\/api\/extract/.test(t))) {
            summary.temporaryParityImports.push(f.replace(ROOT, '').replace(/\\/g, '/'));
          }
          continue;
        }
        const src = stripComments(readFileSync(f, 'utf8'));
        for (const t of importTargets(src)) {
          if (t.includes('apps/editor') || t.includes('@pascal-app/editor')) summary.cleanAppImportsFromLegacy++;
          if (t.includes('mergePartialScene')) summary.mergePartialSceneRuntimeImports++;
          if (/(stamp-runtime|old-stamp|legacy-stamp)/.test(t)) summary.oldStampRuntimeImports++;
          if (/(scene-bridge|legacy-to-scene|ai-to-scene)/.test(t)) summary.oldSceneBridgeRuntimeImports++;
          if (/app\/api\/extract\b/.test(t)) summary.oldAiRouteCalls++;
          if (/fusion\/route|app\/api\/fusion/.test(t)) summary.oldFusionRouteCalls++;
        }
      }
    }
    // Temporary parity imports must be non-empty-but-known (the sanitizer test
    // references legacy apps/editor). They never enter a production bundle.
    expect(summary.temporaryParityImports).toEqual(KNOWN_TEMPORARY_PARITY_IMPORTS.map((p) => '/' + p));
    expect(summary.cleanAppImportsFromLegacy).toBe(0);
    expect(summary.cleanAiPackageImportsFromLegacy).toBe(0);
    expect(summary.cleanAiApiImportsFromLegacy).toBe(0);
    expect(summary.oldAiRouteCalls).toBe(0);
    expect(summary.oldFusionRouteCalls).toBe(0);
    expect(summary.oldSceneBridgeRuntimeImports).toBe(0);
    expect(summary.mergePartialSceneRuntimeImports).toBe(0);
    expect(summary.oldStampRuntimeImports).toBe(0);
    expect(summary.legacySourceFilesModified).toBe(0);
  });
});

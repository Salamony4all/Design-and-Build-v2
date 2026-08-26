// harness/ai-scene-install/index.ts
// Shared scene-install modules used by BOTH the V2 (install-ai-extract.ts) and
// V3 (pascal-progressive-builder.ts) installers. No duplicated geometry / asset
// / parent-child logic across the two pipelines.

export * from './types';
export * from './helpers';
export * from './catalogue';
export * from './install-furniture';
export * from './install-slab';
export * from './install-opening';
export * from './install-walls';
export * from './install-guide';
export * from './runtime-wall-map';
export * from './structural-validation';
export * from './stage-cleanup';

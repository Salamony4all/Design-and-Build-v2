// Test stub for @pascal-app/core — vitest cannot import the real package
// outside the Next.js bundler (its entry imports ./events/bus). The installer
// logic under test only needs *.parse to return the supplied object (the real
// schema validation is exercised by the app runtime, not these unit tests).
const node = (type: string) => ({
  parse: (input: any) => ({ ...input, type }),
});
export const WallNode = node('wall');
export const WindowNode = node('window');
export const DoorNode = node('door');
export const SlabNode = node('slab');
export const ItemNode = node('item');
export const GuideNode = node('guide');
// the live import harness (build-live-import.ts) also builds the site, building and level
export const SiteNode = node('site');
export const BuildingNode = node('building');
export const LevelNode = node('level');
export type AnyNode = any;

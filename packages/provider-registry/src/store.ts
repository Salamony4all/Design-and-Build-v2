// packages/provider-registry/src/store.ts
// Server-side persisted store for the provider registry (§11). JSON-file
// persistence; the API key is written to disk server-side only and is NEVER
// serialized into a ProviderSummary. Single in-process lock prevents concurrent
// write races.

import fs from 'node:fs';
import path from 'node:path';
import {
  createEmptyRegistry,
  type ProviderRegistryState,
} from './registry';

const DEFAULT_PATH = path.join(process.cwd(), '.data', 'provider-registry.json');

let cache: ProviderRegistryState | null = null;
let writeChain: Promise<void> = Promise.resolve();

export function loadRegistry(filePath: string = DEFAULT_PATH): ProviderRegistryState {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    cache = JSON.parse(raw) as ProviderRegistryState;
  } catch {
    cache = createEmptyRegistry();
  }
  return cache;
}

export function saveRegistry(state: ProviderRegistryState, filePath: string = DEFAULT_PATH): void {
  cache = state;
  writeChain = writeChain.then(() => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
  });
}

export function commitRegistry(state: ProviderRegistryState, filePath?: string): ProviderRegistryState {
  saveRegistry(state, filePath);
  return state;
}

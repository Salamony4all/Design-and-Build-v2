// packages/provider-registry/src/persistence.ts
// Provider-registry persistence interface (Change Set 3, §5/§7).
//
// The current implementation is a LOCAL_DEVELOPMENT_FILE_STORE — a JSON file on
// the server's local disk. It is ACCEPTABLE ONLY for controlled local development
// because credentials may be written in PLAIN TEXT. Production MUST swap in a
// SECURE_SERVER_DATABASE_OR_VAULT implementation behind this same interface; the
// app code only depends on the interface, never on the file path.
//
// SECURITY CONTRACT:
//  - Secrets are written server-side only and never serialized into a
//    ProviderSummary / client response.
//  - No provider credential is ever returned to the browser, logged, or written
//    into project/scene JSON, exports, or test evidence.
//  - Client storage (localStorage / IndexedDB) is NEVER used for credentials.

export type PersistenceBackend = 'LOCAL_DEVELOPMENT_FILE_STORE' | 'SECURE_SERVER_DATABASE_OR_VAULT';

export interface ProviderRegistryPersistence {
  readonly backend: PersistenceBackend;
  /** Load the full registry state. */
  load(): import('./registry').ProviderRegistryState;
  /** Persist the full registry state (secrets server-side only). */
  save(state: import('./registry').ProviderRegistryState): void;
}

export const PERSISTENCE_BACKEND: PersistenceBackend = 'LOCAL_DEVELOPMENT_FILE_STORE';

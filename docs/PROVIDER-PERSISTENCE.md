# Provider Registry Persistence & Security

**Change Set:** 3 · **App:** `apps/design-build-editor` · **Package:** `design-build-provider-registry`

## Current implementation

| Property | Value |
|---|---|
| Backend | `LOCAL_DEVELOPMENT_FILE_STORE` |
| Storage location | `<app-root>/.data/provider-registry.json` (server-side only) |
| Credential encryption at rest | **PLAIN TEXT** (explicitly not encrypted) |
| File permissions | Inherited from process umask (no hardened ACL set); server-only, never served as a static asset |
| Access boundary | Server-only (`nodejs` runtime). The API key is resolved in `app/api/extraction/ai/route.ts` and is **never** sent to the browser |
| Credential masking | `summarize()` / `toSummary()` return `hasApiKey: boolean`, never the key bytes; a stored sentinel `__SERVER_RESOLVED_FROM_ENV__` means "resolve from server environment" |
| Backup behavior | None automated — the file is a single JSON document; manual copy only |
| Deletion behavior | `removeProvider()` rewrites the file without the entry; if the active selection pointed at the removed provider, the dangling selection is cleared (verified by test) |
| Production safety | **NOT production-safe** — plain-text secrets on local disk, no encryption, no rotation, no access control beyond the host filesystem |

## Future production backend

The registry is accessed only through the `ProviderRegistryPersistence` interface
(`packages/provider-registry/src/persistence.ts`). Production swaps the
`LOCAL_DEVELOPMENT_FILE_STORE` for a `SECURE_SERVER_DATABASE_OR_VAULT`
implementation behind the same interface. App code depends on the interface, not
on the file path, so the change is localized to this package.

**This change set does NOT integrate Supabase.** The vault backend is deferred to
a later change set.

## What is forbidden

- Storing provider credentials in `localStorage` or `IndexedDB`.
- Returning the raw API key in any API response, provider summary, log line,
  diagnostic, project JSON, scene JSON, screenshot, or test snapshot.
- Placing the credential in client React state beyond transient form submission
  (the key field is a controlled input; on submit it is POSTed to the server and
  discarded from the client).
- Bundling the registry file into a public or client-served path.

## Verification

- `packages/provider-registry/tests/crud.test.ts` asserts the masked summary never
  contains the synthetic key, and that the stored-at-rest secret is server-side only.
- `tools/migration/tests/dependency-boundary.test.ts` asserts no clean package or
  app bundle imports `apps/editor` (legacy client-secret pattern), and that the only
  legacy import is a known test-only path (`packages/extraction-ai/tests/...`) which
  cannot enter a production bundle.

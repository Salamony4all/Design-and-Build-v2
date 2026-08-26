// features/pro/pascal-editor-icons.ts
//
// Deployment-safe Iconify registration for the embedded official
// @pascal-app/editor@0.9.2 shell.
//
// The Editor renders its toolbar/panel icons via @iconify/react using public
// collection prefixes (lucide, mdi, carbon, charm, ph). By default
// @iconify/react fetches those from the public Iconify API at runtime, which
// breaks offline / locked-down deployments and produces broken-image
// placeholders. This module registers ONLY the finite set of icons the official
// Editor actually references — extracted into pascal-editor-icon-data.json by
// scripts/regen-pro-icons.cjs from the manifest in pascal-editor-icon-manifest.ts
// (15 icons, curated from the resolved 0.9.2 source — not full collections).
//
// Registration is performed SYNCHRONOUSLY at module load (top-level), so the
// icon storage is populated BEFORE the official <Editor> ever mounts — even
// before React renders. No public api.iconify.design request is needed for any
// required icon. This does NOT patch @pascal-app/editor.
//
// The curated data file shape is: { [prefix]: { prefix, icons: { [name]: body } } }.

'use client';

import { addCollection } from '@iconify/react/offline';
import iconData from './pascal-editor-icon-data.json';

type IconCollectionFile = Record<string, { prefix: string; icons: Record<string, unknown> }>;

let registered = false;

export function registerPascalEditorIcons(): void {
  if (registered) return;
  registered = true;
  const data = iconData as unknown as IconCollectionFile;
  for (const key of Object.keys(data)) {
    const entry = data[key];
    if (!entry || !entry.prefix || !entry.icons) continue;
    addCollection({ prefix: entry.prefix, icons: entry.icons } as never);
  }
}

// Synchronous, side-effecting registration at import time so the registry is
// ready before the Editor mounts. Guarded to the browser runtime: in non-DOM
// environments (e.g. unit tests) we skip the auto-call and let the caller
// (ProEditorLazy, which only runs in the browser) invoke it explicitly.
if (typeof window !== 'undefined') {
  registerPascalEditorIcons();
}

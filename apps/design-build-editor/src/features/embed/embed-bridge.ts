// features/embed/embed-bridge.ts
// BOQ Flow express mode. Design & Build runs inside BOQ Flow's "Design & Build"
// modal as an iframe (`?embed=boqflow`). The two pages talk only by postMessage:
// BOQ Flow sends the plan (and later its products); this page reports progress,
// the finished model and the files BOQ Flow's export suite needs.
//
// Messages are accepted only from BOQ Flow's own origins and only from the
// parent window. Replies go to that origin alone; the first "ready" carries no
// data, so it may be announced before the parent has proved its origin.

import { useCallback, useEffect, useRef } from 'react';

export const EMBED_PARAM = 'embed';
export const EMBED_PARENT = 'boqflow';
export const BRIDGE_SOURCE = 'design-build';
export const BRIDGE_VERSION = 1;

const DEFAULT_ORIGINS = [
  'https://boqv-2.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];
/** Vercel preview deployments of the BOQ Flow project. */
const PREVIEW_ORIGIN = /^https:\/\/boqv-2-[a-z0-9-]+\.vercel\.app$/;

const MAX_PLAN_BYTES = 60 * 1024 * 1024;
const MAX_PRODUCTS = 500;

/** BOQ Flow origins allowed to drive this page (more can be added with NEXT_PUBLIC_DB_EMBED_ORIGINS). */
export function embedOriginAllowed(origin: string, extra: string = process.env.NEXT_PUBLIC_DB_EMBED_ORIGINS ?? ''): boolean {
  if (!origin || origin === 'null') return false;
  const list = [...DEFAULT_ORIGINS, ...extra.split(',').map((s) => s.trim()).filter(Boolean)];
  return list.includes(origin) || PREVIEW_ORIGIN.test(origin);
}

/** True when this page is BOQ Flow's embedded express view. */
export function isEmbedded(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.parent !== window && new URLSearchParams(window.location.search).get(EMBED_PARAM) === EMBED_PARENT;
  } catch {
    return false;
  }
}

/** One BOQ Flow line with the product chosen for it (brand, model and picture). */
export interface EmbedProduct {
  id: string;
  description: string;
  qty: number;
  unit?: string;
  location?: string;
  category?: string;
  brand?: string;
  model?: string;
  imageUrl?: string;
  /** Size in metres when BOQ Flow knows it (width, depth, height). */
  dims?: { w?: number; d?: number; h?: number };
}

export type ParentMessage =
  | { type: 'plan'; file: Blob; name: string }
  | { type: 'products'; items: EmbedProduct[] }
  | { type: 'artifacts'; requestId: string }
  | { type: 'ping' };

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

const metres = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0.05 && v < 30 ? v : undefined;

function parseProduct(v: unknown, i: number): EmbedProduct | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  const description = str(p.description, 1000);
  if (!description) return null;
  const qty = typeof p.qty === 'number' ? p.qty : Number(p.qty);
  const imageUrl = str(p.imageUrl, 2000);
  const dims = p.dims && typeof p.dims === 'object' ? (p.dims as Record<string, unknown>) : null;
  return {
    id: str(p.id, 100) ?? `item_${i + 1}`,
    description,
    qty: Number.isFinite(qty) && qty > 0 ? Math.min(Math.round(qty), 1000) : 1,
    unit: str(p.unit, 20),
    location: str(p.location, 200),
    category: str(p.category, 200),
    brand: str(p.brand, 200),
    model: str(p.model, 300),
    // Pictures are links or inline images; anything else is dropped.
    imageUrl: imageUrl && /^(https?:\/\/|data:image\/)/i.test(imageUrl) ? imageUrl : undefined,
    dims: dims ? { w: metres(dims.w), d: metres(dims.d), h: metres(dims.h) } : undefined,
  };
}

/** Validate one message from BOQ Flow; null when it is not a well-formed bridge message. */
export function parseParentMessage(data: unknown): ParentMessage | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if (m.source !== EMBED_PARENT || m.v !== BRIDGE_VERSION || typeof m.type !== 'string') return null;
  switch (m.type) {
    case 'plan': {
      const file = m.file;
      if (typeof Blob === 'undefined' || !(file instanceof Blob)) return null;
      if (file.size <= 0 || file.size > MAX_PLAN_BYTES) return null;
      const name = str(m.name, 200) ?? 'plan.pdf';
      if (file.type !== 'application/pdf' && !/\.pdf$/i.test(name)) return null;
      return { type: 'plan', file, name };
    }
    case 'products': {
      if (!Array.isArray(m.items)) return null;
      const items = m.items.slice(0, MAX_PRODUCTS).map(parseProduct).filter((p): p is EmbedProduct => !!p);
      return { type: 'products', items };
    }
    case 'artifacts':
      return typeof m.requestId === 'string' && m.requestId.length > 0 && m.requestId.length <= 100
        ? { type: 'artifacts', requestId: m.requestId }
        : null;
    case 'ping':
      return { type: 'ping' };
    default:
      return null;
  }
}

export interface SceneCounts {
  walls: number;
  glassWalls: number;
  curvedWalls: number;
  windows: number;
  doors: number;
  items: number;
}

/** Counts shown in BOQ Flow's modal and carried into its export suite. */
export function countSceneNodes(nodes: Record<string, unknown> | undefined | null): SceneCounts {
  const c: SceneCounts = { walls: 0, glassWalls: 0, curvedWalls: 0, windows: 0, doors: 0, items: 0 };
  for (const raw of Object.values(nodes ?? {})) {
    const n = raw as { type?: string; material?: { preset?: string }; curveOffset?: number } | null;
    if (!n) continue;
    if (n.type === 'wall') {
      c.walls++;
      if (n.material?.preset === 'glass') c.glassWalls++;
      if (typeof n.curveOffset === 'number' && Math.abs(n.curveOffset) > 1e-6) c.curvedWalls++;
    } else if (n.type === 'window') c.windows++;
    else if (n.type === 'door') c.doors++;
    else if (n.type === 'item') c.items++;
  }
  return c;
}

export interface EmbedHandlers {
  plan: (file: Blob, name: string) => void;
  products?: (items: EmbedProduct[]) => void;
  artifacts?: (requestId: string) => void;
  /** The parent asks again whether we are there (for example after it re-opened its modal). */
  ping?: () => void;
}

/**
 * Listen for BOQ Flow and return `post(type, payload)` for replies. Does nothing
 * unless `enabled` (the page is embedded).
 */
export function useEmbedBridge(enabled: boolean, handlers: EmbedHandlers) {
  const originRef = useRef<string | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const post = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      const target = originRef.current;
      if (!enabled || !target) return;
      try {
        window.parent.postMessage({ source: BRIDGE_SOURCE, v: BRIDGE_VERSION, type, ...payload }, target);
      } catch (e) {
        console.warn('[embed] could not reach BOQ Flow:', e);
      }
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || !embedOriginAllowed(e.origin)) return;
      const msg = parseParentMessage(e.data);
      if (!msg) return;
      originRef.current = e.origin;
      const h = handlersRef.current;
      if (msg.type === 'plan') h.plan(msg.file, msg.name);
      else if (msg.type === 'products') h.products?.(msg.items);
      else if (msg.type === 'artifacts') h.artifacts?.(msg.requestId);
      else if (msg.type === 'ping') h.ping?.();
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ source: BRIDGE_SOURCE, v: BRIDGE_VERSION, type: 'ready' }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, [enabled]);

  return post;
}

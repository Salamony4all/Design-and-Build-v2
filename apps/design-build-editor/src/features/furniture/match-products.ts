// features/furniture/match-products.ts
// Match BOQ Flow's product lines to the furniture read from the drawing.
//
// The drawing says where each piece stands and how big it is; BOQ Flow says which
// product it is. A product line is matched to a type of drawn piece (all pieces of
// one kind and size) by kind (from the line's text and category), by size (when the
// line gives one, e.g. "3200 × 1200 × 850 mm") and by count (the line's quantity
// against how many such pieces the drawing shows). Pure functions, no scene access.

export type PieceKind =
  | 'seat' | 'sofa' | 'table' | 'side-table' | 'desk' | 'bed' | 'storage'
  | 'plant' | 'screen' | 'sanitary' | 'equipment' | 'joinery' | 'unknown';

export interface MatchPiece {
  id: string;
  typeId: string;
  kind: PieceKind | string;
  shape: string;
  widthM: number;
  depthM: number;
}

export interface MatchProduct {
  id: string;
  description: string;
  qty: number;
  category?: string;
  brand?: string;
  model?: string;
  imageUrl?: string;
  dims?: { w?: number; d?: number; h?: number };
}

export interface ProductMatch {
  productId: string;
  qty: number;
  placed: number;
  typeIds: string[];
}

export interface MatchResult {
  /** piece id → product id */
  byPiece: Record<string, string>;
  products: ProductMatch[];
  unplacedProductIds: string[];
  unmatchedPieceIds: string[];
}

const KIND_WORDS: [PieceKind, RegExp][] = [
  ['side-table', /\b(side|end|lamp|occasional|nesting|accent)\s*tables?\b/i],
  ['sofa', /\b(sofas?|settees?|couch(es)?|loveseats?|benches|bench|banquettes?|chaise|sectional)\b/i],
  ['seat', /\b(chairs?|armchairs?|stools?|seat(ing)?|poufs?|ottomans?|recliners?|tub)\b/i],
  ['desk', /\b(desks?|workstations?|counters?|reception|work\s*tables?|bench\s*desks?)\b/i],
  ['table', /\b(tables?|tops?)\b/i],
  ['bed', /\b(beds?|bunks?|headboards?)\b/i],
  ['storage', /\b(cabinets?|credenzas?|sideboards?|shelv(es|ing)|shelf|bookcases?|lockers?|wardrobes?|pedestals?|storage|cupboards?|drawers?)\b/i],
  ['plant', /\b(plants?|planters?|greenery|trees?|pots?)\b/i],
  ['screen', /\b(tv|television|screens?|displays?|monitors?|signage)\b/i],
  ['sanitary', /\b(wc|toilets?|basins?|sinks?|urinals?|showers?|vanit(y|ies)|bidets?)\b/i],
];

/** What a product line is, from its text and category. */
export function productKind(text: string): PieceKind | null {
  for (const [k, re] of KIND_WORDS) if (re.test(text)) return k;
  return null;
}

/**
 * Size written in a product line, in metres (largest first): "3200 × 1200 × 850 mm",
 * "1.6 x 0.8 m", "Ø 800", "dia. 600".
 */
export function productDims(text: string): { w: number; d: number; h?: number } | null {
  const t = text.replace(/,/g, '.');
  const round = t.match(/(?:Ø|ø|⌀|dia(?:meter)?\.?|diam\.?)\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?/i);
  const box = t.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?(?:\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?)?/i);
  const toM = (v: number, unit: string | undefined, hint: number) => {
    const u = (unit || '').toLowerCase();
    if (u === 'mm') return v / 1000;
    if (u === 'cm') return v / 100;
    if (u === 'm') return v;
    // no unit: furniture sizes are written in mm (≥ 100) or metres (< 10)
    return hint >= 100 ? v / 1000 : hint >= 10 ? v / 100 : v;
  };
  if (box) {
    const unit = box[6] || box[4] || box[2];
    const a = toM(parseFloat(box[1]), box[2] || unit, parseFloat(box[1]));
    const b = toM(parseFloat(box[3]), box[4] || unit, parseFloat(box[3]));
    const c = box[5] ? toM(parseFloat(box[5]), box[6] || unit, parseFloat(box[5])) : undefined;
    if (!(a > 0.05 && b > 0.05 && a < 30 && b < 30)) return null;
    // three numbers are width × depth × height in furniture schedules
    return { w: Math.max(a, b), d: Math.min(a, b), ...(c && c < 4 ? { h: c } : {}) };
  }
  if (round) {
    const v = parseFloat(round[1]);
    const m = toM(v, round[2], v);
    return m > 0.1 && m < 5 ? { w: m, d: m } : null;
  }
  return null;
}

/**
 * Height of a product in metres, when its line tells it: a third size ("840 x 800 x
 * 760 mm"), or its type (coffee tables are low, high-back chairs and bar stools tall).
 */
export function productHeight(text: string, dims?: { h?: number }): number | undefined {
  const h = dims?.h ?? productDims(text)?.h;
  if (h && h >= 0.2 && h <= 3) return h;
  if (/\b(coffee|cocktail|low)\s*tables?\b/i.test(text)) return 0.42;
  if (/\bhigh[\s-]*back(ed)?\b|\bwing\s*back\b|\bwingback\b|\bprivacy\s+(arm)?chairs?\b|\bacoustic\s+(arm)?chairs?\b/i.test(text)) return 1.25;
  if (/\b(bar|counter|high)\s*(stools?|chairs?)\b/i.test(text)) return 1.0;
  return undefined;
}

const COMPATIBLE: Record<string, string[]> = {
  seat: ['seat'],
  sofa: ['sofa', 'seat'],
  table: ['table', 'side-table', 'desk'],
  'side-table': ['side-table', 'table'],
  desk: ['desk', 'table'],
  bed: ['bed'],
  storage: ['storage', 'joinery', 'desk'],
  plant: ['plant'],
  screen: ['screen'],
  sanitary: ['sanitary'],
};

interface TypeGroup { typeId: string; kind: string; shape: string; w: number; d: number; pieceIds: string[] }

export function matchProducts(pieces: MatchPiece[], products: MatchProduct[]): MatchResult {
  const types = new Map<string, TypeGroup>();
  for (const p of pieces) {
    const key = p.typeId || p.id;
    let t = types.get(key);
    if (!t) types.set(key, (t = { typeId: key, kind: String(p.kind), shape: p.shape, w: p.widthM, d: p.depthM, pieceIds: [] }));
    t.pieceIds.push(p.id);
  }

  const candidates: { score: number; product: MatchProduct; type: TypeGroup }[] = [];
  for (const product of products) {
    const text = `${product.category ?? ''} ${product.description}`;
    // The line's own words first (the BOQ text), then its catalogue category.
    const kind = productKind(product.description) ?? productKind(`${product.category ?? ''}`);
    if (!kind) continue;
    const dims = product.dims?.w && product.dims?.d ? { w: product.dims.w, d: product.dims.d } : productDims(product.description);
    for (const t of types.values()) {
      const ok = COMPATIBLE[kind] ?? [kind];
      const rank = ok.indexOf(t.kind);
      if (rank < 0) continue;
      let score = rank === 0 ? 10 : 6;
      if (dims) {
        const dw = Math.abs(dims.w - t.w) / Math.max(dims.w, t.w);
        const dd = Math.abs(dims.d - t.d) / Math.max(dims.d, t.d);
        score -= 10 * Math.min(1, dw + dd);
      } else score -= 2;
      const qty = Math.max(1, product.qty);
      score -= (4 * Math.abs(qty - t.pieceIds.length)) / Math.max(qty, t.pieceIds.length);
      if (/\bcurved|\bc-shaped|\barc\b|\bcrescent/i.test(text) && t.shape === 'curved') score += 3;
      if (/\bround|\bcircular|\bø|\bdia/i.test(text) && t.shape === 'round') score += 2;
      if (/\bl-shaped|\bcorner|\bl shape/i.test(text) && t.shape === 'l-shape') score += 3;
      candidates.push({ score, product, type: t });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const byPiece: Record<string, string> = {};
  const placed = new Map<string, ProductMatch>();
  for (const p of products) placed.set(p.id, { productId: p.id, qty: Math.max(1, p.qty), placed: 0, typeIds: [] });
  const usedTypes = new Set<string>();
  for (const c of candidates) {
    if (c.score < 1 || usedTypes.has(c.type.typeId)) continue;
    const m = placed.get(c.product.id)!;
    if (m.placed >= m.qty) continue;
    usedTypes.add(c.type.typeId);
    m.typeIds.push(c.type.typeId);
    m.placed += c.type.pieceIds.length;
    for (const id of c.type.pieceIds) byPiece[id] = c.product.id;
  }

  const list = [...placed.values()];
  return {
    byPiece,
    products: list,
    unplacedProductIds: list.filter((m) => m.placed === 0).map((m) => m.productId),
    unmatchedPieceIds: pieces.filter((p) => !byPiece[p.id]).map((p) => p.id),
  };
}

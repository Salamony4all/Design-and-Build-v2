// features/furniture/product-refs.ts
// The products from BOQ Flow that found a place in the model, each with the colour
// its stand-ins wear. Kept apart from plan-furniture (no three.js) so the render path
// can read it: a render names each product by that colour and shows its picture.

export interface ProductColour {
  hex: string;
  name: string;
}

/**
 * Distinct colours with plain names, so a stand-in's colour tells which product it is.
 * None is close to the untinted stand-ins (off-white, green plants, black screens).
 */
export const PRODUCT_COLOURS: readonly ProductColour[] = [
  { hex: '#c0504d', name: 'red' },
  { hex: '#3f7fbf', name: 'blue' },
  { hex: '#e3b93b', name: 'yellow' },
  { hex: '#8e63b8', name: 'purple' },
  { hex: '#e07f35', name: 'orange' },
  { hex: '#36a39c', name: 'teal' },
  { hex: '#d36f9c', name: 'pink' },
  { hex: '#8a5a36', name: 'brown' },
];

export interface ProductRef {
  id: string;
  /** Brand and model, or the start of the description. */
  label: string;
  description: string;
  /** A picture of the product: an inline image or an https link. */
  imageUrl?: string;
  colour: ProductColour;
}

let refs = new Map<string, ProductRef>();

export function setProductRefs(list: readonly ProductRef[]): void {
  refs = new Map(list.map((r) => [r.id, r]));
}

export function productRef(id: string): ProductRef | undefined {
  return refs.get(id);
}

export function productRefs(): ProductRef[] {
  return [...refs.values()];
}

export function productLabel(p: { brand?: string; model?: string; description: string }): string {
  return [p.brand, p.model].filter(Boolean).join(' · ') || p.description.replace(/\s+/g, ' ').trim().slice(0, 60);
}

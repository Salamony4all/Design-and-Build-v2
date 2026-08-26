import { PASCAL_FURNITURE } from './pascal-furniture-catalog';
const catalog=PASCAL_FURNITURE.map(x=>`catalog:${x.slug} | ${x.label} | ${x.widthM}x${x.depthM}m`).join('\n');
export function getFurnitureDetectionPrompt(zones:unknown[],walls:unknown[]){return `You are extracting ONLY movable furniture and equipment from a top-down architectural plan.
Do not return walls, doors, windows, room labels, sanitary symbols as furniture unless the symbol clearly represents an installed fixture listed in the allowed catalogue.
Coordinate frame: bottom-left origin, metres, same frame as the supplied walls and zones.

ALLOWED PASCAL ASSETS (familyId MUST be exactly one of these catalogue ids):\n${catalog}

KNOWN ZONES:\n${JSON.stringify(zones)}
KNOWN WALLS:\n${JSON.stringify(walls)}

Rules:
1. Detect a furniture instance only when the symbol footprint is visible. Never infer furniture from a room name.
2. Return the centre of the visible symbol, not the text label.
3. zoneId must identify the containing zone. If no zone contains the centre, set zoneId=null and confidence<=0.45.
4. Width/depth follow the symbol footprint. rotation is degrees counter-clockwise from +X.
5. If the asset class is uncertain, omit it rather than substitute another item.
6. Repeated chairs/tables must be counted individually only when individual symbols are visible.
7. Do not duplicate built-in joinery in both fitout and furniture.
8. confidence must reflect symbol visibility, asset match and location certainty.
Return strict JSON matching the furniture schema only.`}
export function getFurnitureVerificationPrompt(draft:unknown,zones:unknown[]){return `Audit this furniture draft against the same floor-plan image. Remove hallucinated items, correct wrong catalogue ids, wrong centres, wrong rotations, wrong dimensions, duplicate instances and wrong zoneId values. Never add an item based only on a room label. Preserve only image-supported furniture.\nDRAFT:${JSON.stringify(draft)}\nZONES:${JSON.stringify(zones)}\nReturn strict JSON.`}

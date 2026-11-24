// features/furniture/card-orientation.ts
// Which way a product photo card stands (pure maths, kept apart from three.js and the
// scene so it can be tested): turned with its product, swinging towards the camera.

/** An angle brought into (−π, π]. */
export function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

/**
 * Plan angle of the photo side of a standing card. With a known front (`facing`, plan
 * angle) the card stays turned with its product and swings towards the camera
 * (`toCamera`, plan angle from the piece) by at most `limit`, so it never shows edge-on:
 * seen from the front half, the photo faces the camera that far; from the back half,
 * the card's back (the silhouette) does. With no known front it faces the camera.
 */
export function cardNormal(facing: number | null | undefined, toCamera: number, limit = Math.PI / 4): number {
  if (facing === null || facing === undefined || !Number.isFinite(facing)) return wrapAngle(toCamera);
  const d = wrapAngle(toCamera - facing);
  const towards = Math.abs(d) <= Math.PI / 2 ? d : wrapAngle(toCamera - facing - Math.PI);
  return wrapAngle(facing + Math.max(-limit, Math.min(limit, towards)));
}

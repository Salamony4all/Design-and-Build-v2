// design-build-coordinate-frame
// The single verified PDF<->Pascal transform. EVERY future category uses this.
// HARD RULE: no phase-local offsets, flips, scaling or cropping allowed.
//
// Verified mapping (from the frozen CODE-06 alignment, round-trip error = 0):
//   PDF point (pdfX,pdfY) -> Pascal world (X,Z):
//     nx = (pdfX - pageX0) / pdfWidth
//     nz = (pdfY - pageY0) / pdfHeight
//     pascalX = nx * pageWidthM
//     pascalZ = nz * pageHeightM          // single Z-mirror; X unchanged
//   Inverse (toPdf) returns the original point exactly.

export type Bounds = [number, number, number, number]; // [x0,y0,x1,y1]
export interface PageMetrics {
  pageBoundsPt: Bounds;
  scaleMmPerPt: number;
  pageWidthM: number;
  pageHeightM: number;
}

export interface CoordinateFrame {
  toPascal(pdfX: number, pdfY: number): [number, number];
  toPdf(pascalX: number, pascalZ: number): [number, number];
  toPascalBounds(b: Bounds): Bounds;
  toPdfBounds(b: Bounds): Bounds;
  guidePlaneTransform(): { width: number; height: number; position: [number, number, number]; rotationDeg: number };
  angleRadToPascalYaw(rad: number): number;
}

export function createCoordinateFrame(metrics: PageMetrics): CoordinateFrame {
  const [x0, y0, x1, y1] = metrics.pageBoundsPt;
  const pdfWidth = x1 - x0;
  const pdfHeight = y1 - y0;
  const { pageWidthM, pageHeightM } = metrics;

  const toPascal = (pdfX: number, pdfY: number): [number, number] => {
    const nx = (pdfX - x0) / pdfWidth;
    const nz = (pdfY - y0) / pdfHeight;
    return [nx * pageWidthM, nz * pageHeightM];
  };
  const toPdf = (pascalX: number, pascalZ: number): [number, number] => {
    const nx = pascalX / pageWidthM;
    const nz = pascalZ / pageHeightM;
    return [x0 + nx * pdfWidth, y0 + nz * pdfHeight];
  };
  const toPascalBounds = (b: Bounds): Bounds => {
    const a = toPascal(b[0], 0);
    const c = toPascal(b[2], b[3]);
    return [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[0], c[0]), Math.max(a[1], c[1])];
  };
  const toPdfBounds = (b: Bounds): Bounds => {
    return [toPdf(b[0], b[1])[0], toPdf(b[0], b[1])[1], toPdf(b[2], b[3])[0], toPdf(b[2], b[3])[1]];
  };
  const guidePlaneTransform = () => ({
    width: pageWidthM, height: pageHeightM,
    position: [pageWidthM / 2, -0.045, pageHeightM / 2] as [number, number, number], rotationDeg: 0,
  });
  const angleRadToPascalYaw = (rad: number): number => (-rad * 180) / Math.PI;

  return { toPascal, toPdf, toPascalBounds, toPdfBounds, guidePlaneTransform, angleRadToPascalYaw };
}

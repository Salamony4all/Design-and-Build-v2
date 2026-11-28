// features/boq/geometric-takeoff.ts
// Computes pure 3D geometric surface takeoffs from the live Pascal scene graph
// (walls, curved arcs, glass partitions, floor slabs, doors, windows, furniture).
// Always honors the pilot-window exclusion predicate (`isPilotCommercialExcluded`).

import { isPilotCommercialExcluded } from '../window-pilot/install-pilot-windows';
import type { PlanFurniture } from '../furniture/plan-furniture';

export interface GeometricTakeoff {
  netFloorAreaM2: number;
  ceilingAreaM2: number;
  solidWallLengthLm: number;
  solidWallGrossAreaM2: number;
  solidWallNetPaintAreaM2: number;
  curvedSolidWallLengthLm: number;
  curvedSolidWallAreaM2: number;
  glassPartitionLengthLm: number;
  glassPartitionAreaM2: number;
  skirtingLengthLm: number;
  wallsTotalCount: number;
  doors: {
    total: number;
    single: number;
    double: number;
    podGlass: number;
    totalWidthLm: number;
    totalAreaM2: number;
  };
  windows: {
    total: number;
    totalWidthLm: number;
    totalAreaM2: number;
  };
  columnsCount: number;
  furnitureTotalCount: number;
  sanitaryCounts: {
    wc: number;
    basin: number;
    shower: number;
  };
  furnitureGroups: {
    typeId: string;
    kind: string;
    subtype?: string;
    shape: string;
    count: number;
    widthM: number;
    depthM: number;
    isJoinery: boolean;
  }[];
}

export interface StandaloneBoqRow {
  id: string;
  sn: string;
  code: string;
  division: 'furniture' | 'joinery' | 'fitout';
  category: string;
  brand: string;
  model: string;
  description: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
  basis: string;
  finishes: { role: string; code: string; name: string; hex: string }[];
  dimensionsMm?: string;
  leadTimeDays?: number;
}

const r2 = (v: number): number => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
const nVal = (v: unknown, fb = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

function arcWallLengthM(chordLen: number, sagitta: number): number {
  const absS = Math.abs(sagitta);
  if (!(chordLen > 0) || absS < 1e-4) return chordLen;
  const half = chordLen / 2;
  const R = (half * half + absS * absS) / (2 * absS);
  const theta = 2 * Math.asin(Math.min(1, half / R));
  return Math.max(chordLen, R * theta);
}

function shoelaceArea(pts: readonly [number, number][]): number {
  if (!Array.isArray(pts) || pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    sum += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return Math.abs(sum) / 2;
}

export function computeSceneGeometricTakeoff(
  rawNodes: Record<string, unknown> | undefined | null,
  planFurniture?: PlanFurniture | null,
): GeometricTakeoff {
  const nodes = Object.values(rawNodes ?? {}).filter((n): n is Record<string, unknown> => Boolean(n && typeof n === 'object' && !isPilotCommercialExcluded(n)));

  let wallsTotalCount = 0;
  let solidWallLengthLm = 0;
  let solidWallGrossAreaM2 = 0;
  let curvedSolidWallLengthLm = 0;
  let curvedSolidWallAreaM2 = 0;
  let glassPartitionLengthLm = 0;
  let glassPartitionAreaM2 = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  let slabAreaM2 = 0;
  let doorsTotal = 0;
  let doorsSingle = 0;
  let doorsDouble = 0;
  let doorsPodGlass = 0;
  let doorsWidthLm = 0;
  let doorsAreaM2 = 0;

  let windowsTotal = 0;
  let windowsWidthLm = 0;
  let windowsAreaM2 = 0;

  let columnsCount = 0;
  let wcCount = 0;
  let basinCount = 0;
  let showerCount = 0;

  const wallTypes = new Map<string, { glass: boolean }>();

  for (const n of nodes) {
    if (n.type === 'slab' && Array.isArray(n.polygon)) {
      const poly = (n.polygon as unknown[])
        .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
        .map((p) => [Number(p[0]), Number(p[1])] as [number, number]);
      slabAreaM2 += shoelaceArea(poly);
      continue;
    }

    if (n.type === 'wall') {
      const start = Array.isArray(n.start) ? n.start : null;
      const end = Array.isArray(n.end) ? n.end : null;
      if (!start || !end) continue;
      const ax = nVal(start[0]);
      const az = nVal(start[1]);
      const bx = nVal(end[0]);
      const bz = nVal(end[1]);
      minX = Math.min(minX, ax, bx);
      maxX = Math.max(maxX, ax, bx);
      minZ = Math.min(minZ, az, bz);
      maxZ = Math.max(maxZ, az, bz);

      const chord = Math.hypot(bx - ax, bz - az);
      if (!(chord > 0.02)) continue;
      const sagitta = nVal(n.curveOffset, 0);
      const len = arcWallLengthM(chord, sagitta);
      const h = Math.max(2.0, nVal(n.height, 3.0));
      const mat = (n.material && typeof n.material === 'object' ? (n.material as Record<string, unknown>) : null);
      const meta = (n.metadata && typeof n.metadata === 'object' ? (n.metadata as Record<string, unknown>) : {});
      const isGlass = mat?.preset === 'glass' || String(meta.wallClassification || '') === 'GLASS_PARTITION';
      const isCurved = Math.abs(sagitta) > 1e-4;
      const isInternal = /internal|partition|completion/i.test(String(meta.wallClassification || n.name || ''));

      wallsTotalCount++;
      wallTypes.set(String(n.id || ''), { glass: isGlass });

      if (isGlass) {
        glassPartitionLengthLm += len;
        glassPartitionAreaM2 += len * h;
      } else {
        solidWallLengthLm += len;
        // Internal partitions expose both faces; perimeter walls expose interior face (~1.65x average)
        const faceMult = isInternal ? 2 : 1.5;
        const area = len * h * faceMult;
        solidWallGrossAreaM2 += area;
        if (isCurved) {
          curvedSolidWallLengthLm += len;
          curvedSolidWallAreaM2 += area;
        }
      }
      continue;
    }

    if (n.type === 'door') {
      const meta = (n.metadata && typeof n.metadata === 'object' ? (n.metadata as Record<string, unknown>) : {});
      const w = Math.max(0.6, nVal(n.width ?? (Array.isArray(n.size) ? n.size[0] : undefined) ?? meta.widthM, 0.9));
      const h = Math.max(1.8, nVal(n.height ?? (Array.isArray(n.size) ? n.size[1] : undefined), 2.1));
      const dType = String(n.doorType ?? meta.doorType ?? '');
      doorsTotal++;
      doorsWidthLm += w;
      doorsAreaM2 += w * h;
      if (/pod|glass/i.test(dType) || meta.glazed === true) doorsPodGlass++;
      else if (w >= 1.35 || /double/i.test(dType)) doorsDouble++;
      else doorsSingle++;
      continue;
    }

    if (n.type === 'window') {
      const meta = (n.metadata && typeof n.metadata === 'object' ? (n.metadata as Record<string, unknown>) : {});
      const w = Math.max(0.4, nVal(n.width ?? (Array.isArray(n.size) ? n.size[0] : undefined) ?? meta.widthM, 1.2));
      const h = Math.max(0.4, nVal(n.height ?? (Array.isArray(n.size) ? n.size[1] : undefined), 1.2));
      windowsTotal++;
      windowsWidthLm += w;
      windowsAreaM2 += w * h;
      continue;
    }

    if (n.type === 'column') {
      columnsCount++;
    }
  }

  // Fallback floor area from wall bounding envelope if no explicit SlabNode exists
  let netFloorAreaM2 = slabAreaM2;
  if (!(netFloorAreaM2 > 1) && Number.isFinite(minX) && maxX > minX && maxZ > minZ) {
    netFloorAreaM2 = (maxX - minX) * (maxZ - minZ) * 0.85;
  }

  // Deduct door and window areas from paintable solid wall area
  const solidWallNetPaintAreaM2 = Math.max(0, solidWallGrossAreaM2 - doorsAreaM2 * 1.5 - windowsAreaM2);
  const skirtingLengthLm = Math.max(0, solidWallLengthLm * 1.4 - doorsWidthLm * 2);

  // Furniture groups from installed items or extracted PlanFurniture
  const itemNodes = nodes.filter((n) => n.type === 'item' && (n.metadata as Record<string, unknown> | undefined)?.source === 'plan-furniture');
  const groups = new Map<string, GeometricTakeoff['furnitureGroups'][number]>();

  const registerPiece = (
    typeId: string,
    kind: string,
    subtype: string | undefined,
    shape: string,
    widthM: number,
    depthM: number,
  ) => {
    const key = `${typeId}|${kind}|${subtype || ''}`;
    if (subtype === 'wc' || (kind === 'sanitary' && /wc/i.test(subtype || ''))) wcCount++;
    else if (subtype === 'shower') showerCount++;
    else if (kind === 'sanitary') basinCount++;

    const isJoinery =
      kind === 'joinery' ||
      shape === 'curved' ||
      shape === 'l-shape' ||
      subtype === 'reception-counter' ||
      ((kind === 'storage' || kind === 'desk') && widthM > 2.4);

    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        typeId,
        kind,
        subtype,
        shape,
        count: 1,
        widthM: r2(widthM),
        depthM: r2(depthM),
        isJoinery,
      });
    } else {
      g.count += 1;
    }
  };

  if (itemNodes.length > 0) {
    for (const item of itemNodes) {
      const meta = (item.metadata ?? {}) as Record<string, unknown>;
      const sizeM = Array.isArray(meta.sizeM) ? meta.sizeM : [0.8, 0.8];
      registerPiece(
        String(meta.typeId || item.id || 'item'),
        String(meta.kind || 'unknown'),
        typeof meta.subtype === 'string' ? meta.subtype : undefined,
        String(meta.shape || 'rect'),
        nVal(sizeM[0], 0.8),
        nVal(sizeM[1], 0.8),
      );
    }
  } else if (planFurniture?.pieces?.length) {
    for (const p of planFurniture.pieces) {
      registerPiece(p.typeId || p.id, p.kind, p.subtype, p.shape || 'rect', p.widthM || 0.8, p.depthM || 0.8);
    }
  }

  const furnitureGroups = [...groups.values()].sort((a, b) => b.count - a.count);
  const furnitureTotalCount = furnitureGroups.reduce((s, g) => s + g.count, 0);

  return {
    netFloorAreaM2: r2(netFloorAreaM2),
    ceilingAreaM2: r2(netFloorAreaM2),
    solidWallLengthLm: r2(solidWallLengthLm),
    solidWallGrossAreaM2: r2(solidWallGrossAreaM2),
    solidWallNetPaintAreaM2: r2(solidWallNetPaintAreaM2),
    curvedSolidWallLengthLm: r2(curvedSolidWallLengthLm),
    curvedSolidWallAreaM2: r2(curvedSolidWallAreaM2),
    glassPartitionLengthLm: r2(glassPartitionLengthLm),
    glassPartitionAreaM2: r2(glassPartitionAreaM2),
    skirtingLengthLm: r2(skirtingLengthLm),
    wallsTotalCount,
    doors: {
      total: doorsTotal,
      single: doorsSingle,
      double: doorsDouble,
      podGlass: doorsPodGlass,
      totalWidthLm: r2(doorsWidthLm),
      totalAreaM2: r2(doorsAreaM2),
    },
    windows: {
      total: windowsTotal,
      totalWidthLm: r2(windowsWidthLm),
      totalAreaM2: r2(windowsAreaM2),
    },
    columnsCount,
    furnitureTotalCount,
    sanitaryCounts: {
      wc: wcCount,
      basin: basinCount,
      shower: showerCount,
    },
    furnitureGroups,
  };
}

/**
 * Generates a standalone measured BOQ (Furniture, Custom Joinery, and Fit-Out surfaces)
 * from the 3D scene takeoff when Design & Build is used outside BOQFLOW.
 */
export function synthesizeStandaloneBoqFromTakeoff(takeoff: GeometricTakeoff): StandaloneBoqRow[] {
  const rows: StandaloneBoqRow[] = [];
  let sn = 1;

  // Division 1 & 2: Extracted Furniture & Bespoke Joinery
  for (const g of takeoff.furnitureGroups) {
    if (g.kind === 'sanitary') continue; // counted cleanly in Fit-Out MEP-SAN section
    const wMm = Math.round(g.widthM * 1000);
    const dMm = Math.round(g.depthM * 1000);
    const nameMap: Record<string, string> = {
      armchair: 'Lounge Armchair',
      chair: 'Task / Swivel Chair',
      stool: 'Bar / Counter Stool',
      'l-sofa': 'L-Shaped Lounge Sofa',
      'curved-sofa': 'Curved Acoustic Sofa / Banquette',
      bench: 'Built-In Bench / Banquette',
      desk: 'Office Workstation / Desk',
      'reception-counter': 'Bespoke Reception Counter',
      'coffee-table': 'Low Coffee Table',
      'meeting-table': 'Conference / Meeting Table',
      'side-table': 'Round Side Table',
      credenza: 'Credenza / Low Storage',
      cabinet: 'Full-Height Storage / Cabinetry',
      wardrobe: 'Built-In Wardrobe / Locker Bank',
      screen: '65" 4K Wall-Mounted LED Display',
      plant: 'Interior Floor Planter & Foliage',
    };
    const label = nameMap[g.subtype || g.kind] || `${g.kind.charAt(0).toUpperCase()}${g.kind.slice(1)} Unit`;
    const isAv = g.kind === 'screen';
    const rate = isAv ? 420 : g.isJoinery ? 480 : g.kind === 'sofa' ? 620 : g.kind === 'desk' || g.kind === 'table' ? 290 : g.kind === 'plant' ? 85 : 210;
    const division: StandaloneBoqRow['division'] = isAv ? 'fitout' : g.isJoinery ? 'joinery' : 'furniture';
    rows.push({
      id: `std_${sn}_${g.typeId}`,
      sn: String(sn++),
      code: isAv ? 'MEP-AV-01' : g.isJoinery ? 'FAB-JOIN-01' : `FFE-${String(g.kind).toUpperCase().slice(0, 4)}`,
      division,
      category: division === 'joinery' ? 'Custom Joinery & Fabrication' : division === 'fitout' ? 'Electrical & Mechanical (MEP)' : 'Loose Furniture & FF&E',
      brand: division === 'joinery' ? 'Custom Fabrication' : isAv ? 'FitOut V2' : 'Contract Specification',
      model: isAv ? 'MEP-AV-01' : label,
      description: `${label} (~${wMm} × ${dMm} mm) — Extracted from 3D plan (${g.shape})`,
      qty: g.count,
      unit: 'Nos',
      rate,
      amount: r2(g.count * rate),
      basis: `${g.count} × ${g.kind} (${g.widthM} × ${g.depthM} m) measured in 3D scene`,
      dimensionsMm: `${wMm}x${dMm}mm`,
      leadTimeDays: division === 'joinery' ? 21 : 14,
      finishes: division === 'joinery'
        ? [
            { role: 'Primary Surface', code: 'Natural Oak Veneer', name: 'Crown Cut Oak', hex: '#C6A478' },
            { role: 'Accent / Plinth', code: 'RAL 9005', name: 'Matte Black Steel', hex: '#191A1C' },
          ]
        : [
            { role: 'Upholstery / Finish', code: 'Warm Stone #253', name: 'Commercial Contract Finish', hex: '#B8B2A6' },
            { role: 'Frame / Base', code: 'RAL 7021', name: 'Anthracite Steel', hex: '#2E3234' },
          ],
    });
  }

  // Division 3: Architectural Fit-Out & MEP Measured Surfaces
  const addFitout = (
    code: string,
    model: string,
    category: string,
    description: string,
    qty: number,
    unit: string,
    rate: number,
    basis: string,
    finishes: StandaloneBoqRow['finishes'],
    brand = 'GCC Contract Standard',
  ) => {
    if (!(qty > 0)) return;
    rows.push({
      id: `std_${sn}_${code}`,
      sn: String(sn++),
      code,
      division: 'fitout',
      category,
      brand,
      model: `${code} — ${model}`,
      description,
      qty: r2(qty),
      unit,
      rate,
      amount: r2(qty * rate),
      basis,
      leadTimeDays: 10,
      finishes,
    });
  };

  addFitout(
    'MOB 01',
    'Site Mobilization, Permits & CAR Insurance',
    'Preliminaries & Site Works',
    'Project mobilization, authority/mall work permits, Contractor All Risk (CAR) insurance, safety signage & final handback deep cleaning.',
    1,
    'LS',
    650,
    '1 Lot per measured project floor plate',
    [{ role: 'HSE / Sign-Off', code: 'CAR + HSE', name: 'Approved Compliance Pack', hex: '#475569' }],
    'GCC Contract Standard',
  );
  addFitout(
    'FL-POR-01',
    'Commercial Porcelain / Carpet Floor Finish',
    'Floor Finishes',
    'Supply and installation of RAK Ceramics 600x600mm porcelain / Interface carpet tile floor finish over Mapei cementitious self-leveling screed across measured 3D slab area.',
    takeoff.netFloorAreaM2,
    'Sqm',
    18,
    `3D Slab Area = ${takeoff.netFloorAreaM2} m²`,
    [
      { role: 'Field Tile / Carpet', code: 'RAK Atlas Warm', name: 'Warm Limestone Matt', hex: '#D8CFC2' },
      { role: 'Grout / Trim', code: 'RAL 7035', name: 'Light Grey Epox', hex: '#CBD0D3' },
    ],
    'RAK Ceramics',
  );
  addFitout(
    'CL-GYP-01',
    'Suspended Gypsum Board Ceiling System',
    'Ceiling Works',
    '12.5mm moisture-resistant Knauf concealed MF grid suspended ceiling with shadow-gap angle, jointing & Jotun matte white emulsion.',
    takeoff.ceilingAreaM2,
    'Sqm',
    14,
    `Reflected Ceiling = ${takeoff.ceilingAreaM2} m²`,
    [{ role: 'Ceiling Board', code: 'Knauf GKB 12.5', name: 'Matte Pure White', hex: '#F5F5F3' }],
    'Knauf',
  );
  addFitout(
    'FN-PNT-01',
    'Interior Wall Skim Coat & Emulsion Paint',
    'Wall Finishes & Painting',
    'Jotun Fenomastic alkali primer, 2 coats gypsum skim putty and 2 finish coats washable matt emulsion on internal solid & curved wall surfaces.',
    takeoff.solidWallNetPaintAreaM2,
    'Sqm',
    5.5,
    `${takeoff.solidWallLengthLm} lm solid walls less openings`,
    [{ role: 'Wall Paint', code: 'Jotun 9918', name: 'Classic White Matt', hex: '#F2F1EC' }],
    'Jotun',
  );
  addFitout(
    'PT-GLS-01',
    'Acoustic Tempered Glass Partitions & Curved Pods',
    'Glazing & Partitions',
    '12mm Guardian clear toughened acoustic glazing & curved pod panels in Optima anodized aluminum low-profile head and sill channels.',
    takeoff.glassPartitionAreaM2,
    'Sqm',
    68,
    `${takeoff.glassPartitionLengthLm} lm extracted glass walls`,
    [
      { role: 'Glazing', code: 'Clear Low-Iron', name: '12mm Tempered Clear', hex: '#CFE8EC' },
      { role: 'Track Frame', code: 'RAL 9005', name: 'Anodized Matte Black', hex: '#18191B' },
    ],
    'Guardian Glass / Optima',
  );
  addFitout(
    'FN-SKT-01',
    'Architectural Flush Skirting (100mm)',
    'Floor Finishes',
    '100mm Gulf Extrusions anodized aluminum / porcelain skirting along solid wall perimeters excluding door openings.',
    takeoff.skirtingLengthLm,
    'Lm',
    4.5,
    `${takeoff.skirtingLengthLm} lm perimeter net of doors`,
    [{ role: 'Skirting Profile', code: 'ALU-BLK-100', name: 'Brushed Anthracite', hex: '#2B2F36' }],
    'Gulf Extrusions',
  );
  addFitout(
    'DR-SWG-01',
    'Flush Acoustic Timber / Glass Doors & Ironmongery',
    'Doors & Ironmongery',
    'Full-height acoustic doors with Egger HPL/oak veneer, seals, stainless lever handles, concealed hinges and Dormakaba overhead door closers.',
    takeoff.doors.total,
    'Nos',
    220,
    `${takeoff.doors.total} extracted DoorNodes (${takeoff.doors.podGlass} pod/glass)`,
    [
      { role: 'Door Leaf', code: 'Natural Oak', name: 'Crown Oak Veneer', hex: '#C8A679' },
      { role: 'Hardware', code: 'Dormakaba SS', name: 'Brushed Stainless Steel', hex: '#B7BDC4' },
    ],
    'Dormakaba',
  );
  addFitout(
    'MEP-SAN-02',
    'Commercial Wall-Hung WC Suites',
    'Sanitary & Plumbing',
    'Duravit wall-hung rimless ceramic WC pan, Geberit concealed cistern frame and brushed flush plate in wet rooms.',
    takeoff.sanitaryCounts.wc,
    'Nos',
    240,
    `${takeoff.sanitaryCounts.wc} WC fixtures in model`,
    [{ role: 'Ceramic', code: 'Duravit White', name: 'Alpine Ceramic', hex: '#F7F7F5' }],
    'Duravit / Geberit',
  );
  addFitout(
    'MEP-SAN-03',
    'Countertop Wash Basins & Chrome Mixers',
    'Sanitary & Plumbing',
    'Duravit vitreous china countertop wash basin complete with Grohe chrome mono mixer, bottle trap & angle valves.',
    takeoff.sanitaryCounts.basin,
    'Nos',
    165,
    `${takeoff.sanitaryCounts.basin} wash basins in model`,
    [
      { role: 'Ceramic', code: 'Duravit White', name: 'Alpine Ceramic', hex: '#F7F7F5' },
      { role: 'Brassware', code: 'Grohe Chrome', name: 'StarLight Chrome', hex: '#C8CDD2' },
    ],
    'Duravit / Grohe',
  );

  return rows;
}

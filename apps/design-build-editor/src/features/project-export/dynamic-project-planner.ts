// features/project-export/dynamic-project-planner.ts
// Scale-adaptive CPM Project Action & Control Plan + MS Project MSPDI XML exporter
// for standalone Design & Build (mirrors BOQFLOW's dynamicProjectPlanner.js).

import type { GeometricTakeoff, StandaloneBoqRow } from '../boq/geometric-takeoff';

export interface ProjectPlanMetaInput {
  projectName?: string;
  projectNumber?: string;
  clientName?: string;
  contractor?: string;
  projectManager?: string;
  locationZone?: string;
  issueDate?: string;
  currency?: string;
  contractDurationDays?: number | string;
  vatPercent?: number | string;
}

export interface ProjectPlanData {
  meta: {
    title: string;
    client: string;
    contractor: string;
    pm: string;
    location: string;
    projectNumber: string;
    currency: string;
    vatPct: number;
    vatRate: number;
    netTotal: number;
    grossTotal: number;
    durationDays: number;
    scaleTier: string;
    floorSqm: number;
    startDate: Date;
    finishDate: Date;
    startDateIso: string;
    finishDateIso: string;
  };
  wbsItems: Array<
    StandaloneBoqRow & {
      wbsCode: string;
      tradeKey: string;
      tradeLabel: string;
      execActId: string;
      installActId: string;
      execWeight: number;
      allocExec: number;
      allocInst: number;
      finishSummary: string;
    }
  >;
  activities: Array<{
    id: string;
    phase: string;
    name: string;
    type: 'Task' | 'Milestone';
    boqRef: string;
    owner: string;
    predIds: string[];
    predText: string;
    startDay: number;
    duration: number;
    endDay: number;
    resourceId: string;
    allocatedBac: number;
  }>;
  actionItems: Array<{
    id: number;
    actId: string;
    action: string;
    owner: string;
    dateAssigned: string;
    dueDate: string;
    priority: string;
    notes: string;
    startDay: number;
    duration: number;
  }>;
  deliverables: Array<{
    id: string;
    title: string;
    type: string;
    actId: string;
    from: string;
    to: string;
    note: string;
  }>;
  resources: Array<{
    id: string;
    name: string;
    type: string;
    org: string;
    role: string;
    actIds: string[];
    assigned: ProjectPlanData['activities'];
  }>;
  materials: Array<{
    id: string;
    item: string;
    boqRef: string;
    qtyUnit: string;
    finishes: string;
    brand: string;
  }>;
  payments: Array<{
    id: number;
    title: string;
    share: number;
    amount: number;
    actId: string;
    day: number;
  }>;
  risks: Array<{
    id: string;
    risk: string;
    category: string;
    prob: number;
    impact: number;
    owner: string;
    actId: string;
    response: string;
  }>;
  stakeholders: Array<{
    id: string;
    name: string;
    role: string;
    power: number;
    interest: number;
  }>;
  sCurve: Array<{
    day: number;
    date: string;
    dailyPv: number;
    cumPv: number;
    pctWork: number;
    cumBilling: number;
    pctBilling: number;
  }>;
}

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
const r3 = (v: number) => Math.round((Number(v) || 0) * 1000) / 1000;
const escXml = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const ISO_DATE = (d: Date | string) => {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};
const ADD_DAYS = (baseDate: Date, offsetDays: number) => {
  const d = new Date(baseDate.getTime());
  d.setDate(d.getDate() + offsetDays);
  return d;
};

function classifyTrade(row: StandaloneBoqRow) {
  const hay = `${row.brand} ${row.model} ${row.category} ${row.description} ${row.code}`.toLowerCase();
  const code = row.code.toUpperCase();
  if (/^(MOB|UTIL|HSE|DEB|CLN|INS)/i.test(code) || /\b(mobilization|prelim|insurance|permit|cleaning)\b/i.test(hay)) {
    return { key: 'prelims', label: 'Mobilization, Permits & Prelims / التجهيز والتأمين', evMode: 'site' as const };
  }
  if (/^MEP-AV/i.test(code) || /\b(signage|display\s*screen|led\s*display|branding|lightbox)\b/i.test(hay)) {
    return { key: 'signage', label: 'Branding, Signage & AV Systems / البراندنج والشاشات', evMode: 'fab' as const };
  }
  if (/^MEP-SAN/i.test(code) || /\b(sanitary|wc|basin|shower|pantry)\b/i.test(hay)) {
    return { key: 'sanitary', label: 'Sanitary & Pantry Fixtures / الأدوات الصحية', evMode: 'fab' as const };
  }
  if (/^MEP/i.test(code) || /\b(electrical|lighting|mep|wiring)\b/i.test(hay)) {
    return { key: 'mep', label: 'Electrical, Lighting & MEP Works / الأعمال الكهروميكانيكية', evMode: 'site' as const };
  }
  if (row.division === 'joinery' || /^FAB-/i.test(code)) {
    return { key: 'joinery', label: 'Custom Joinery & Millwork / النجارة والتصنيع الخاص', evMode: 'fab' as const };
  }
  if (/^(WN-GLZ|PT-|WC-)/i.test(code) || /\b(partition|glazing|cladding|fluted\s*wall)\b/i.test(hay)) {
    return { key: 'partitions', label: 'Partitions, Glazing & Wall Cladding / القواطع والتكسيات والزجاج', evMode: 'site' as const };
  }
  if (/^CL-|ceiling/i.test(hay)) {
    return { key: 'ceiling', label: 'Ceiling Works / أعمال الأسقف', evMode: 'site' as const };
  }
  if (/^FN-/i.test(code) || /paint|wallpaper/i.test(hay)) {
    return { key: 'paint', label: 'Wall Finishes & Painting / دهان الحوائط', evMode: 'site' as const };
  }
  if (/^FL-|floor|skirting/i.test(hay)) {
    return { key: 'flooring', label: 'Floor Finishes & Skirting / أعمال الأرضيات', evMode: 'site' as const };
  }
  if (/^DR-|door|window/i.test(hay)) {
    return { key: 'doors', label: 'Doors, Windows & Ironmongery / الأبواب والنوافذ', evMode: 'site' as const };
  }
  return { key: 'furniture', label: 'Loose Furniture & FF&E / الأثاث والتجهيزات', evMode: 'fab' as const };
}

export function buildStandaloneProjectPlan(
  rows: readonly StandaloneBoqRow[],
  takeoff: GeometricTakeoff | null,
  metaInput: ProjectPlanMetaInput = {},
): ProjectPlanData {
  const currency = metaInput.currency || 'OMR';
  const netTotal = r3(rows.reduce((s, r) => s + num(r.amount), 0));
  const vatPct = metaInput.vatPercent !== undefined && String(metaInput.vatPercent).trim() !== '' ? Math.max(0, Number(metaInput.vatPercent)) : 5;
  const vatRate = vatPct / 100;
  const grossTotal = r3(netTotal * (1 + vatRate));

  const tagged = rows.map((r) => ({ ...r, trade: classifyTrade(r) }));
  const tradeSet = new Set(tagged.map((r) => r.trade.key));
  const floorSqm = Number(takeoff?.netFloorAreaM2 || 0);
  const omrMult = currency === 'OMR' ? 1 : currency === 'AED' || currency === 'SAR' ? 0.105 : 0.385;
  const netOmr = netTotal * omrMult;
  const maxLead = Math.max(14, ...rows.map((r) => Number(r.leadTimeDays) || 0));

  const overrideDur = Number(metaInput.contractDurationDays);
  let durationDays = 45;
  let scaleTier = 'Boutique Fit-Out (45 Days)';
  if (overrideDur >= 15) {
    durationDays = Math.round(overrideDur);
    scaleTier = durationDays >= 110 ? 'Turnkey Major' : durationDays >= 80 ? 'Large Commercial' : durationDays >= 55 ? 'Medium Fit-Out' : 'Compact Fit-Out';
  } else if (netOmr > 200000 || floorSqm >= 800 || tradeSet.size >= 9) {
    durationDays = Math.max(120, Math.min(180, maxLead + 60));
    scaleTier = 'Turnkey Major (120+ Days)';
  } else if (netOmr > 60000 || floorSqm >= 300 || tradeSet.size >= 7) {
    durationDays = Math.max(90, Math.min(120, maxLead + 42));
    scaleTier = 'Large Commercial (90 Days)';
  } else if (netOmr > 15000 || floorSqm >= 100 || tradeSet.size >= 5) {
    durationDays = Math.max(60, maxLead + 30);
    scaleTier = 'Medium Fit-Out (60 Days)';
  }
  const scaleFactor = durationDays / 45;
  const sc = (base: number, min = 1) => Math.max(min, Math.round(base * scaleFactor));

  const startDate = (() => {
    const m = String(metaInput.issueDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
  })();
  const finishDate = ADD_DAYS(startDate, durationDays - 1);
  const clientName = String(metaInput.clientName || 'Client').trim();
  const contractorName = String(metaInput.contractor || 'Main Contractor').trim();
  const pmName = String(metaInput.projectManager || 'Project Manager').trim();
  const title = String(metaInput.projectName || 'Design & Build Fit-Out Project').trim();

  const mobEnd = Math.min(Math.round(durationDays * 0.16), sc(7, 5));
  const fabStart = mobEnd + 1;
  const hasJoinery = tradeSet.has('joinery');
  const hasFfe = tradeSet.has('furniture');
  const hasSignage = tradeSet.has('signage');
  const hasSanitary = tradeSet.has('sanitary');
  const hasPartitions = tradeSet.has('partitions');
  const hasMep = tradeSet.has('mep') || hasSignage || hasSanitary;
  const hasCeiling = tradeSet.has('ceiling');
  const hasPaint = tradeSet.has('paint');
  const hasFlooring = tradeSet.has('flooring');
  const hasDoors = tradeSet.has('doors');
  const hasOffsite = hasJoinery || hasFfe || hasSignage || hasSanitary;

  const activities: ProjectPlanData['activities'] = [];
  const pushAct = (a: Omit<ProjectPlanData['activities'][number], 'endDay' | 'allocatedBac'>) => {
    activities.push({ ...a, endDay: a.startDay + a.duration - 1, allocatedBac: 0 });
  };

  pushAct({ id: 'A00', phase: '1. Project Management | إدارة المشروع', name: 'Project management, HSE, landlord coordination & progress control', type: 'Task', boqRef: 'Prelims', owner: pmName, predIds: [], predText: '-', startDay: 1, duration: durationDays, resourceId: 'R01' });
  pushAct({ id: 'A01', phase: '2. Mobilization & Approvals | التجهيز والاعتمادات', name: 'Receive 60% advance payment & commence contractual duration', type: 'Milestone', boqRef: 'Payment 60%', owner: clientName, predIds: [], predText: '-', startDay: 1, duration: 1, resourceId: 'R11' });
  pushAct({ id: 'A02', phase: '2. Mobilization & Approvals | التجهيز والاعتمادات', name: 'Issue CAR Insurance policy & HSE Plan', type: 'Task', boqRef: 'Prelims', owner: pmName, predIds: ['A01'], predText: 'A01', startDay: 1, duration: sc(3, 2), resourceId: 'R01' });
  pushAct({ id: 'A03', phase: '2. Mobilization & Approvals | التجهيز والاعتمادات', name: 'Submit landlord/municipality fit-out permit pack', type: 'Task', boqRef: 'Prelims', owner: pmName, predIds: ['A02'], predText: 'A02', startDay: 2, duration: Math.max(3, mobEnd - 2), resourceId: 'R10' });
  pushAct({ id: 'A04', phase: '2. Mobilization & Approvals | التجهيز والاعتمادات', name: 'Site handover & Work Permit issued', type: 'Milestone', boqRef: 'Site Access', owner: 'Landlord', predIds: ['A03'], predText: 'A03', startDay: mobEnd, duration: 1, resourceId: 'R10' });
  pushAct({ id: 'A05', phase: '2. Mobilization & Approvals | التجهيز والاعتمادات', name: 'Site laser survey & 3D as-built verification', type: 'Task', boqRef: 'All Trades', owner: 'Technical Designer', predIds: ['A01'], predText: 'A01', startDay: 2, duration: sc(3, 2), resourceId: 'R03' });
  pushAct({ id: 'A06', phase: '2. Mobilization & Approvals | التجهيز والاعتمادات', name: 'Prepare shop drawings & joinery elevations', type: 'Task', boqRef: 'Joinery/FF&E', owner: 'Technical Designer', predIds: ['A05'], predText: 'A05', startDay: 3, duration: Math.max(2, mobEnd - 4), resourceId: 'R03' });
  pushAct({ id: 'A07', phase: '2. Mobilization & Approvals | التجهيز والاعتمادات', name: 'Submit official brand finish swatches & samples (MAS)', type: 'Task', boqRef: 'Finishes', owner: pmName, predIds: ['A01'], predText: 'A01', startDay: 3, duration: sc(3, 2), resourceId: 'R01' });
  if (hasMep) {
    pushAct({ id: 'A08', phase: '2. Mobilization & Approvals | التجهيز والاعتمادات', name: 'Prepare coordinated MEP, lighting & AV drawings', type: 'Task', boqRef: 'MEP/AV', owner: 'MEP Engineer', predIds: ['A05'], predText: 'A05', startDay: Math.min(4, mobEnd - 2), duration: sc(2, 2), resourceId: 'R07' });
  }
  const approvalPreds = ['A06', 'A07', ...(hasMep ? ['A08'] : [])];
  const approvalStart = Math.max(mobEnd - 1, Math.max(...activities.filter((a) => approvalPreds.includes(a.id)).map((a) => a.endDay)) + 1);
  pushAct({ id: 'A09', phase: '2. Mobilization & Approvals | التجهيز والاعتمادات', name: 'Client approval of shop drawings & finish samples (MAS Gate)', type: 'Milestone', boqRef: 'Critical Gate', owner: clientName, predIds: approvalPreds, predText: approvalPreds.join(', '), startDay: Math.min(mobEnd, approvalStart), duration: 2, resourceId: 'R01' });

  const workStart = Math.max(fabStart, (activities.find((a) => a.id === 'A09')?.endDay || mobEnd) + 1);
  const offIdsByKey: Record<string, string> = {};
  const fabGroupIds: string[] = [];
  const fabDurJ = Math.max(sc(18, 10), Math.min(Math.round(durationDays * 0.45), maxLead || 20));

  if (hasJoinery) {
    pushAct({ id: 'A10', phase: '3. Off-Site Manufacturing & Procurement | التصنيع والتوريد', name: 'Factory fabrication of custom joinery & millwork (80% EV)', type: 'Task', boqRef: 'Joinery', owner: 'Joinery Factory', predIds: ['A09'], predText: 'A09', startDay: workStart, duration: fabDurJ, resourceId: 'R04' });
    fabGroupIds.push('A10');
    offIdsByKey.joinery = 'A10';
  }
  if (hasFfe) {
    pushAct({ id: 'A11', phase: '3. Off-Site Manufacturing & Procurement | التصنيع والتوريد', name: 'Procure & manufacture contract loose furniture (80% EV)', type: 'Task', boqRef: 'Loose FF&E', owner: 'FF&E Suppliers', predIds: ['A09'], predText: 'A09', startDay: workStart, duration: sc(18, 10), resourceId: 'R05' });
    fabGroupIds.push('A11');
    offIdsByKey.furniture = 'A11';
  }
  if (hasSignage || hasSanitary) {
    pushAct({ id: 'A12', phase: '3. Off-Site Manufacturing & Procurement | التصنيع والتوريد', name: 'Fabricate 3D signage, AV displays & sanitary supply (80% EV)', type: 'Task', boqRef: 'AV/Sanitary', owner: 'Signage/MEP Supply', predIds: ['A09'], predText: 'A09', startDay: workStart, duration: sc(19, 10), resourceId: 'R06' });
    fabGroupIds.push('A12');
    if (hasSignage) offIdsByKey.signage = 'A12';
    if (hasSanitary) offIdsByKey.sanitary = 'A12';
  }
  const fabFinish = fabGroupIds.length ? Math.max(...activities.filter((a) => fabGroupIds.includes(a.id)).map((a) => a.endDay)) : workStart + 10;
  if (fabGroupIds.length) {
    pushAct({ id: 'A14', phase: '3. Off-Site Manufacturing & Procurement | التصنيع والتوريد', name: 'Factory QC inspection (MIR) & completion (20% Payment trigger)', type: 'Milestone', boqRef: 'MIR / 20%', owner: pmName, predIds: [...fabGroupIds], predText: fabGroupIds.join(', '), startDay: fabFinish + 1, duration: 1, resourceId: 'R04' });
  }

  const siteIdsByKey: Record<string, string> = {};
  let siteCursor = Math.max(mobEnd + 1, workStart);
  let lastSitePred = ['A04'];
  if (hasPartitions) {
    const d = sc(5, 3);
    pushAct({ id: 'A15', phase: '4. On-Site Fit-Out Works | أعمال الموقع', name: 'Erect drywall partitions & acoustic glass walls', type: 'Task', boqRef: 'Partitions', owner: 'Site Fit-Out Team', predIds: ['A04', 'A09'], predText: 'A04, A09', startDay: siteCursor, duration: d, resourceId: 'R02' });
    siteIdsByKey.partitions = 'A15';
    siteCursor += Math.max(2, Math.floor(d * 0.7));
    lastSitePred = ['A15'];
  }
  if (hasMep) {
    const d = sc(6, 3);
    const preds = hasPartitions ? ['A15', 'A08'] : ['A04', 'A08'];
    pushAct({ id: 'A17', phase: '4. On-Site Fit-Out Works | أعمال الموقع', name: 'MEP first-fix wiring, power points & lighting conduits', type: 'Task', boqRef: 'MEP', owner: 'MEP Team', predIds: preds, predText: preds.join(', '), startDay: siteCursor, duration: d, resourceId: 'R07' });
    siteIdsByKey.mep = 'A17';
    siteCursor += d;
    pushAct({ id: 'A18', phase: '4. On-Site Fit-Out Works | أعمال الموقع', name: 'Consultant / Landlord MEP concealment inspection (WIR)', type: 'Milestone', boqRef: 'WIR-MEP', owner: 'Landlord', predIds: ['A17'], predText: 'A17', startDay: siteCursor, duration: 1, resourceId: 'R10' });
    siteCursor += 1;
    lastSitePred = ['A18'];
  }
  if (hasCeiling) {
    const d = sc(4, 2);
    pushAct({ id: 'A19', phase: '4. On-Site Fit-Out Works | أعمال الموقع', name: 'Install suspended gypsum ceiling grid & closure', type: 'Task', boqRef: 'Ceiling', owner: 'Site Fit-Out Team', predIds: lastSitePred, predText: lastSitePred.join(', '), startDay: siteCursor, duration: d, resourceId: 'R02' });
    siteIdsByKey.ceiling = 'A19';
    siteCursor += d;
    lastSitePred = ['A19'];
  }
  if (hasPaint) {
    const d = sc(5, 3);
    pushAct({ id: 'A21', phase: '4. On-Site Fit-Out Works | أعمال الموقع', name: 'Wall prep, skim coat, primer & 2 finish paint coats (10% Milestone)', type: 'Task', boqRef: 'Painting', owner: 'Painting Crew', predIds: lastSitePred, predText: lastSitePred.join(', '), startDay: siteCursor, duration: d, resourceId: 'R08' });
    siteIdsByKey.paint = 'A21';
    siteCursor += d;
    lastSitePred = ['A21'];
  }
  if (hasFlooring) {
    const d = sc(4, 2);
    pushAct({ id: 'A22P', phase: '4. On-Site Fit-Out Works | أعمال الموقع', name: 'Floor finish installation & perimeter skirting', type: 'Task', boqRef: 'Flooring', owner: 'Flooring Crew', predIds: lastSitePred, predText: lastSitePred.join(', '), startDay: siteCursor, duration: d, resourceId: 'R02' });
    siteIdsByKey.flooring = 'A22P';
    siteCursor += d;
    lastSitePred = ['A22P'];
  }
  if (hasDoors) {
    const d = sc(3, 2);
    pushAct({ id: 'A22D', phase: '4. On-Site Fit-Out Works | أعمال الموقع', name: 'Install architectural door sets & ironmongery', type: 'Task', boqRef: 'Doors', owner: 'Carpentry Crew', predIds: lastSitePred, predText: lastSitePred.join(', '), startDay: Math.max(siteCursor - 1, mobEnd + 2), duration: d, resourceId: 'R09' });
    siteIdsByKey.doors = 'A22D';
    siteCursor += Math.max(1, d - 1);
    lastSitePred = ['A22D'];
  }

  const tailBudget = sc(12, 8);
  const payStart = Math.min(durationDays - tailBudget, Math.max(fabGroupIds.length ? fabFinish + 2 : workStart + 8, siteCursor));
  const payDur = sc(3, 2);
  if (hasOffsite) {
    const payPreds = [fabGroupIds.length ? 'A14' : 'A09'];
    pushAct({ id: 'A22', phase: '5. Payment & Delivery | السداد والتوريد', name: 'Invoice & clear 20% pre-delivery milestone payment', type: 'Task', boqRef: 'Payment 20%', owner: `${clientName} Finance`, predIds: payPreds, predText: payPreds.join(', '), startDay: payStart, duration: payDur, resourceId: 'R11' });
    pushAct({ id: 'A23', phase: '5. Payment & Delivery | السداد والتوريد', name: 'Coordinate site delivery permits & gate passes (DN)', type: 'Task', boqRef: 'Delivery Note', owner: pmName, predIds: ['A22'], predText: 'A22', startDay: payStart + payDur, duration: sc(2, 1), resourceId: 'R10' });
  }

  const instStart = hasOffsite ? (activities.find((a) => a.id === 'A23')?.endDay || payStart + 3) + 1 : Math.max(siteCursor, durationDays - 7);
  const remainToEnd = Math.max(5, durationDays - instStart + 1);
  const instDur = Math.max(2, Math.round(remainToEnd * 0.45));
  const instPreds = hasOffsite ? ['A23', ...lastSitePred] : lastSitePred;
  pushAct({ id: 'A24', phase: '6. Site Installation | التركيب والتشطيب النهائي', name: 'Deliver & install loose FF&E & bespoke joinery (20% EV)', type: 'Task', boqRef: 'FF&E & Joinery', owner: 'Installation Team', predIds: [...new Set(instPreds)], predText: [...new Set(instPreds)].join(', '), startDay: instStart, duration: instDur, resourceId: 'R09' });

  const hookStart = Math.min(durationDays - 4, Math.max(instStart + 1, (activities.find((a) => a.id === 'A24')?.endDay || instStart) - 1));
  pushAct({ id: 'A25', phase: '6. Site Installation | التركيب والتشطيب النهائي', name: 'Final signage/AV installation, lighting trim & hookup', type: 'Task', boqRef: 'MEP/AV', owner: 'MEP & Signage', predIds: ['A24'], predText: 'A24 (SS/Overlap)', startDay: hookStart, duration: Math.max(2, sc(3, 2)), resourceId: 'R07' });

  const testDay = Math.min(durationDays - 3, (activities.find((a) => a.id === 'A25')?.endDay || hookStart) + 1);
  pushAct({ id: 'A26', phase: '7. Testing & Handover | التشغيل والتسليم', name: 'Testing & commissioning lighting, AV & MEP', type: 'Task', boqRef: 'Commissioning', owner: 'MEP Engineer', predIds: ['A25'], predText: 'A25', startDay: testDay, duration: 1, resourceId: 'R07' });
  const snagDay = Math.min(durationDays - 2, testDay + 1);
  pushAct({ id: 'A27', phase: '7. Testing & Handover | التشغيل والتسليم', name: 'Pre-handover joint inspection with Landlord / Client', type: 'Milestone', boqRef: 'Final WIR', owner: 'Landlord', predIds: ['A26'], predText: 'A26', startDay: snagDay, duration: 1, resourceId: 'R10' });
  pushAct({ id: 'A28', phase: '7. Testing & Handover | التشغيل والتسليم', name: 'Close Snag List & final deep cleaning', type: 'Task', boqRef: 'Snagging', owner: 'Site Supervisor', predIds: ['A27'], predText: 'A27', startDay: snagDay, duration: Math.max(1, durationDays - snagDay), resourceId: 'R02' });
  pushAct({ id: 'A29', phase: '7. Testing & Handover | التشغيل والتسليم', name: 'Final Handover Certificate (10% Final Payment trigger)', type: 'Milestone', boqRef: 'Handover 10%', owner: `${clientName} + ${contractorName}`, predIds: ['A28'], predText: 'A28', startDay: durationDays, duration: 1, resourceId: 'R01' });

  const wbsItems: ProjectPlanData['wbsItems'] = tagged.map((r, idx) => {
    const tk = r.trade.key;
    let execActId = 'A00';
    let installActId = '';
    let execWeight = 1;
    if (r.trade.evMode === 'fab' && offIdsByKey[tk]) {
      execActId = offIdsByKey[tk];
      installActId = 'A24';
      execWeight = 0.8;
    } else if (siteIdsByKey[tk]) {
      execActId = siteIdsByKey[tk];
    } else if (tk !== 'prelims') {
      execActId = 'A24';
    }
    const allocExec = r3(r.amount * execWeight);
    return {
      ...r,
      wbsCode: `WBS ${idx + 1}.${r.sn}`,
      tradeKey: tk,
      tradeLabel: r.trade.label,
      execActId,
      installActId,
      execWeight,
      allocExec,
      allocInst: r3(r.amount - allocExec),
      finishSummary: (r.finishes || []).map((f) => `${f.role}: ${f.code} ${f.name}`).join(' · ') || 'Standard',
    };
  });

  const actMap = new Map(activities.map((a) => [a.id, a]));
  wbsItems.forEach((w) => {
    const e = actMap.get(w.execActId);
    if (e) e.allocatedBac = r3(e.allocatedBac + w.allocExec);
    if (w.installActId && actMap.get(w.installActId)) {
      const iAct = actMap.get(w.installActId)!;
      iAct.allocatedBac = r3(iAct.allocatedBac + w.allocInst);
    }
  });

  const payments = [
    { id: 1, title: 'Advance Payment (60%) | الدفعة المقدمة', share: 0.6, amount: r2(grossTotal * 0.6), actId: 'A01', day: 1 },
    { id: 2, title: 'Off-Site Manufacturing Complete / MIR (20%)', share: 0.2, amount: r2(grossTotal * 0.2), actId: activities.some((a) => a.id === 'A14') ? 'A14' : 'A09', day: activities.find((a) => a.id === 'A14')?.endDay || Math.round(durationDays * 0.62) },
    { id: 3, title: 'Mid-Fitout Milestone (10%)', share: 0.1, amount: r2(grossTotal * 0.1), actId: activities.some((a) => a.id === 'A21') ? 'A21' : 'A24', day: activities.find((a) => a.id === 'A21')?.endDay || Math.round(durationDays * 0.52) },
    { id: 4, title: 'Final Handover (10%)', share: 0.1, amount: r2(grossTotal - r2(grossTotal * 0.6) - r2(grossTotal * 0.2) - r2(grossTotal * 0.1)), actId: 'A29', day: durationDays },
  ];

  const actionItems = activities.map((a, idx) => ({
    id: idx + 1,
    actId: a.id,
    action: a.name,
    owner: a.owner,
    dateAssigned: ISO_DATE(ADD_DAYS(startDate, a.startDay - 1)),
    dueDate: ISO_DATE(ADD_DAYS(startDate, a.endDay - 1)),
    priority: a.type === 'Milestone' || ['A09', 'A10', 'A24', 'A25'].includes(a.id) ? 'High' : 'Medium',
    notes: `${a.boqRef}${a.predText !== '-' ? ` | Pred: ${a.predText}` : ''}`,
    startDay: a.startDay,
    duration: a.duration,
  }));

  const deliverables = [
    { id: 'D01', title: '60% Advance Payment Confirmation', type: 'Financial', actId: 'A01', from: clientName, to: contractorName, note: 'Day 1 Trigger' },
    { id: 'D02', title: 'CAR Insurance Policy & HSE Plan', type: 'Document', actId: 'A02', from: contractorName, to: 'Landlord / Client', note: '' },
    { id: 'D03', title: 'Landlord Work Permit Dossier', type: 'Permit', actId: 'A03', from: contractorName, to: 'Landlord', note: '' },
    { id: 'D04', title: 'Signed Site Handover & Work Permit', type: 'Permit', actId: 'A04', from: 'Landlord', to: contractorName, note: '' },
    { id: 'D05', title: '3D Measured Surface Verification', type: 'Technical', actId: 'A05', from: contractorName, to: clientName, note: '' },
    { id: 'D06', title: 'Execution Shop Drawings', type: 'Drawings', actId: 'A06', from: contractorName, to: clientName, note: '' },
    { id: 'D07', title: 'Material Approval Sheets (MAS) & Brand Swatches', type: 'MAS Samples', actId: 'A07', from: contractorName, to: clientName, note: '' },
    { id: 'D08', title: 'Client Design & Material Sign-Off Gate', type: 'Approval', actId: 'A09', from: clientName, to: contractorName, note: 'Critical Path' },
    ...(activities.some((a) => a.id === 'A14') ? [{ id: 'D09', title: 'Factory QC Inspection (MIR) + 20% Invoice', type: 'MIR / Financial', actId: 'A14', from: contractorName, to: clientName, note: '' }] : []),
    ...(hasMep ? [{ id: 'D10', title: 'MEP First-Fix WIR Inspection', type: 'WIR Inspection', actId: 'A18', from: 'Landlord', to: contractorName, note: '' }] : []),
    { id: 'D11', title: 'Site Installation WIR & Delivery Note', type: 'WIR / DN', actId: 'A24', from: contractorName, to: clientName, note: '' },
    { id: 'D12', title: 'Final Handover & Snag Closure Certificate', type: 'Handover', actId: 'A29', from: contractorName, to: clientName, note: '' },
  ];

  const resCatalog = [
    { id: 'R01', name: 'Project Manager', type: 'Staff', org: contractorName, role: 'Permits, CAR & client control' },
    { id: 'R02', name: 'Site Supervisor', type: 'Staff', org: contractorName, role: 'Daily site fit-out supervision' },
    { id: 'R03', name: 'Technical Designer', type: 'Staff', org: contractorName, role: '3D survey & shop drawings' },
    { id: 'R04', name: 'Joinery Factory', type: 'Subcontractor', org: 'Approved Workshop', role: 'Bespoke joinery & millwork' },
    { id: 'R05', name: 'FF&E Suppliers', type: 'Supplier', org: 'Contract Brands', role: 'Loose furniture manufacture' },
    { id: 'R06', name: 'Signage & AV Integrator', type: 'Subcontractor', org: 'Specialist', role: '3D signage & AV systems' },
    { id: 'R07', name: 'Licensed MEP Contractor', type: 'Subcontractor', org: 'Specialist', role: 'First-fix & T&C' },
    { id: 'R08', name: 'Painting Crew', type: 'Subcontractor', org: 'Specialist', role: 'Wall/ceiling finishes' },
    { id: 'R09', name: 'Installation Team', type: 'Staff', org: contractorName, role: 'FF&E & doors install' },
    { id: 'R10', name: 'Landlord / Consultant', type: 'External', org: 'Landlord', role: 'Permits & WIR sign-offs' },
    { id: 'R11', name: 'Finance Lead', type: 'Staff', org: `${contractorName} / ${clientName}`, role: 'Milestone billing' },
  ];
  const usedRes = new Set(activities.map((a) => a.resourceId));
  const resources = resCatalog
    .filter((r) => usedRes.has(r.id))
    .map((r) => {
      const assigned = activities.filter((a) => a.resourceId === r.id);
      return { ...r, actIds: assigned.map((a) => a.id), assigned };
    });

  const materials = wbsItems.slice(0, 35).map((w, idx) => ({
    id: `M${String(idx + 1).padStart(2, '0')}`,
    item: w.model || w.description.slice(0, 50),
    boqRef: w.code || w.sn,
    qtyUnit: `${w.qty} ${w.unit}`,
    finishes: w.finishSummary,
    brand: w.brand || 'Specified',
  }));

  const risks = [
    { id: 'R01', risk: 'Delay in site handover or landlord permit', category: 'External', prob: 4, impact: 4, owner: pmName, actId: 'A04', response: 'Submit CAR Day 2; apply EOT notice immediately.' },
    { id: 'R02', risk: 'Client delay in MAS & shop drawing sign-off', category: 'Client', prob: 4, impact: 5, owner: clientName, actId: 'A09', response: '48h approval SLA; split approval by trade.' },
    { id: 'R03', risk: 'Pre-delivery 20% payment lag (> 5 days)', category: 'Financial', prob: 3, impact: 4, owner: `${clientName} Finance`, actId: 'A22', response: 'Issue MIR & invoice 48h prior to factory completion.' },
    { id: 'R04', risk: 'Off-site manufacturing overrun', category: 'Supply Chain', prob: 3, impact: 5, owner: 'Production Lead', actId: offIdsByKey.joinery || offIdsByKey.furniture || 'A24', response: 'Weekly factory QC checkpoints at 50% and 80%.' },
    { id: 'R05', risk: 'Trade overlap congestion during closeout', category: 'Schedule', prob: 4, impact: 3, owner: 'Site Supervisor', actId: 'A24', response: 'Shift sequencing & zone access scheduling.' },
  ];

  const stakeholders = [
    { id: 'S01', name: `${clientName} (Client)`, role: 'Owner & Approver', power: 5, interest: 5 },
    { id: 'S02', name: `${contractorName} (Contractor)`, role: 'Turnkey Delivery', power: 5, interest: 5 },
    { id: 'S03', name: 'Landlord / Building Mgmt', role: 'Permits & WIRs', power: 5, interest: 3 },
    { id: 'S04', name: 'Manufacturers & MEP', role: 'Execution & Supply', power: 3, interest: 4 },
  ];

  const sCurve: ProjectPlanData['sCurve'] = [];
  let cumPv = 0;
  for (let day = 1; day <= durationDays + 15; day++) {
    let dayPv = 0;
    if (day <= durationDays) {
      for (const a of activities) {
        if (day >= a.startDay && day <= a.endDay && a.allocatedBac > 0) dayPv += a.allocatedBac / Math.max(1, a.duration);
      }
    }
    cumPv = Math.min(netTotal, cumPv + dayPv);
    let cumBilling = 0;
    payments.forEach((p) => { if (day >= p.day) cumBilling += p.amount; });
    sCurve.push({ day, date: ISO_DATE(ADD_DAYS(startDate, day - 1)), dailyPv: r2(dayPv), cumPv: r2(cumPv), pctWork: netTotal > 0 ? r3(cumPv / netTotal) : 0, cumBilling: r2(cumBilling), pctBilling: grossTotal > 0 ? r3(cumBilling / grossTotal) : 0 });
  }

  return {
    meta: { title, client: clientName, contractor: contractorName, pm: pmName, location: String(metaInput.locationZone || 'Site'), projectNumber: String(metaInput.projectNumber || 'PRJ-2026'), currency, vatPct, vatRate, netTotal, grossTotal, durationDays, scaleTier, floorSqm: r2(floorSqm), startDate, finishDate, startDateIso: ISO_DATE(startDate), finishDateIso: ISO_DATE(finishDate) },
    wbsItems, activities, actionItems, deliverables, resources, materials, payments, risks, stakeholders, sCurve,
  };
}

export async function buildStandaloneProjectPlanExcel(plan: ProjectPlanData): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = plan.meta.contractor;
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const NAVY = 'FF0F172A';
  const BLUE = 'FF1D4ED8';
  const SLATE = 'FF334155';
  const INPUT_BG = 'FFFEF9C3';
  const GANTT_BAR = 'FF2563EB';
  const MILESTONE_BAR = 'FFD97706';
  const BORDER_CLR = 'FFCBD5E1';

  const styleHdr = (row: import('exceljs').Row, bg = NAVY) => {
    row.eachCell((cell) => {
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: BORDER_CLR } } };
    });
    row.height = 25;
  };
  const styleBanner = (ws: import('exceljs').Worksheet, title: string, subtitle: string, cols = 10) => {
    ws.mergeCells(1, 1, 1, cols);
    ws.getCell(1, 1).value = title;
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    ws.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    ws.getCell(1, 1).alignment = { vertical: 'middle', indent: 1 };
    ws.getRow(1).height = 28;
    ws.mergeCells(2, 1, 2, cols);
    ws.getCell(2, 1).value = subtitle;
    ws.getCell(2, 1).font = { size: 10, color: { argb: SLATE } };
    ws.getRow(2).height = 20;
  };

  const actLastRow = 5 + plan.activities.length;
  const wbsLastRow = 5 + plan.wbsItems.length;
  const delivLastRow = 4 + plan.deliverables.length;
  const riskLastRow = 4 + plan.risks.length;

  const wsDash = wb.addWorksheet('Dashboard | لوحة المعلومات');
  styleBanner(wsDash, `${plan.meta.title} — Executive Project Control Dashboard`, `${plan.meta.scaleTier} · ${plan.meta.durationDays} Calendar Days · Client: ${plan.meta.client}`, 10);
  wsDash.getRow(4).values = ['Contract Parameter', 'Value', 'Notes', '', 'Schedule Assumption', 'Value', 'Unit'];
  styleHdr(wsDash.getRow(4), SLATE);
  wsDash.getRow(5).values = ['Project Name', plan.meta.title, plan.meta.projectNumber, '', 'Baseline Start Date', plan.meta.startDate, 'YYYY-MM-DD'];
  wsDash.getRow(6).values = ['Client', plan.meta.client, plan.meta.location, '', 'Status Date', new Date(), '=TODAY()'];
  wsDash.getRow(7).values = [`Net Value (${plan.meta.currency})`, { formula: `='Scope & WBS'!J${wbsLastRow + 1}` }, 'Excl. VAT', '', 'Contract Duration (Days)', plan.meta.durationDays, 'Days'];
  wsDash.getRow(8).values = [`VAT (${plan.meta.vatPct}%)`, { formula: `=B7*${plan.meta.vatRate}` }, 'Tax', '', 'Planned Finish Date', { formula: '=F5+F7-1' }, 'Formula'];
  wsDash.getRow(9).values = [`Gross Total (${plan.meta.currency})`, { formula: '=B7+B8' }, 'Incl. VAT', '', 'Current Day', { formula: '=MAX(0,MIN(F7,F6-F5+1))' }, 'Day #'];
  [wsDash.getCell('F5'), wsDash.getCell('F6'), wsDash.getCell('F7')].forEach((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_BG } }; c.font = { bold: true, color: { argb: BLUE } }; });
  wsDash.getCell('F5').numFmt = 'yyyy-mm-dd';
  wsDash.getCell('F6').numFmt = 'yyyy-mm-dd';
  wsDash.getCell('F8').numFmt = 'yyyy-mm-dd';
  [wsDash.getCell('B7'), wsDash.getCell('B8'), wsDash.getCell('B9')].forEach((c) => { c.numFmt = '#,##0.00'; c.font = { bold: true }; });
  wsDash.getRow(11).values = ['EVM KPI', 'Value', 'Description', '', 'Operations KPI', 'Value', 'Target'];
  styleHdr(wsDash.getRow(11), BLUE);
  wsDash.getRow(12).values = ['Actual %', { formula: `='Schedule & Gantt'!P${actLastRow + 1}` }, 'Weighted', '', 'Completed Acts', { formula: `=COUNTIF('Schedule & Gantt'!R6:R${actLastRow},"Completed")` }, `of ${plan.activities.length}`];
  wsDash.getRow(13).values = ['Planned %', { formula: `=IF(B7=0,0,B15/B7)` }, 'Baseline', '', 'Delayed Acts', { formula: `=COUNTIF('Schedule & Gantt'!R6:R${actLastRow},"Delayed")` }, '0 Target'];
  wsDash.getRow(14).values = ['SPI', { formula: '=IF(B15=0,1,B16/B15)' }, '>= 1.00', '', 'Deliverables Done', { formula: `=COUNTIF(Deliverables!K5:K${delivLastRow},"Done")` }, `of ${plan.deliverables.length}`];
  wsDash.getRow(15).values = ['Planned Value PV', { formula: `='Schedule & Gantt'!T${actLastRow + 1}` }, 'Cumulative', '', 'Open High Risks', { formula: `=COUNTIFS(Risks!I5:I${riskLastRow},"High",Risks!K5:K${riskLastRow},"Open")` }, 'Monitor'];
  wsDash.getRow(16).values = ['Earned Value EV', { formula: `='Schedule & Gantt'!U${actLastRow + 1}` }, 'Earned', '', 'Gross Contract', { formula: '=B9' }, plan.meta.currency];
  wsDash.getCell('B12').numFmt = '0.0%';
  wsDash.getCell('B13').numFmt = '0.0%';
  wsDash.getCell('B14').numFmt = '0.00';
  [wsDash.getCell('B15'), wsDash.getCell('B16'), wsDash.getCell('F16')].forEach((c) => { c.numFmt = '#,##0.00'; });
  [22, 18, 26, 4, 26, 16, 20].forEach((w, i) => { wsDash.getColumn(i + 1).width = w; });

  const wsAct = wb.addWorksheet('Action Plan | خطة العمل');
  styleBanner(wsAct, `Project Action Tracker | خطة العمل (${plan.meta.title})`, 'Synced 1:1 with Master Gantt schedule', 10);
  wsAct.getRow(4).values = ['ID', 'Done', 'Action', 'Owner', 'Start Date', 'Due Date', 'Priority', 'Status', '% Complete', 'Notes'];
  styleHdr(wsAct.getRow(4));
  plan.actionItems.forEach((it, idx) => {
    const row = wsAct.getRow(5 + idx);
    row.values = [it.id, '', it.action, it.owner, { formula: `='Schedule & Gantt'!K${6 + idx}` }, { formula: `='Schedule & Gantt'!L${6 + idx}` }, it.priority, { formula: `='Schedule & Gantt'!R${6 + idx}` }, { formula: `='Schedule & Gantt'!P${6 + idx}` }, it.notes];
    row.getCell(5).numFmt = 'yyyy-mm-dd';
    row.getCell(6).numFmt = 'yyyy-mm-dd';
    row.getCell(9).numFmt = '0%';
  });
  [6, 7, 50, 22, 13, 13, 11, 13, 12, 32].forEach((w, i) => { wsAct.getColumn(i + 1).width = w; });

  const wsInst = wb.addWorksheet('Instructions | تعليمات');
  styleBanner(wsInst, 'Operating Guide & EVM Assumptions', 'Weekly update SOP and 80/20 Earned Value convention', 6);
  wsInst.getRow(4).values = ['Rule', 'Description'];
  styleHdr(wsInst.getRow(4), SLATE);
  wsInst.getRow(5).values = ['Yellow Cells', 'Editable inputs (dates, actual durations, % complete, invoices)'];
  wsInst.getRow(6).values = ['EVM 80 / 20', 'Off-site manufacturing earns 80% on MIR, 20% on site installation'];
  wsInst.getColumn(1).width = 24;
  wsInst.getColumn(2).width = 92;

  const wsWbs = wb.addWorksheet('Scope & WBS');
  styleBanner(wsWbs, 'Scope & Work Breakdown Structure (WBS)', 'Mapped from measured 3D geometry & BOQ', 12);
  wsWbs.getRow(4).values = ['WBS', 'Code', 'Trade', 'Description', 'Official Finishes', 'Unit', 'Qty', 'Exec Act', 'Install Act', `Net (${plan.meta.currency})`, '% Done', 'Status'];
  styleHdr(wsWbs.getRow(4));
  plan.wbsItems.forEach((w, idx) => {
    const r = 5 + idx;
    const row = wsWbs.getRow(r);
    row.values = [w.wbsCode, w.code || w.sn, w.tradeLabel, w.description, w.finishSummary, w.unit, w.qty, w.execActId, w.installActId || '-', w.amount, { formula: `=IF(J${r}=0,0,'Cost, EV & S-Curve'!O${7 + idx}/J${r})` }, { formula: `=IF(K${r}>=0.99,"Completed",IF(K${r}>0,"In Progress","Not Started"))` }];
    row.getCell(10).numFmt = '#,##0.00';
    row.getCell(11).numFmt = '0%';
  });
  wsWbs.getRow(wbsLastRow + 1).values = ['TOTAL BAC', '', '', '', '', '', '', '', '', { formula: `=SUM(J5:J${wbsLastRow})` }, '', ''];
  wsWbs.getRow(wbsLastRow + 1).font = { bold: true };
  wsWbs.getRow(wbsLastRow + 1).getCell(10).numFmt = '#,##0.00';
  [12, 13, 28, 44, 34, 8, 9, 12, 12, 16, 11, 13].forEach((w, i) => { wsWbs.getColumn(i + 1).width = w; });

  const totalGanttDays = plan.meta.durationDays + 15;
  const wsSch = wb.addWorksheet('Schedule & Gantt');
  styleBanner(wsSch, `Master CPM Schedule (${plan.meta.durationDays} Days)`, 'Visual Gantt & Earned Value formulas', 21 + totalGanttDays);
  wsSch.getRow(4).values = ['ID', 'Phase', 'Activity', 'Type', 'BOQ', 'Owner', 'Pred', 'Start(d)', 'Dur(d)', 'End(d)', 'Start Date', 'End Date', 'Act Start', 'Act Dur', 'Forecast', '% Done', 'Plan %', 'Status', `BAC`, 'PV', 'EV', ...Array.from({ length: totalGanttDays }, (_, i) => i + 1)];
  styleHdr(wsSch.getRow(4));
  const costEndRow = 6 + plan.wbsItems.length;
  plan.activities.forEach((a, idx) => {
    const r = 6 + idx;
    const row = wsSch.getRow(r);
    row.values = [a.id, a.phase, a.name, a.type, a.boqRef, a.owner, a.predText, a.startDay, a.duration, { formula: `=H${r}+I${r}-1` }, { formula: `='Dashboard | لوحة المعلومات'!$F$5+H${r}-1` }, { formula: `='Dashboard | لوحة المعلومات'!$F$5+J${r}-1` }, '', '', { formula: `=IF(M${r}="",J${r},M${r}+IF(N${r}="",I${r},N${r})-1)` }, 0, { formula: `=MAX(0,MIN(1,('Dashboard | لوحة المعلومات'!$F$9-H${r}+1)/I${r}))` }, { formula: `=IF(P${r}>=1,"Completed",IF(OR(Q${r}>P${r}+0.0001,O${r}>J${r}),"Delayed",IF(P${r}>0,"In Progress","Not Started")))` }, { formula: `=SUMIFS('Cost, EV & S-Curve'!$K$7:$K$${costEndRow},'Cost, EV & S-Curve'!$H$7:$H$${costEndRow},A${r})+SUMIFS('Cost, EV & S-Curve'!$L$7:$L$${costEndRow},'Cost, EV & S-Curve'!$I$7:$I$${costEndRow},A${r})` }, { formula: `=S${r}*Q${r}` }, { formula: `=S${r}*P${r}` }];
    row.getCell(11).numFmt = 'yyyy-mm-dd';
    row.getCell(12).numFmt = 'yyyy-mm-dd';
    row.getCell(16).numFmt = '0%';
    row.getCell(17).numFmt = '0%';
    [19, 20, 21].forEach((ci) => { row.getCell(ci).numFmt = '#,##0.00'; });
    for (let d = 1; d <= totalGanttDays; d++) {
      if (d >= a.startDay && d <= a.endDay) {
        const gc = row.getCell(21 + d);
        gc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: a.type === 'Milestone' ? MILESTONE_BAR : GANTT_BAR } };
        if (a.type === 'Milestone') { gc.value = '◆'; gc.font = { color: { argb: 'FFFFFFFF' } }; gc.alignment = { horizontal: 'center' }; }
      }
    }
  });
  wsSch.getRow(actLastRow + 1).values = ['TOTAL', '', 'Totals', '', '', '', '', '', plan.meta.durationDays, '', '', '', '', '', { formula: `=MAX(O6:O${actLastRow})` }, { formula: `=IF(S${actLastRow + 1}=0,0,U${actLastRow + 1}/S${actLastRow + 1})` }, { formula: `=IF(S${actLastRow + 1}=0,0,T${actLastRow + 1}/S${actLastRow + 1})` }, '', { formula: `=SUM(S6:S${actLastRow})` }, { formula: `=SUM(T6:T${actLastRow})` }, { formula: `=SUM(U6:U${actLastRow})` }];
  wsSch.getRow(actLastRow + 1).font = { bold: true };
  [7, 24, 44, 10, 14, 20, 14, 10, 10, 10, 12, 12, 10, 10, 12, 10, 10, 12, 14, 13, 13].forEach((w, i) => { wsSch.getColumn(i + 1).width = w; });
  for (let d = 1; d <= totalGanttDays; d++) wsSch.getColumn(21 + d).width = 3.2;

  const wsDel = wb.addWorksheet('Deliverables');
  styleBanner(wsDel, 'Submittals & Deliverables Register (MAS / MIR / WIR / DN)', 'Linked to Schedule dates', 12);
  wsDel.getRow(4).values = ['ID', 'Deliverable', 'Type', 'Act ID', 'From', 'To', 'Plan Day', 'Plan Date', 'Act Date', 'Status', 'Flag', 'Notes'];
  styleHdr(wsDel.getRow(4));
  plan.deliverables.forEach((d, idx) => {
    const r = 5 + idx;
    const row = wsDel.getRow(r);
    row.values = [d.id, d.title, d.type, d.actId, d.from, d.to, { formula: `=INDEX('Schedule & Gantt'!$J$6:$J$${actLastRow},MATCH(D${r},'Schedule & Gantt'!$A$6:$A$${actLastRow},0))` }, { formula: `='Dashboard | لوحة المعلومات'!$F$5+G${r}-1` }, '', 'Not Submitted', { formula: `=IF(OR(J${r}="Approved",J${r}="Received"),"Done",IF('Dashboard | لوحة المعلومات'!$F$9>G${r},"Overdue","On Track"))` }, d.note];
    row.getCell(8).numFmt = 'yyyy-mm-dd';
  });
  [8, 42, 15, 10, 18, 18, 10, 12, 12, 14, 11, 24].forEach((w, i) => { wsDel.getColumn(i + 1).width = w; });

  const wsRes = wb.addWorksheet('Resources & Materials');
  styleBanner(wsRes, 'Resources & Key Materials (Official Finishes)', 'Daily histogram + Finish spec', 9 + plan.meta.durationDays);
  wsRes.getRow(4).values = ['ID', 'Resource', 'Type', 'Org', 'Role', 'Activities', 'Start', 'End', 'Days', ...Array.from({ length: plan.meta.durationDays }, (_, i) => i + 1)];
  styleHdr(wsRes.getRow(4));
  plan.resources.forEach((res, idx) => {
    const row = wsRes.getRow(5 + idx);
    const s = Math.min(...res.assigned.map((a) => a.startDay));
    const e = Math.max(...res.assigned.map((a) => a.endDay));
    row.values = [res.id, res.name, res.type, res.org, res.role, res.actIds.join(', '), s, e, e - s + 1];
    for (let d = 1; d <= plan.meta.durationDays; d++) {
      if (res.assigned.some((a) => d >= a.startDay && d <= a.endDay)) {
        const c = row.getCell(9 + d);
        c.value = 1;
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
      }
    }
  });
  const mRow = 7 + plan.resources.length;
  wsRes.getRow(mRow).values = ['ID', 'Material', 'Code', 'Qty', 'Official Finishes', 'Brand'];
  styleHdr(wsRes.getRow(mRow), SLATE);
  plan.materials.forEach((m, i) => { wsRes.getRow(mRow + 1 + i).values = [m.id, m.item, m.boqRef, m.qtyUnit, m.finishes, m.brand]; });
  [8, 30, 14, 18, 36, 22, 10, 10, 10].forEach((w, i) => { wsRes.getColumn(i + 1).width = w; });

  const wsCost = wb.addWorksheet('Cost, EV & S-Curve');
  styleBanner(wsCost, `Cost Control, 80/20 EV Split & S-Curve (${plan.meta.currency})`, 'Exact BAC + VAT reconciliation', 16);
  wsCost.getRow(6).values = ['SN', 'Trade', 'Description', 'Unit', 'Qty', 'Rate', 'Amount', 'Exec Act', 'Install Act', 'Exec Wt', 'Alloc Exec', 'Alloc Inst', '% Done', 'PV', 'EV', 'AC'];
  styleHdr(wsCost.getRow(6));
  plan.wbsItems.forEach((w, idx) => {
    const r = 7 + idx;
    const row = wsCost.getRow(r);
    row.values = [w.code || w.sn, w.tradeLabel, w.description, w.unit, w.qty, w.rate, { formula: `=E${r}*F${r}` }, w.execActId, w.installActId || '', w.execWeight, { formula: `=G${r}*J${r}` }, { formula: `=G${r}-K${r}` }, { formula: `=IF(G${r}=0,0,O${r}/G${r})` }, { formula: `=K${r}*INDEX('Schedule & Gantt'!$Q$6:$Q$${actLastRow},MATCH(H${r},'Schedule & Gantt'!$A$6:$A$${actLastRow},0))+IF(I${r}="",0,L${r}*INDEX('Schedule & Gantt'!$Q$6:$Q$${actLastRow},MATCH(I${r},'Schedule & Gantt'!$A$6:$A$${actLastRow},0)))` }, { formula: `=K${r}*INDEX('Schedule & Gantt'!$P$6:$P$${actLastRow},MATCH(H${r},'Schedule & Gantt'!$A$6:$A$${actLastRow},0))+IF(I${r}="",0,L${r}*INDEX('Schedule & Gantt'!$P$6:$P$${actLastRow},MATCH(I${r},'Schedule & Gantt'!$A$6:$A$${actLastRow},0)))` }, ''];
    [6, 7, 11, 12, 14, 15, 16].forEach((ci) => { row.getCell(ci).numFmt = '#,##0.00'; });
    row.getCell(13).numFmt = '0%';
  });
  const totR = 7 + plan.wbsItems.length;
  wsCost.getRow(totR).values = ['TOTAL BAC', '', '', '', '', '', { formula: `=SUM(G7:G${totR - 1})` }, '', '', '', { formula: `=SUM(K7:K${totR - 1})` }, { formula: `=SUM(L7:L${totR - 1})` }, { formula: `=IF(G${totR}=0,0,O${totR}/G${totR})` }, { formula: `=SUM(N7:N${totR - 1})` }, { formula: `=SUM(O7:O${totR - 1})` }, { formula: `=SUM(P7:P${totR - 1})` }];
  wsCost.getRow(totR).font = { bold: true };
  [12, 24, 38, 8, 9, 12, 14, 10, 10, 9, 12, 12, 10, 12, 12, 12].forEach((w, i) => { wsCost.getColumn(i + 1).width = w; });

  const wsRisk = wb.addWorksheet('Risks');
  styleBanner(wsRisk, 'Risk Register (5x5 Scoring)', 'Prob × Impact', 11);
  wsRisk.getRow(4).values = ['ID', 'Risk', 'Category', 'Prob', 'Impact', 'Score', 'Level', 'Mitigation', 'Owner', 'Activity', 'Status'];
  styleHdr(wsRisk.getRow(4), 'FF991B1B');
  plan.risks.forEach((rk, i) => {
    const r = 5 + i;
    wsRisk.getRow(r).values = [rk.id, rk.risk, rk.category, rk.prob, rk.impact, { formula: `=D${r}*E${r}` }, { formula: `=IF(F${r}>=15,"High",IF(F${r}>=8,"Medium","Low"))` }, rk.response, rk.owner, rk.actId, 'Open'];
  });
  [8, 40, 16, 8, 8, 8, 10, 44, 20, 10, 10].forEach((w, i) => { wsRisk.getColumn(i + 1).width = w; });

  const wsStk = wb.addWorksheet('Stakeholders & RACI');
  styleBanner(wsStk, 'Stakeholders & Governance RACI', 'Power × Interest matrix', 6);
  wsStk.getRow(4).values = ['ID', 'Stakeholder', 'Role', 'Power', 'Interest', 'Strategy'];
  styleHdr(wsStk.getRow(4));
  plan.stakeholders.forEach((s, i) => {
    const r = 5 + i;
    wsStk.getRow(r).values = [s.id, s.name, s.role, s.power, s.interest, { formula: `=IF(AND(D${r}>=4,E${r}>=4),"Manage Closely",IF(D${r}>=4,"Keep Satisfied","Keep Informed"))` }];
  });
  [8, 36, 24, 10, 10, 18].forEach((w, i) => { wsStk.getColumn(i + 1).width = w; });

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function buildStandaloneMsProjectXml(plan: ProjectPlanData): Blob {
  const isoTs = (d: Date, hour = 8) => `${ISO_DATE(d)}T${String(hour).padStart(2, '0')}:00:00`;
  const durPt = (days: number) => `PT${Math.max(0, days * 8)}H0M0S`;
  const uidByAct = new Map<string, number>();
  let nextUid = 1;
  const phases: { name: string; uid: number; list: ProjectPlanData['activities'] }[] = [];
  const byPhase = new Map<string, ProjectPlanData['activities']>();
  plan.activities.forEach((a) => {
    if (!byPhase.has(a.phase)) {
      const list: ProjectPlanData['activities'] = [];
      byPhase.set(a.phase, list);
      phases.push({ name: a.phase, uid: 0, list });
    }
    byPhase.get(a.phase)!.push(a);
  });
  phases.forEach((p) => {
    p.uid = nextUid++;
    p.list.forEach((a) => uidByAct.set(a.id, nextUid++));
  });

  const taskNodes: string[] = [
    `    <Task><UID>0</UID><ID>0</ID><Name>${escXml(plan.meta.title)}</Name><Type>1</Type><OutlineNumber>0</OutlineNumber><OutlineLevel>0</OutlineLevel><Start>${isoTs(plan.meta.startDate, 8)}</Start><Finish>${isoTs(plan.meta.finishDate, 17)}</Finish><Duration>${durPt(plan.meta.durationDays)}</Duration><Summary>1</Summary><Milestone>0</Milestone><Baseline><Number>0</Number><Cost>${r2(plan.meta.netTotal)}</Cost></Baseline></Task>`,
  ];
  let seqId = 1;
  phases.forEach((ph, pIdx) => {
    const pOut = String(pIdx + 1);
    const pStart = ADD_DAYS(plan.meta.startDate, Math.min(...ph.list.map((a) => a.startDay)) - 1);
    const pEnd = ADD_DAYS(plan.meta.startDate, Math.max(...ph.list.map((a) => a.endDay)) - 1);
    const pDur = Math.max(...ph.list.map((a) => a.endDay)) - Math.min(...ph.list.map((a) => a.startDay)) + 1;
    taskNodes.push(`    <Task><UID>${ph.uid}</UID><ID>${seqId++}</ID><Name>${escXml(ph.name)}</Name><Type>1</Type><OutlineNumber>${pOut}</OutlineNumber><OutlineLevel>1</OutlineLevel><Start>${isoTs(pStart, 8)}</Start><Finish>${isoTs(pEnd, 17)}</Finish><Duration>${durPt(pDur)}</Duration><Summary>1</Summary><Milestone>0</Milestone></Task>`);
    ph.list.forEach((a, subIdx) => {
      const uid = uidByAct.get(a.id)!;
      const isMile = a.type === 'Milestone';
      const preds = a.predIds.map((pid) => uidByAct.get(pid)).filter(Boolean).map((pUid) => `<PredecessorLink><PredecessorUID>${pUid}</PredecessorUID><Type>${a.id === 'A25' ? 3 : 1}</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`).join('');
      taskNodes.push(`    <Task><UID>${uid}</UID><ID>${seqId++}</ID><Name>${escXml(`${a.id}: ${a.name}`)}</Name><Type>0</Type><OutlineNumber>${pOut}.${subIdx + 1}</OutlineNumber><OutlineLevel>2</OutlineLevel><Start>${isoTs(ADD_DAYS(plan.meta.startDate, a.startDay - 1), 8)}</Start><Finish>${isoTs(ADD_DAYS(plan.meta.startDate, a.endDay - 1), isMile ? 8 : 17)}</Finish><Duration>${isMile ? 'PT0H0M0S' : durPt(a.duration)}</Duration><Summary>0</Summary><Milestone>${isMile ? 1 : 0}</Milestone><Notes>${escXml(`BOQ: ${a.boqRef} | Owner: ${a.owner}`)}</Notes>${preds}<Baseline><Number>0</Number><Cost>${r2(a.allocatedBac)}</Cost></Baseline></Task>`);
    });
  });

  const resNodes = plan.resources.map((r, i) => `    <Resource><UID>${i + 1}</UID><ID>${i + 1}</ID><Name>${escXml(`${r.id} - ${r.name}`)}</Name><Type>1</Type><Group>${escXml(r.org)}</Group></Resource>`);
  const resMap = new Map(plan.resources.map((r, i) => [r.id, i + 1]));
  const assignNodes = plan.activities.map((a, idx) => {
    const tUid = uidByAct.get(a.id);
    const rUid = resMap.get(a.resourceId);
    if (!tUid || !rUid) return '';
    return `    <Assignment><UID>${idx + 1}</UID><TaskUID>${tUid}</TaskUID><ResourceUID>${rUid}</ResourceUID><Units>1</Units><Cost>${r2(a.allocatedBac)}</Cost></Assignment>`;
  }).filter(Boolean);

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion>
  <Name>${escXml(plan.meta.title)}</Name>
  <StartDate>${isoTs(plan.meta.startDate, 8)}</StartDate>
  <FinishDate>${isoTs(plan.meta.finishDate, 17)}</FinishDate>
  <CurrencyCode>${escXml(plan.meta.currency)}</CurrencyCode>
  <Tasks>
${taskNodes.join('\n')}
  </Tasks>
  <Resources>
${resNodes.join('\n')}
  </Resources>
  <Assignments>
${assignNodes.join('\n')}
  </Assignments>
</Project>`;
  return new Blob([xml], { type: 'application/xml;charset=utf-8' });
}

// features/project-export/standalone-export-suite.ts
// Generates the complete BOQFLOW-equivalent Design & Build export suite directly
// inside standalone Design & Build (http://localhost:3003):
// BOQ/, Submittals/, Programme/, Drawings/, Presentation/, FF&E/, Renders/, Model/, Reports/.

import type { ViewerHandle } from 'design-build-simplified-viewer-shell';
import { getPascalStores } from 'design-build-simplified-viewer-shell';
import {
  computeSceneGeometricTakeoff,
  synthesizeStandaloneBoqFromTakeoff,
  type GeometricTakeoff,
  type StandaloneBoqRow,
} from '@/features/boq/geometric-takeoff';
import {
  buildStandaloneMsProjectXml,
  buildStandaloneProjectPlan,
  buildStandaloneProjectPlanExcel,
  type ProjectPlanMetaInput,
} from '@/features/project-export/dynamic-project-planner';
import { filterCommercialNodes } from '@/features/project-export/ExportRail';
import { productRefs } from '@/features/furniture/product-refs';
import { captureViewForRender, readPlanUnderlay } from '@/features/render/capture-view';
import type { PlanFurniture } from '@/features/furniture/plan-furniture';

export type StandaloneExportKind =
  | 'BOQ Excel'
  | 'BOQ Summary'
  | 'Submittals (MAS/MIR/WIR/DN)'
  | 'Project Plan (.xlsx)'
  | 'MS Project (.xml)'
  | 'Mood Board'
  | 'Design & Build Presentation'
  | 'FF&E Schedule'
  | 'Drawing Package'
  | 'Scene JSON'
  | 'Photorealistic Renders'
  | 'Extraction Audit'
  | 'Full Design & Build Package';

export interface StandaloneRenderEntry {
  id: string;
  imageUrl: string;
  style?: string;
  viewKind?: string;
  modelLabel?: string;
  score?: number;
  approved?: boolean;
}

export interface StandaloneExportContext {
  viewerHandle: ViewerHandle | null;
  projectMeta: ProjectPlanMetaInput & {
    company?: string;
    website?: string;
    consultant?: string;
    revision?: string;
  };
  planFileName?: string;
  sourcePdfBytes?: Uint8Array | null;
  planFurniture?: PlanFurniture | null;
  boqRows?: StandaloneBoqRow[] | null;
  takeoff?: GeometricTakeoff | null;
  renders?: StandaloneRenderEntry[];
  onProgress?: (label: string, fraction?: number) => void;
}

interface DivisionInfo {
  key: 'furniture' | 'joinery' | 'fitout';
  title: string;
  shortTitle: string;
  accent: string;
}

const DIVISIONS: DivisionInfo[] = [
  { key: 'furniture', title: 'Loose Furniture & Seating Systems', shortTitle: 'Loose Furniture', accent: '2563EB' },
  { key: 'joinery', title: 'Custom Joinery & Bespoke Millwork', shortTitle: 'Custom Joinery', accent: '7C3AED' },
  { key: 'fitout', title: 'Architectural Fit-Out & Surface Finishes', shortTitle: 'Architectural Fit-Out', accent: '0D9488' },
];

const NAVY = '0F172A';
const ACCENT = '2563EB';
const INK = '1E293B';
const MUTED = '64748B';
const LINE = 'CBD5E1';
const SOFT = 'F8FAFC';

function clip(v: unknown, max = 90): string {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function money(v: number): string {
  return Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function rgb(hex: string): [number, number, number] {
  const c = String(hex || '#0F172A').replace('#', '');
  return [
    parseInt(c.slice(0, 2), 16) || 15,
    parseInt(c.slice(2, 4), 16) || 23,
    parseInt(c.slice(4, 6), 16) || 42,
  ];
}

function safeSlug(title: string): string {
  return (title || 'Design_Build_Project').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Design_Build_Project';
}

function containBox(w: number, h: number, box: { x: number; y: number; w: number; h: number }) {
  if (!w || !h) return box;
  const s = Math.min(box.w / w, box.h / h);
  const rw = w * s;
  const rh = h * s;
  return { x: box.x + (box.w - rw) / 2, y: box.y + (box.h - rh) / 2, w: rw, h: rh };
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mimeMatch = head.match(/data:([^;]+)/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const bin = atob(body || '');
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

async function imageToJpegData(url: string, maxDim = 1800): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const img = await loadImg(url);
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(1, Math.round((img.naturalWidth || 800) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || 600) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#FFFFFF';
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.88), width: w, height: h };
  } catch {
    return null;
  }
}

function renderSwatchCardJpeg(row: StandaloneBoqRow): { dataUrl: string; width: number; height: number } {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 300;
  const g = canvas.getContext('2d');
  if (!g) return { dataUrl: '', width: 480, height: 300 };

  const sws = row.finishes?.length
    ? row.finishes
    : [{ role: 'Finish', code: row.code, name: 'Manufacturer Standard', hex: row.division === 'fitout' ? '#0D9488' : row.division === 'joinery' ? '#7C3AED' : '#2563EB' }];

  g.fillStyle = '#F8FAFC';
  g.fillRect(0, 0, 480, 300);

  // Header band
  g.fillStyle = '#0F172A';
  g.fillRect(0, 0, 480, 44);
  g.fillStyle = '#FFFFFF';
  g.font = 'bold 16px Arial, sans-serif';
  g.fillText(clip(`${row.code} · ${row.brand}`, 40), 18, 28);

  // Large finish swatch panels
  const panelW = Math.floor((480 - 36 - (sws.length - 1) * 12) / sws.length);
  sws.slice(0, 3).forEach((sw, i) => {
    const x = 18 + i * (panelW + 12);
    g.fillStyle = sw.hex || '#94A3B8';
    g.fillRect(x, 60, panelW, 130);
    g.strokeStyle = '#CBD5E1';
    g.lineWidth = 2;
    g.strokeRect(x, 60, panelW, 130);
    g.fillStyle = '#0F172A';
    g.font = 'bold 12px Arial, sans-serif';
    g.fillText(clip(sw.role, 18), x, 212);
    g.fillStyle = '#334155';
    g.font = '12px Arial, sans-serif';
    g.fillText(clip(`${sw.code} — ${sw.name}`, 24), x, 230);
  });

  g.fillStyle = '#64748B';
  g.font = '12px Arial, sans-serif';
  g.fillText(clip(`${row.model}  ·  ${row.qty} ${row.unit}  ·  ${row.basis}`, 62), 18, 272);

  return { dataUrl: canvas.toDataURL('image/jpeg', 0.9), width: 480, height: 300 };
}

function resolveSnapshotData(ctx: StandaloneExportContext) {
  const stores = getPascalStores();
  const rawNodes = (stores?.useScene.getState().nodes ?? {}) as Record<string, unknown>;
  const safeNodes = filterCommercialNodes(rawNodes);
  const takeoff = ctx.takeoff ?? computeSceneGeometricTakeoff(safeNodes, ctx.planFurniture);
  const boqRows = (ctx.boqRows && ctx.boqRows.length ? ctx.boqRows : synthesizeStandaloneBoqFromTakeoff(takeoff)).slice();
  // Group strictly by Division: furniture -> joinery -> fitout
  const divOrder: Record<string, number> = { furniture: 1, joinery: 2, fitout: 3 };
  boqRows.sort((a, b) => (divOrder[a.division] ?? 9) - (divOrder[b.division] ?? 9) || a.sn.localeCompare(b.sn));

  const refs = productRefs();
  const title = clip(ctx.projectMeta.projectName || ctx.planFileName?.replace(/\.[^.]+$/, '') || 'Design & Build Project', 72);
  const company = clip(ctx.projectMeta.company || 'Design & Build Studio', 48);
  const client = clip(ctx.projectMeta.clientName || '', 48);
  const currency = clip(ctx.projectMeta.currency || 'OMR', 8);
  const dateStr = ctx.projectMeta.issueDate || new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const vatPct = Number.isFinite(Number(ctx.projectMeta.vatPercent)) ? Number(ctx.projectMeta.vatPercent) : 5;

  return { safeNodes, takeoff, boqRows, refs, title, slug: safeSlug(title), company, client, currency, dateStr, vatPct };
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function captureSceneViews(handle: ViewerHandle | null) {
  const out: { overview?: string; top?: string; plain?: string } = {};
  if (handle) {
    try {
      const ov = await captureViewForRender(handle, { frameBuilding: true, pads: true });
      out.overview = ov?.dataUrl;
      out.top = ov?.dataUrl;
    } catch { /* ignore */ }
  }
  try {
    const u = await readPlanUnderlay(2200);
    if (u) out.plain = u;
  } catch { /* ignore */ }
  return out;
}

// ------------------------------------------------------------------ BOQ Excel

async function makeBoqExcelBlob(snap: ReturnType<typeof resolveSnapshotData>): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = snap.company;
  wb.created = new Date();
  const ws = wb.addWorksheet('Detailed BOQ', { properties: { tabColor: { argb: `FF${ACCENT}` } } });
  const headers = ['Ref', 'Division', 'Category', 'Brand', 'Model / Code', 'Specification & Scope', 'Official Brand Finishes', 'Qty', 'Unit', `Rate (${snap.currency})`, `Amount (${snap.currency})`, '3D Geometric Basis'];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

  ws.mergeCells(1, 1, 1, headers.length);
  ws.getCell(1, 1).value = `${snap.title} — Post-Build Geometric Bill of Quantities`;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: `FF${NAVY}` } };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, headers.length);
  ws.getCell(2, 1).value = [snap.client ? `Client: ${snap.client}` : '', `Issue Date: ${snap.dateStr}`, `Net Floor: ${snap.takeoff.netFloorAreaM2.toFixed(2)} m²`, `Net Wall Paint: ${snap.takeoff.solidWallNetPaintAreaM2.toFixed(2)} m²`].filter(Boolean).join('  ·  ');
  ws.getCell(2, 1).font = { size: 9.5, color: { argb: `FF${MUTED}` } };

  [9, 18, 22, 18, 22, 48, 36, 10, 9, 14, 16, 30].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  const hr = ws.getRow(4);
  hr.values = headers;
  hr.height = 24;
  hr.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${NAVY}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });

  let r = 5;
  let activeDiv = '';
  let netTotal = 0;
  for (const item of snap.boqRows) {
    if (item.division !== activeDiv) {
      activeDiv = item.division;
      const dInfo = DIVISIONS.find((d) => d.key === activeDiv) ?? DIVISIONS[0];
      ws.mergeCells(r, 1, r, headers.length);
      const dr = ws.getRow(r);
      dr.getCell(1).value = dInfo.title.toUpperCase();
      dr.getCell(1).font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      dr.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${dInfo.accent}` } };
      dr.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      dr.height = 21;
      r++;
    }
    const amt = Math.round(Number(item.qty || 0) * Number(item.rate || 0) * 100) / 100;
    netTotal += amt;
    const finishText = item.finishes.map((f) => `${f.role}: ${f.code} (${f.name})`).join(' | ');
    const xr = ws.getRow(r);
    xr.values = [
      item.sn,
      DIVISIONS.find((d) => d.key === item.division)?.shortTitle ?? item.division,
      item.category,
      item.brand,
      item.model,
      item.description,
      finishText,
      item.qty,
      item.unit,
      item.rate,
      { formula: `H${r}*I${r}`, result: amt },
      item.basis,
    ];
    xr.getCell(11).value = { formula: `H${r}*J${r}`, result: amt };
    xr.height = 34;
    xr.eachCell((cell, col) => {
      cell.font = { size: 9.5, color: { argb: `FF${INK}` } };
      cell.alignment = { vertical: 'middle', horizontal: [6, 7, 12].includes(col) ? 'left' : 'center', wrapText: [6, 7, 12].includes(col) };
      cell.border = { bottom: { style: 'hair', color: { argb: `FF${LINE}` } } };
      if (col === 8) cell.numFmt = '#,##0.##';
      if (col === 10 || col === 11) cell.numFmt = '#,##0.00';
    });
    r++;
  }

  const vatAmt = Math.round(netTotal * (snap.vatPct / 100) * 100) / 100;
  const grandTotal = netTotal + vatAmt;
  [
    ['Subtotal (Excl. VAT)', netTotal],
    [`VAT (${snap.vatPct}%)`, vatAmt],
    [`Grand Total (${snap.currency})`, grandTotal],
  ].forEach(([lbl, val], idx) => {
    const tr = ws.getRow(r + 1 + idx);
    tr.getCell(10).value = String(lbl);
    tr.getCell(11).value = Number(val);
    tr.getCell(11).numFmt = '#,##0.00';
    [10, 11].forEach((c) => {
      tr.getCell(c).font = { bold: true, size: idx === 2 ? 11 : 10, color: { argb: `FF${NAVY}` } };
      tr.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SOFT}` } };
    });
  });

  ws.views = [{ state: 'frozen', ySplit: 4 }];
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ------------------------------------------------------------------ BOQ Summary PDF

async function makeBoqSummaryPdfBlob(snap: ReturnType<typeof resolveSnapshotData>): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();

  doc.setFillColor(...rgb(NAVY));
  doc.rect(0, 0, W, 28, 'F');
  doc.setFillColor(...rgb(ACCENT));
  doc.rect(0, 28, W, 1.2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('BOQ SUMMARY', 14, 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(203, 213, 225);
  doc.text(clip(`${snap.title}${snap.client ? ` · ${snap.client}` : ''} · ${snap.dateStr}`, 90), 14, 21);

  const divTotals = DIVISIONS.map((d) => {
    const items = snap.boqRows.filter((b) => b.division === d.key);
    const total = items.reduce((s, b) => s + Number(b.qty || 0) * Number(b.rate || 0), 0);
    return [d.title, String(items.length), money(total)];
  });
  const net = snap.boqRows.reduce((s, b) => s + Number(b.qty || 0) * Number(b.rate || 0), 0);
  const vat = net * (snap.vatPct / 100);

  autoTable(doc, {
    startY: 36,
    theme: 'grid',
    margin: { left: 14, right: 14 },
    styles: { fontSize: 8.5, cellPadding: 2.2, lineColor: rgb(LINE), lineWidth: 0.15, textColor: rgb(INK) },
    headStyles: { fillColor: rgb(NAVY), textColor: 255, fontStyle: 'bold' },
    head: [['Division', 'Items', `Amount (${snap.currency})`]],
    body: divTotals,
    foot: [
      ['Subtotal', String(snap.boqRows.length), money(net)],
      [`VAT (${snap.vatPct}%)`, '', money(vat)],
      [`Grand Total (${snap.currency})`, '', money(net + vat)],
    ],
    footStyles: { fillColor: rgb(SOFT), textColor: rgb(NAVY), fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'center', cellWidth: 20 }, 2: { halign: 'right', cellWidth: 38 } },
  });

  const y2 = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 110) + 8;
  autoTable(doc, {
    startY: y2,
    theme: 'grid',
    margin: { left: 14, right: 14 },
    styles: { fontSize: 7.4, cellPadding: 1.8, lineColor: rgb(LINE), lineWidth: 0.12, textColor: rgb(INK) },
    headStyles: { fillColor: rgb(NAVY), textColor: 255, fontStyle: 'bold' },
    head: [['Ref', 'Division / Item', 'Brand / Model', 'Qty', 'Unit', 'Rate', 'Amount']],
    body: snap.boqRows.map((b) => [
      b.sn,
      `${DIVISIONS.find((d) => d.key === b.division)?.shortTitle ?? ''} — ${clip(b.description, 54)}`,
      clip(`${b.brand} · ${b.model}`, 26),
      String(b.qty),
      b.unit,
      money(b.rate),
      money(Number(b.qty) * Number(b.rate)),
    ]),
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' },
      3: { cellWidth: 13, halign: 'center' },
      4: { cellWidth: 12, halign: 'center' },
      5: { cellWidth: 20, halign: 'right' },
      6: { cellWidth: 22, halign: 'right' },
    },
  });

  return doc.output('blob');
}

// ------------------------------------------------------------------ Submittals (MAS/MIR/WIR/DN)

async function makeSubmittalsBlobs(snap: ReturnType<typeof resolveSnapshotData>) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const ctxLike = {
    title: snap.title,
    client: snap.client,
    company: snap.company,
    date: snap.dateStr,
    project: {
      number: snap.takeoff.netFloorAreaM2 ? `3D-${Math.round(snap.takeoff.netFloorAreaM2)}M2` : 'DB-001',
      location: clip(snap.boqRows[0] ? 'Measured 3D Scope' : 'Project Site', 32),
      contractor: snap.company,
      consultant: snap.client || 'Design Consultant',
      revision: 'Rev 00',
    },
    placedOf: () => 0,
    products: snap.boqRows.map((b, i) => ({
      sn: b.sn,
      code: b.code,
      brand: b.brand,
      model: b.model,
      skuCode: b.code,
      description: b.description,
      divisionTitle: DIVISIONS.find((d) => d.key === b.division)?.shortTitle ?? b.division,
      subGroup: b.category,
      category: b.category,
      qty: b.qty,
      unit: b.unit,
      finishes: b.finishes,
      finishSummary: b.finishes.map((f) => `${f.role}: ${f.code} (${f.name})`).join(' · '),
      location: 'Per Floor Plan',
      sourceIndex: i,
    })),
  };

  // Reuse clean A4 submittal layouts matching BOQFLOW's submittalSuiteBuilder.js
  const pictures = snap.boqRows.map((b) => renderSwatchCardJpeg(b));

  const header = (doc: InstanceType<typeof jsPDF>, title: string, refCode: string) => {
    const W = doc.internal.pageSize.getWidth();
    doc.setFillColor(...rgb(NAVY));
    doc.rect(0, 0, W, 28, 'F');
    doc.setFillColor(...rgb(ACCENT));
    doc.rect(0, 28, W, 1.2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(title, W / 2, 13, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(203, 213, 225);
    doc.text(`Ref: ${refCode}  ·  ${snap.title}  ·  ${snap.dateStr}`, W / 2, 21.5, { align: 'center' });
    return 34;
  };

  // MAS
  const masDoc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  ctxLike.products.forEach((p, idx) => {
    if (idx > 0) masDoc.addPage();
    let y = header(masDoc, 'MATERIAL APPROVAL SHEET', `MAS-${String(idx + 1).padStart(3, '0')}`);
    const pic = pictures[idx];
    if (pic?.dataUrl) {
      const f = containBox(pic.width, pic.height, { x: 14, y, w: 68, h: 44 });
      masDoc.addImage(pic.dataUrl, 'JPEG', f.x, f.y, f.w, f.h);
    }
    masDoc.setFont('helvetica', 'bold');
    masDoc.setFontSize(11);
    masDoc.setTextColor(...rgb(NAVY));
    masDoc.text(clip(`${p.brand} · ${p.model}`, 44), 86, y + 8);
    masDoc.setFont('helvetica', 'normal');
    masDoc.setFontSize(8.2);
    masDoc.setTextColor(...rgb(INK));
    masDoc.text(masDoc.splitTextToSize(clip(p.description, 220), 106).slice(0, 4), 86, y + 15);
    y += 50;
    autoTable(masDoc, {
      startY: y,
      theme: 'grid',
      margin: { left: 14, right: 14 },
      styles: { fontSize: 8.2, cellPadding: 2, lineColor: rgb(LINE), lineWidth: 0.15, textColor: rgb(INK) },
      headStyles: { fillColor: rgb(NAVY), textColor: 255 },
      head: [['Parameter', 'Specification']],
      body: [
        ['BOQ Ref / Division', `${p.sn} — ${p.divisionTitle}`],
        ['Brand & Model', `${p.brand} · ${p.model}`],
        ['Official Finishes', p.finishSummary || 'Manufacturer Standard'],
        ['Measured Quantity', `${p.qty} ${p.unit}`],
      ],
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 46, fillColor: rgb(SOFT) } },
    });
  });

  // MIR, WIR, Delivery Note
  const makeScheduleSubmittal = (title: string, codePrefix: string, statusLabel: string) => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const y = header(doc, title, `${codePrefix}-001`);
    autoTable(doc, {
      startY: y,
      theme: 'grid',
      margin: { left: 12, right: 12 },
      styles: { fontSize: 7.5, cellPadding: 1.8, lineColor: rgb(LINE), lineWidth: 0.12, textColor: rgb(INK) },
      headStyles: { fillColor: rgb(NAVY), textColor: 255, fontStyle: 'bold' },
      head: [['Ref', 'Division', 'Brand & Model', 'Official Finishes', 'Qty', 'Unit', 'Status']],
      body: ctxLike.products.map((p) => [
        p.sn,
        p.divisionTitle,
        clip(`${p.brand} · ${p.model}`, 26),
        clip(p.finishSummary, 32),
        String(p.qty),
        p.unit,
        statusLabel,
      ]),
      columnStyles: { 0: { halign: 'center', cellWidth: 12 }, 4: { halign: 'center', cellWidth: 13 }, 5: { halign: 'center', cellWidth: 13 }, 6: { halign: 'center', cellWidth: 24 } },
    });
    return doc.output('blob');
  };

  return [
    { path: 'Submittals/MAS.pdf', blob: masDoc.output('blob') },
    { path: 'Submittals/MIR.pdf', blob: makeScheduleSubmittal('MATERIAL INSPECTION REQUEST', 'MIR', '[ ] Pass') },
    { path: 'Submittals/WIR.pdf', blob: makeScheduleSubmittal('WORK INSPECTION REQUEST', 'WIR', '[ ] Approved') },
    { path: 'Submittals/Delivery_Note.pdf', blob: makeScheduleSubmittal('DELIVERY NOTE', 'DN', '[ ] Good') },
  ];
}

// ------------------------------------------------------------------ FF&E Schedule & Mood Board & Catalogue Links

async function makeFfeScheduleBlob(snap: ReturnType<typeof resolveSnapshotData>): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = snap.company;
  const ws = wb.addWorksheet('FF&E Schedule', { properties: { tabColor: { argb: `FF${ACCENT}` } } });
  const headers = ['Ref', 'Image', 'Division', 'Brand', 'Model', 'Description', 'Official Brand Finishes', 'Qty', 'Unit', `Rate (${snap.currency})`, `Amount (${snap.currency})`];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  ws.mergeCells(1, 1, 1, headers.length);
  ws.getCell(1, 1).value = `${snap.title} — FF&E & Finish Schedule`;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: `FF${NAVY}` } };
  [9, 13, 18, 18, 22, 42, 34, 10, 9, 14, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const hr = ws.getRow(3);
  hr.values = headers;
  hr.height = 24;
  hr.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${NAVY}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  snap.boqRows.forEach((b, i) => {
    const r = 4 + i;
    const xr = ws.getRow(r);
    const finishText = b.finishes.map((f) => `${f.role}: ${f.code} (${f.name})`).join(' | ');
    xr.values = [b.sn, '', DIVISIONS.find((d) => d.key === b.division)?.shortTitle ?? b.division, b.brand, b.model, b.description, finishText, b.qty, b.unit, b.rate, Number(b.qty) * Number(b.rate)];
    xr.height = 46;
    const card = renderSwatchCardJpeg(b);
    if (card.dataUrl) {
      const id = wb.addImage({ base64: card.dataUrl.split(',')[1], extension: 'jpeg' });
      ws.addImage(id, { tl: { col: 1.1, row: r - 1 + 0.1 }, ext: { width: 58, height: 38 }, editAs: 'oneCell' });
    }
    xr.eachCell((cell, col) => {
      cell.font = { size: 9.5, color: { argb: `FF${INK}` } };
      cell.alignment = { vertical: 'middle', wrapText: [6, 7].includes(col), horizontal: [6, 7].includes(col) ? 'left' : 'center' };
      if (col === 10 || col === 11) cell.numFmt = '#,##0.00';
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

async function makeMoodBoardPdfBlob(snap: ReturnType<typeof resolveSnapshotData>, heroImg?: string): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  const W = doc.internal.pageSize.getWidth();
  const top = (sub: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(...rgb(NAVY));
    doc.text(clip(snap.title, 68), 15, 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...rgb(MUTED));
    doc.text(`${sub}  ·  ${snap.dateStr}`, 15, 27);
    doc.setDrawColor(...rgb(ACCENT));
    doc.setLineWidth(0.8);
    doc.line(15, 31, 65, 31);
  };

  top('Mood Board & Official Finish Selections');
  if (heroImg) {
    const j = await imageToJpegData(heroImg, 1800);
    if (j?.dataUrl) {
      const f = containBox(j.width, j.height, { x: 15, y: 38, w: 250, h: 185 });
      doc.addImage(j.dataUrl, 'JPEG', f.x, f.y, f.w, f.h);
    }
  }
  const tile = (b: StandaloneBoqRow, x: number, y: number, w: number, h: number) => {
    doc.setDrawColor(...rgb(LINE));
    doc.roundedRect(x, y, w, h, 2, 2, 'S');
    const card = renderSwatchCardJpeg(b);
    if (card.dataUrl) {
      const f = containBox(card.width, card.height, { x: x + 2, y: y + 2, w: w - 4, h: h - 22 });
      doc.addImage(card.dataUrl, 'JPEG', f.x, f.y, f.w, f.h);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...rgb(INK));
    doc.text(clip(`${b.brand} · ${b.model}`, 32), x + 3, y + h - 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...rgb(MUTED));
    doc.text(`${b.qty} ${b.unit} · ${clip(b.finishes[0]?.code || 'Standard', 20)}`, x + 3, y + h - 5);
  };

  snap.boqRows.slice(0, 8).forEach((b, k) => {
    tile(b, 275 + (k % 2) * 65, 38 + Math.floor(k / 2) * 60, 61, 56);
  });

  for (const div of DIVISIONS) {
    const divItems = snap.boqRows.filter((b) => b.division === div.key);
    if (!divItems.length) continue;
    doc.addPage();
    top(`Mood Board — ${div.title}`);
    divItems.slice(0, 18).forEach((b, k) => {
      tile(b, 15 + (k % 6) * 66, 38 + Math.floor(k / 6) * 82, 62, 78);
    });
  }
  return doc.output('blob');
}

// ------------------------------------------------------------------ Presentation PPTX

async function makePresentationBlob(
  snap: ReturnType<typeof resolveSnapshotData>,
  views: { overview?: string; top?: string },
  renders: StandaloneRenderEntry[],
): Promise<Blob> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.author = snap.company;
  // pptxgenjs writes the company into docProps/app.xml unescaped: an "&" there makes the
  // file invalid (PowerPoint asks to repair it, cloud editors refuse it).
  pres.company = snap.company.replace(/&/g, 'and').replace(/[<>]/g, '');
  pres.title = `${snap.title} - Design & Build`;

  // Cover
  const cover = pres.addSlide();
  cover.background = { color: NAVY };
  const hero = renders[0]?.imageUrl || views.overview;
  if (hero) {
    const j = await imageToJpegData(hero, 1800);
    if (j?.dataUrl) cover.addImage({ data: j.dataUrl, x: 0, y: 0, w: 13.333, h: 7.5 });
  }
  cover.addShape(pres.ShapeType.rect, { x: 0.5, y: 4.5, w: 7.2, h: 2.4, fill: { color: NAVY, transparency: 15 }, line: { color: NAVY, transparency: 100 } });
  cover.addText('DESIGN & BUILD PROPOSAL', { x: 0.8, y: 4.7, w: 6.5, h: 0.35, fontSize: 12, bold: true, color: 'A5B4FC', charSpacing: 2 });
  cover.addText(clip(snap.title, 65), { x: 0.8, y: 5.1, w: 6.5, h: 0.9, fontSize: 26, bold: true, color: 'FFFFFF', fit: 'shrink' });
  cover.addText([snap.client ? `Client: ${snap.client}` : '', snap.dateStr, snap.company].filter(Boolean).join(' · '), { x: 0.8, y: 6.1, w: 6.5, h: 0.4, fontSize: 12, color: 'CBD5E1' });

  // 3D Geometry & Surface Takeoff Slide
  if (views.overview) {
    const s = pres.addSlide();
    s.addText('3D Model & Pure Geometric Takeoff', { x: 0.5, y: 0.35, w: 10, h: 0.55, fontSize: 22, bold: true, color: NAVY });
    const j = await imageToJpegData(views.overview, 1600);
    if (j?.dataUrl) {
      const f = containBox(j.width, j.height, { x: 0.5, y: 1.2, w: 8.2, h: 5.6 });
      s.addImage({ data: j.dataUrl, ...f });
    }
    const facts: [string, string][] = [
      [`${snap.takeoff.netFloorAreaM2.toFixed(1)} m²`, 'Net 3D Floor Slab Area'],
      [`${snap.takeoff.solidWallNetPaintAreaM2.toFixed(1)} m²`, 'Net Solid Wall Paint Area'],
      [`${snap.takeoff.glassPartitionAreaM2.toFixed(1)} m²`, 'Curved & Straight Glass Partitions'],
      [`${snap.takeoff.doors.total} · ${snap.takeoff.windows.total}`, 'Doors & Windows Installed'],
      [`${snap.takeoff.furnitureTotalCount}`, 'Furniture & Fit-Out Elements'],
    ];
    facts.forEach(([val, lbl], i) => {
      const fy = 1.3 + i * 1.05;
      s.addText(val, { x: 9.1, y: fy, w: 3.8, h: 0.5, fontSize: 24, bold: true, color: ACCENT });
      s.addText(lbl, { x: 9.1, y: fy + 0.48, w: 3.8, h: 0.3, fontSize: 11, color: MUTED });
    });
  }

  // Renders
  for (let i = 0; i < renders.length; i++) {
    const rs = pres.addSlide();
    rs.background = { color: NAVY };
    const j = await imageToJpegData(renders[i].imageUrl, 1800);
    if (j?.dataUrl) {
      const f = containBox(j.width, j.height, { x: 0.4, y: 0.35, w: 12.5, h: 6.3 });
      rs.addImage({ data: j.dataUrl, ...f });
    }
    rs.addText(`Perspective ${String(i + 1).padStart(2, '0')} · ${renders[i].style || 'Photorealistic'}`, { x: 0.5, y: 6.8, w: 8, h: 0.35, fontSize: 11, color: 'CBD5E1' });
  }

  // Division Cards
  for (const div of DIVISIONS) {
    const items = snap.boqRows.filter((b) => b.division === div.key);
    for (let start = 0; start < items.length; start += 6) {
      const ds = pres.addSlide();
      ds.addText(div.shortTitle, { x: 0.5, y: 0.35, w: 10, h: 0.55, fontSize: 22, bold: true, color: NAVY });
      items.slice(start, start + 6).forEach((b, k) => {
        const col = k % 3;
        const row = Math.floor(k / 3);
        const x = 0.5 + col * 4.16;
        const y = 1.25 + row * 2.85;
        ds.addShape(pres.ShapeType.rect, { x, y, w: 4.0, h: 2.7, fill: { color: 'FFFFFF' }, line: { color: LINE, width: 0.75 } });
        const card = renderSwatchCardJpeg(b);
        if (card.dataUrl) ds.addImage({ data: card.dataUrl, x: x + 0.15, y: y + 0.1, w: 3.7, h: 1.55 });
        ds.addText(clip(`${b.brand} · ${b.model}`, 38), { x: x + 0.15, y: y + 1.72, w: 3.7, h: 0.3, fontSize: 11, bold: true, color: NAVY });
        ds.addText(clip(b.description, 88), { x: x + 0.15, y: y + 2.02, w: 3.7, h: 0.35, fontSize: 8.5, color: MUTED });
        ds.addText(`${b.qty} ${b.unit} · ${snap.currency} ${money(Number(b.qty) * Number(b.rate))}`, { x: x + 0.15, y: y + 2.38, w: 3.7, h: 0.25, fontSize: 9, bold: true, color: INK });
      });
    }
  }

  const ab = await pres.write({ outputType: 'arraybuffer' });
  return new Blob([ab as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}

// ------------------------------------------------------------------ Audit PDF

async function makeExtractionAuditPdfBlob(snap: ReturnType<typeof resolveSnapshotData>): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...rgb(NAVY));
  doc.rect(0, 0, W, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('EXTRACTION & 3D GEOMETRIC AUDIT', 14, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(clip(`${snap.title} · ${snap.dateStr}`, 84), 14, 21);

  const t = snap.takeoff;
  autoTable(doc, {
    startY: 36,
    theme: 'grid',
    margin: { left: 14, right: 14 },
    headStyles: { fillColor: rgb(NAVY), textColor: 255 },
    head: [['3D Architectural / Surface Metric', 'Measured Value', 'Basis']],
    body: [
      ['Net Floor Slab Area', `${t.netFloorAreaM2.toFixed(2)} m²`, 'Shoelace polygon area from live SlabNodes'],
      ['Reflected Ceiling Area', `${t.ceilingAreaM2.toFixed(2)} m²`, 'Enclosed floor footprint'],
      ['Solid Wall Length / Gross Area', `${t.solidWallLengthLm.toFixed(2)} lm / ${t.solidWallGrossAreaM2.toFixed(2)} m²`, `${t.wallsTotalCount} commercial walls (pilot excluded)`],
      ['Net Solid Wall Paint Area', `${t.solidWallNetPaintAreaM2.toFixed(2)} m²`, '2-face solid wall area minus door & window openings'],
      ['Curved / Glass Partitions', `${t.glassPartitionLengthLm.toFixed(2)} lm / ${t.glassPartitionAreaM2.toFixed(2)} m²`, 'Arc chord + sagitta true curve length'],
      ['Perimeter Skirting', `${t.skirtingLengthLm.toFixed(2)} lm`, 'Solid partition run less door clear widths'],
      ['Doors / Windows', `${t.doors.total} doors · ${t.windows.total} windows`, `${t.doors.podGlass} pod/glass doors`],
      ['Sanitary Fixtures (WC / Basin / Shower)', `${t.sanitaryCounts.wc} / ${t.sanitaryCounts.basin} / ${t.sanitaryCounts.shower}`, '3D fixture item takeoff'],
    ],
  });
  return doc.output('blob');
}

// ------------------------------------------------------------------ Public Dispatcher

export async function runStandaloneExport(kind: StandaloneExportKind, ctx: StandaloneExportContext): Promise<{ fileCount: number; filename: string }> {
  const progress = ctx.onProgress || (() => {});
  progress(`Preparing ${kind}…`, 0.08);

  const snap = resolveSnapshotData(ctx);
  const views = await captureSceneViews(ctx.viewerHandle);
  const renders = ctx.renders || [];

  const getPlanData = () =>
    buildStandaloneProjectPlan(snap.boqRows, snap.takeoff, ctx.projectMeta);

  if (kind === 'BOQ Excel') {
    const blob = await makeBoqExcelBlob(snap);
    const filename = `${snap.slug}_Detailed_BOQ.xlsx`;
    downloadBlob(blob, filename);
    return { fileCount: 1, filename };
  }
  if (kind === 'BOQ Summary') {
    const blob = await makeBoqSummaryPdfBlob(snap);
    const filename = `${snap.slug}_BOQ_Summary.pdf`;
    downloadBlob(blob, filename);
    return { fileCount: 1, filename };
  }
  if (kind === 'Project Plan (.xlsx)') {
    const blob = await buildStandaloneProjectPlanExcel(getPlanData());
    const filename = `${snap.slug}_Action_and_Project_Plan.xlsx`;
    downloadBlob(blob, filename);
    return { fileCount: 1, filename };
  }
  if (kind === 'MS Project (.xml)') {
    const blob = buildStandaloneMsProjectXml(getPlanData());
    const filename = `${snap.slug}_MS_Project_Schedule.xml`;
    downloadBlob(blob, filename);
    return { fileCount: 1, filename };
  }
  if (kind === 'Mood Board') {
    const blob = await makeMoodBoardPdfBlob(snap, renders[0]?.imageUrl || views.overview);
    const filename = `${snap.slug}_Mood_Board.pdf`;
    downloadBlob(blob, filename);
    return { fileCount: 1, filename };
  }
  if (kind === 'Design & Build Presentation') {
    const blob = await makePresentationBlob(snap, views, renders);
    const filename = `${snap.slug}_Design_and_Build_Presentation.pptx`;
    downloadBlob(blob, filename);
    return { fileCount: 1, filename };
  }
  if (kind === 'FF&E Schedule') {
    const blob = await makeFfeScheduleBlob(snap);
    const filename = `${snap.slug}_FFE_Schedule.xlsx`;
    downloadBlob(blob, filename);
    return { fileCount: 1, filename };
  }
  if (kind === 'Extraction Audit') {
    const blob = await makeExtractionAuditPdfBlob(snap);
    const filename = `${snap.slug}_Extraction_Audit.pdf`;
    downloadBlob(blob, filename);
    return { fileCount: 1, filename };
  }
  if (kind === 'Scene JSON') {
    const blob = new Blob([JSON.stringify(snap.safeNodes, null, 2)], { type: 'application/json' });
    const filename = `${snap.slug}_Pascal_Scene.json`;
    downloadBlob(blob, filename);
    return { fileCount: 1, filename };
  }

  // Multi-file or Full Package ZIP
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const root = zip.folder(snap.slug)!;
  let fileCount = 0;
  const addFile = (path: string, blob: Blob) => {
    root.file(path, blob, { compression: /\.(png|jpe?g|pptx|xlsx)$/i.test(path) ? 'STORE' : 'DEFLATE' });
    fileCount++;
  };

  const wantAll = kind === 'Full Design & Build Package';

  if (wantAll || kind === 'Submittals (MAS/MIR/WIR/DN)') {
    progress('Generating MAS, MIR, WIR & Delivery Note…', 0.2);
    const subs = await makeSubmittalsBlobs(snap);
    subs.forEach((f) => addFile(f.path, f.blob));
  }

  if (wantAll) {
    progress('Generating Detailed BOQ & Summary…', 0.32);
    addFile('BOQ/Detailed_BOQ.xlsx', await makeBoqExcelBlob(snap));
    addFile('BOQ/BOQ_Summary.pdf', await makeBoqSummaryPdfBlob(snap));

    progress('Building Action Plan & MS Project XML…', 0.45);
    const plan = getPlanData();
    addFile('Programme/Action_and_Project_Plan.xlsx', await buildStandaloneProjectPlanExcel(plan));
    addFile('Programme/MS_Project_Schedule.xml', buildStandaloneMsProjectXml(plan));

    progress('Building Design & Build Presentation & FF&E…', 0.62);
    addFile('Presentation/Design_and_Build_Presentation.pptx', await makePresentationBlob(snap, views, renders));
    addFile('FF&E/FF&E_Schedule.xlsx', await makeFfeScheduleBlob(snap));
    addFile('FF&E/Mood_Board.pdf', await makeMoodBoardPdfBlob(snap, renders[0]?.imageUrl || views.overview));
    addFile('Model/Pascal_Scene.json', new Blob([JSON.stringify(snap.safeNodes, null, 2)], { type: 'application/json' }));
    addFile('Reports/Extraction_Audit.pdf', await makeExtractionAuditPdfBlob(snap));
  }

  if (wantAll || kind === 'Drawing Package') {
    progress('Capturing Drawing Views…', 0.78);
    if (ctx.sourcePdfBytes?.byteLength) {
      addFile('Drawings/Source_Drawing.pdf', new Blob([ctx.sourcePdfBytes as BlobPart], { type: 'application/pdf' }));
    }
    if (views.plain) addFile('Drawings/Extracted_Plan.png', dataUrlToBlob(views.plain));
    if (views.top) addFile('Drawings/Annotated_Plan.png', dataUrlToBlob(views.top));
  }

  if (wantAll || kind === 'Photorealistic Renders') {
    progress('Bundling Renders…', 0.88);
    if (renders.length) {
      renders.forEach((r, i) => {
        if (r.imageUrl?.startsWith('data:')) {
          addFile(`Renders/Perspective_${String(i + 1).padStart(2, '0')}.png`, dataUrlToBlob(r.imageUrl));
        }
      });
    } else if (views.overview) {
      addFile('Renders/3D_Model_Overview.png', dataUrlToBlob(views.overview));
    }
  }

  progress('Compressing ZIP package…', 0.95);
  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const suffix = kind === 'Full Design & Build Package' ? 'Full_Design_Build_Suite' : safeSlug(kind);
  const filename = `${snap.slug}_${suffix}.zip`;
  downloadBlob(zipBlob, filename);
  progress('Download ready', 1);
  return { fileCount, filename };
}

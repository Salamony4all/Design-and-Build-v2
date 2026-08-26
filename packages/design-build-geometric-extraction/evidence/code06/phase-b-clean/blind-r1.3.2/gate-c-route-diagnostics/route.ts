import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ARTIFACT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..', 'packages', 'design-build-geometric-extraction', 'evidence', 'code06', 'phase-b-clean', 'blind-r1.3.2', 'cs50-gate-b1-unit-corrected-mapping.json');

interface MappingRecord {
  anonymousRegionId: string;
  openingRegionId: string;
  selectedPhysicalWallId: string;
  pascalWallNodeId: string;
  wallLocalIntervalMeters: { start: number; end: number; width: number };
  pascalWorldCentre: { x: number; y: number; z: number };
  intervalCentreMeters: number;
  planRotationRadians: number;
  mappingStatus: string;
  projectEndpointA: { x: number; z: number };
  projectEndpointB: { x: number; z: number };
}

interface PilotRecord {
  anonymousRegionId: string;
  openingRegionId: string;
  physicalWallId: string;
  mappedWallIdentityHint: string;
  intervalStartM: number;
  intervalEndM: number;
  widthM: number;
  worldStart: { x: number; z: number };
  worldEnd: { x: number; z: number };
  worldCentre: { x: number; z: number };
  planRotationRadians: number;
  mappingStatus: string;
}

const PILOT_IDS = ['AR-23', 'AR-05', 'AR-15'];

function normalize(m: MappingRecord): PilotRecord {
  return {
    anonymousRegionId: m.anonymousRegionId,
    openingRegionId: m.openingRegionId,
    physicalWallId: m.selectedPhysicalWallId,
    mappedWallIdentityHint: m.selectedPhysicalWallId,
    intervalStartM: m.wallLocalIntervalMeters.start,
    intervalEndM: m.wallLocalIntervalMeters.end,
    widthM: m.wallLocalIntervalMeters.width,
    worldStart: m.projectEndpointA,
    worldEnd: m.projectEndpointB,
    worldCentre: { x: m.pascalWorldCentre.x, z: m.pascalWorldCentre.z },
    planRotationRadians: m.planRotationRadians,
    mappingStatus: m.mappingStatus,
  };
}

export async function GET() {
  const raw = readFileSync(ARTIFACT, 'utf8');
  const data = JSON.parse(raw) as { mappings: MappingRecord[] };
  const map = new Map((data.mappings || []).map(m => [m.anonymousRegionId, m]));
  const pilots = PILOT_IDS
    .map(id => map.get(id))
    .filter((m): m is MappingRecord => !!m && m.mappingStatus === 'VALIDATED_MAPPING')
    .map(normalize);

  if (pilots.length !== PILOT_IDS.length) {
    return NextResponse.json({ error: 'missing pilot mapping', pilots }, { status: 500 });
  }

  return NextResponse.json({ pilots });
}

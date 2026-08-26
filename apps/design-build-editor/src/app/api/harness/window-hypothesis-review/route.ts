import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'dev-fixtures', 'window-hypothesis-pilots.json');
const FEATURE_FLAG = process.env.NEXT_PUBLIC_ENABLE_WINDOW_HYPOTHESIS_REVIEW === 'true';
const EXPECTED_SOURCE_HASH = 'bf59724a54e4b3e15d01c4e5011cdf6b394bbda388cfd2f87ab20e8fee9972d7';

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

interface Fixture {
  schemaVersion: string;
  sourceArtifactHash: string;
  generatedAt: string;
  pilots: PilotRecord[];
  validation: {
    recordCount: number;
    duplicateRegionIds: string[];
    invalidWidths: string[];
    invalidIntervals: string[];
    invalidMappingStatuses: string[];
    WAFieldsPresent: boolean;
    sourceHashMatches: boolean;
  };
}

export async function GET() {
  if (!FEATURE_FLAG) {
    return NextResponse.json({ error: 'feature disabled' }, { status: 404 });
  }

  const raw = readFileSync(FIXTURE, 'utf8');
  const fixture = JSON.parse(raw) as Fixture;

  if (fixture.validation?.sourceHashMatches !== true || fixture.sourceArtifactHash !== EXPECTED_SOURCE_HASH) {
    return NextResponse.json({ error: 'invalid fixture source hash', sourceArtifactHash: fixture.sourceArtifactHash }, { status: 500 });
  }
  if (!Array.isArray(fixture.pilots) || fixture.pilots.length !== 3) {
    return NextResponse.json({ error: 'invalid pilot count', pilotCount: fixture.pilots?.length ?? null }, { status: 500 });
  }
  const ids = fixture.pilots.map(p => p.anonymousRegionId);
  const duplicateRegionIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  const invalidWidths = fixture.pilots.filter(p => !Number.isFinite(p.widthM) || p.widthM <= 0).map(p => p.anonymousRegionId);
  const invalidIntervals = fixture.pilots.filter(p => !Number.isFinite(p.intervalStartM) || !Number.isFinite(p.intervalEndM) || p.intervalEndM <= p.intervalStartM).map(p => p.anonymousRegionId);
  const invalidMappingStatuses = fixture.pilots.filter(p => p.mappingStatus !== 'VALIDATED_MAPPING').map(p => p.anonymousRegionId);
  if (duplicateRegionIds.length || invalidWidths.length || invalidIntervals.length || invalidMappingStatuses.length) {
    return NextResponse.json({
      error: 'invalid fixture payload',
      duplicateRegionIds,
      invalidWidths,
      invalidIntervals,
      invalidMappingStatuses,
    }, { status: 500 });
  }

  return NextResponse.json({
    status: 'ok',
    sourceArtifactHash: fixture.sourceArtifactHash,
    pilotCount: fixture.pilots.length,
    pilots: fixture.pilots,
  });
}

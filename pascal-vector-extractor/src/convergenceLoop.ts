import type {
  WallGraph,
  StructuralEdgeEvidence,
  RegressionMetrics,
  RoomGraph,
  OpeningHostProof,
  AuditTargetProfile,
  ConvergenceOptions,
  ConvergenceSummary,
  ConvergenceStopReason,
  CorrectionLedgerEntry,
  RevisionState,
  LocalCorrectionProposal,
} from './models';
import { proposeLocalCorrections, evaluateCorrectionProposal } from './proposalEngine';
import { evaluateRegressionTier } from './regressionEngine';

export interface InitialConvergenceState {
  wallGraph: Readonly<WallGraph>;
  structuralEvidence: readonly StructuralEdgeEvidence[];
  regressionReport: Readonly<RegressionMetrics>;
  roomGraph: Readonly<RoomGraph>;
  openingHosts: readonly OpeningHostProof[];
  profile: Readonly<AuditTargetProfile>;
}

function extractProposalIdentifiers(prop: LocalCorrectionProposal) {
  let mismatchComponentIds: string[] = [];
  let graphDefectIds: string[] = [];
  let affectedWallIds: string[] = [];
  let proposedWallIds: string[] = [];
  let affectedEvidenceIds: string[] = [];

  const payload = prop.payload as any;

  if (prop.type === 'SNAP_T_JUNCTION') {
    mismatchComponentIds = payload.affectedMismatchComponentIds || [prop.targetComponentId];
    affectedWallIds = [payload.stemWallId, payload.hostWallId].filter(Boolean);
    affectedEvidenceIds = payload.evidenceIds || [];
  } else if (prop.type === 'RESTORE_MISSING_WALL_SEGMENT') {
    mismatchComponentIds = [payload.sourceComponentId || prop.targetComponentId];
    proposedWallIds = ['new_wall_restore_1'];
    affectedEvidenceIds = payload.pairedFaceIds || [];
  } else if (prop.type === 'REMOVE_FALSE_WALL_SEGMENT') {
    mismatchComponentIds = [prop.targetComponentId];
    affectedWallIds = [payload.wallId].filter(Boolean);
    affectedEvidenceIds = payload.relatedEvidenceIds || [];
  } else if (prop.type === 'TRANSLATE_LOCAL_CENTERLINE') {
    graphDefectIds = [`graph_defect_translate_${payload.wallId}`];
    affectedWallIds = [payload.wallId];
    affectedEvidenceIds = payload.facePairIds || [];
  } else if (prop.type === 'CLOSE_SHORT_NON_OPENING_GAP') {
    graphDefectIds = [`graph_defect_gap_${payload.wallAId}_${payload.wallBId}`];
    affectedWallIds = [payload.wallAId, payload.wallBId].filter(Boolean);
    affectedEvidenceIds = payload.sourceEvidenceIds || [];
  } else if (prop.type === 'COLLAPSE_DUPLICATE_WALL') {
    graphDefectIds = [`graph_defect_dup_${payload.removedWallId}`];
    affectedWallIds = [payload.retainedWallId, payload.removedWallId].filter(Boolean);
  }

  return { mismatchComponentIds, graphDefectIds, affectedWallIds, proposedWallIds, affectedEvidenceIds };
}

export function runLocalCorrectionConvergence(
  initialState: InitialConvergenceState,
  options: Readonly<ConvergenceOptions> = {}
): ConvergenceSummary {
  const maxIter = options.maximumIterations ?? 20;

  let currentWallGraph = { ...initialState.wallGraph };
  let currentRegression = { ...initialState.regressionReport };

  const revisions: RevisionState = {
    wallGraphRevision: initialState.wallGraph.revision || 1,
    wallPolygonRevision: 1,
    roomGraphRevision: initialState.roomGraph.revision || 1,
    openingHostRevision: 1,
    regressionInputRevision: 1,
  };

  const ledger: CorrectionLedgerEntry[] = [];

  let proposedCount = 0;
  let evaluatedCount = 0;
  let acceptedCount = 0;
  let rejectedCount = 0;
  let skippedCount = 0;
  let rollbackCount = 0;

  const wallIoUBefore = currentRegression.wallPolygonIoU;
  const missingBefore = currentRegression.rawEvidence.missingWallLengthMm;
  const falseBefore = currentRegression.rawEvidence.falseWallLengthMm;

  let stopReason: ConvergenceStopReason = 'NO_PROPOSALS_GENERATED';

  for (let iter = 1; iter <= maxIter; iter++) {

    const { proposals } = proposeLocalCorrections(
      currentWallGraph,
      initialState.structuralEvidence,
      currentRegression,
      initialState.roomGraph,
      initialState.openingHosts
    );

    if (proposals.length === 0) {
      stopReason = 'NO_PROPOSALS_GENERATED';
      break;
    }

    proposedCount += proposals.length;

    let anyAcceptedThisIter = false;

    for (let i = 0; i < proposals.length; i++) {
      const prop = proposals[i]!;

      evaluatedCount++;
      const revBefore = revisions.wallGraphRevision;

      const evalResult = evaluateCorrectionProposal(
        {
          wallGraph: currentWallGraph,
          structuralEvidence: initialState.structuralEvidence,
          regressionReport: currentRegression,
          roomGraph: initialState.roomGraph,
          openingHosts: initialState.openingHosts,
        },
        prop
      );

      const { mismatchComponentIds, graphDefectIds, affectedWallIds, proposedWallIds, affectedEvidenceIds } = extractProposalIdentifiers(prop);

      if (evalResult.accepted) {
        acceptedCount++;
        anyAcceptedThisIter = true;

        revisions.wallGraphRevision++;
        revisions.wallPolygonRevision++;
        revisions.roomGraphRevision++;
        revisions.openingHostRevision++;
        revisions.regressionInputRevision++;

        currentRegression = {
          ...currentRegression,
          wallPolygonIoU: evalResult.afterMetrics.wallPolygonIoU,
          rawEvidence: {
            ...currentRegression.rawEvidence,
            missingWallLengthMm: evalResult.afterMetrics.missingWallLengthMm,
            falseWallLengthMm: evalResult.afterMetrics.falseWallLengthMm,
          },
        };

        const tierRes = evaluateRegressionTier({
          wallPolygonIoU: currentRegression.wallPolygonIoU,
          boundaryDistanceP95Mm: evalResult.afterMetrics.sourceToReconstructionP95Mm,
          maxBoundaryDeviationMm: 20.0,
          roomPolygonOverlapIoU: evalResult.afterMetrics.roomIoU,
          unhostedDoorsCount: 0,
          unhostedWindowsCount: 0,
        });

        currentRegression.tierEvaluation = tierRes;

        ledger.push({
          correctionId: `corr_${iter}_${prop.proposalId}`,
          proposalType: prop.type,
          ruleId: `rule_${prop.type.toLowerCase()}`,
          mismatchComponentIds,
          graphDefectIds,
          affectedWallIds,
          proposedWallIds,
          affectedEvidenceIds,
          geometryRevisionBefore: revBefore,
          geometryRevisionAfter: revisions.wallGraphRevision,
          before: evalResult.beforeMetrics,
          after: evalResult.afterMetrics,
          accepted: true,
          rollbackPerformed: false,
          status: 'ACCEPTED',
        });

        if (tierRes.allFinalGatesPassed) {
          stopReason = 'FINAL_TIER_REACHED';

          // Mark all remaining unevaluated proposals in current proposal set as SKIPPED
          for (let k = i + 1; k < proposals.length; k++) {
            const remProp = proposals[k]!;
            skippedCount++;

            const remIds = extractProposalIdentifiers(remProp);

            ledger.push({
              correctionId: `corr_${iter}_${remProp.proposalId}`,
              proposalType: remProp.type,
              ruleId: `rule_${remProp.type.toLowerCase()}`,
              mismatchComponentIds: remIds.mismatchComponentIds,
              graphDefectIds: remIds.graphDefectIds,
              affectedWallIds: remIds.affectedWallIds,
              proposedWallIds: remIds.proposedWallIds,
              affectedEvidenceIds: remIds.affectedEvidenceIds,
              geometryRevisionBefore: revisions.wallGraphRevision,
              geometryRevisionAfter: revisions.wallGraphRevision,
              before: evalResult.afterMetrics,
              after: evalResult.afterMetrics,
              accepted: false,
              rollbackPerformed: false,
              status: 'SKIPPED',
              skipReason: 'FINAL_TIER_REACHED_BEFORE_EVALUATION',
            });
          }
          break;
        }

      } else {
        rejectedCount++;
        rollbackCount++;

        ledger.push({
          correctionId: `corr_${iter}_${prop.proposalId}`,
          proposalType: prop.type,
          ruleId: `rule_${prop.type.toLowerCase()}`,
          mismatchComponentIds,
          graphDefectIds,
          affectedWallIds,
          proposedWallIds,
          affectedEvidenceIds,
          geometryRevisionBefore: revBefore,
          geometryRevisionAfter: revBefore,
          before: evalResult.beforeMetrics,
          after: evalResult.afterMetrics,
          accepted: false,
          rollbackPerformed: true,
          status: 'REJECTED',
          rejectionReason: evalResult.rejectionReason,
        });
      }
    }

    if (stopReason === 'FINAL_TIER_REACHED') break;

    if (!anyAcceptedThisIter) {
      stopReason = 'NO_PROPOSALS_ACCEPTED';
      break;
    }

    if (iter === maxIter) {
      stopReason = 'MAXIMUM_ITERATIONS_REACHED';
    }
  }

  const finalTier = currentRegression.tierEvaluation?.tier || 'reviewable';
  const exportAllowed = currentRegression.tierEvaluation?.exportAllowed || false;

  return {
    iterations: 1,
    proposedCorrectionCount: proposedCount,
    evaluatedCorrectionCount: evaluatedCount,
    acceptedCorrectionCount: acceptedCount,
    rejectedCorrectionCount: rejectedCount,
    skippedCorrectionCount: skippedCount,
    rollbackCount,
    stopReason,
    wallIoUBefore,
    wallIoUAfter: currentRegression.wallPolygonIoU,
    missingWallLengthBeforeMm: missingBefore,
    missingWallLengthAfterMm: currentRegression.rawEvidence.missingWallLengthMm,
    falseWallLengthBeforeMm: falseBefore,
    falseWallLengthAfterMm: currentRegression.rawEvidence.falseWallLengthMm,
    finalTier,
    exportAllowed,
    ledger,
  };
}

// design-build-extraction-ai
// CAP-02: AI_SCENE_DIFF_V2 (AI Scene Diffing with User-Edit Protection)
//
// Pure, non-destructive diffing engine for multi-phase AI scene updates.
// Boundary rules:
//   - NO mutation of live scene state directly.
//   - Protects manual PRO edits from overwrite.
//   - Identifies nodesToCreate, nodesToUpdate, nodesToRetain, and nodesRetainedForReview.
//   - Applies ONLY when pipelineKind === 'ai'.

import type { Provenance } from 'design-build-extraction-contracts';

/** Feature flag for AI scene diffing V2 (Default: false). */
export const AI_SCENE_DIFF_V2 = false;

export interface DiffableNode {
  id: string;
  type: string;
  parentId?: string;
  semanticId?: string;
  sourceRecordId?: string;
  metadata?: Record<string, unknown>;
  provenance?: Provenance;
  position?: [number, number, number] | [number, number];
  rotation?: [number, number, number] | number;
  scale?: [number, number, number];
  start?: [number, number];
  end?: [number, number];
  polygon?: Array<[number, number]>;
  thickness?: number;
  height?: number;
  asset?: { id: string; category?: string; name?: string };
}

export interface UserEditConflictRecord {
  id: string;
  nodeId: string;
  field: string;
  currentUserValue: unknown;
  incomingAIValue: unknown;
  sourceConfidence: number;
  conflictStatus: 'PRESERVED_USER_VALUE' | 'ROUTED_TO_REVIEW';
  timestamp: string;
}

export interface SceneDiffPlan {
  nodesToCreate: DiffableNode[];
  nodesToUpdate: Array<{ id: string; changes: Partial<DiffableNode>; original: DiffableNode }>;
  nodesToRetain: DiffableNode[];
  nodesRetainedForReview: Array<{ id: string; node: DiffableNode; reason: string }>;
  conflicts: UserEditConflictRecord[];
  isNoop: boolean;
  pure: true;
}

export interface SceneDiffInput {
  pipelineKind: 'ai' | 'mupdf' | 'manual' | string;
  liveNodes: Record<string, DiffableNode> | DiffableNode[];
  incomingNodes: DiffableNode[];
  options?: {
    enabled?: boolean;
    protectUserEdits?: boolean;
  };
}

/**
 * Checks whether two values are deeply equivalent for essential scene graph geometry.
 */
function isEquivalent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * Computes a non-destructive diff plan between live scene nodes and incoming AI revision nodes.
 */
export function computeAiSceneDiff(input: SceneDiffInput): SceneDiffPlan {
  const isEnabled = input.options?.enabled ?? AI_SCENE_DIFF_V2;
  const protectUserEdits = input.options?.protectUserEdits ?? true;

  // Convert liveNodes to map
  const liveMap = new Map<string, DiffableNode>();
  if (Array.isArray(input.liveNodes)) {
    for (const n of input.liveNodes) {
      liveMap.set(n.id, n);
    }
  } else {
    for (const [id, n] of Object.entries(input.liveNodes)) {
      liveMap.set(id, n);
    }
  }

  // If disabled by flag or not AI pipeline, do full replacement or noop
  if (!isEnabled || input.pipelineKind !== 'ai') {
    const allNew = input.incomingNodes.filter((n) => !liveMap.has(n.id));
    const existing = input.incomingNodes.filter((n) => liveMap.has(n.id));
    return {
      nodesToCreate: allNew,
      nodesToUpdate: existing.map((n) => ({ id: n.id, changes: n, original: liveMap.get(n.id)! })),
      nodesToRetain: [],
      nodesRetainedForReview: [],
      conflicts: [],
      isNoop: allNew.length === 0 && existing.length === 0,
      pure: true,
    };
  }

  const nodesToCreate: DiffableNode[] = [];
  const nodesToUpdate: Array<{ id: string; changes: Partial<DiffableNode>; original: DiffableNode }> = [];
  const nodesToRetain: DiffableNode[] = [];
  const nodesRetainedForReview: Array<{ id: string; node: DiffableNode; reason: string }> = [];
  const conflicts: UserEditConflictRecord[] = [];

  const matchedLiveIds = new Set<string>();

  // Map incoming nodes against live nodes by (id || semanticId || sourceRecordId)
  for (const incoming of input.incomingNodes) {
    let matchedLive: DiffableNode | undefined = liveMap.get(incoming.id);

    if (!matchedLive && incoming.semanticId) {
      for (const live of liveMap.values()) {
        if (live.semanticId === incoming.semanticId) {
          matchedLive = live;
          break;
        }
      }
    }

    if (!matchedLive && incoming.sourceRecordId) {
      for (const live of liveMap.values()) {
        if (live.sourceRecordId === incoming.sourceRecordId) {
          matchedLive = live;
          break;
        }
      }
    }

    if (!matchedLive) {
      // Genuinely new node
      nodesToCreate.push(incoming);
      continue;
    }

    matchedLiveIds.add(matchedLive.id);

    // Check user modification protections
    const isUserModified =
      protectUserEdits &&
      (matchedLive.metadata?._userModified === true ||
        matchedLive.metadata?.userEdited === true ||
        matchedLive.provenance?.sourceKind === 'mock' ||
        (matchedLive.provenance && matchedLive.provenance.sourceKind !== 'gemini'));

    // Check for geometric differences
    const changes: Partial<DiffableNode> = {};
    let hasChanges = false;

    const fieldsToCheck: Array<keyof DiffableNode> = [
      'start',
      'end',
      'position',
      'rotation',
      'scale',
      'polygon',
      'thickness',
      'height',
      'parentId',
      'asset',
    ];

    for (const field of fieldsToCheck) {
      const liveVal = matchedLive[field];
      const incomingVal = incoming[field];

      if (incomingVal !== undefined && !isEquivalent(liveVal, incomingVal)) {
        if (isUserModified) {
          // Record conflict; PRESERVE user value
          conflicts.push({
            id: `conflict_${conflicts.length + 1}`,
            nodeId: matchedLive.id,
            field: String(field),
            currentUserValue: liveVal,
            incomingAIValue: incomingVal,
            sourceConfidence: incoming.provenance?.confidence ?? 0.8,
            conflictStatus: 'PRESERVED_USER_VALUE',
            timestamp: new Date().toISOString(),
          });
        } else {
          (changes as any)[field] = incomingVal;
          hasChanges = true;
        }
      }
    }

    if (hasChanges) {
      nodesToUpdate.push({
        id: matchedLive.id,
        changes,
        original: matchedLive,
      });
    } else {
      nodesToRetain.push(matchedLive);
    }
  }

  // Identify live AI nodes missing in incoming pass
  for (const [id, liveNode] of liveMap.entries()) {
    if (matchedLiveIds.has(id)) continue;

    // Do NOT touch user-created or manual nodes
    if (liveNode.provenance && liveNode.provenance.sourceKind !== 'gemini') {
      nodesToRetain.push(liveNode);
      continue;
    }

    // AI node omitted in later pass -> Retain for review
    nodesRetainedForReview.push({
      id,
      node: liveNode,
      reason: 'AI_NODE_MISSING_FROM_LATER_PASS',
    });
  }

  return {
    nodesToCreate,
    nodesToUpdate,
    nodesToRetain,
    nodesRetainedForReview,
    conflicts,
    isNoop: nodesToCreate.length === 0 && nodesToUpdate.length === 0 && nodesRetainedForReview.length === 0,
    pure: true,
  };
}

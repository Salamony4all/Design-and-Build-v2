// Home page — First Upgrade + Change Set 2 (Live Pure MuPDF Migration).
//
// Responsibilities:
//   - Install ONLY the initial shell (site/building/level/guide) via setScene,
//     then reveal the official Pascal Viewer shell.
//   - Frozen import (development/regression fallback): runStagedCode06Import
//     from the baked frozen fixture via prepareCode06Drafts.
//   - Live import (Change Set 2): prepareLiveDrafts(result) from the neutral
//     ExtractionResult produced by the clean design-build-extraction-mupdf
//     provider, then the SAME runStagedCode06Import runner + framing handshake.
//   - Emit typed `import-progress` events to the ChatPanel (which only renders
//     them — it performs NO Pascal mutation).
//
// ALL Pascal scene mutation lives here (and in the adapter), never in ChatPanel.
//
// GEOMETRIC_EXTRACTION_PROVIDER:
//   'frozen-code06' -> Geometric Extract uses the baked frozen fixture (default
//                      until live parity is fully green; also the dev fallback).
//   'live-mupdf'     -> Geometric Extract runs the live Pure MuPDF boundary.
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Temporary development feature flag (Change Set 2, §8). Default stays frozen
// until live Pascal parity is fully verified. After green gates, flip to
// 'live-mupdf' and rerun all gates before production activation.
const GEOMETRIC_EXTRACTION_PROVIDER: 'frozen-code06' | 'live-mupdf' = 'live-mupdf';
import dynamic from 'next/dynamic';
const PascalWindowHypothesisOverlay = dynamic(
  () => import('@/features/window-hypothesis/PascalWindowHypothesisOverlay'),
  { ssr: false },
);
import * as THREE from 'three';
import type { ChatCommand, ChatEvent } from 'design-build-conversation-core';
import { ChatPanel } from '@/features/conversation/ChatPanel';
import { attachmentRepository } from '@/features/conversation/attachment-repository';
import { ProviderSettingsPanel } from '@/features/conversation/ProviderSelector';
import { SlidersHorizontal } from 'lucide-react';
import { AiExtractionControls, useAiProviderRegistry } from '@/features/ai-extraction';
import { ViewerToolbar } from '@/features/viewer-interaction/ViewerToolbar';
import { SelectionPropertiesPanel } from '@/features/viewer-interaction/SelectionPropertiesPanel';
import { KeyboardElementControls } from '@/features/viewer-interaction/KeyboardElementControls';
import { BuildProgressRail } from '@/features/progressive-build/BuildProgressRail';
import { BuildCompletionCard } from '@/features/progressive-build/BuildCompletionCard';
import { ChunkLoadRecovery } from '@/features/progressive-build/ChunkLoadRecovery';
import { ProgressiveBuildV3, applyGuideReadiness, guideSignalApplicable, type StageCardState } from '@/features/progressive-build/ProgressiveBuildV3';
import { DiagnosticPanel } from '@/features/progressive-build/DiagnosticPanel';
import { createProgressiveInstaller, resolveAiExtractionPlan } from '@/harness/pascal-progressive-builder';
import { installFurniture } from '@/harness/ai-scene-install';
import type { RuntimeWallMapBuild } from '@/harness/ai-scene-install/runtime-wall-map';
import { validateStructuralScene, type StructuralValidationResult } from '@/harness/ai-scene-install/structural-validation';
import { projectLabelFromFiles } from '@/components/dynamic-project-label';
import { validateEvent } from 'design-build-extraction-ai';
import type { BuildStage, ProgressiveBuildEvent, FurnitureCandidate } from 'design-build-extraction-ai';
import { ExportRail, filterCommercialNodes } from '@/features/project-export/ExportRail';
import { isEmbedded, useEmbedBridge, countSceneNodes, type EmbedProduct } from '@/features/embed/embed-bridge';
import { selectDoorInstallerInput, type RuntimeWallMap } from '@/features/door-pilot/door-boundary';
import { getPascalStores, ensureBuiltinPluginLoaded, type ViewerHandle } from 'design-build-simplified-viewer-shell';
import { RenderStudio, loadRenderPrefs } from '@/features/render/RenderStudio';
import { prepareView, currentViewKind, captureViewForRender, readPlanUnderlay, type PreparedView } from '@/features/render/capture-view';
import { renderPhotoreal, type RenderJobResult } from '@/features/render/render-client';
import { RENDER_TIERS, getRenderStyle, styleFromText, furnishFromText } from '@/features/render/render-presets';
import { providerRequestHeaders } from '@/features/providers/browser-provider-store';
import { useEditorMode } from '@/features/pro/useEditorMode';
import { ProEditorLazy } from '@/features/pro/ProEditorLazy';
import { ProOverlay } from '@/features/pro/ProOverlay';
import { preparePro, type ProPreloadResult } from '@/features/pro/proPreload';
import { useViewer } from '@pascal-app/viewer';
import { builtinPlugin } from '@pascal-app/nodes';
import { SiteNode, BuildingNode, LevelNode, SlabNode, WallNode, emitter, runAsSingleSceneHistoryStep } from '@pascal-app/core';
import type { AnyNode } from '@pascal-app/core';
import { prepareCode06Drafts } from '@/harness/build-code06-import';
import { prepareLiveDrafts } from '@/harness/build-live-import';
import { buildFinalizedWallMap } from '@/harness/finalized-wall-map';
import { cropGuideToRoi } from '@/harness/crop-guide';
import type { WindowInstallSpec } from '@/harness/extract-live-windows';
import type { LiveWindowContract } from '@/features/window-pilot/install-pilot-windows';
import type { LiveDoorContract } from '@/features/door-pilot/install-live-doors';
import { runStagedCode06Import, type StageEvent } from '@/harness/code06-staged-import';
import { installLiveColumns, type LiveColumnInstallerContext } from '@/features/columns/install-live-columns';
import type { ColumnContract } from 'design-build-extraction-mupdf';
import { validateSceneTree, type NodeMap } from 'design-build-pascal-adapter';
import { computeFraming, type Aabb, type FramingSolution } from '@/features/viewer-interaction/camera-framing-service';
import {
  ISO_PHI,
  ISO_THETA,
  TOP_PHI,
  animateTo,
  applyLimits,
  boxCenter,
  boxRadius,
  cancelViewAnimation,
  combine as combineBoxes,
  currentPose,
  fitPose,
  focusPose,
  freeAreaShift,
  lensToVFov,
  navLimits,
  pickPoint,
  pickSurface,
  setLensShift,
  turnPose,
  zoomPose,
  animateFree,
  LENS_STEPS_MM,
  MAX_LENS_MM,
  MAX_POLAR,
  MIN_LENS_MM,
  ORBIT_LENS_MM,
  WALK_LENS_MM,
  type Aabb as NavAabb,
  type NavLimits,
  type ViewArea,
} from '@/features/viewer-interaction/view-navigator';
import { NavHint } from '@/features/viewer-interaction/NavHint';
import {
  WalkControls,
  clampToArea,
  findStandingSpot,
  quaternionFromYawPitch,
  sceneProbe,
  yawPitchFromDirection,
  type WalkHost,
} from '@/features/viewer-interaction/walk-controls';
import type { AttachmentRef } from 'design-build-conversation-core';

declare global {
  interface Window {
    __code06?: {
      core: ReturnType<typeof getPascalStores>;
      drafts: import('@/harness/build-code06-import').Code06Drafts;
      initialIds: import('@/harness/build-code06-import').InitialIds;
      getLiveNodes: () => Record<string, unknown>;
      validate: () => unknown;
      // --- dev-only diagnostics (not in production) ---
      getStatus: () => Code06Status;
      failNextBatch: () => void;
      resetFrozenImport: () => void;
    };
  }
}

interface Code06Status {
  importState: 'idle' | 'initializing' | 'importing' | 'completed' | 'failed' | 'stalled';
  currentStage: string;
  committedWalls: number;
  expectedWalls: number;
  sceneNodeCount: number;
  wallNodeCount: number;
  wallRegistryCount: number;
  dirtyNodeCount: number;
  sceneTreeIssues: number;
  duplicateWallIds: number;
  unreachableNodeIds: string[];
  progressiveEventLog: unknown[];
  lastFraming: null | { center: number[]; radius: number; cameraAfter: number[]; target: number[]; near: number; far: number; objects: number };
}

const PascalViewerShell = dynamic(
  () => import('design-build-simplified-viewer-shell').then((m) => m.PascalViewerShell),
  { ssr: false },
);

const SelectionActionAnchor3D = dynamic(
  () => import('@/features/pro/SelectionActionAnchor3D').then((m) => m.SelectionActionAnchor3D),
  { ssr: false },
);

const SelectionActionBarDOM = dynamic(
  () => import('@/features/pro/SelectionActionBarDOM').then((m) => m.SelectionActionBarDOM),
  { ssr: false },
);

const SelectionActionBarErrorBoundary = dynamic(
  () => import('@/features/pro/SelectionActionBarErrorBoundary').then((m) => m.SelectionActionBarErrorBoundary),
  { ssr: false },
);

const ToolManager = dynamic(
  () => import('@pascal-app/editor').then((m: any) => m.ToolManager),
  { ssr: false },
);

const EditorGrid = dynamic(
  () => import('@pascal-app/editor').then((m: any) => m.Grid),
  { ssr: false },
);

const EditorSelectionManager = dynamic(
  () => import('@/features/pro/EditorSelectionManager').then((m) => m.EditorSelectionManager),
  { ssr: false },
);

const MOCK_MODELS = {
  chat: ['gemini-2.5-flash', 'gemini-2.5-pro', 'claude-sonnet'],
  extraction: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  render: ['nano-banana', 'comfyui-local'],
};

// ---- module-scope dev diagnostics (not referenced by UI; tree-shaken in prod
// because all access is behind NODE_ENV !== 'production') ----
// 1×1 transparent picture: the guide's placeholder until the drawing's own picture arrives
const BLANK_GUIDE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==';

const DIAG = {
  importState: 'idle' as Code06Status['importState'],
  currentStage: 'none',
  committedWalls: 0,
  expectedWalls: 70,
  eventLog: [] as unknown[],
  failNextBatch: { current: false },
  importOk: false,
  runCounter: 0,
  lastFraming: null as null | { center: number[]; radius: number; cameraAfter: number[]; target: number[]; near: number; far: number; objects: number },
  // Change Set 2 activation (§8 final diagnostic fields)
  extractionProvider: 'none' as 'none' | 'live-mupdf' | 'frozen-code06' | 'clean-gemini',
  extractionState: 'idle' as 'idle' | 'reading' | 'extracting' | 'validated' | 'failed',
  extractionMessage: '',
  uploadedFileName: '',
  apiStatus: 0,
  installedPilotWindows: 0,
  windowInstallResults: [] as Array<{
    anonymousRegionId: string;
    physicalWallId: string;
    livePascalWallNodeId: string | null;
    windowNodeId: string | null;
    mappingStatus: string;
    widthM: number;
  }>,
  windowInstallError: '',
  // Change Set 2 (Gate C, live): audit of the REAL geometric window extraction.
  liveWindowAudit: null as null | {
    totalCandidates: number; accepted: number; review: number; rejected: number;
    byWall: Record<string, { accepted: number; review: number; rejected: number }>;
  },
  liveWindowExtractionError: '',
  // Change Set: live door extraction + installation diagnostics.
  installedDoors: 0,
  doorInstallResults: [] as Array<{
    doorAssemblyId: string;
    physicalWallId: string;
    livePascalWallNodeId: string | null;
    doorNodeId: string | null;
    mappingStatus: string;
    widthM: number;
  }>,
  doorInstallError: '',
  // Change Set: AI multipass extract — furniture/windows/doors installed into
  // the live Pascal scene (categories prepareLiveDrafts omits).
  installedAiFurniture: 0,
  installedAiWindows: 0,
  installedAiDoors: 0,
  aiExtractInstallError: '',
  doorManifestAccepted: 0,
  doorReviewRecords: [] as Array<{
    doorAssemblyId: string;
    verdict: string;
    reviewReason: string;
    automaticInstallationAllowed: boolean;
    relatedAcceptedAssemblyId?: string;
  }>,
  // ---- M2: finalized runtime wall map + count ownership ----
  originalWallCount: 0,
  completionWallCount: 0,
  finalizedWallCount: 0,
  curvedWallCount: 0,
  wallMapPass: false,
  wallMap: [] as unknown[],
  // Windows (semantic, from the geometric detector — host rendering out of scope in M2):
  windowsExtracted: 0,
  windowsEligible: 0,
  windowsInstalledNodes: 0,
  windowsFailed: 0,
  // Change Set: live door extraction + installation diagnostics.
  doorDiagnosticReviewCount: 0, // 202 extraction candidates held for diagnostic review (NOT production doors)
  doorsAccepted: 0,
  doorsAutoInstallable: 0,
  doorsAuditReview: 0,
  // Terminal-state gating:
  validationPass: false,
  projectReady: 'PENDING' as 'PENDING' | 'READY',
  candidateReviewRecords: 0,
  candidateReviewLabel: 'candidate review evidence',
  // ---- S8: bounded readiness controller terminal outcome ----
  readinessOutcome: 'PENDING' as 'PENDING' | 'READY' | 'RENDERER_FAILED' | 'CHUNK_LOAD_FAILED' | 'TIMEOUT' | 'CANCELLED',
  chunkLoadError: '' as string,
  chunkLoadFailed: false,
  // §Isolation: non-fatal Guide image-preparation diagnostic (redacted — no bytes/Base64).
  guideImageError: null as null | { detectedMimeType: string; reason: string; byteLength: number },
};

const STAGE_LABEL: Record<string, string> = {
  none: 'project',
  slab: 'slab',
  'exterior-walls': 'walls',
  'principal-internal-walls': 'walls',
  'service-walls': 'walls',
  'short-partitions': 'walls',
  import: 'project',
};
const stageLabelOf = (s: string) => STAGE_LABEL[s] ?? 'project';

let evId = 0;
const nid = () => `ev_${++evId}`;
/** Chat text that adjusts the last render (look, light, materials) rather than asking something new. */
const RENDER_TWEAK = /render|photo ?real|light|golden|sunset|night|dusk|overcast|clay|marble|wood|oak|concrete|tile|floor|wall finish|material|furnish|furniture|warm|style/i;

/** True when the live scene has at least one wall (read straight from the store). */
function sceneHasWallsNow(): boolean {
  const st = getPascalStores().useScene.getState() as unknown as { nodes?: Record<string, { type?: string }> };
  return Object.values(st.nodes ?? {}).some((n) => n?.type === 'wall');
}

export default function Home() {
  const [events, setEvents] = useState<ChatEvent[]>([
    { type: 'message', role: 'assistant', id: nid(), text: 'Upload a floor plan and I will turn it into a 3D model. Then press Render for a photoreal image.' },
  ]);
  const [selection, setSelection] = useState({ chat: MOCK_MODELS.chat[0], extraction: MOCK_MODELS.extraction[0], render: MOCK_MODELS.render[0] });
  // Extraction method (geometric | ai), lifted from ChatPanel so the visible
  // pipeline panel switches when the user selects AI mode.
  const [extractMethod, setExtractMethod] = useState<'geometric' | 'ai'>('geometric');
  const [importing, setImporting] = useState(false);
  // Bumped on every committed batch to force the frameloop="never" Canvas to
  // invalidate() and run its useFrame systems — which drain dirtyNodes and
  // populate sceneRegistry.byType.wall. Without this, the wall systems never
  // tick after the initial frame, leaving dirty:71 / wallReg:0 (the production
  // divergence). Mirrors harness/page.tsx per-batch sceneReadyKey bumping.
  const [sceneReadyTick, setSceneReadyTick] = useState(0);
  const [docked, setDocked] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(true);
  // Optional official Pascal PRO editing mode (spec: PASCAL_PRO_EDITOR).
  const editorMode = useEditorMode();
  // Transition machine (atomic shell switch, single Canvas/Viewer invariant):
  //   proMounting  = we have unmounted STANDARD and are mounting the official
  //                  Editor (narrow swap; during this window a dedicated loading
  //                  surface is shown, so exactly one Canvas/Viewer exists).
  //   proMode      = PRO is EFFECTIVE (rendered & ready). Gates STANDARD chrome.
  const ts = editorMode.transitionState;
  // OVERLAY MODE: PRO is a layer over the permanently-mounted Standard Viewer.
  // proMode = PRO overlay is EFFECTIVE (panels mounted over the live model).
  // proMounting = brief window between preload success and overlay mount.
  const proMounting = ts === 'OVERLAY_MOUNTING';
  const proMode = editorMode.effectiveMode === 'pro';
  const proRequested = editorMode.requestedMode === 'pro' && !proMode && !proMounting;

  // --- PRO crash-recovery sentinel (spec §13) ---
  // Before the shell swap begins we mark the session IN_PROGRESS. After PRO is
  // stable for 10s we promote it to PRO_STABLE. On the next cold load, if the
  // marker is still IN_PROGRESS (or absent), we force STANDARD, clear any
  // requested PRO, and show a safe notice — we NEVER auto-reopen a crashing PRO.
  const PRO_SENTINEL = 'db:proTransition';
  const [proRecoveryNotice, setProRecoveryNotice] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const marker = window.sessionStorage.getItem(PRO_SENTINEL);
      if (marker && marker !== 'PRO_STABLE') {
        // A previous PRO session did not complete — stay in STANDARD.
        window.sessionStorage.removeItem('db:editorMode');
        setProRecoveryNotice('Pascal PRO did not complete the previous session. Standard mode was restored.');
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initialize the dev-only bounded stability ring buffer (never per-frame logs).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { __pascalProStability?: unknown[] };
    if (!w.__pascalProStability) w.__pascalProStability = [];
  }, []);

  // Preload phase runs WHILE STANDARD remains the only mounted Viewer. It never
  // renders <Editor>; it warms the chunk, registers icons, loads the builtin
  // plugin, and captures the scene. On success we mount the PRO overlay over
  // the still-live Viewer (no Canvas swap, no scene copy). On failure we stay
  // in STANDARD (safe rollback).
  const [preload, setPreload] = useState<ProPreloadResult | null>(null);
  const transitionIdRef = useRef(0);
  useEffect(() => {
    if (editorMode.requestedMode !== 'pro' || ts !== 'PREPARING_PRO') return;
    const tid = ++transitionIdRef.current;
    editorMode.setProStage('PRO_IMPORTING');
    preparePro(activeRunIdRef.current ?? 'db-pro')
      .then((res) => {
        if (tid !== transitionIdRef.current) return; // cancelled/abandoned
        setPreload(res);
        editorMode.setProStage('PRO_PROJECT_READY');
        editorMode.setTransitionState('OVERLAY_MOUNTING');
        // Mark overlay ready on the next tick (overlay mounts over live Viewer).
        requestAnimationFrame(() => editorMode.markProOverlayReady());
      })
      .catch((e) => {
        if (tid !== transitionIdRef.current) return;
        editorMode.markProFailed('PRO_FAILED');
        setPreload(null);
        if (e instanceof Error) console.warn('[PascalPRO] failed', e.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ts, editorMode.requestedMode]);

  // One authoritative 10s timeout owned by this coordinator (covers preload,
  // shell swap, onLoad, loader settlement). Cleared on success/failure/cancel.
  useEffect(() => {
    if (!editorMode.requestedMode || editorMode.effectiveMode === 'pro') return;
    if (ts === 'IDLE' || ts === 'FAILED') return;
    const tid = transitionIdRef.current;
    const t = setTimeout(() => {
      if (tid !== transitionIdRef.current) return;
      editorMode.setProStage('PRO_TIMEOUT');
      editorMode.markProFailed('PRO_TIMEOUT');
      setPreload(null);
    }, 10_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ts, editorMode.requestedMode, editorMode.effectiveMode]);

  // Promote the sentinel to PRO_STABLE 10s after PRO becomes effective, proving
  // the session is stable (not merely opened). Until then the next reload treats
  // it as an incomplete transition.
  useEffect(() => {
    if (editorMode.effectiveMode !== 'pro') return;
    const id = setTimeout(() => {
      try {
        window.sessionStorage.setItem(PRO_SENTINEL, 'PRO_STABLE');
      } catch {
        /* ignore */
      }
    }, 10_000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorMode.effectiveMode]);

  // Clear the sentinel when we are safely back in STANDARD (clean return).
  useEffect(() => {
    if (editorMode.effectiveMode === 'standard' && ts === 'IDLE') {
      try {
        window.sessionStorage.removeItem(PRO_SENTINEL);
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorMode.effectiveMode, ts]);

  // §5: single-flight extraction — disables the Extract button while running.
  const [extractionBusy, setExtractionBusy] = useState(false);

  // ── Progressive Pure AI V3 state (spec §17-§19) ──
  const PROGRESSIVE_ENABLED = process.env.NEXT_PUBLIC_PROGRESSIVE_BUILD_V1 === 'true';
  const BUILD_GIT_COMMIT = process.env.NEXT_PUBLIC_GIT_COMMIT ?? 'dev-local';
  const [progActive, setProgActive] = useState(false);
  const [progRunId, setProgRunId] = useState<string | null>(null);
  const [progStages, setProgStages] = useState<Record<BuildStage, StageCardState>>(() => ({
    guide: { status: 'pending', installed: 0, total: 0, review: 0 },
    slab: { status: 'pending', installed: 0, total: 0, review: 0 },
    walls: { status: 'pending', installed: 0, total: 0, review: 0 },
    windows: { status: 'pending', installed: 0, total: 0, review: 0 },
    doors: { status: 'pending', installed: 0, total: 0, review: 0 },
    furniture: { status: 'pending', installed: 0, total: 0, review: 0 },
  }));
  // Mirror of progStages for synchronous reads inside async event handlers
  // (dependency guards need the latest stage status without re-rendering).
  const progStagesRef = useRef<Record<BuildStage, StageCardState>>(progStages);
  // Finalized AI wall map (Phase B): explicit semantic→runtime wall mapping,
  // built from actual WallNode installation. READY gates window/door hosting.
  const [progWallMap, setProgWallMap] = useState<RuntimeWallMapBuild | null>(null);
  const progWallMapRef = useRef<RuntimeWallMapBuild | null>(null);
  // Phase B §10 structural validation result (truthful scene audit).
  const [progStructural, setProgStructural] = useState<StructuralValidationResult | null>(null);
  const [progReview, setProgReview] = useState<FurnitureCandidate[]>([]);
  const activeRunIdRef = useRef<string | null>(null);
  // Once a Pascal snapshot build has run, the legacy geometric BuildProgressRail +
  // its hardcoded 70-wall target must stay hidden (AI mode shows only the Pascal panel).
  const progBuiltRef = useRef(false);
  const [initialInstalled, setInitialInstalled] = useState(false);
  const startedRef = useRef(false);
  const viewerHandleRef = useRef<ViewerHandle | null>(null);
  const windowSpecsRef = useRef<WindowInstallSpec[]>([]);
  const doorSpecsRef = useRef<LiveDoorContract[]>([]);
  const doorManifestRef = useRef<unknown>(null);
  const windowAuditRef = useRef<any>(null);
  const isStreamingExtractionRef = useRef(false);
  const activeStagedHandleRef = useRef<any>(null);
  const allWallDraftsRef = useRef<Record<string, unknown>>({});
  const bufferedWindowDraftsRef = useRef<{ node: AnyNode; parentId: string }[]>([]);
  const bufferedDoorDraftsRef = useRef<{ node: AnyNode; parentId: string }[]>([]);
  // Structural-validation inputs (Phase B §10): ledgers captured during install.
  const windowLedgerRef = useRef<unknown>(null);
  const doorLedgerRef = useRef<unknown>(null);
  const aiResultRef = useRef<import('design-build-extraction-contracts').ExtractionResult | null>(null);
  const [renderProgress, setRenderProgress] = useState<{
    isRendering: boolean;
    progress: number;
    stageName: string;
    snapshotUrl?: string;
    renderId?: string;
    modelLabel?: string;
  }>({
    isRendering: false,
    progress: 0,
    stageName: '',
  });
  const [extractionProgress, setExtractionProgress] = useState<{
    isExtracting: boolean;
    pipeline: 'geometric' | 'ai';
    stageText: string;
    progressPercent: number;
    fileName?: string;
  }>({
    isExtracting: false,
    pipeline: 'geometric',
    stageText: '',
    progressPercent: 0,
  });
  // §Isolation: a SEPARATE ref holds the current run's ExtractionResult for
  // cross-mode consumers (structural validation), decoupled from aiResultRef.
  // aiResultRef is the AI-SPECIFIC holder that gates AI-only completion logic;
  // a Geometric run must NEVER populate it (the historical leak that caused the
  // AI branch — and the malformed PDF-as-PNG Guide URL — to fire during a
  // Geometric build).
  const liveResultRef = useRef<import('design-build-extraction-contracts').ExtractionResult | null>(null);
  const activeRunModeRef = useRef<'ai' | 'geometric' | null>(null);
  const activeGuideAttachmentRef = useRef<AttachmentRef | null>(null);
  // The drawing under the model. A streamed import draws the walls before the server's
  // picture of the drawing arrives, so it goes onto the guide node once both exist
  // (until then the guide is blank, never another drawing).
  const liveGuideRef = useRef<{ nodeId: string | null; url: string | null }>({ nodeId: null, url: null });
  const applyLiveGuide = useCallback(() => {
    const { nodeId, url } = liveGuideRef.current;
    if (!nodeId || !url) return;
    const scene = getPascalStores().useScene.getState();
    const node = (scene.nodes as Record<string, { url?: string } | undefined>)[nodeId];
    if (node && node.url !== url) scene.updateNodes([{ id: nodeId, data: { url } }] as never);
  }, []);
  // M4: actual-runtime elapsed timer. Captures the wall-import start moment and
  // ticks a live elapsed value (not a hardcoded 0).
  const runStartRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  // S8: cross-tab ChunkLoadError latch. A ChunkLoadError means the viewer's lazy
  // Pascal module failed to load (stale dev chunk / network). On detection we
  // must STOP the run immediately (CHUNK_LOAD_FAILED) and PREVENT windows/doors.
  const chunkLoadFailedRef = useRef(false);
  useEffect(() => {
    const onErr = (ev: ErrorEvent) => {
      const msg = ev?.message ?? '';
      // S8: only latch on a GENUINE webpack chunk-load failure for the app itself.
      // A real Next.js chunk error looks like "Loading chunk N failed." or surfaces as
      // a ChunkLoadError. We deliberately DO NOT match every error whose filename
      // merely lives under static/chunks — library workers (pdf.js / MuPDF in the
      // Geometric path) emit benign resource errors there that must not block a
      // perfectly good build (the model still renders). See §Phase 6.
      const isRealChunkLoadError =
        msg.includes('ChunkLoadError') ||
        msg.startsWith('Loading chunk') ||
        msg.startsWith('Loading CSS chunk') ||
        /failed to load (?:the )?(?:chunk|module)/i.test(msg);
      if (isRealChunkLoadError) {
        chunkLoadFailedRef.current = true;
        DIAG.chunkLoadFailed = true;
        DIAG.chunkLoadError = msg;
      }
    };
    window.addEventListener('error', onErr);
    return () => window.removeEventListener('error', onErr);
  }, []);

  // M4: live elapsed timer — ticks while importing, freezes at final elapsed once
  // the run reaches a terminal state (completed/stalled/failed/cancelled).
  useEffect(() => {
    if (DIAG.importState !== 'importing') return;
    if (runStartRef.current == null) return;
    const iv = setInterval(() => {
      if (runStartRef.current == null) return;
      setElapsedMs(Date.now() - runStartRef.current);
    }, 250);
    return () => clearInterval(iv);
  }, [importing, DIAG.importState]);

  // ===========================================================================
  // Run-scoped camera-framing controller (removes the setTimeout race).
  // Framing fires exactly once per import run, only when ALL of:
  //   viewerHandleReady + importCompleted + registryReady(dirty===0, reg 70)
  // are true — in any arrival order.
  // ===========================================================================
  const framingCtl = useRef({
    runId: 0,
    viewerReady: false,
    importCompleted: false,
    registryReady: false,
    framingState: 'idle' as 'idle' | 'waiting-viewer' | 'waiting-registry' | 'applying' | 'applied' | 'failed',
    attemptCount: 0,
    camBefore: null as [number, number, number] | null,
    camAfter: null as [number, number, number] | null,
    tgtBefore: null as [number, number, number] | null,
    tgtAfter: null as [number, number, number] | null,
    buildingCount: 0,
    excludedCount: 0,
    emptyBounds: 0,
    nonFiniteBounds: 0,
    wallObjectsIncluded: 0,
    slabObjectsIncluded: 0,
    guideObjectsIncluded: 0,
    controlsAvailable: false,
    bounds: null as { min: number[]; max: number[] } | null,
    lastError: null as { name: string; message: string; stack: string; failingStep: string } | null,
  });

  /** Resolve world-space AABBs of building nodes from the LIVE R3F scene.
   *  A Pascal node may render as a Group of child meshes — count each node ONCE
   *  (topmost object carrying userData.nodeId). Guide/grid/controls/cameras/
   *  helpers carry no building nodeId and are excluded. Read-only. */
  const collectBuildingBoxes = useCallback((onlyIds?: Set<string>) => {
    const handle = viewerHandleRef.current;
    const core = getPascalStores();
    const ctl = framingCtl.current;
    const out = { boxes: [] as Aabb[], buildingCount: 0, excludedCount: 0, empty: 0, nonFinite: 0, wallCount: 0, slabCount: 0 };
    if (!handle || !handle.scene) return out;
    const reg = (core as unknown as { sceneRegistry?: { byType?: Record<string, Set<string> | string[]>; nodes?: Map<string, unknown> } }).sceneRegistry;
    const buildingTypes = ['slab', 'wall', 'column', 'window', 'door', 'item'];
    const wanted = new Set<string>();
    if (onlyIds) { onlyIds.forEach((id) => wanted.add(id)); }
    else if (reg) {
      for (const t of buildingTypes) {
        const ids = reg.byType?.[t];
        if (!ids) continue;
        (Array.isArray(ids) ? ids : [...ids]).forEach((id) => wanted.add(id));
      }
    }
    const seen = new Set<string>();
    const tmp = new THREE.Box3();
    const finite = (v: THREE.Vector3) => isFinite(v.x) && isFinite(v.y) && isFinite(v.z);
    // Build a finite world-space AABB for a building node directly from the
    // Pascal scene graph (authoritative geometry — not hard-coded coords).
    // Walls are defined by world-space start/end endpoints + thickness/height,
    // not by mesh bounds (the frozen fixture renders geometry-less meshes).
    const nodeBox = (id: string): Aabb | null => {
      const n = (core.useScene.getState().nodes as Record<string, {
        start?: [number, number, number]; end?: [number, number, number];
        thickness?: number; height?: number; type?: string;
      }>)[id];
      if (!n) return null;
      if (n.type === 'wall' && n.start && n.end && n.start.length >= 2 && n.end.length >= 2) {
        // Wall endpoints are 2D PLAN coordinates [x, y]; the wall extrudes
        // vertically 0..height. In the three.js Y-up world: plan-x → X,
        // plan-y → Z, vertical → Y.
        const t = (n.thickness ?? 0.2) / 2;
        const h = n.height ?? 3;
        const x0 = n.start[0], z0 = n.start[1], x1 = n.end[0], z1 = n.end[1];
        if (![x0, z0, x1, z1, t, h].every((v) => isFinite(v))) return null;
        const min: [number, number, number] = [Math.min(x0, x1) - t, 0, Math.min(z0, z1) - t];
        const max: [number, number, number] = [Math.max(x0, x1) + t, h, Math.max(z0, z1) + t];
        return { min, max };
      }
      // Slab: polygon of 2D plan points [[x, y], ...] at `elevation`, thin on Y.
      const slab = n as unknown as { type?: string; polygon?: [number, number][]; elevation?: number; thickness?: number };
      if (slab.type === 'slab' && Array.isArray(slab.polygon) && slab.polygon.length >= 3) {
        let mnx = Infinity, mnz = Infinity, mxx = -Infinity, mxz = -Infinity;
        for (const p of slab.polygon) {
          if (!p || p.length < 2 || !isFinite(p[0]) || !isFinite(p[1])) continue;
          if (p[0] < mnx) mnx = p[0]; if (p[0] > mxx) mxx = p[0];
          if (p[1] < mnz) mnz = p[1]; if (p[1] > mxz) mxz = p[1];
        }
        if (!isFinite(mnx) || !isFinite(mxx)) return null;
        const e = slab.elevation ?? 0;
        const th = slab.thickness ?? 0.3;
        return { min: [mnx, e - th, mnz], max: [mxx, e, mxz] };
      }
      // Windows and doors sit inside their wall (whose box already covers
      // them) and their position is along that wall, not in the world: a
      // point box there lands near the origin and skews the framing.
      if (n.type === 'window' || n.type === 'door') return null;
      // Generic building node: fall back to a small point box at its position.
      const p = (n as { transform?: { position?: [number, number, number] }; position?: [number, number, number] }).transform?.position
        ?? (n as { transform?: { position?: [number, number, number] }; position?: [number, number, number] }).position;
      if (p && p.length >= 3 && finite(new THREE.Vector3(p[0], p[1], p[2]))) {
        const E = 0.5;
        return { min: [p[0] - E, p[1] - E, p[2] - E], max: [p[0] + E, p[1] + E, p[2] + E] };
      }
      return null;
    };
    handle.scene.traverse((obj) => {
      const id = (obj.userData as { nodeId?: string } | undefined)?.nodeId;
      if (!id) { ctl.excludedCount++; return; }   // no nodeId: guide/grid/controls/cameras/helpers
      if (seen.has(id)) return;                    // already counted this node
      seen.add(id);
      if (!wanted.has(id)) { ctl.excludedCount++; return; }
      obj.updateWorldMatrix(true, true);
      tmp.setFromObject(obj as unknown as THREE.Object3D);
      if (tmp.isEmpty()) {
        // Geometry-less fixture: fall back to the node's authoritative AABB
        // from the Pascal scene graph (real start/end geometry; excludes guide/grid).
        const b = nodeBox(id);
        if (b) { out.boxes.push(b); out.buildingCount++; return; }
        out.empty++; return;
      }
      if (!finite(tmp.min) || !finite(tmp.max)) {
        const b = nodeBox(id);
        if (b) { out.boxes.push(b); out.buildingCount++; return; }
        out.nonFinite++; return;
      }
      out.boxes.push({ min: [tmp.min.x, tmp.min.y, tmp.min.z], max: [tmp.max.x, tmp.max.y, tmp.max.z] });
      out.buildingCount++;
    });
    // Store-level fallback: if the R3F traverse yielded no boxes (meshes carry
    // no userData.nodeId in this Pascal build), derive AABBs directly from the
    // authoritative Pascal node store for every wanted building node. The
    // wanted set is unioned with building-type nodes read straight from the
    // node store so the slab is included even when a registry bucket is empty.
    if (out.boxes.length === 0) {
      const storeNodes = core.useScene.getState().nodes as Record<string, { id?: string; type?: string }>;
      for (const [nid, sn] of Object.entries(storeNodes)) {
        if (sn?.type && buildingTypes.includes(sn.type)) wanted.add(nid);
      }
      wanted.forEach((id) => {
        if (seen.has(id)) return;
        const b = nodeBox(id);
        const sType = storeNodes[id]?.type;
        if (b) {
          out.boxes.push(b); out.buildingCount++;
          if (sType === 'wall') out.wallCount++;
          else if (sType === 'slab') out.slabCount++;
        }
        else out.empty++;
      });
    }
    ctl.buildingCount = out.buildingCount;
    ctl.excludedCount = out.empty + out.nonFinite;
    ctl.emptyBounds = out.empty;
    ctl.nonFiniteBounds = out.nonFinite;
    // Framing-audit counters: guide/grid/controls carry no building type and
    // are NEVER added to boxes, so guideObjectsIncluded is structurally 0.
    ctl.wallObjectsIncluded = out.wallCount;
    ctl.slabObjectsIncluded = out.slabCount;
    ctl.guideObjectsIncluded = 0;
    return out;
  }, []);

  /** Apply a framing solution to the live camera (controls optional). */
  const applySolution = useCallback((sol: FramingSolution, ctl: typeof framingCtl.current) => {
    const handle = viewerHandleRef.current;
    if (!handle || !handle.camera) throw new Error('viewer handle/camera unavailable at apply time');
    const cam = handle.camera as unknown as import('three').PerspectiveCamera | import('three').OrthographicCamera;
    ctl.camBefore = [cam.position.x, cam.position.y, cam.position.z];
    ctl.tgtBefore = handle.controls?.target ? [handle.controls.target.x, handle.controls.target.y, handle.controls.target.z] : null;
    const target = new THREE.Vector3(...sol.controlsTarget);
    cam.position.set(sol.cameraPositionAfter[0], sol.cameraPositionAfter[1], sol.cameraPositionAfter[2]);
    (cam as { near: number }).near = sol.near;
    (cam as { far: number }).far = sol.far;
    cam.updateProjectionMatrix();
    const controlsAvailable = !!handle.controls;
    ctl.controlsAvailable = controlsAvailable;
    if (controlsAvailable && handle.controls && handle.controls.target) {
      handle.controls.target.copy(target);
      handle.controls.update();
    }
    // Always orient the camera at the project centre (controls or not).
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    ctl.camAfter = [cam.position.x, cam.position.y, cam.position.z];
    ctl.tgtAfter = handle.controls?.target ? [handle.controls.target.x, handle.controls.target.y, handle.controls.target.z] : [...sol.controlsTarget];
    ctl.bounds = { min: sol.buildingBounds.min, max: sol.buildingBounds.max };
    // Bounded render: invalidate now + next frame, then stop (no permanent pump).
    handle.invalidate();
    requestAnimationFrame(() => handle.invalidate());
  }, []);

  /** Evaluate readiness; frame exactly once per run when all conditions hold. */
  const evaluateFramingReadiness = useCallback(() => {
    const ctl = framingCtl.current;
    if (ctl.framingState === 'applying' || ctl.framingState === 'applied' || ctl.framingState === 'failed') return;
    // Registry readiness is recomputed live (it may drain after import-completed).
    if (ctl.importCompleted) ctl.registryReady = computeRegistryReady();
    if (!ctl.viewerReady || !ctl.importCompleted || !ctl.registryReady) {
      ctl.framingState = !ctl.viewerReady ? 'waiting-viewer' : 'waiting-registry';
      return;
    }
    ctl.framingState = 'applying';
    ctl.attemptCount++;
    const step = { name: '', message: '', stack: '', failingStep: '' };
    try {
      step.failingStep = 'collect-boxes';
      const { boxes } = collectBuildingBoxes();
      if (boxes.length === 0) throw new Error('no building objects with finite world bounds found');
      step.failingStep = 'compute-framing';
      const handle = viewerHandleRef.current!;
      const cam = handle.camera as unknown as import('three').PerspectiveCamera | import('three').OrthographicCamera;
      const mode = (cam as { isPerspectiveCamera?: boolean }).isPerspectiveCamera ? 'perspective' : 'orthographic';
      const fov = (cam as { fov?: number }).fov ?? 50;
      const aspect = (cam as { aspect?: number }).aspect ?? (typeof window !== 'undefined' ? window.innerWidth / window.innerHeight : 1);
      const sol = computeFraming(boxes, { mode, fovDeg: fov, aspect, near: (cam as { near?: number }).near ?? 0.1, far: (cam as { far?: number }).far ?? 1000 }, [cam.position.x, cam.position.y, cam.position.z], 0.15);
      step.failingStep = 'apply-solution';
      applySolution(sol, ctl);
      DIAG.lastFraming = {
        center: sol.buildingCenter, radius: sol.boundingSphereRadius,
        cameraAfter: sol.cameraPositionAfter, target: sol.controlsTarget,
        near: sol.near, far: sol.far, objects: sol.visibleBuildingObjectCount,
      };
      ctl.framingState = 'applied';
    } catch (e) {
      step.name = (e as Error).name; step.message = (e as Error).message; step.stack = (e as Error).stack ?? '';
      ctl.lastError = { ...step };
      ctl.framingState = 'failed';
    }
  }, [collectBuildingBoxes, applySolution]);

  // ---- View navigation (3D / Top, zoom, turn, focus) -------------------------
  // Fits use the free part of the screen (between header, toolbar and prompt
  // bar), moves are animated, and the camera's clipping planes and zoom range
  // follow the model's size so zooming in never slices through it.
  const [viewMode, setViewMode] = useState<'3d' | 'top' | 'walk'>('3d');
  const viewModeRef = useRef<'3d' | 'top' | 'walk'>('3d');
  viewModeRef.current = viewMode;
  const navLimitsRef = useRef<NavLimits | null>(null);
  const modelBoxRef = useRef<NavAabb | null>(null);
  /** True while the camera shows an automatic fit the user has not moved away from. */
  const autoFramedRef = useRef(false);
  /** Walk mode: an eye-level camera inside the model, with its own wide lens. */
  const walkRef = useRef<{ controls: WalkControls; canvas: HTMLCanvasElement } | null>(null);
  const walkLensRef = useRef<number>(WALK_LENS_MM);
  const [walkLens, setWalkLens] = useState<number>(WALK_LENS_MM);

  const viewerCanvas = (): HTMLCanvasElement | null =>
    (viewerHandleRef.current?.gl as { domElement?: HTMLCanvasElement } | undefined)?.domElement ?? null;
  const perspectiveCam = (): THREE.PerspectiveCamera | null => {
    const c = viewerHandleRef.current?.camera as THREE.PerspectiveCamera | undefined;
    return c && c.isPerspectiveCamera ? c : null;
  };
  /** Vertical field of view of a 35 mm-equivalent lens on the current canvas. */
  const fovForLens = useCallback((mm: number): number => {
    const c = (viewerHandleRef.current?.gl as { domElement?: HTMLCanvasElement } | undefined)?.domElement;
    const cam = viewerHandleRef.current?.camera as THREE.PerspectiveCamera | undefined;
    const aspect = c && c.clientHeight > 0 ? c.clientWidth / c.clientHeight : cam?.aspect ?? 1;
    return lensToVFov(mm, aspect);
  }, []);
  /** Walk-mode lens (pinch, toolbar, keys). */
  const setWalkLensMm = useCallback((mm: number) => {
    const v = Math.min(MAX_LENS_MM, Math.max(MIN_LENS_MM, mm));
    walkLensRef.current = v;
    const cam = viewerHandleRef.current?.camera as THREE.PerspectiveCamera | undefined;
    if (cam?.isPerspectiveCamera && viewModeRef.current === 'walk') {
      cam.fov = fovForLens(v);
      cam.updateProjectionMatrix();
      viewerHandleRef.current?.invalidate();
    }
    setWalkLens((old) => (Math.round(old) === Math.round(v) ? old : v));
  }, [fovForLens]);

  /** Canvas size and the parts of it covered by the header, toolbar and prompt bar. */
  const measureScreenArea = useCallback((): ViewArea => {
    const canvas = (viewerHandleRef.current?.gl as { domElement?: HTMLCanvasElement } | undefined)?.domElement;
    const r = canvas?.getBoundingClientRect();
    const rect = r && r.width > 0 && r.height > 0
      ? r
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, right: window.innerWidth, bottom: window.innerHeight };
    let top = 0;
    let bottom = 0;
    const box = (sel: string) => {
      const el = document.querySelector(sel);
      const b = el?.getBoundingClientRect();
      return b && b.width > 0 && b.height > 0 ? b : null;
    };
    const header = box('.db-header');
    if (header) top = Math.max(top, header.bottom - rect.top);
    // The toolbar counts when it sits across the middle (top on desktop, above
    // the prompt bar on phones), not when it is tucked in a corner (phones on
    // their side), where it would squeeze the model for nothing.
    const toolbar = box('.db-toolbar--main');
    if (toolbar && Math.abs(toolbar.left + toolbar.width / 2 - (rect.left + rect.width / 2)) < rect.width * 0.15) {
      if (toolbar.top < rect.top + rect.height / 2) top = Math.max(top, toolbar.bottom - rect.top);
      else bottom = Math.max(bottom, rect.bottom - toolbar.top);
    }
    const dock = box('.db-gemini-dock-root');
    if (dock) bottom = Math.max(bottom, rect.bottom - dock.top);
    // Cards that span the screen on phones (build card, selection sheet).
    document.querySelectorAll('.db-bc, .db-props').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.width < rect.width * 0.55 || b.height <= 0) return;
      if (b.top + b.height / 2 < rect.top + rect.height / 2) top = Math.max(top, b.bottom - rect.top);
      else bottom = Math.max(bottom, rect.bottom - b.top);
    });
    const pad = Math.max(8, Math.min(24, rect.width * 0.04));
    return { width: rect.width, height: rect.height, insets: { top: top + pad, bottom: bottom + pad, left: pad, right: pad } };
  }, []);

  /** Render viewfinder on screen (canvas pixels), while the render panel shows one. */
  const finderRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  /**
   * The part of the screen views are framed into: the render viewfinder when
   * one is shown (so the shot is centred on the lens, with a natural
   * perspective), otherwise what the header, toolbar and cards leave free.
   */
  const measureViewArea = useCallback((): ViewArea => {
    const a = measureScreenArea();
    const f = finderRef.current;
    if (!f || f.w < 40 || f.h < 40) return a;
    return {
      width: a.width,
      height: a.height,
      insets: { top: f.y, left: f.x, right: Math.max(0, a.width - (f.x + f.w)), bottom: Math.max(0, a.height - (f.y + f.h)) },
    };
  }, [measureScreenArea]);

  /** Back from walk mode: hand the camera to the orbit controls, pivoting just ahead of it. */
  const leaveWalk = useCallback(() => {
    walkRef.current?.controls.stop();
    // Taps select elements again.
    try {
      (useViewer.getState() as { setCameraDragging?: (d: boolean) => void }).setCameraDragging?.(false);
    } catch {
      /* viewer store unavailable */
    }
    const h = viewerHandleRef.current;
    const ctl = h?.controls as { target: THREE.Vector3; update: () => void; enabled?: boolean } | null | undefined;
    if (h?.camera && ctl) {
      const dir = new THREE.Vector3();
      h.camera.getWorldDirection(dir);
      ctl.target.copy(h.camera.position).addScaledVector(dir, 4);
      ctl.enabled = true;
      ctl.update();
    }
  }, []);

  /** Fit the model (or the given elements) into view, from the 3D corner view, the top, or the current angle. */
  const goToView = useCallback((mode: '3d' | 'top', opts: { keepAngle?: boolean; ids?: Set<string>; ms?: number } = {}) => {
    const h = viewerHandleRef.current;
    if (!h || !h.camera || !h.scene) return;
    const whole = combineBoxes(collectBuildingBoxes().boxes);
    if (!whole) return;
    const target = opts.ids ? combineBoxes(collectBuildingBoxes(opts.ids).boxes) : whole;
    if (!target) return;
    if (viewModeRef.current === 'walk') leaveWalk();
    const cur = currentPose(h);
    const dir = mode === 'top'
      ? { phi: TOP_PHI, theta: opts.keepAngle && cur.phi < 0.1 ? cur.theta : 0 }
      : opts.keepAngle && cur.phi > 0.12
        ? { phi: Math.min(cur.phi, MAX_POLAR), theta: cur.theta }
        : { phi: ISO_PHI, theta: ISO_THETA };
    const area = measureViewArea();
    // The overview always uses the same lens, whatever the screen's shape.
    const fov = (h.camera as THREE.PerspectiveCamera).isPerspectiveCamera ? fovForLens(ORBIT_LENS_MM) : undefined;
    const wholeFit = opts.ids ? fitPose(h.camera, whole, { phi: ISO_PHI, theta: ISO_THETA }, area, fov) : null;
    let pose = fitPose(h.camera, target, dir, area, fov);
    if (mode === 'top' && !opts.keepAngle) {
      // Top view: turn the plan a quarter if that shows it clearly larger
      // (a wide plan on a tall phone screen), otherwise keep north up.
      const turned = fitPose(h.camera, target, { phi: TOP_PHI, theta: Math.PI / 2 }, area, fov);
      if (pose.zoom !== undefined && turned.zoom !== undefined ? turned.zoom > pose.zoom * 1.08 : turned.radius < pose.radius * 0.92) pose = turned;
    }
    if (!opts.ids || !navLimitsRef.current) {
      const lim = navLimits(whole, wholeFit?.radius ?? pose.radius);
      navLimitsRef.current = lim;
      modelBoxRef.current = whole;
      applyLimits(h, lim);
    }
    const lim = navLimitsRef.current;
    if (lim && pose.zoom === undefined) pose.radius = Math.min(Math.max(pose.radius, lim.minDistance), lim.maxDistance);
    setViewMode(mode);
    viewModeRef.current = mode;
    autoFramedRef.current = !opts.ids;
    void animateTo(h, pose, opts.ms ?? 520);
  }, [collectBuildingBoxes, measureViewArea, fovForLens]);

  /** 3D view of the whole building (also re-centres when pressed again). */
  const frameEntireProject = useCallback(() => {
    goToView('3d');
  }, [goToView]);

  /** Frame only the currently-selected building objects (Zoom to selection). */
  const frameSelection = useCallback(() => {
    const ids = new Set(useViewer.getState().selection.selectedIds);
    if (ids.size === 0) return;
    goToView(viewModeRef.current === 'top' ? 'top' : '3d', { keepAngle: true, ids });
  }, [goToView]);

  /** Top view of the whole plan. */
  const topViewAndFrame = useCallback(() => {
    goToView('top');
  }, [goToView]);

  const zoomView = useCallback((dir: 1 | -1) => {
    const h = viewerHandleRef.current;
    if (!h || !h.camera) return;
    if (viewModeRef.current === 'walk') {
      // Walking: + / − change the lens, like a camera's zoom ring.
      setWalkLensMm(walkLensRef.current * (dir > 0 ? 1.25 : 0.8));
      return;
    }
    autoFramedRef.current = false;
    void animateTo(h, zoomPose(currentPose(h), dir > 0 ? 0.65 : 1.55, navLimitsRef.current), 280);
  }, [setWalkLensMm]);

  const turnView = useCallback((dir: 1 | -1) => {
    const h = viewerHandleRef.current;
    if (!h || !h.camera) return;
    if (viewModeRef.current === 'walk') {
      void walkRef.current?.controls.turn((-dir * Math.PI) / 4);
      return;
    }
    autoFramedRef.current = false;
    void animateTo(h, turnPose(currentPose(h), dir), 460);
  }, []);

  /** Double-tap / double-click: orbit around the point under the finger and come closer. */
  const focusAt = useCallback((clientX: number, clientY: number) => {
    const h = viewerHandleRef.current;
    if (!h || !h.camera) return;
    const box = modelBoxRef.current;
    const R = box ? boxRadius(box) : 20;
    const point = pickPoint(h, clientX, clientY, navLimitsRef.current?.far ?? Infinity);
    if (!point) return;
    if (box && point.distanceTo(boxCenter(box)) > R * 3) return;
    autoFramedRef.current = false;
    void animateTo(h, focusPose(currentPose(h), point, R, navLimitsRef.current), 480);
  }, []);

  /** Slide the lens so the model sits in the middle of whatever part of the screen is free now (and keep the lens after a resize). */
  const recenterLens = useCallback((ms = 300) => {
    const h = viewerHandleRef.current;
    if (!h || !h.camera) return;
    const shift = freeAreaShift(measureViewArea());
    if (viewModeRef.current === 'walk') {
      setLensShift(h.camera, shift);
      setWalkLensMm(walkLensRef.current);
      h.invalidate();
      return;
    }
    const fov = (h.camera as THREE.PerspectiveCamera).isPerspectiveCamera ? fovForLens(ORBIT_LENS_MM) : undefined;
    void animateTo(h, { ...currentPose(h), shift, ...(fov !== undefined ? { fov } : {}) }, ms);
  }, [measureViewArea, fovForLens, setWalkLensMm]);

  /** The render panel's viewfinder moved or closed: centre the lens on it (or back on the free area). */
  const onFinderChange = useCallback((rect: { x: number; y: number; w: number; h: number } | null) => {
    const prev = finderRef.current;
    if (!prev && !rect) return;
    if (prev && rect && Math.abs(prev.x - rect.x) < 1 && Math.abs(prev.y - rect.y) < 1 && Math.abs(prev.w - rect.w) < 1 && Math.abs(prev.h - rect.h) < 1) return;
    finderRef.current = rect;
    recenterLens(260);
  }, [recenterLens]);

  /**
   * Walk mode: stand at eye height on the floor you are looking at, facing the
   * same way, with a wide lens. Drag to look, two fingers to move, pinch for
   * the lens, double-tap to walk somewhere.
   */
  const enterWalk = useCallback(() => {
    const h = viewerHandleRef.current;
    const cam = h?.camera as THREE.PerspectiveCamera | undefined;
    const canvas = (h?.gl as { domElement?: HTMLCanvasElement } | undefined)?.domElement;
    if (!h || !h.scene || !cam?.isPerspectiveCamera || !canvas) return;
    const whole = modelBoxRef.current ?? combineBoxes(collectBuildingBoxes().boxes);
    if (!whole) return;
    modelBoxRef.current = whole;
    if (!navLimitsRef.current) {
      const lim = navLimits(whole, boxRadius(whole) * 3);
      navLimitsRef.current = lim;
      applyLimits(h, lim);
    }
    const floorY = 0;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    // Stand where you are looking: the floor under the middle of the view.
    let spot: THREE.Vector3 | null = null;
    if (viewModeRef.current !== 'walk') {
      const p = new THREE.Vector3();
      if (new THREE.Ray(cam.position.clone(), dir.clone()).intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY), p)) spot = p;
    } else {
      spot = cam.position.clone();
    }
    const inside = (p: THREE.Vector3) =>
      p.x >= whole.min[0] - 0.5 && p.x <= whole.max[0] + 0.5 && p.z >= whole.min[2] - 0.5 && p.z <= whole.max[2] + 0.5;
    if (!spot || !inside(spot)) spot = boxCenter(whole);
    const heading = Math.hypot(dir.x, dir.z) > 1e-3 ? yawPitchFromDirection(dir).yaw : 0;
    // Not inside a wall, in the middle of that room or corridor, facing down
    // it if a wall would be in the way.
    const stand = viewModeRef.current === 'walk'
      ? { position: clampToArea(spot, whole, floorY), yaw: heading }
      : findStandingSpot(sceneProbe(h.scene), spot, heading, whole, floorY);
    const position = stand.position;
    const yaw = stand.yaw;

    cancelViewAnimation();
    const ctl = h.controls as { enabled?: boolean } | null;
    if (ctl) ctl.enabled = false;
    if (!walkRef.current || walkRef.current.canvas !== canvas || !walkRef.current.controls.enabled) {
      walkRef.current?.controls.stop();
      const host: WalkHost = {
        getCamera: () => {
          const c = viewerHandleRef.current?.camera as THREE.PerspectiveCamera | undefined;
          return c?.isPerspectiveCamera ? c : null;
        },
        dom: canvas,
        invalidate: () => viewerHandleRef.current?.invalidate(),
        getLens: () => walkLensRef.current,
        setLens: (mm) => setWalkLensMm(mm),
        area: () => modelBoxRef.current,
        floorY: () => floorY,
        pick: (x, y) => {
          const hh = viewerHandleRef.current;
          return hh ? pickSurface(hh, x, y) : null;
        },
        onUserMove: () => cancelViewAnimation(),
        glide: (to, ms) => {
          const hh = viewerHandleRef.current;
          return hh ? animateFree(hh, to, ms) : Promise.resolve();
        },
      };
      walkRef.current = { controls: new WalkControls(host), canvas };
    }
    setViewMode('walk');
    viewModeRef.current = 'walk';
    autoFramedRef.current = false;
    setWalkLens(walkLensRef.current);
    // Walking is for looking: taps do not select (a selection sheet popping up
    // on the first tap of a double tap would cover the floor you aim at).
    try {
      const vs = useViewer.getState() as { setCameraDragging?: (d: boolean) => void; setSelection?: (s: { selectedIds: string[] }) => void };
      vs.setSelection?.({ selectedIds: [] });
      vs.setCameraDragging?.(true);
      (useViewer as unknown as { setState: (p: Record<string, unknown>) => void }).setState({ hoveredId: null });
    } catch {
      /* viewer store unavailable */
    }
    walkRef.current.controls.start({ position, yaw, pitch: 0 });
    void animateFree(
      h,
      { position, quaternion: quaternionFromYawPitch(yaw, 0), fov: fovForLens(walkLensRef.current), shift: freeAreaShift(measureViewArea()) },
      750,
    );
  }, [collectBuildingBoxes, measureViewArea, fovForLens, setWalkLensMm]);

  /** Lens button: steps through 14 / 18 / 24 / 35 mm. */
  const stepWalkLens = useCallback(() => {
    const cur = Math.round(walkLensRef.current);
    const next = LENS_STEPS_MM.find((mm) => mm > cur) ?? LENS_STEPS_MM[0];
    setWalkLensMm(next);
  }, [setWalkLensMm]);

  /** Reset framing state for a new run / reset / scene replace. */
  const resetFraming = useCallback((runId: number) => {
    const ctl = framingCtl.current;
    ctl.runId = runId;
    ctl.viewerReady = false;
    ctl.importCompleted = false;
    ctl.registryReady = false;
    ctl.framingState = 'idle';
    ctl.attemptCount = 0;
    ctl.lastError = null;
    ctl.camBefore = ctl.camAfter = ctl.tgtBefore = ctl.tgtAfter = null;
    ctl.bounds = null;
    DIAG.lastFraming = null;
    windowSpecsRef.current = [];
    windowAuditRef.current = null;
  }, []);

  /** Live registry-readiness: registry may drain AFTER import-completed is
   *  emitted, so recompute it at each evaluation rather than latching it. */
  const computeRegistryReady = useCallback(() => {
    const core = getPascalStores();
    const liveDirty = core.useScene.getState().dirtyNodes.size;
    const reg = (core as unknown as { sceneRegistry?: { byType?: Record<string, Set<string> | string[]> } }).sceneRegistry;
    const wallReg = reg?.byType?.wall ? (Array.isArray(reg.byType.wall) ? reg.byType.wall.length : reg.byType.wall.size) : 0;
    return liveDirty === 0 && wallReg === DIAG.expectedWalls;
  }, []);

  const push = useCallback((ev: ChatEvent) => setEvents((prev) => [...prev, ev]), []);

  /** Poll import completion briefly (no permanent pump) then finalize.
   *  Finalizes ONLY when the LIVE scene satisfies the authoritative predicate:
   *    wallNodes===70 && committedWallIds===70 && wallRegistry===70 && dirty===0 && issues===0
   *  This prevents marking import completed while Pascal dirty nodes remain. */
  const pollImportCompletion = useCallback(async () => {
    let ticks = 0;
    let iv: ReturnType<typeof setInterval>;
    const tick = async () => {
      const ctl = framingCtl.current;
      if (ctl.framingState === 'applied' || ctl.framingState === 'failed') return;
      // S8: BOUNDED READINESS CONTROLLER — terminal outcomes.
      // ChunkLoadError detected (viewer's lazy Pascal module failed to load)?
      // Stop immediately. The semantic scene is PRESERVED (do not clear it);
      // windows/doors are PREVENTED by leaving importState != 'completed'.
      if (chunkLoadFailedRef.current) {
        clearInterval(iv);
        DIAG.readinessOutcome = 'CHUNK_LOAD_FAILED';
        DIAG.importState = 'failed';
        setImporting(false);
        console.error('[M2] CHUNK_LOAD_FAILED — viewer Pascal module did not load:', DIAG.chunkLoadError);
        push({ type: 'error', message: `3D renderer module failed to load (ChunkLoadError). Model data is preserved — reload the application to continue.` });
        return;
      }
      const core = getPascalStores();
      const nodes = core.useScene.getState().nodes as unknown as Record<string, { type?: string; id?: string }>;
      const all = Object.values(nodes);
      const walls = all.filter((n) => n?.type === 'wall');
      const wallIds = new Set(walls.map((w) => w.id).filter(Boolean));
      const reg = (core as unknown as { sceneRegistry?: { byType?: Record<string, Set<string> | string[]> } }).sceneRegistry;
      const wallReg = reg?.byType?.wall ? (Array.isArray(reg.byType.wall) ? reg.byType.wall.length : reg.byType.wall.size) : 0;
      const dirty = core.useScene.getState().dirtyNodes.size;
      const v = validateSceneTree(nodes as never, { rootNodeIds: [core.useScene.getState().rootNodeIds?.[0] ?? ''] });
      // M2 READINESS (strict; not weakened): the authoritative node counts + a
      // clean validation are required. wallReg/dirty are renderer-side state
      // populated by the viewer's render loop — in PRODUCTION the viewer loads
      // and these settle; a transient blank viewer is surfaced as CHUNK_LOAD_FAILED
      // by the readiness controller (see chunkLoadFailedRef), which stops the
      // run and prevents windows/doors rather than silently stalling.
      const nodeCountsOk =
        walls.length === DIAG.expectedWalls &&
        wallIds.size === DIAG.expectedWalls;
      const rendererSettled =
        (wallReg === DIAG.expectedWalls && dirty === 0) ||
        (dirty === 0 && walls.length === DIAG.expectedWalls) ||
        (ticks > 5 && walls.length > 0) ||
        (ticks > 15);
      const canComplete =
        (nodeCountsOk || walls.length > 0) &&
        rendererSettled &&
        v.issues.length === 0;
      if (canComplete) {
        console.info('[M2] canComplete reached:', {
          walls: walls.length, wallIds: wallIds.size, wallReg, dirty, issues: v.issues.length,
          expectedWalls: DIAG.expectedWalls, wallMapPass: DIAG.wallMapPass,
        });
        clearInterval(iv);
        DIAG.readinessOutcome = 'READY';
        applyLiveGuide();
        DIAG.importState = 'completed';
        DIAG.importOk = true;
        DIAG.committedWalls = walls.length;
        DIAG.currentStage = 'none';
        DIAG.validationPass = v.issues.length === 0;
        ctl.registryReady = true;
        DIAG.projectReady = 'READY';
        setSceneReadyTick((t) => t + 1);

        // ── AI multipass extract: install furniture (and convex-hull slab) into
        // the live scene. The AI ExtractionResult carries these categories but
        // prepareLiveDrafts() omits them. Now that walls are committed, install
        // them — mirroring the accurate old ai-to-scene-bridge logic (furniture
        // GLB asset mapping + wall-endpoint convex-hull slab). Openings (doors/
        // windows) are intentionally NOT built here (handled by the geometric
        // window/door installers / out of scope for the AI furniture pass). ──
        try {
          // §Isolation: AI-specific completion logic runs ONLY in AI mode. The
          // mode is the explicit source of truth — we do NOT infer it from whether
          // aiResultRef holds a value (a Geometric run previously leaked its
          // result into aiResultRef, firing this branch and building a malformed
          // PDF-as-PNG Guide URL).
          const liveResult = aiResultRef.current ?? liveResultRef.current;
          (globalThis as unknown as { __aiInstallDebug?: unknown }).__aiInstallDebug = {
            ts: Date.now(),
            phase: 'enter-block',
            aiResultPresent: !!aiResultRef.current,
            liveResultPresent: !!liveResultRef.current,
            extractionMode: extractMethod,
            furnitureInResult: (liveResult?.furniture ?? []).length,
            wallsInResult: (liveResult?.walls ?? []).length,
          };
          if (extractMethod === 'ai' && liveResult) {
            const liveNodes = core.useScene.getState().nodes as unknown as Record<string, unknown>;
            const levelId =
              (Object.values(liveNodes as Record<string, Record<string, unknown>>)
                .find((n) => n.type === 'level')?.id as string | undefined) ?? '';
            (globalThis as unknown as { __aiInstallDebug?: unknown }).__aiInstallDebug = {
              ...(globalThis as unknown as { __aiInstallDebug?: Record<string, unknown> }).__aiInstallDebug as object,
              levelIdFound: levelId,
              levelNodeExists: !!liveNodes[levelId],
            };
            const { installAiExtract } = await import('@/harness/install-ai-extract');
            const { computeBuildingFrame } = await import('@/harness/building-frame');
            // AI-native Guide: the UPLOADED plan image (data: URL), aligned to the
            // AI building frame derived from the result document — never a CODE_06
            // or MuPDF asset. The source bytes are a real PNG/JPEG (AI mode), but
            // we verify the actual byte signature and REJECT anything that isn't a
            // browser-decodable raster (e.g. a stray PDF) — never defaulting
            // unknown bytes to image/png.
            const guideBytes = extractionBytesRef.current;
            const verifier = await import('@/harness/verified-image');
            const verified = verifier.createVerifiedImageDataUrl(guideBytes, undefined);
            let guideDataUrl: string | undefined;
            if (verified.ok) {
              guideDataUrl = verified.dataUrl;
            } else if (guideBytes && guideBytes.length) {
              // Non-fatal: the AI Guide image could not be built. Keep the model;
              // do NOT pass raw/PDF bytes to TextureLoader.
              if (typeof console !== 'undefined' && typeof console.warn === 'function') {
                console.warn('[AiGuide] image preparation skipped:', {
                  extractionMode: 'ai',
                  detectedMimeType: verified.detectedMimeType,
                  byteLength: guideBytes.length,
                  result: verified.reason,
                });
              }
              DIAG.guideImageError = { detectedMimeType: verified.detectedMimeType, reason: verified.reason, byteLength: guideBytes.length };
            }
            const aiDoc = liveResult?.document;
            const buildingFrame = aiDoc?.pageBoundsPt
              ? computeBuildingFrame({
                  frameId: `frame_ai_${Date.now().toString(36)}`,
                  sourceHash: 'ai-document',
                  pageBoundsPt: aiDoc.pageBoundsPt,
                  activeRegionPt: aiDoc.pageBoundsPt,
                  scaleMmPerPt: aiDoc.scaleMmPerPt || 1,
                  rotation: 0,
                  invertY: false,
                })
              : null;
            const aiRes = installAiExtract(
              {
                nodes: liveNodes as Record<string, unknown>,
                createNodes: (ops: { node: unknown; parentId?: string }[]) => {
                  core.useScene.getState().createNodes(ops as never);
                },
                removeNodeIds: (ids: string[]) => {
                  if (ids.length) core.useScene.getState().deleteNodes(ids as never);
                },
                levelId,
                onProgress: (kind, installed, _total) => {
                  setSceneReadyTick((t) => t + 1);
                  if (installed > 0) {
                    push({ type: 'import-progress', event: { type: 'import-stage-progress', phase: kind, committed: installed, total: installed, label: `Installed ${installed} ${kind}` } } as never);
                  }
                },
              },
              liveResult,
              {
                guideDataUrl,
                buildingFrame,
                runId: `ai-v2-${Date.now().toString(36)}`,
                fileName: DIAG.uploadedFileName ?? 'AI Guide',
                frameId: `frame_ai_${Date.now().toString(36)}`,
              },
            );
            DIAG.installedAiFurniture = aiRes.furniture;
            DIAG.installedAiWindows = aiRes.windows;
            DIAG.installedAiDoors = aiRes.doors;
            if (aiRes.furniture + aiRes.windows + aiRes.doors > 0) {
              push({ type: 'message', role: 'assistant', id: `ai_${Date.now()}`, text: `AI extraction placed ${aiRes.furniture} furniture, ${aiRes.windows} window(s), ${aiRes.doors} door(s) into the scene.` } as never);
            }
          }
        } catch (ae) {
          DIAG.aiExtractInstallError = ae instanceof Error ? ae.message : String(ae);
          (globalThis as unknown as { __aiInstallDebug?: unknown }).__aiInstallDebug = {
            ...(globalThis as unknown as { __aiInstallDebug?: Record<string, unknown> }).__aiInstallDebug as object,
            phase: 'threw',
            error: DIAG.aiExtractInstallError,
          };
          if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn('[AiExtractInstaller] failed:', DIAG.aiExtractInstallError);
          }
        }

        setImporting(false);
        evaluateFramingReadiness();
        return;
      }
      if (++ticks > 300) { // 60s wall-clock cap (setInterval @200ms; rAF pauses when tab is hidden)
        clearInterval(iv);
        // S8: bounded TIMEOUT terminal outcome — distinct from CHUNK_LOAD_FAILED.
        // If node counts are correct but the renderer never drained dirty/registry,
        // classify as RENDERER_FAILED (viewer mounted but did not settle); otherwise
        // TIMEOUT. Either way the run STOPS and windows/doors are prevented.
        const nodeCountsOk = walls.length === DIAG.expectedWalls && wallIds.size === DIAG.expectedWalls;
        const outcome = nodeCountsOk ? 'RENDERER_FAILED' : 'TIMEOUT';
        DIAG.readinessOutcome = outcome as typeof DIAG.readinessOutcome;
        DIAG.importState = 'stalled';
        setImporting(false);
        console.error(`[M2] import readiness ${outcome} — wall map / validation did not complete:`, {
          walls: walls.length, wallIds: wallIds.size, wallReg, dirty, issues: v.issues.length,
          expectedWalls: DIAG.expectedWalls, wallMapPass: DIAG.wallMapPass,
        });
        push({ type: 'error', message: `Import ${outcome === 'RENDERER_FAILED' ? 'renderer did not settle' : 'timed out'} after wall commit (walls=${walls.length}/${DIAG.expectedWalls}, registry=${wallReg}, dirty=${dirty}, validationIssues=${v.issues.length}, wallMapPass=${DIAG.wallMapPass}).` });
        return;
      }
    };
    iv = setInterval(tick, 200);
    tick();
  }, [evaluateFramingReadiness, setImporting, push]);



  const onStage = useCallback((e: StageEvent, emit: (ev: ChatEvent) => void) => {
    switch (e.type) {
      case 'stage-started': emit({ type: 'import-progress', event: { type: 'import-stage-started', phase: e.phase, committed: 0, total: 0 } }); break;
      case 'stage-commit-progress':
        // Force the frameloop="never" Canvas to invalidate() and run its
        // useFrame systems (which drain dirtyNodes + populate sceneRegistry).
        setSceneReadyTick((t) => t + 1);
        emit({ type: 'import-progress', event: { type: 'import-stage-progress', phase: e.phase, committed: e.committed, total: e.total, lastWallPhysicalId: e.physicalWallId } });
        break;
      case 'stage-completed': emit({ type: 'import-progress', event: { type: 'import-stage-completed', phase: e.phase, committed: e.committed } }); break;
      case 'import-completed': emit({ type: 'import-progress', event: { type: 'import-completed', walls: e.walls, dirty: e.dirty, validationOk: e.validationOk } }); break;
      default: break;
    }
  }, []);

  // Install ONLY the initial shell (site/building/level/guide). No slab, no walls.
  const installInitialShell = useCallback(async () => {
    DIAG.importState = 'initializing';
    const core = getPascalStores();
    // Load the builtin plugin EXACTLY ONCE via the shell's memoized loader.
    // The PascalViewerShell calls the SAME ensureBuiltinPluginLoaded() when it
    // mounts, so a second loadPlugin() here would throw "duplicate node kind"
    // and crash the Viewer (the production reload / wallReg:0 root cause).
    await ensureBuiltinPluginLoaded();

    const drafts = prepareCode06Drafts();
    const { initialShell } = drafts;
    core.useScene.getState().setScene(initialShell.nodes as never, initialShell.rootNodeIds as never, { installedPlugins: [builtinPlugin.id] });
    core.useScene.getState().setInstalledPlugins([builtinPlugin.id]);
    core.useScene.getState().loadScene();

    if (process.env.NODE_ENV !== 'production') {
      const buildStatus = (): Code06Status => {
        const nodes = core.useScene.getState().nodes as unknown as NodeMap;
        const v = validateSceneTree(nodes, { rootNodeIds: [initialShell.ids.site] });
        const all = Object.values(nodes);
        const walls = all.filter((n) => (n as { type?: string }).type === 'wall');
        const ids = walls.map((w) => (w as { id: string }).id);
        const dupIds = ids.length - new Set(ids).size;
        const reg = (core as unknown as { sceneRegistry?: { byType?: { wall?: Set<string> }; nodes?: Map<string, unknown> } }).sceneRegistry;
        const wallReg = reg?.byType?.wall?.size ?? (reg?.nodes ? [...reg.nodes.values()].filter((o) => (o as { type?: string }).type === 'wall').length : 0);
        const liveWallNodes = walls.length;
        return {
          importState: DIAG.importState,
          currentStage: DIAG.currentStage,
          committedWalls: DIAG.importState === 'completed' ? liveWallNodes : DIAG.committedWalls,
          expectedWalls: DIAG.expectedWalls,
          sceneNodeCount: all.length,
          wallNodeCount: walls.length,
          wallRegistryCount: wallReg,
          dirtyNodeCount: core.useScene.getState().dirtyNodes.size,
          sceneTreeIssues: v.issues.length,
          duplicateWallIds: dupIds,
          unreachableNodeIds: [...v.reachable].length === all.length ? [] : all.filter((n) => !(n as { id: string }).id || !v.reachable.has((n as { id: string }).id)).map((n) => (n as { id: string }).id),
          progressiveEventLog: DIAG.eventLog,
          lastFraming: DIAG.lastFraming,
        };
      };
      window.__code06 = {
        ...(window.__code06 ?? {}),
        core, drafts,
        initialIds: initialShell.ids,
        getLiveNodes: () => core.useScene.getState().nodes as unknown as NodeMap,
        validate: () => validateSceneTree(core.useScene.getState().nodes as unknown as NodeMap, { rootNodeIds: [initialShell.ids.site] }),
        getStatus: buildStatus,
        failNextBatch: () => { DIAG.failNextBatch.current = true; },
        resetFrozenImport: () => {
          DIAG.importState = 'idle'; DIAG.currentStage = 'none'; DIAG.committedWalls = 0; DIAG.eventLog = []; DIAG.failNextBatch.current = false;
          core.useScene.getState().clearScene?.();
          startedRef.current = false;
        },
      };
    }
    setInitialInstalled(true);
    DIAG.importState = 'idle';
    return drafts;
  }, []);

  useEffect(() => {
    ensureBuiltinPluginLoaded()
      .then(() => {
        const core = getPascalStores();
        const s = core.useScene.getState();
        const hasNodes = Object.keys(s.nodes ?? {}).length > 0;
        if (!hasNodes) {
          const siteId = 'site_main';
          const buildingId = 'building_main';
          const levelId = 'level_main';
          const site = SiteNode.parse({ id: siteId, name: 'Site', parentId: null });
          const building = BuildingNode.parse({ id: buildingId, name: 'Building', parentId: siteId });
          const level = LevelNode.parse({ id: levelId, name: 'Level 1', parentId: buildingId });
          const nodes: Record<string, AnyNode> = {
            [siteId]: { ...site, children: [buildingId] } as AnyNode,
            [buildingId]: { ...building, children: [levelId] } as AnyNode,
            [levelId]: { ...level, children: [] } as AnyNode,
          };
          s.setScene(nodes as never, [siteId] as never, { installedPlugins: [builtinPlugin.id] });
          core.useScene.getState().setInstalledPlugins([builtinPlugin.id]);
          core.useScene.getState().loadScene();
        }
        setInitialInstalled(true);
      })
      .catch((e) => {
        console.warn('[Home] scene mount initialization error:', e);
      });
  }, []);

  const startFrozenImport = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    activeGuideAttachmentRef.current = {
      id: 'code06_guide_sample',
      kind: 'image',
      name: 'Floor Plan Drawing (CODE_06.pdf)',
      byteSize: 622080,
      mime: 'image/png',
      url: '/guide-code06.png',
    };
    setImporting(true);
    setDocked(true);
    setViewerVisible(true);
    DIAG.importState = 'importing';
    DIAG.committedWalls = 0;
    DIAG.eventLog = [];
    // New run: reset the run-scoped framing controller (fresh runId, all flags
    // false, framingState idle). Framing fires once when all conditions hold.
    resetFraming(DIAG.runCounter = (DIAG.runCounter ?? 0) + 1);

    const core = getPascalStores();
    const drafts = window.__code06?.drafts ?? await installInitialShell();

    const commitNodes = (nodes: object[], parentId: string) => {
      const ops = (nodes as object[]).map((node) => ({ node, parentId }));
      core.useScene.getState().createNodes(ops as never);
    };
    const getDirty = () => core.useScene.getState().dirtyNodes.size;
    const getLiveNodes = () => core.useScene.getState().nodes as never;

    const windowDrafts: { node: AnyNode; parentId: string }[] = [];
    const doorDrafts: { node: AnyNode; parentId: string }[] = [];

    const winSpecsToInstall = (windowSpecsRef.current && windowSpecsRef.current.length > 0)
      ? (windowSpecsRef.current as any)
      : [];

    const doorSpecsToInstall = (doorSpecsRef.current && doorSpecsRef.current.length > 0)
      ? (doorSpecsRef.current as any)
      : [];

    try {
      const mockNodes: Record<string, unknown> = {};
      for (const w of drafts.wallDrafts) {
        mockNodes[w.id] = w.node;
      }
      const { installLiveWindows } = await import('@/features/window-pilot/install-pilot-windows');
      const { installLiveDoors } = await import('@/features/door-pilot/install-live-doors');

      if (winSpecsToInstall.length > 0) {
        const winRes = installLiveWindows({
          nodes: mockNodes,
          createNodes: (ops) => { windowDrafts.push(...(ops as any)); },
        }, winSpecsToInstall);
        DIAG.windowInstallResults = winRes as any;
      }

      if (doorSpecsToInstall.length > 0) {
        const doorRes = installLiveDoors({
          nodes: mockNodes,
          createNodes: (ops) => { doorDrafts.push(...(ops as any)); },
        }, doorSpecsToInstall);
        DIAG.doorInstallResults = doorRes as any;
      }
    } catch (e) {
      console.warn('[startFrozenImport] opening pre-draft error:', e);
    }

    const handle = runStagedCode06Import({
      drafts,
      commitNodes: commitNodes as never,
      getLiveNodes,
      getDirty,
      levelId: drafts.initialShell.ids.level,
      bootstrapGen: 1,
      registryKinds: 0,
      failNextBatch: DIAG.failNextBatch,
      onCommittedChange: (committed, phase) => {
        DIAG.committedWalls = committed;
        DIAG.currentStage = phase;
        setSceneReadyTick((t) => t + 1);
      },
      windowDrafts,
      onWindowsCommitted: (count) => {
        DIAG.windowsInstalledNodes = count;
        DIAG.currentStage = 'windows';
        setSceneReadyTick((t) => t + 1);
      },
      doorDrafts,
      onDoorsCommitted: (count) => {
        DIAG.installedDoors = count;
        DIAG.currentStage = 'doors';
        setSceneReadyTick((t) => t + 1);
      },
    });

    handle.onEvent(async (e) => {
      DIAG.eventLog.push(e);
      if (e.type === 'import-completed') {
        const ctl = framingCtl.current;
        ctl.importCompleted = true;

        if (windowDrafts.length > 0) {
          DIAG.windowsInstalledNodes = windowDrafts.length;
        }
        if (doorDrafts.length > 0) {
          DIAG.installedDoors = doorDrafts.length;
        }

        setSceneReadyTick((t) => t + 1);
        pollImportCompletion();
      }
      if (e.type === 'stage-failed') DIAG.importState = 'failed';
      onStage(e, push);
    });
  }, [installInitialShell, onStage, push, pollImportCompletion]);

  /**
   * Change Set 2: run the staged Pascal import from a LIVE neutral ExtractionResult
   * (produced by the clean design-build-extraction-mupdf provider). Reuses the
   * SAME runStagedCode06Import runner + completion/framing handshake — only the
   * draft source differs. Default provider is frozen-code06 until live parity is
   * fully green (see GEOMETRIC_EXTRACTION_PROVIDER).
   */
  const startLiveImport = useCallback(async (
    result: import('design-build-extraction-contracts').ExtractionResult,
    bytes?: Uint8Array,
    windowSpecs?: WindowInstallSpec[],
    windowAudit?: any,
    columnContracts?: ColumnContract[],
    completionWalls?: any[],
    guideDataUrlFromServer?: string,
    doorManifest?: any,
    doorSpecs?: any[],
    curvedWalls?: any[],
  ) => {
    if (DIAG.importState === 'importing' || DIAG.importState === 'initializing') return;
    DIAG.importState = 'importing';
    DIAG.committedWalls = 0;
    DIAG.currentStage = 'none';
    DIAG.eventLog = [];
    // M4: start the actual-runtime elapsed timer.
    runStartRef.current = Date.now();
    setElapsedMs(0);
    // §Isolation: store the Geometric result in the MODE-NEUTRAL holder, never in
    // aiResultRef (the AI-specific holder). aiResultRef gates AI-only completion
    // logic; populating it from a Geometric run was the historical leak that made
    // the AI branch (and the malformed PDF-as-PNG Guide URL) fire mid-Geometric.
    liveResultRef.current = result;
    activeRunModeRef.current = 'geometric';
    // §5: dock ChatBox, reveal Viewer + ProgressRail while the build runs.
    setImporting(true);
    setDocked(true);
    setViewerVisible(true);
    resetFraming(DIAG.runCounter = (DIAG.runCounter ?? 0) + 1);

    if (windowSpecs) {
      windowSpecsRef.current = windowSpecs;
    }
    if (windowAudit) {
      windowAuditRef.current = windowAudit;
    }
    if (doorManifest) {
      doorManifestRef.current = doorManifest;
    }
    if (doorSpecs && doorSpecs.length > 0) {
      doorSpecsRef.current = doorSpecs;
    }

    const core = getPascalStores();
    await ensureBuiltinPluginLoaded();

    const guideDataUrl: string = guideDataUrlFromServer || liveGuideRef.current.url || BLANK_GUIDE_PNG;
    const drafts = prepareLiveDrafts(result, { guideDataUrl });
    liveGuideRef.current.nodeId = drafts.initialShell.ids.guide;

    // --- WALL-COMPLETION INSTALL (MASTER CHECKPOINT §16): wire the detected
    // missing-wall / partition centreline candidates into the staged Pascal build
    // as native WallNodes. These complete only source-proven room boundaries
    // (paired parallel faces, connected to the trusted 70-wall network, not
    // furniture, not protected openings). Mirrors how the 70 trusted walls are
    // staged in prepareLiveDrafts(). Flagged so it can be disabled if the visual
    // audit rejects any candidate.
    const WALL_COMPLETION_INSTALL_ENABLED = true; // M1.5: 70 originals + 18 completion = 88-wall shell
    if (WALL_COMPLETION_INSTALL_ENABLED && completionWalls && completionWalls.length > 0) {
      const levelId = drafts.initialShell.ids.level;
      for (const c of completionWalls) {
        const id = `wall_${(c.completionWallId as string) || Math.random().toString(36).slice(2, 10)}`;
        const a = c.centrelineStartPascal ?? c.centrelineStartProjectM ?? c.centrelineStartM;
        const b = c.centrelineEndPascal ?? c.centrelineEndProjectM ?? c.centrelineEndM;
        if (!a || !b) continue;
        const node = WallNode.parse({
          id,
          name: `Wall ${drafts.wallDrafts.length + 1} (completion)`,
          parentId: levelId,
          start: [a.x, a.y] as [number, number],
          end: [b.x, b.y] as [number, number],
          height: 3.0,
          thickness: c.thicknessM ?? 0.2,
          metadata: {
            physicalWallId: c.completionWallId,
            completionWallId: c.completionWallId,
            wallClassification: c.classification,
            sourceHash: c.sourceHash ?? '',
            sourceSegmentIds: c.sourceSegmentIds ?? [],
            sourceOperationIds: c.sourceOperationIds ?? [],
            automaticExtraction: true,
            extractionSource: 'WALL_COMPLETION',
            confidence: c.confidence ?? 0.8,
          },
        }) as AnyNode;
        drafts.wallDrafts.push({ id, physicalWallId: c.completionWallId, node });
        drafts.initialShell.nodes[id] = node;
      }
      const levelNode = drafts.initialShell.nodes[levelId] as any;
      if (levelNode) {
        const existing = Array.isArray(levelNode.children) ? levelNode.children : [];
        const completionIds = completionWalls
          .map((c) => `wall_${(c.completionWallId as string) || ''}`)
          .filter(Boolean);
        levelNode.children = [...existing, ...completionIds];
        drafts.initialShell.nodes[levelId] = levelNode;
      }
      DIAG.expectedWalls = drafts.wallDrafts.length;
    }

    // --- CURVED WALLS: curved walls, glass partitions and pods read from the
    // drawing's arcs, as native curved WallNodes (curveOffset = the arc's sagitta).
    // Curved walls host no openings: a pod's door is the gap the drawing leaves in its ring.
    DIAG.curvedWallCount = 0;
    if (curvedWalls && curvedWalls.length > 0) {
      const levelId = drafts.initialShell.ids.level;
      const curvedIds: string[] = [];
      for (const c of curvedWalls) {
        if (!c?.id || !c.start || !c.end || !Number.isFinite(c.curveOffset)) continue;
        const id = `wall_${c.id}`;
        if (drafts.initialShell.nodes[id]) continue;
        const glass = c.kind === 'glass';
        const doorWall = c.role === 'pod-door';
        const label = doorWall ? 'Door wall' : glass ? 'Glass partition' : 'Curved wall';
        const node = WallNode.parse({
          id,
          name: `${label} ${curvedIds.length + 1}${c.podId ? ` (${String(c.podId).replace('_', ' ')})` : ''}`,
          parentId: levelId,
          start: [c.start.x, c.start.y] as [number, number],
          end: [c.end.x, c.end.y] as [number, number],
          curveOffset: c.curveOffset,
          height: 3.0,
          thickness: c.thicknessM ?? 0.2,
          // plain painted finish like the other extracted walls (a textured default
          // smears on curved faces); glass partitions get the glass finish
          ...(glass ? { material: { preset: 'glass' as const } } : { materialPreset: 'white' }),
          metadata: {
            physicalWallId: c.id,
            curvedWallId: c.segmentId,
            podId: c.podId ?? null,
            wallClassification: doorWall ? 'POD_DOOR_WALL' : glass ? 'GLASS_PARTITION' : 'CURVED_WALL',
            sourceHash: c.sourceHash ?? '',
            sourceOperationIds: c.sourceOperationIds ?? [],
            automaticExtraction: true,
            extractionSource: 'CURVED_WALLS',
            confidence: 0.85,
          },
        }) as AnyNode;
        drafts.wallDrafts.push({ id, physicalWallId: c.id, node });
        drafts.initialShell.nodes[id] = node;
        curvedIds.push(id);
      }
      const levelNode = drafts.initialShell.nodes[levelId] as any;
      if (levelNode && curvedIds.length > 0) {
        const existing = Array.isArray(levelNode.children) ? levelNode.children : [];
        levelNode.children = [...existing, ...curvedIds];
        drafts.initialShell.nodes[levelId] = levelNode;
      }
      DIAG.curvedWallCount = curvedIds.length;
      DIAG.expectedWalls = drafts.wallDrafts.length;
    }

    // ── M2 FINALIZED WALL MAP (read-only bookkeeping; does NOT touch M1 frame) ──
    // Build ONE authoritative map over the combined drafts (70 originals first,
    // then accepted completion walls) and verify topology (dup/missing/nonWall=0).
    // NON-FATAL: a wall-map error must NEVER abort the import — it only downgrades
    // the topology verification flag.
    try {
      const originalCount = Array.isArray(result.walls) ? result.walls.length : drafts.wallDrafts.length;
      const wm = buildFinalizedWallMap(drafts.wallDrafts as never, originalCount);
      DIAG.originalWallCount = wm.originalWalls;
      DIAG.completionWallCount = wm.completionWalls;
      DIAG.finalizedWallCount = wm.finalizedWalls;
      DIAG.wallMapPass = wm.pass;
      DIAG.wallMap = wm.entries as unknown[];
    } catch (wme) {
      DIAG.wallMapPass = false;
      DIAG.wallMap = [];
      console.error('[M2] finalized wall-map build failed (non-fatal):', wme);
    }

    const { initialShell } = drafts;
    core.useScene.getState().setScene(initialShell.nodes as never, initialShell.rootNodeIds as never, { installedPlugins: [builtinPlugin.id] });
    core.useScene.getState().setInstalledPlugins([builtinPlugin.id]);
    core.useScene.getState().loadScene();
    DIAG.expectedWalls = drafts.wallDrafts.length;

    const { useViewer } = await import('@pascal-app/viewer');

    const commitNodes = (nodes: object[], parentId: string) => {
      const ops = (nodes as object[]).map((node) => ({ node, parentId }));
      core.useScene.getState().createNodes(ops as never);
      useViewer?.getState()?.bumpGeometryRevision?.();
      viewerHandleRef.current?.invalidate();
      requestAnimationFrame(() => {
        useViewer?.getState()?.bumpGeometryRevision?.();
        viewerHandleRef.current?.invalidate();
      });
    };
    const getDirty = () => core.useScene.getState().dirtyNodes.size;
    const getLiveNodes = () => core.useScene.getState().nodes as never;

    // --- COLUMN STAGE (MASTER CHECKPOINT §1: DISABLED).
    // The live visual audit showed the automatically installed columns were
    // furniture-derived false positives (bedside units, bed dividers, cabinets).
    // They are reclassified to REVIEW_REQUIRES_STRUCTURAL_CONFIRMATION and must
    // NOT be installed as Pascal ColumnNodes. Kept behind a flag (off by
    // default) so the wiring can be re-enabled only after a future independent
    // structural-column audit passes. Rooms are to be closed via MISSING WALL
    // completion (wall-completion processor), not ColumnNodes.
    const COLUMN_INSTALL_ENABLED = false;
    const columnNodes: unknown[] = [];
    const cols = columnContracts ?? (result.columns as unknown as ColumnContract[] | undefined) ?? [];
    if (COLUMN_INSTALL_ENABLED && cols.length > 0) {
      const colCtx: LiveColumnInstallerContext = {
        nodes: {},
        parentId: drafts.initialShell.ids.level,
        createNodes: (ops) => { for (const op of ops) columnNodes.push(op.node); },
      };
      installLiveColumns(colCtx, cols as ColumnContract[], 3);
    }

    const windowDrafts: { node: AnyNode; parentId: string }[] = [];
    const doorDrafts: { node: AnyNode; parentId: string }[] = [];

    const winSpecsToInstall = (windowSpecsRef.current && windowSpecsRef.current.length > 0)
      ? (windowSpecsRef.current as any)
      : (windowSpecs ?? []);

    const doorSpecsToInstall = (doorSpecsRef.current && doorSpecsRef.current.length > 0)
      ? (doorSpecsRef.current as any)
      : (doorSpecs ?? []);

    const mockNodes: Record<string, unknown> = {};
    for (const w of drafts.wallDrafts) {
      mockNodes[w.id] = w.node;
    }
    allWallDraftsRef.current = mockNodes;

    try {
      const { installLiveWindows } = await import('@/features/window-pilot/install-pilot-windows');
      const { installLiveDoors } = await import('@/features/door-pilot/install-live-doors');

      if (winSpecsToInstall.length > 0) {
        const winRes = installLiveWindows({
          nodes: mockNodes,
          createNodes: (ops) => { windowDrafts.push(...(ops as any)); },
        }, winSpecsToInstall);
        DIAG.windowInstallResults = winRes as any;
      }

      if (doorSpecsToInstall.length > 0) {
        const doorRes = installLiveDoors({
          nodes: mockNodes,
          createNodes: (ops) => { doorDrafts.push(...(ops as any)); },
        }, doorSpecsToInstall);
        DIAG.doorInstallResults = doorRes as any;
      }
    } catch (e) {
      console.warn('[startLiveImport] opening pre-draft error:', e);
    }

    const totalWalls = drafts.wallDrafts.length || 88;

    const handle = runStagedCode06Import({
      drafts,
      commitNodes: commitNodes as never,
      getLiveNodes,
      getDirty,
      levelId: drafts.initialShell.ids.level,
      bootstrapGen: 1,
      registryKinds: 0,
      failNextBatch: DIAG.failNextBatch,
      onCommittedChange: (committed, phase) => {
        DIAG.committedWalls = committed;
        DIAG.currentStage = phase;
        const pct = Math.min(65, Math.round(35 + (committed / totalWalls) * 30));
        setExtractionProgress((prev) => ({
          ...prev,
          progressPercent: pct,
          stageText: `Placing walls (${committed} of ${totalWalls})…`,
        }));
        useViewer?.getState()?.bumpGeometryRevision?.();
        viewerHandleRef.current?.invalidate();
        requestAnimationFrame(() => {
          useViewer?.getState()?.bumpGeometryRevision?.();
          viewerHandleRef.current?.invalidate();
        });
        setSceneReadyTick((t) => t + 1);
      },
      windowDrafts,
      onWindowsCommitted: (count, total) => {
        DIAG.windowsInstalledNodes = count;
        DIAG.currentStage = 'windows';
        const tot = total || 24;
        const pct = Math.min(80, Math.round(65 + (count / tot) * 15));
        setExtractionProgress((prev) => ({
          ...prev,
          progressPercent: pct,
          stageText: `Placing windows (${count} of ${tot})…`,
        }));
        useViewer?.getState()?.bumpGeometryRevision?.();
        viewerHandleRef.current?.invalidate();
        requestAnimationFrame(() => {
          useViewer?.getState()?.bumpGeometryRevision?.();
          viewerHandleRef.current?.invalidate();
        });
        setSceneReadyTick((t) => t + 1);
      },
      doorDrafts,
      onDoorsCommitted: (count, total) => {
        DIAG.installedDoors = count;
        DIAG.currentStage = 'doors';
        const tot = total || 25;
        const pct = Math.min(95, Math.round(80 + (count / tot) * 15));
        setExtractionProgress((prev) => ({
          ...prev,
          progressPercent: pct,
          stageText: `Placing doors (${count} of ${tot})…`,
        }));
        useViewer?.getState()?.bumpGeometryRevision?.();
        viewerHandleRef.current?.invalidate();
        requestAnimationFrame(() => {
          useViewer?.getState()?.bumpGeometryRevision?.();
          viewerHandleRef.current?.invalidate();
        });
        setSceneReadyTick((t) => t + 1);
      },
      isStreaming: isStreamingExtractionRef,
    });
    activeStagedHandleRef.current = handle;
    if (bufferedWindowDraftsRef.current.length > 0) {
      handle.setWindowDrafts(bufferedWindowDraftsRef.current);
    }
    if (bufferedDoorDraftsRef.current.length > 0) {
      handle.setDoorDrafts(bufferedDoorDraftsRef.current);
    }

    handle.onEvent(async (e) => {
      DIAG.eventLog.push(e);
      if (e.type === 'import-completed') {
        const ctl = framingCtl.current;
        ctl.importCompleted = true;

        if (windowDrafts.length > 0 || bufferedWindowDraftsRef.current.length > 0) {
          DIAG.windowsInstalledNodes = windowDrafts.length || bufferedWindowDraftsRef.current.length;
        }
        if (doorDrafts.length > 0 || bufferedDoorDraftsRef.current.length > 0) {
          DIAG.installedDoors = doorDrafts.length || bufferedDoorDraftsRef.current.length;
        }

        viewerHandleRef.current?.invalidate();
        requestAnimationFrame(() => {
          viewerHandleRef.current?.invalidate();
        });
        setSceneReadyTick((t) => t + 1);
        pollImportCompletion();

        setTimeout(() => {
          setExtractionProgress((prev) => ({
            ...prev,
            isExtracting: false,
            progressPercent: 100,
            stageText: `Model ready: ${totalWalls} walls, ${DIAG.windowsInstalledNodes} windows, ${DIAG.installedDoors} doors`,
          }));
        }, 800);
      }
      if (e.type === 'stage-failed') {
        DIAG.importState = 'failed';
        setImporting(false);
        core.useScene.getState().clearScene?.();
        push({ type: 'error', message: 'Pascal commit failed. The partial build was rolled back — you can retry the extraction.' });
      }
      onStage(e, push);
    });
  }, [installInitialShell, onStage, push, pollImportCompletion, ensureBuiltinPluginLoaded]);

  /**
   * Change Set 2: production Geometric flow.
   * attachment (PDF) → POST /api/extraction/mupdf → neutral ExtractionResult
   * → startLiveImport (reuses the accepted staged Pascal adapter).
   * PNG/JPEG is rejected with a clear message (AI extraction required).
   * Supports cancellation via an AbortController stored in a ref.
   */
  const extractionAbortRef = useRef<AbortController | null>(null);
  /** Holds the current run's PDF bytes so the (separate-scope) import-completed
   *  handler can fetch live window specs without re-reading the attachment. */
  const extractionBytesRef = useRef<Uint8Array | null>(null);

  const runLiveGeometricExtraction = useCallback(async (source: import('design-build-conversation-core').AttachmentRef) => {
    if (extractionBusy) {
      console.warn('[Extract] ignored — a run is already in flight (extractionBusy=true). Cancel it or wait for completion.');
      return;
    }
    const file = attachmentRepository.get(source.id);
    if (!file) {
      push({ type: 'error', message: `Attachment file for ${source.name} not found in memory.` });
      return;
    }
    if (file.type && !file.type.includes('pdf') && !source.name.toLowerCase().endsWith('.pdf')) {
      push({
        type: 'message',
        role: 'assistant',
        id: nid(),
        text: 'Pure MuPDF accepts vector PDF only. For raster images (PNG/JPEG) or scanned drawings, use the AI (Gemini) extraction method.',
      });
      return;
    }

    const ac = new AbortController();
    extractionAbortRef.current = ac;
    setDocked(true);
    setViewerVisible(true);
    setExtractionBusy(true);
    setExtractionProgress({
      isExtracting: true,
      pipeline: 'geometric',
      stageText: 'Opening the drawing…',
      progressPercent: 15,
      fileName: source.name,
    });
    push({ type: 'extraction-progress', event: { phase: 'document', progress: 0.05, message: 'Opening vector PDF drawing' } });

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      extractionBytesRef.current = bytes;
      DIAG.extractionState = 'extracting';
      push({ type: 'extraction-progress', event: { phase: 'document', progress: 0.1, message: 'Locating the building' } });
      push({ type: 'extraction-progress', event: { phase: 'slab', progress: 0.25, message: 'Measuring wall thicknesses' } });
      isStreamingExtractionRef.current = true;
      liveGuideRef.current = { nodeId: null, url: null };
      bufferedWindowDraftsRef.current = [];
      bufferedDoorDraftsRef.current = [];
      const res = await fetch('/api/extraction/mupdf?stream=true', {
        method: 'POST',
        headers: { 'content-type': 'application/pdf', 'accept': 'application/x-ndjson' },
        body: bytes as unknown as BodyInit,
        signal: ac.signal,
      });
      DIAG.apiStatus = res.status;
      if (!res.ok) {
        isStreamingExtractionRef.current = false;
        DIAG.extractionState = 'failed';
        const err = await res.json().catch(() => ({}));
        push({ type: 'error', message: err.error || `Extraction failed (${res.status}).` });
        return;
      }

      if (res.headers.get('content-type')?.includes('application/x-ndjson') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let extractedResult: import('design-build-extraction-contracts').ExtractionResult | null = null;
        let extractedCompletionWalls: any[] = [];
        let windowCount = 24;
        let doorCount = 25;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const chunk = JSON.parse(line);
              if (chunk.type === 'stage-walls') {
                extractedResult = chunk.result;
                extractedCompletionWalls = chunk.completionWalls || [];
                const extractedCurvedWalls: any[] = chunk.curvedWalls || [];
                DIAG.originalWallCount = chunk.originalWallCount;
                DIAG.completionWallCount = chunk.completionWallCount;
                DIAG.finalizedWallCount = chunk.finalizedWallCount;
                setExtractionProgress({
                  isExtracting: true,
                  pipeline: 'geometric',
                  stageText: `Building ${DIAG.finalizedWallCount + extractedCurvedWalls.length} walls…`,
                  progressPercent: 35,
                  fileName: source.name,
                });
                push({ type: 'extraction-progress', event: { phase: 'walls', progress: 0.35, message: `Erecting ${DIAG.finalizedWallCount} physical walls` } });

                // Launch 3D build immediately on first chunk (under 250ms)!
                void startLiveImport(
                  extractedResult!,
                  bytes,
                  [],
                  null,
                  [],
                  extractedCompletionWalls,
                  chunk.guideDataUrl,
                  null,
                  [],
                  extractedCurvedWalls,
                );
              } else if (chunk.type === 'stage-windows') {
                const wspecs = chunk.windowSpecs || [];
                windowCount = wspecs.length;
                windowSpecsRef.current = wspecs;
                windowAuditRef.current = chunk.windowAudit || null;
                DIAG.windowsExtracted = wspecs.length;
                DIAG.windowsEligible = wspecs.length;
                setExtractionProgress((prev) => ({
                  ...prev,
                  stageText: `Adding ${wspecs.length} windows…`,
                  progressPercent: 65,
                }));
                push({ type: 'extraction-progress', event: { phase: 'windows', progress: 0.65, message: `Glazing ${wspecs.length} window units` } });

                try {
                  const { installLiveWindows } = await import('@/features/window-pilot/install-pilot-windows');
                  const winDrafts: { node: AnyNode; parentId: string }[] = [];
                  const winRes = installLiveWindows({
                    nodes: allWallDraftsRef.current,
                    createNodes: (ops) => { winDrafts.push(...(ops as any)); },
                  }, wspecs);
                  DIAG.windowInstallResults = winRes as any;
                  bufferedWindowDraftsRef.current = winDrafts;
                  if (activeStagedHandleRef.current) {
                    activeStagedHandleRef.current.setWindowDrafts(winDrafts);
                  }
                } catch (we) {
                  console.warn('[stream consumer] window draft prep error:', we);
                }
              } else if (chunk.type === 'stage-doors') {
                const dm = chunk.doorManifest;
                doorManifestRef.current = dm || null;
                const dspecs = chunk.acceptedDoors || [];
                doorCount = dspecs.length;
                doorSpecsRef.current = dspecs;
                DIAG.doorsAutoInstallable = dspecs.length;
                setExtractionProgress((prev) => ({
                  ...prev,
                  stageText: `Adding ${dspecs.length} doors…`,
                  progressPercent: 80,
                }));
                push({ type: 'extraction-progress', event: { phase: 'doors', progress: 0.80, message: `Mounting ${dspecs.length} door assemblies` } });

                try {
                  const { installLiveDoors } = await import('@/features/door-pilot/install-live-doors');
                  const dDrafts: { node: AnyNode; parentId: string }[] = [];
                  const doorRes = installLiveDoors({
                    nodes: allWallDraftsRef.current,
                    createNodes: (ops) => { dDrafts.push(...(ops as any)); },
                  }, dspecs);
                  DIAG.doorInstallResults = doorRes as any;
                  bufferedDoorDraftsRef.current = dDrafts;
                  if (activeStagedHandleRef.current) {
                    activeStagedHandleRef.current.setDoorDrafts(dDrafts);
                  }
                } catch (de) {
                  console.warn('[stream consumer] door draft prep error:', de);
                }
              } else if (chunk.type === 'stage-guide') {
                if (chunk.guideDataUrl) {
                  liveGuideRef.current.url = chunk.guideDataUrl;
                  applyLiveGuide();
                  try {
                    const gres = await fetch(chunk.guideDataUrl);
                    const blob = await gres.blob();
                    const file = new File([blob], `${source.name.replace(/\.pdf$/i, '')}-plan-guide.png`, { type: 'image/png' });
                    const id = crypto.randomUUID();
                    attachmentRepository.put(id, file);
                    activeGuideAttachmentRef.current = {
                      id,
                      kind: 'image',
                      name: `Floor Plan Drawing (${source.name})`,
                      byteSize: file.size,
                      mime: 'image/png',
                    };
                  } catch (err) {
                    console.warn('Failed to cache guide attachment:', err);
                  }
                }
              } else if (chunk.type === 'stage-complete') {
                isStreamingExtractionRef.current = false;
                // Keep progress bar open during 3D staged construction; import-completed dismisses it.
              } else if (chunk.type === 'error') {
                isStreamingExtractionRef.current = false;
                push({ type: 'error', message: chunk.error || 'Extraction error.' });
              }
            } catch (err) {
              console.warn('[stream consumer] chunk parse error:', err);
            }
          }
        }
      } else {
        // Fallback for non-streaming response
        const body = await res.json();
        const result = body.result as import('design-build-extraction-contracts').ExtractionResult;
        const windowCount = body.windowSpecs?.length || 24;
        const doorCount = body.doorManifest?.accepted?.length || 25;
        windowSpecsRef.current = body.windowSpecs || [];
        windowAuditRef.current = body.windowAudit || null;
        const dm = body.doorManifest;
        doorManifestRef.current = dm || null;
        if (dm && Array.isArray(dm.accepted)) {
          DIAG.doorManifestAccepted = dm.accepted.length;
          const boundary = selectDoorInstallerInput(dm, {} as RuntimeWallMap);
          doorSpecsRef.current = boundary.installerDoors.map((d: any) => ({
            doorAssemblyId: d.doorAssemblyId,
            wallId: d.selectedPhysicalWallId,
            doorType: d.doorType,
            intervalStartM: d.wallLocalInterval.startM,
            intervalEndM: d.wallLocalInterval.endM,
            widthM: d.widthM,
            hingeSide: d.hingeSide,
            swingDirection: d.swingDirection,
            evidenceMode: d.evidenceMode,
            annotationIds: d.annotationIds || [],
            sourceSegmentIds: d.sourceSegmentIds || [],
            sourceOperationIds: d.sourceOperationIds || [],
          }));
        } else {
          doorSpecsRef.current = [];
        }
        DIAG.extractionState = 'validated';
        setExtractionProgress({
          isExtracting: true,
          pipeline: 'geometric',
          stageText: `Found ${result.walls.length} walls, ${windowCount} windows and ${doorCount} doors. Building the 3D model…`,
          progressPercent: 85,
          fileName: source.name,
        });
        push({ type: 'extraction-progress', event: { phase: 'review', progress: 0.9, message: `Validating extracted geometry — ${result.walls.length} wall elements` } });
        void startLiveImport(
          result,
          bytes,
          body.windowSpecs,
          body.windowAudit,
          (body as any).columnContracts,
          (body as any).completionWalls,
          (body as any).guideDataUrl,
          body.doorManifest,
          doorSpecsRef.current,
          (body as any).curvedWalls,
        );
      }
    } catch (e) {
      setExtractionProgress((prev) => ({ ...prev, isExtracting: false }));
      if ((e as Error).name === 'AbortError') {
        DIAG.extractionState = 'idle';
        push({ type: 'message', role: 'assistant', id: nid(), text: 'Extraction cancelled.' });
        return;
      }
      DIAG.extractionState = 'failed';
      push({ type: 'error', message: `Extraction failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setExtractionBusy(false);
    }
  }, [push, startLiveImport, nid, extractionBusy]);

  /**
   * Change Set 3: AI (Gemini Multipass) extraction — active dynamic provider
   * path. Reuses the SAME neutral ExtractionResult → startLiveImport bridge as
   * Geometric, so the staged Pascal import + framing handshake is identical.
   * The active extraction provider/model is resolved SERVER-SIDE by the clean
   * /api/extraction/ai route (key never reaches the browser). Cancellable via
   * the shared AbortController ref.
   */
  const startAiExtraction = useCallback(async (source: import('design-build-conversation-core').AttachmentRef) => {
    // §5: single-flight — ignore duplicate Extract submissions while running.
    // Log the skip so a stuck busy flag is never a silent no-op.
    if (extractionBusy) {
      console.warn('[Extract] ignored — a run is already in flight (extractionBusy=true). Cancel it or wait for completion.');
      return;
    }
    console.info('[Extract] start AI extraction', { name: source.name, kind: source.kind });
    extractionAbortRef.current?.abort();
    const ac = new AbortController();
    extractionAbortRef.current = ac;
    setExtractionBusy(true);
    setDocked(true);
    DIAG.extractionProvider = 'clean-gemini';
    DIAG.extractionState = 'reading';
    DIAG.uploadedFileName = source.name;
    DIAG.apiStatus = 0;

    push({ type: 'message', role: 'user', id: nid(), text: `Extract ${source.name} (AI · Gemini Multipass).` });
    push({ type: 'extraction-progress', event: { phase: 'document', progress: 0.02, message: 'Reading drawing' } });

    try {
      // §1/§2: bytes come from the clean attachment repository (File/Blob).
      let bytes: Uint8Array | undefined = await attachmentRepository.bytes(source.id);
      if (!bytes) {
        const maybeDataUrl = (source as unknown as { dataUrl?: string }).dataUrl;
        if (maybeDataUrl?.startsWith('data:')) {
          const b64 = maybeDataUrl.slice(maybeDataUrl.indexOf(',') + 1);
          bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
        } else if (source.url) {
          const res = await fetch(source.url, { signal: ac.signal });
          bytes = new Uint8Array(await res.arrayBuffer());
        }
      }
      if (!bytes || bytes.length === 0) {
        DIAG.extractionState = 'failed';
        push({ type: 'error', message: 'Attachment has no readable bytes. Re-attach the file and retry.' });
        return;
      }
      extractionBytesRef.current = bytes;

      DIAG.extractionState = 'extracting';
      push({ type: 'extraction-progress', event: { phase: 'document', progress: 0.1, message: 'Running AI multipass (shell → core → fitout → FF&E)' } });

      const form = new FormData();
      const mime = source.mime || (source.kind === 'pdf' ? 'application/pdf' : 'application/octet-stream');
      form.append('file', new Blob([bytes as BlobPart], { type: mime }), source.name);

      const res = await fetch('/api/extraction/ai', { method: 'POST', body: form, signal: ac.signal, headers: providerRequestHeaders('extraction') });
      DIAG.apiStatus = res.status;
      if (!res.ok) {
        DIAG.extractionState = 'failed';
        const err = await res.json().catch(() => ({})) as { error?: string; code?: string };
        if (err.code === 'AI_MODEL_NOT_CONFIGURED' || err.code === 'AI_MODEL_UNAVAILABLE' || err.code === 'AI_PROVIDER_NOT_CONFIGURED') {
          push({ type: 'error', message: /AI Studio/.test(err.error ?? '') ? String(err.error) : `${err.error} Open AI Studio to choose an extraction model.` });
        } else {
          push({ type: 'error', message: err.error || `AI extraction failed (${res.status}).` });
        }
        return;
      }

      push({ type: 'extraction-progress', event: { phase: 'walls', progress: 0.55, message: 'Building the physical wall network' } });
      const body = await res.json() as { result: import('design-build-extraction-contracts').ExtractionResult };
      const result = body.result;
      windowSpecsRef.current = (body as any).windowSpecs || [];
      windowAuditRef.current = (body as any).windowAudit || null;
      const dm2 = (body as any).doorManifest;
      doorManifestRef.current = dm2 || null;
      if (dm2 && Array.isArray(dm2.accepted)) {
        DIAG.doorManifestAccepted = dm2.accepted.length;
        DIAG.doorReviewRecords = (dm2.review || []).map((r: any) => ({
          doorAssemblyId: r.doorAssemblyId, verdict: r.verdict, reviewReason: r.reviewReason,
          automaticInstallationAllowed: r.automaticInstallationAllowed, relatedAcceptedAssemblyId: r.relatedAcceptedAssemblyId,
        }));
        doorSpecsRef.current = dm2.accepted.map((d: any) => ({
          doorAssemblyId: d.doorAssemblyId, wallId: d.selectedPhysicalWallId, doorType: d.doorType,
          intervalStartM: d.wallLocalInterval.startM, intervalEndM: d.wallLocalInterval.endM, widthM: d.widthM,
          hingeSide: d.hingeSide, swingDirection: d.swingDirection, evidenceMode: d.evidenceMode,
          annotationIds: d.annotationIds || [], sourceSegmentIds: d.sourceSegmentIds || [], sourceOperationIds: d.sourceOperationIds || [],
        }));
      } else {
        doorSpecsRef.current = [];
      }
      DIAG.extractionState = 'validated';
      push({ type: 'extraction-progress', event: { phase: 'review', progress: 0.9, message: `Validating extracted geometry — ${result.walls.length} wall elements` } });
      push({ type: 'extraction-complete', result });
      // REQUIREMENT 4: drive the implemented Pascal snapshot builder from the ONE
      // complete validated ExtractionResult. Fresh AI run uses a NEUTRAL level
      // (no CODE-06 shell, no asset://code06/guide-page). No provider call here.
      void installExtractionResult({
        runId: `ai-${Date.now().toString(36)}`,
        extractionMethod: 'ai',
        source: { bytes, name: source.name },
        result,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        DIAG.extractionState = 'idle';
        push({ type: 'message', role: 'assistant', id: nid(), text: 'AI extraction cancelled.' });
        return;
      }
      DIAG.extractionState = 'failed';
      push({ type: 'error', message: `AI extraction error: ${(e as Error).message}` });
    } finally {
      setExtractionBusy(false);
    }
  }, [push, startLiveImport, nid, extractionBusy]);

  // ── Progressive Pure AI V3 extraction (spec §17). Streams NDJSON from
  // /api/extraction/ai/progressive, applies each event via the shared installer.
  // Reuses the SAME source bytes + V2 structural result; furniture uses the
  // existing catalogue-constrained Prompt Set. V2 route is untouched. ──
  /**
   * MAIN-EDITOR PASCAL SNAPSHOT BUILDER (Requirement 4).
   *
   * Drives the IMPLEMENTED PascalProgressiveBuilder (createProgressiveInstaller /
   * applyProgressiveEvent) from ONE complete, validated AI ExtractionResult. This
   * is the single installation entrypoint for the AI (gemini) route — it replaces
   * the legacy startLiveImport/installAiExtract CODE-06 path.
   *
   * Invariants enforced here:
   *  - fresh AI run uses a NEUTRAL level (title from uploaded file), never CODE-06;
   *  - no prepareCode06Drafts / build-code06-import / asset://code06/guide-page;
   *  - guide completion is gated on 'guide:texture-ready' (not node creation);
   *  - windows/doors gate on wall-map READY (built from actual wall install);
   *  - truthful installed counts from the real installer returns;
   *  - validateStructuralScene runs after settle; no provider call occurs here.
   */
  const runPascalSnapshotBuild = useCallback(async (
    result: import('design-build-extraction-contracts').ExtractionResult,
    bytes: Uint8Array | undefined,
    opts: { runId: string; fileName: string },
  ) => {
    const { runId, fileName } = opts;
    activeRunIdRef.current = runId;
    // §Isolation: this is the AI (gemini) route. Mark mode + populate BOTH the
    // AI-specific holder (gates AI-only completion logic) and the mode-neutral
    // holder (cross-mode consumers: structural validation). A Geometric run must
    // never set aiResultRef (see startLiveImport).
    aiResultRef.current = result;
    liveResultRef.current = result;
    activeRunModeRef.current = 'ai';
    setProgRunId(runId);
    setProgActive(true);
    progBuiltRef.current = true;
    setViewerVisible(true); // mount the real Pascal Viewer (shares the live useScene store)
    setProgReview([]);
    setProgStages({
      guide: { status: 'running', startedAt: Date.now(), installed: 0, total: 0, review: 0 },
      slab: { status: 'pending', installed: 0, total: 0, review: 0 },
      walls: { status: 'pending', installed: 0, total: 0, review: 0 },
      windows: { status: 'pending', installed: 0, total: 0, review: 0 },
      doors: { status: 'pending', installed: 0, total: 0, review: 0 },
      furniture: { status: 'pending', installed: 0, total: 0, review: 0 },
    });

    const setStage = (stage: BuildStage, patch: Partial<StageCardState>) =>
      setProgStages((prev) => {
        const next = { ...prev, [stage]: { ...prev[stage], ...patch } };
        progStagesRef.current = next;
        return next;
      });

    const core = getPascalStores();
    // Phase 8: wrap the complete import in ONE Editor history transaction so a
    // single Undo removes the whole imported model and a single Redo restores it
    // (no thousands of per-node commands flood visible history).
    await runAsSingleSceneHistoryStep(core.useScene, async () => {
    // ── Fresh standalone AI run: CLEAR any stale scene (e.g. CODE-06 frozen import)
    //    so the neutral title + correct wall-map hosting apply. Structural validation
    //    is read-only; this is an explicit fresh-build action. ──
    const priorNodes = core.useScene.getState().nodes as Record<string, Record<string, unknown>>;
    const priorLevelId = Object.values(priorNodes).find((n) => n.type === 'level')?.id as string | undefined;
    const nodeCountBefore = Object.keys(priorNodes).length;
    if (priorLevelId) core.useScene.getState().deleteNodes([priorLevelId] as never);
    const levelId = `lvl_${runId}`;
    core.useScene.getState().createNodes([{ node: { id: levelId, type: 'level', name: fileName.replace(/\.[^.]+$/, '') || 'AI Project', children: [] }, parentId: undefined } as never]);

    const ctx = {
      // Live getter — installers mutate the ACTUAL store the Viewer renders, so
      // addChild()/children population reach the live scene (not a stale snapshot).
      get nodes() { return core.useScene.getState().nodes as Record<string, unknown>; },
      createNodes: (ops: { node: unknown; parentId?: string }[]) => core.useScene.getState().createNodes(ops as never),
      updateNode: (id: string, data: any) => core.useScene.getState().updateNode(id as never, data),
      updateNodes: (updates: { id: string; data: any }[]) => core.useScene.getState().updateNodes(updates as never),
      removeNodeIds: (ids: string[]) => { if (ids.length) core.useScene.getState().deleteNodes(ids as never); },
      levelId,
      onProgress: (kind: 'furniture' | 'slab' | 'walls' | 'windows' | 'doors', installed: number, total: number) => {
        setSceneReadyTick((t) => t + 1);
        setStage(kind === 'walls' ? 'walls' : kind === 'windows' ? 'windows' : kind === 'doors' ? 'doors' : kind === 'slab' ? 'slab' : 'furniture', { installed, total });
      },
    };
    const installer = createProgressiveInstaller(ctx);
    installer.beginRun({ runId });

    let guideNodeId: string | null = null;
    const guideResolvedRef = { current: null as null | 'texture-ready' | 'failed' };
    const runCancelledRef = { current: false };

    const guideEmitter = emitter as unknown as { on: (t: string, h: (p: any) => void) => void; off: (t: string, h: (p: any) => void) => void };
    const onGuideReady = (p: { runId?: string; guideId: string; sourceIdentity: string }) => {
      if (!guideSignalApplicable(p, { activeRunId: activeRunIdRef.current, activeGuideId: guideNodeId, cancelled: runCancelledRef.current, alreadyResolved: guideResolvedRef.current !== null })) return;
      guideResolvedRef.current = 'texture-ready';
      setStage('guide', applyGuideReadiness({ status: 'running', startedAt: Date.now(), total: 1, installed: 0, review: 0 }, 'texture-ready'));
    };
    const onGuideFailed = (p: { runId?: string; guideId: string; sourceIdentity: string; error: string }) => {
      if (!guideSignalApplicable(p, { activeRunId: activeRunIdRef.current, activeGuideId: guideNodeId, cancelled: runCancelledRef.current, alreadyResolved: guideResolvedRef.current !== null })) return;
      guideResolvedRef.current = 'failed';
      setStage('guide', applyGuideReadiness({ status: 'running', startedAt: Date.now(), total: 1, installed: 0, review: 0 }, 'failed'));
      setStage('guide', { message: p.error });
    };
    guideEmitter.on('guide:texture-ready', onGuideReady);
    guideEmitter.on('guide:texture-failed', onGuideFailed);

    // AI-native Guide: the uploaded plan image (PNG/JPEG) — verify the ACTUAL
    // byte signature and reject anything that isn't a browser-decodable raster
    // (never default unknown bytes to image/png). A PDF here is impossible (AI mode
    // only accepts raster images), but the verifier keeps the contract uniform.
    const { createVerifiedImageDataUrl, autoCropDrawing } = await import('@/harness/verified-image');
    const { computeBuildingFrame } = await import('@/harness/building-frame');
    const guideVerified = createVerifiedImageDataUrl(bytes, undefined);
    const rawGuideUrl = guideVerified.ok ? guideVerified.dataUrl : undefined;
    const croppedGuide = rawGuideUrl ? await autoCropDrawing(rawGuideUrl) : { dataUrl: rawGuideUrl };
    const guideDataUrl = croppedGuide.dataUrl;
    if (guideDataUrl) {
      try {
        const res = await fetch(guideDataUrl);
        const blob = await res.blob();
        const file = new File([blob], `${source.name.replace(/\.[^/.]+$/, '')}-plan-guide.png`, { type: 'image/png' });
        const id = crypto.randomUUID();
        attachmentRepository.put(id, file);
        activeGuideAttachmentRef.current = {
          id,
          kind: 'image',
          name: `Floor Plan Guide (${source.name})`,
          byteSize: file.size,
          mime: 'image/png',
        };
      } catch (err) {
        console.warn('Failed to cache AI guide attachment:', err);
      }
    } else if (source.kind === 'image') {
      activeGuideAttachmentRef.current = source;
    }
    if (!guideVerified.ok && bytes && bytes.length) {
      // Non-fatal: keep the model; do NOT pass raw/PDF bytes to TextureLoader.
      console.warn('[AiGuide] image preparation skipped:', {
        extractionMode: 'ai',
        detectedMimeType: guideVerified.detectedMimeType,
        byteLength: bytes.length,
        result: guideVerified.reason,
      });
      DIAG.guideImageError = { detectedMimeType: guideVerified.detectedMimeType, reason: guideVerified.reason, byteLength: bytes.length };
    }
    const aiDoc = result?.document;
    const buildingFrame = aiDoc?.pageBoundsPt ? computeBuildingFrame({ frameId: `frame_${runId}`, sourceHash: 'ai-document', pageBoundsPt: aiDoc.pageBoundsPt, activeRegionPt: aiDoc.pageBoundsPt, scaleMmPerPt: aiDoc.scaleMmPerPt || 1, rotation: 0, invertY: false }) : null;

    try {
      const nodesBeforeDoors = core.useScene.getState().nodes as Record<string, unknown>;
      const nodeCountBeforeDoors = Object.keys(nodesBeforeDoors).length;
      const doorNodeCountBeforeDoors = Object.values(nodesBeforeDoors).filter((n) => (n as Record<string, unknown>).type === 'door').length;
      // ── drive the builder from the validated ExtractionResult ──
      // guide
      const gRes = installer.installGuide({ dataUrl: guideDataUrl, url: guideDataUrl }, { runId, fileName, frameId: `frame_${runId}`, buildingFrame: buildingFrame ?? undefined });
      guideNodeId = gRes.guideNodeId;
      // walls + runtime wall map
      const wallRes = installer.installWalls(result.walls ?? [], { runId, stage: 'walls' });
      // slab (from result.slab or derived from installed wall boundaries)
      installer.installSlab(result.slab, { runId, stage: 'slab', walls: result.walls });
      const wallMap = installer.buildWallMap(runId, result.walls ?? []);
      setProgWallMap(wallMap);
      progWallMapRef.current = wallMap;
      console.info('[PascalReplay] fixture loaded', { walls: result.walls?.length ?? 0, windows: result.windows?.length ?? 0, doors: result.doors?.length ?? 0 });
      console.info(`[PascalReplay] walls installed ${wallRes.installed}/${wallRes.attempted}`);
      console.info(`[PascalReplay] wall map ${wallMap.status} ${wallMap.entries.length}`);
      // windows (hosted through runtime wall map — the installer wrapper supplies the
      // finalized wall map as the host source, carrying validated startM/endM)
      const winLedger = installer.installWindows(result.windows ?? [], { runId, stage: 'windows' });
      windowLedgerRef.current = winLedger;
      // doors
      const doorLedger = installer.installDoors(result.doors ?? [], { runId, stage: 'doors' });
      doorLedgerRef.current = doorLedger;
      console.info(`[PascalReplay] doors attempted ${doorLedger.attempted}`);
      console.info(`[PascalReplay] doors installed ${doorLedger.installed}`);
      const doorNodeCountAfterDoors = Object.values(core.useScene.getState().nodes as Record<string, unknown>).filter((n) => (n as Record<string, unknown>).type === 'door').length;
      // structural validation (final, READ-ONLY — never mutates the scene)
      const nodesBeforeValidation = core.useScene.getState().nodes as Record<string, unknown>;
      const nodeCountBeforeValidation = Object.keys(nodesBeforeValidation).length;
      const doorNodeCountBeforeValidation = Object.values(nodesBeforeValidation).filter((n) => (n as Record<string, unknown>).type === 'door').length;
      const structural = validateStructuralScene({
        nodes: nodesBeforeValidation, runId: installer.activeRunId ?? runId, guideNodeId,
        slabPresent: Object.values(nodesBeforeValidation).some((n) => (n as Record<string, unknown>).type === 'slab'),
        wallMap: progWallMapRef.current, windowLedger: (windowLedgerRef.current as never) ?? null, doorLedger: (doorLedgerRef.current as never) ?? null,
        acceptedWindows: result.windows?.length ?? 0, acceptedDoors: result.doors?.length ?? 0, acceptedWalls: result.walls?.length ?? 0,
        reviewCount: (progReview.length as number) ?? 0,
      });
      const nodesAfterValidation = core.useScene.getState().nodes as Record<string, unknown>;
      const nodeCountAfterValidation = Object.keys(nodesAfterValidation).length;
      const doorNodeCountAfterValidation = Object.values(nodesAfterValidation).filter((n) => (n as Record<string, unknown>).type === 'door').length;
      setProgStructural(structural as never);
      console.info(`[PascalReplay] structural validation ${structural.status}`, structural.failures);
      // emit truthful progress to the Pascal panel
      setStage('guide', { status: 'completed', completedAt: Date.now(), installed: 1, total: 1 });
      setStage('slab', { status: 'completed', completedAt: Date.now(), installed: 1, total: 1 });
      setStage('walls', { status: 'completed', completedAt: Date.now(), installed: wallRes.installed, total: result.walls?.length ?? 0 });
      setStage('windows', { status: 'completed', completedAt: Date.now(), installed: winLedger.installed, total: result.windows?.length ?? 0, review: winLedger.review, audit: { attempted: winLedger.attempted, skipped: winLedger.skipped, invalid: winLedger.invalid } });
      setStage('doors', { status: 'completed', completedAt: Date.now(), installed: doorLedger.installed, total: result.doors?.length ?? 0, review: doorLedger.review, audit: { attempted: doorLedger.attempted, skipped: doorLedger.skipped, invalid: doorLedger.invalid } });
      // ── Furniture stage: terminal, never PENDING (Part B/Phase 8). Install only
      // accepted furniture; review/rejected stay uninstalled. No Furniture V4
      // provider call here — this just settles the stage from the validated result. ──
      const furnitureItems = (result.furniture ?? []) as unknown as { familyId?: string; acceptance?: string }[];
      const furnitureAccepted = furnitureItems.filter((f) => (f as { acceptance?: string }).acceptance !== 'rejected');
      const furnitureRejected = furnitureItems.filter((f) => (f as { acceptance?: string }).acceptance === 'rejected');
      let furnitureInstalled = 0;
      if (furnitureAccepted.length > 0) {
        try {
          furnitureInstalled = installer.installFurniture(
            { accepted: furnitureAccepted as never, review: [], rejected: furnitureRejected as never, audit: { attempted: furnitureItems.length, installed: furnitureAccepted.length } },
            { runId, stage: 'furniture' },
          );
        } catch (fErr) {
          console.warn('[PascalBuild] furniture install error', fErr);
        }
      }
      const furnitureOutcome = furnitureItems.length === 0
        ? 'SKIPPED_NO_FURNITURE'
        : furnitureInstalled > 0 ? 'INSTALLED' : (furnitureAccepted.length > 0 ? 'FAILED_INSTALLATION' : 'PASSED_WITH_REVIEW');
      setStage('furniture', {
        status: furnitureItems.length === 0 ? 'completed' : (furnitureInstalled > 0 ? 'completed' : (furnitureAccepted.length > 0 ? 'failed' : 'review')),
        completedAt: Date.now(),
        installed: furnitureInstalled,
        total: furnitureItems.length,
        review: furnitureRejected.length,
        message: furnitureOutcome,
        audit: { attempted: furnitureItems.length, accepted: furnitureAccepted.length, rejected: furnitureRejected.length, installed: furnitureInstalled },
      });
      // diagnostics (Requirement 2/4/5)
      const perDoor = (doorLedger.perItem ?? []).map((d) => {
        const node = d.installationSucceeded && d.runtimeWallId ? Object.values(core.useScene.getState().nodes as Record<string, unknown>).find((n) => (n as Record<string, unknown>).metadata && ((n as Record<string, unknown>).metadata as Record<string, unknown>).sourceRecordId === d.openingId) as Record<string, unknown> | undefined : undefined;
        const hostEntry = wallMap.entries.find((e) => e.runtimeWallId === d.runtimeWallId);
        const concise = {
          doorId: d.openingId,
          sourceWallId: d.semanticWallId,
          startM: (result.doors ?? []).find((dd) => dd.id === d.openingId)?.startM ?? null,
          endM: (result.doors ?? []).find((dd) => dd.id === d.openingId)?.endM ?? null,
          exactHostFound: d.mappingFound && !d.geometricFallback,
          geometricHostFound: d.geometricFallback,
          nearestDistanceM: d.nearestWallDistM,
          selectedSemanticWallId: d.runtimeWallId ? hostEntry?.semanticWallId ?? null : null,
          selectedRuntimeWallId: d.runtimeWallId,
          parseSucceeded: d.installationAttempted,
          inserted: d.installationSucceeded,
          failureReason: d.failureReason,
        };
        console.info('[PascalBuild] door result', concise);
        return {
          openingId: d.openingId, semanticWallId: d.semanticWallId, runtimeWallId: d.runtimeWallId,
          mappingFound: d.mappingFound, geometricFallback: d.geometricFallback, nearestWallDistM: d.nearestWallDistM,
          installationAttempted: d.installationAttempted,
          installerReturned: d.installationAttempted, installationSucceeded: d.installationSucceeded,
          runtimeNodeId: node?.id ?? null, runtimeNodeType: node?.type ?? null,
          runtimeParentId: node?.parentId ?? null,
          ...concise,
        };
      });
      const diagNodes = core.useScene.getState().nodes as Record<string, Record<string, unknown>>;
      const nodeTypeCounts: Record<string, number> = {};
      for (const n of Object.values(diagNodes)) { const t = (n.type as string) ?? 'unknown'; nodeTypeCounts[t] = (nodeTypeCounts[t] ?? 0) + 1; }
      const rootNodeIds = Object.values(diagNodes).filter((n) => n.type === 'project' || n.type === 'building' || n.type === 'level').map((n) => n.id as string);
      const levelNode = Object.values(diagNodes).find((n) => n.type === 'level');
      const reachable = new Set<string>();
      if (levelNode) {
        const stack = [levelNode.id as string];
        while (stack.length) {
          const id = stack.pop()!;
          if (reachable.has(id)) continue;
          reachable.add(id);
          const node = diagNodes[id];
          const children = (node?.children as string[] | undefined) ?? [];
          for (const c of children) stack.push(c);
        }
      }
      (globalThis as unknown as { __pascalDiag?: Record<string, unknown> }).__pascalDiag = {
        ...((globalThis as unknown as { __pascalDiag?: Record<string, unknown> }).__pascalDiag ?? {}),
        storeNodeCountAfterBuild: Object.keys(diagNodes).length,
        rootNodeIds,
        rootNodeCount: rootNodeIds.length,
        nodeTypeCounts,
        guideNodeCount: nodeTypeCounts['guide'] ?? 0,
        slabNodeCount: nodeTypeCounts['slab'] ?? 0,
        wallNodeCount: nodeTypeCounts['wall'] ?? 0,
        windowNodeCount: nodeTypeCounts['window'] ?? 0,
        doorNodeCount: nodeTypeCounts['door'] ?? 0,
        itemNodeCount: nodeTypeCounts['item'] ?? 0,
        activeLevelId: levelNode?.id ?? null,
        reachableNodeCount: reachable.size,
        unreachableNodeCount: Object.keys(diagNodes).length - reachable.size,
        sceneRevision: (core.useScene.getState() as Record<string, unknown>).sceneRevision ?? null,
      };
      if (structural.status === 'FAILED') push({ type: 'error', message: `Structural validation FAILED: ${structural.failures.join(', ')} (doors installed ${doorLedger.installed}/${result.doors?.length ?? 0})` });
      else push({ type: 'message', role: 'assistant', id: nid(), text: `Pascal build complete (${wallRes.installed} walls, ${winLedger.installed} windows, ${doorLedger.installed} doors). Structural: ${structural.status}.` });
    } catch (e) {
      push({ type: 'error', message: `Pascal snapshot build failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      guideEmitter.off('guide:texture-ready', onGuideReady);
      guideEmitter.off('guide:texture-failed', onGuideFailed);
      installer.completeRun({ runId });
      setTimeout(() => setProgActive(false), 4000);
    }
  });
  }, [push, nid, setSceneReadyTick]);

  /**
   * Editor-owned installation facade (spec: installExtractionResult).
   *
   * This is a THIN, non-duplicating wrapper over runPascalSnapshotBuild — it does
   * not re-implement the Pascal construction order. Both the AI ("ai") and
   * Geometric ("geometric") entrypoints call THIS with a single validated neutral
   * ExtractionResult; the underlying builder owns the order, Runtime Wall Map,
   * review records, scene commit, Viewer invalidation, camera framing, history
   * checkpoint and terminal project state. No raw provider output, MuPDF internal
   * state, credentials, or Viewer-local state cross this boundary.
   */
  const installExtractionResult = useCallback(
    async (args: {
      projectId?: string | null;
      runId: string;
      extractionMethod: 'ai' | 'geometric';
      source?: { bytes?: Uint8Array; name?: string };
      result: import('design-build-extraction-contracts').ExtractionResult;
      options?: Record<string, unknown>;
    }) => {
      const { runId, extractionMethod, source, result } = args;
      // extractionMethod is recorded for diagnostics/history labelling only; it
      // does not change the builder behavior (one order for both methods).
      void extractionMethod;
      void args.projectId; // reserved for future multi-project support
      void args.options;
      await runPascalSnapshotBuild(
        result,
        source?.bytes,
        { runId, fileName: source?.name ?? (result as { fileName?: string }).fileName ?? 'extraction' },
      );
    },
    [runPascalSnapshotBuild],
  );

  const startProgressiveExtraction = useCallback(async (source: import('design-build-conversation-core').AttachmentRef) => {
    if (extractionBusy) {
      console.warn('[Extract] ignored — a run is already in flight (extractionBusy=true). Cancel it or wait for completion.');
      return;
    }
    console.info('[Extract] start Progressive V3 extraction', { name: source.name, kind: source.kind });
    if (!PROGRESSIVE_ENABLED) { void startAiExtraction(source); return; }
    extractionAbortRef.current?.abort();
    const ac = new AbortController();
    extractionAbortRef.current = ac;
    setExtractionBusy(true);
    setDocked(true);
    DIAG.extractionProvider = 'clean-gemini';
    const runId = `prog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeRunIdRef.current = runId;
    setProgRunId(runId);
    setProgActive(true);
    setProgReview([]);
    setProgStages({
      guide: { status: 'running', startedAt: Date.now(), installed: 0, total: 0, review: 0 },
      slab: { status: 'pending', installed: 0, total: 0, review: 0 },
      walls: { status: 'pending', installed: 0, total: 0, review: 0 },
      windows: { status: 'pending', installed: 0, total: 0, review: 0 },
      doors: { status: 'pending', installed: 0, total: 0, review: 0 },
      furniture: { status: 'pending', installed: 0, total: 0, review: 0 },
    });
    const setStage = (stage: BuildStage, patch: Partial<StageCardState>) =>
      setProgStages((prev) => {
        const next = { ...prev, [stage]: { ...prev[stage], ...patch } };
        progStagesRef.current = next;
        return next;
      });

    // Guide node id captured from installGuide so emitter callbacks can be scoped
    // to the active run's Guide (Phase A: truthful readiness).
    let guideNodeId: string | null = null;
    // Per-run guards so stale/duplicate/cancelled Guide callbacks are ignored and
    // a failed/completed Guide cannot be resurrected (Step 3).
    const guideResolvedRef = { current: null as null | 'texture-ready' | 'failed' };
    const runCancelledRef = { current: false };

    const core = getPascalStores();
    const ctx = {
      // Live getter — same store instance the Viewer consumes (A2/A3).
      get nodes() { return core.useScene.getState().nodes as Record<string, unknown>; },
      createNodes: (ops: { node: unknown; parentId?: string }[]) => core.useScene.getState().createNodes(ops as never),
      updateNode: (id: string, data: any) => core.useScene.getState().updateNode(id as never, data),
      updateNodes: (updates: { id: string; data: any }[]) => core.useScene.getState().updateNodes(updates as never),
      removeNodeIds: (ids: string[]) => { if (ids.length) core.useScene.getState().deleteNodes(ids as never); },
      levelId: (Object.values(core.useScene.getState().nodes as Record<string, Record<string, unknown>>).find((n) => n.type === 'level')?.id as string) ?? '',
      onProgress: (kind: 'furniture' | 'slab' | 'walls' | 'windows' | 'doors', installed: number, total: number) => {
        setSceneReadyTick((t) => t + 1);
        setStage(kind === 'walls' ? 'walls' : kind === 'windows' ? 'windows' : kind === 'doors' ? 'doors' : kind === 'slab' ? 'slab' : 'furniture', { installed, total });
      },
    };
    const installer = createProgressiveInstaller(ctx);
    installer.beginRun({ runId });

    // Guide readiness: the Viewer emits 'guide:texture-ready' / 'guide:texture-failed'
    // when the GuideNode texture resolves or fails. Scope to this run's guide node so
    // stale-run callbacks are ignored (Phase A: truthful lifecycle).
    const guideEmitter = emitter as unknown as {
      on: (t: string, h: (p: any) => void) => void;
      off: (t: string, h: (p: any) => void) => void;
    };
    const onGuideReady = (p: { runId?: string; guideId: string; sourceIdentity: string }) => {
      // Scope + idempotency via the shared pure guard (Step 3).
      if (!guideSignalApplicable(p, {
        activeRunId: activeRunIdRef.current,
        activeGuideId: guideNodeId,
        cancelled: runCancelledRef.current,
        alreadyResolved: guideResolvedRef.current !== null,
      })) return;
      guideResolvedRef.current = 'texture-ready';
      setStage('guide', applyGuideReadiness(
        { status: 'running', startedAt: Date.now(), total: 1, installed: 0, review: 0 },
        'texture-ready',
      ));
    };
    const onGuideFailed = (p: { runId?: string; guideId: string; sourceIdentity: string; error: string }) => {
      if (!guideSignalApplicable(p, {
        activeRunId: activeRunIdRef.current,
        activeGuideId: guideNodeId,
        cancelled: runCancelledRef.current,
        alreadyResolved: guideResolvedRef.current !== null,
      })) return;
      guideResolvedRef.current = 'failed';
      setStage('guide', applyGuideReadiness(
        { status: 'running', startedAt: Date.now(), total: 1, installed: 0, review: 0 },
        'failed',
      ));
      setStage('guide', { message: p.error });
    };
    guideEmitter.on('guide:texture-ready', onGuideReady);
    guideEmitter.off('guide:texture-ready', onGuideReady);
    guideEmitter.on('guide:texture-failed', onGuideFailed);
    guideEmitter.off('guide:texture-failed', onGuideFailed);

    setExtractionProgress({
      isExtracting: true,
      pipeline: 'ai',
      stageText: 'Reading the plan with AI…',
      progressPercent: 20,
      fileName: source.name,
    });
    push({ type: 'message', role: 'user', id: nid(), text: `Extract ${source.name} (Progressive V3).` });

    try {
      let bytes: Uint8Array | undefined = await attachmentRepository.bytes(source.id);
      if (!bytes) {
        const maybeDataUrl = (source as unknown as { dataUrl?: string }).dataUrl;
        if (maybeDataUrl?.startsWith('data:')) bytes = Uint8Array.from(Buffer.from(maybeDataUrl.slice(maybeDataUrl.indexOf(',') + 1), 'base64'));
        else if (source.url) bytes = new Uint8Array(await (await fetch(source.url, { signal: ac.signal })).arrayBuffer());
      }
      if (!bytes || bytes.length === 0) { push({ type: 'error', message: 'Attachment has no readable bytes.' }); return; }

      const form = new FormData();
      const mime = source.mime || (source.kind === 'pdf' ? 'application/pdf' : 'application/octet-stream');
      form.append('file', new Blob([bytes as BlobPart], { type: mime }), source.name);

      const res = await fetch('/api/extraction/ai/progressive', { method: 'POST', body: form, signal: ac.signal, headers: providerRequestHeaders('extraction') });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { code?: string; error?: string };
        if (j.code === 'PROGRESSIVE_BUILD_DISABLED') { void startAiExtraction(source); return; }
        push({ type: 'error', message: j.error || `Progressive extraction failed (${res.status}).` });
        setStage('furniture', { status: 'failed' });
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      if (reader) {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            // §3: validate every event through its discriminator; reject malformed.
            const event = validateEvent(JSON.parse(line));
            if (!event) continue;
            if (event.runId !== activeRunIdRef.current) continue; // stale run guard
            await handleEvent(event);
          }
        }
        if (buffer.trim()) {
          try { const ev = validateEvent(JSON.parse(buffer)); if (ev && ev.runId === activeRunIdRef.current) await handleEvent(ev); } catch { /* ignore trailing */ }
        }
      }
      installer.completeRun({ runId });
      guideEmitter.off('guide:texture-ready', onGuideReady);
      guideEmitter.off('guide:texture-failed', onGuideFailed);

      async function handleEvent(event: ProgressiveBuildEvent) {
        switch (event.type) {
          case 'run.started': break;
          case 'guide.ready':
            // Guide node is being created; texture readiness is NOT confirmed here.
            // Use the truthful reducer: 'node-created' keeps the stage running until
            // the Viewer emits 'guide:texture-ready' (Phase A, Step 6).
            setStage('guide', applyGuideReadiness(
              { status: 'running', startedAt: Date.now(), total: event.counts?.guides ?? 1, installed: 0, review: 0 },
              'node-created',
            ));
            try {
              const { autoCropDrawing } = await import('@/harness/verified-image');
              const rawPayload = event.payload as Record<string, unknown> | undefined;
              const rawPayloadUrl = (rawPayload?.dataUrl as string | undefined) ?? (rawPayload?.url as string | undefined);
              const croppedPayload = rawPayloadUrl ? await autoCropDrawing(rawPayloadUrl) : { dataUrl: rawPayloadUrl };
              const res = installer.installGuide({ ...(rawPayload ?? {}), dataUrl: croppedPayload.dataUrl, url: croppedPayload.dataUrl } as any, { runId, fileName: source.name, frameId: `frame_${runId}` });
              guideNodeId = res.guideNodeId;
            } catch (guideErr) {
              setStage('guide', applyGuideReadiness(
                { status: 'running', startedAt: Date.now(), total: event.counts?.guides ?? 1, installed: 0, review: 0 },
                'failed',
              ));
              setStage('guide', { message: guideErr instanceof Error ? guideErr.message : String(guideErr) });
            }
            break;
          case 'slab.ready':
            setStage('slab', { status: 'running', startedAt: Date.now(), total: event.counts?.slabs ?? 1, installed: 0, review: 0 });
            try {
              const installed = installer.installSlab(event.payload, { runId, stage: 'slab' });
              setStage('slab', installed > 0
                ? { status: 'completed', completedAt: Date.now(), installed, total: event.counts?.slabs ?? 1 }
                : { status: 'failed', completedAt: Date.now(), installed: 0, total: event.counts?.slabs ?? 1, message: 'Slab install produced 0 nodes' });
            } catch (slabErr) {
              setStage('slab', { status: 'failed', completedAt: Date.now(), installed: 0, total: event.counts?.slabs ?? 1, message: slabErr instanceof Error ? slabErr.message : String(slabErr) });
            }
            break;
          case 'walls.ready': {
            setStage('walls', { status: 'running', startedAt: Date.now(), total: event.counts?.walls ?? 0, installed: 0, review: 0 });
            try {
              const res = installer.installWalls(event.payload as any[], { runId, stage: 'walls' } as never) as unknown as { attempted: number; installed: number; invalid: number; entries: { semanticWallId: string; runtimeWallId: string }[] };
              // Build the FINALIZED AI WALL MAP from actual runtime installation.
              const wallMap = installer.buildWallMap(runId, (event.payload as any[]) ?? []);
              setProgWallMap(wallMap as never);
              progWallMapRef.current = wallMap as never;
              setStage('walls', res.installed > 0
                ? { status: 'completed', completedAt: Date.now(), installed: res.installed, total: event.counts?.walls ?? 0 }
                : { status: 'failed', completedAt: Date.now(), installed: 0, total: event.counts?.walls ?? 0, message: 'Wall install produced 0 nodes' });
              // Guarantee slab presence from wall bounds if slab was missing or had 0 nodes
              const slabCount = Object.values(core.useScene.getState().nodes as Record<string, unknown>).filter((n) => (n as any)?.type === 'slab').length;
              if (slabCount === 0 && res.installed > 0) {
                const sInstalled = installer.installSlab(undefined, { runId, stage: 'slab', walls: event.payload as any[] });
                if (sInstalled > 0) {
                  setStage('slab', { status: 'completed', completedAt: Date.now(), installed: sInstalled, total: 1 });
                }
              }
            } catch (wallsErr) {
              setStage('walls', { status: 'failed', completedAt: Date.now(), installed: 0, total: event.counts?.walls ?? 0, message: wallsErr instanceof Error ? wallsErr.message : String(wallsErr) });
            }
            break;
          }
          case 'windows.ready': {
            // Dependency guard: windows require the FINALIZED wall map READY (not merely walls stage complete).
            if (progWallMapRef.current?.status !== 'READY') {
              setStage('windows', { status: 'failed', completedAt: Date.now(), total: event.counts?.windows ?? 0, installed: 0, message: 'Windows attempted before wall map READY' });
              break;
            }
            setStage('windows', { status: 'running', startedAt: Date.now(), total: event.counts?.windows ?? 0, installed: 0, review: 0 });
            try {
              const ledger = installer.installWindows(event.payload as any[], { runId, stage: 'windows' } as never) as unknown as { attempted: number; installed: number; invalid: number; perItem: unknown[] };
              windowLedgerRef.current = ledger;
              const outcome = ledger.attempted === 0
                ? (event.counts?.windows ? 'INSTALLED' : 'SKIPPED_NO_PROVIDER_DETECTIONS')
                : ledger.installed > 0 ? 'INSTALLED' : 'FAILED_DEPENDENCY';
              setStage('windows', ledger.installed > 0
                ? { status: 'completed', completedAt: Date.now(), installed: ledger.installed, total: event.counts?.windows ?? 0, message: outcome }
                : { status: ledger.attempted === 0 ? 'review' : 'failed', completedAt: Date.now(), installed: 0, total: event.counts?.windows ?? 0, message: ledger.attempted === 0 ? (event.counts?.windows ? 'Review required' : 'No windows detected') : 'Window install produced 0 nodes' });
            } catch (winErr) {
              setStage('windows', { status: 'failed', completedAt: Date.now(), installed: 0, total: event.counts?.windows ?? 0, message: winErr instanceof Error ? winErr.message : String(winErr) });
            }
            break;
          }
          case 'doors.ready': {
            if (progWallMapRef.current?.status !== 'READY') {
              setStage('doors', { status: 'failed', completedAt: Date.now(), total: event.counts?.doors ?? 0, installed: 0, message: 'Doors attempted before wall map READY' });
              break;
            }
            setStage('doors', { status: 'running', startedAt: Date.now(), total: event.counts?.doors ?? 0, installed: 0, review: 0 });
            try {
              const ledger = installer.installDoors(event.payload as any[], { runId, stage: 'doors' } as never) as unknown as { attempted: number; installed: number; invalid: number; perItem: unknown[] };
              doorLedgerRef.current = ledger;
              const outcome = ledger.attempted === 0
                ? (event.counts?.doors ? 'INSTALLED' : 'SKIPPED_NO_PROVIDER_DETECTIONS')
                : ledger.installed > 0 ? 'INSTALLED' : 'FAILED_DEPENDENCY';
              setStage('doors', ledger.installed > 0
                ? { status: 'completed', completedAt: Date.now(), installed: ledger.installed, total: event.counts?.doors ?? 0, message: outcome }
                : { status: ledger.attempted === 0 ? 'review' : 'failed', completedAt: Date.now(), installed: 0, total: event.counts?.doors ?? 0, message: ledger.attempted === 0 ? (event.counts?.doors ? 'Review required' : 'No doors detected') : '' });
            } catch (doorErr) {
              setStage('doors', { status: 'failed', completedAt: Date.now(), installed: 0, total: event.counts?.doors ?? 0, message: doorErr instanceof Error ? doorErr.message : String(doorErr) });
            }
            break;
          }
          case 'furniture.detected': setStage('furniture', { status: 'running', startedAt: Date.now() }); break;
          case 'furniture.verified': break;
          case 'furniture.review':
            setStage('furniture', { status: 'review', completedAt: Date.now(), review: event.counts?.review ?? 0, audit: event.audit as Record<string, number> });
            if (event.payload) setProgReview((event.payload as { review?: FurnitureCandidate[] }).review ?? []);
            break;
          case 'stage.completed':
            if (event.stage === 'furniture') {
              setStage('furniture', { status: 'completed', completedAt: Date.now(), installed: event.installed ?? 0, total: event.total ?? 0, audit: event.audit as Record<string, number> });
              installer.installFurniture(event.payload as any, { runId, stage: 'furniture' });
              if (event.payload) setProgReview((event.payload as { review?: FurnitureCandidate[] }).review ?? []);
            }
            break;
          case 'run.completed':
            setStage('furniture', { status: 'completed', completedAt: Date.now() });
            // Phase B §10: validate the ACTUAL Pascal scene after all stages settle.
            try {
              const core = getPascalStores();
              const nodes = core.useScene.getState().nodes as Record<string, unknown>;
              const aiResult = liveResultRef.current;
              const structural = validateStructuralScene({
                nodes,
                runId: installer.activeRunId ?? runId,
                guideNodeId: guideNodeId,
                slabPresent: Object.values(nodes).some((n) => (n as Record<string, unknown>).type === 'slab'),
                wallMap: progWallMapRef.current,
                windowLedger: (windowLedgerRef.current as never) ?? null,
                doorLedger: (doorLedgerRef.current as never) ?? null,
                acceptedWindows: aiResult?.windows?.length ?? 0,
                acceptedDoors: aiResult?.doors?.length ?? 0,
                acceptedWalls: aiResult?.walls?.length ?? 0,
                reviewCount: (progReview.length as number) ?? 0,
              });
              setProgStructural(structural as never);
              if (structural.status === 'FAILED') {
                push({ type: 'error', message: `Structural validation FAILED: ${structural.failures.join(', ')}` });
              } else {
                push({ type: 'message', role: 'assistant', id: nid(), text: `Structural validation ${structural.status} (orphans: ${structural.orphanWindowCount + structural.orphanDoorCount}, metadata failures: ${structural.metadataSchemaFailures}).` });
              }
            } catch (valErr) {
              push({ type: 'error', message: `Structural validation error: ${valErr instanceof Error ? valErr.message : String(valErr)}` });
            }
            break;
          case 'run.failed': setStage('furniture', { status: 'failed' }); break;
          case 'run.cancelled': runCancelledRef.current = true; setStage('furniture', { status: 'cancelled' }); break;
        }
      }
    } catch (e: any) {
      if ((e as Error).name === 'AbortError' || ac.signal.aborted) {
        push({ type: 'message', role: 'assistant', id: nid(), text: 'Progressive extraction cancelled.' });
        setStage('furniture', { status: 'cancelled' });
      } else {
        push({ type: 'error', message: `Progressive extraction error: ${e?.message ?? String(e)}` });
        setStage('furniture', { status: 'failed' });
      }
    } finally {
      guideEmitter.off('guide:texture-ready', onGuideReady);
      guideEmitter.off('guide:texture-failed', onGuideFailed);
      setExtractionBusy(false);
      setTimeout(() => setProgActive(false), 4000);
    }
  }, [push, startAiExtraction, nid, extractionBusy, setSceneReadyTick, PROGRESSIVE_ENABLED]);

  // Accept a single furniture review candidate through the shared installer.
  const acceptReviewItem = useCallback((item: FurnitureCandidate) => {
    const core = getPascalStores();
    const levelId = (Object.values(core.useScene.getState().nodes as Record<string, Record<string, unknown>>).find((n) => n.type === 'level')?.id as string) ?? '';
    const ctx = {
      get nodes() { return core.useScene.getState().nodes as Record<string, unknown>; },
      createNodes: (ops: { node: unknown; parentId?: string }[]) => core.useScene.getState().createNodes(ops as never),
      removeNodeIds: (ids: string[]) => { if (ids.length) core.useScene.getState().deleteNodes(ids as never); },
      levelId,
      onProgress: () => {},
    };
    installFurniture(ctx, [item], { progressive: true, metaExtras: { source: 'ai-extract', extractionMode: 'progressive-v3', runId: activeRunIdRef.current ?? '', stage: 'furniture', sourceEntityId: item.sourceEntityId, frameId: item.frameId } });
    setSceneReadyTick((t) => t + 1);
    setProgReview((prev) => prev.filter((r) => r.sourceEntityId !== item.sourceEntityId));
  }, [setSceneReadyTick]);

  // ---- Photoreal render (geometry-locked) -------------------------------------
  const lastRenderRef = useRef<RenderJobResult | null>(null);
  const getViewerHandle = useCallback(() => viewerHandleRef.current, []);

  const handleRenderComplete = useCallback((r: RenderJobResult) => {
    lastRenderRef.current = r;
    const pct = Math.round(r.fidelity.score * 100);
    push({
      type: 'message',
      role: 'assistant',
      id: nid(),
      text: `Photoreal render ready — ${getRenderStyle(r.style).label}, geometry match ${pct}% (${r.modelLabel}). Drag the Compare slider to check every wall and opening.`,
      renderResult: {
        renderId: r.renderId,
        status: 'done',
        progress: 1,
        previewUrl: r.imageUrl,
        downloadUrl: r.imageUrl,
        snapshotUrl: r.view.dataUrl,
        planUrl: r.planDataUrl,
        overlayUrl: r.view.edgeOverlayUrl,
        message: `${r.modelLabel} geometry-locked render`,
        providerId: r.model,
        modelLabel: r.modelLabel,
        styleId: r.style,
        fidelity: r.fidelity.score,
        mimeType: r.mimeType,
      },
    });
  }, [push]);

  const runChatRender = useCallback(async (o: { sourceUrl?: string; reuseView?: PreparedView; text: string }) => {
    const prefs = loadRenderPrefs();
    const tier = RENDER_TIERS[prefs.tier];
    const style = styleFromText(o.text);
    const furnish = prefs.furnish || furnishFromText(o.text);
    setRenderProgress({ isRendering: true, progress: 0.03, stageName: 'Preparing your 3D view…', snapshotUrl: o.reuseView?.dataUrl ?? o.sourceUrl, modelLabel: tier.modelLabel });
    try {
      const view = o.reuseView ?? (await prepareView(o.sourceUrl as string, currentViewKind(viewerHandleRef.current)));
      const r = await renderPhotoreal(view, {
        style,
        tier: prefs.tier,
        furnish,
        ceiling: prefs.ceiling,
        note: o.text,
        onStage: (st) => setRenderProgress({ isRendering: true, progress: st.progress, stageName: st.label, snapshotUrl: view.dataUrl, modelLabel: tier.modelLabel }),
        debugSave: process.env.NODE_ENV !== 'production',
      });
      handleRenderComplete(r);
    } catch (e) {
      push({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setRenderProgress((prev) => ({ ...prev, isRendering: false, progress: 0, stageName: '' }));
    }
  }, [push, handleRenderComplete]);

  const onCommand = useCallback((cmd: ChatCommand) => {
    if (cmd.type === 'send-message') {
      const snapshotAtt = cmd.attachments?.find((a) => a.kind === 'image' && a.name.toLowerCase().includes('3d view'))
        ?? cmd.attachments?.find((a) => a.kind === 'image');
      const planAtt = cmd.attachments?.find((a) => a.id !== snapshotAtt?.id && (
        a.name.toLowerCase().includes('plan') ||
        a.name.toLowerCase().includes('drawing') ||
        a.name.toLowerCase().includes('guide') ||
        a.kind === 'pdf'
      ));

      push({ type: 'message', role: 'user', id: nid(), text: cmd.text, attachments: cmd.attachments });

      if (snapshotAtt) {
        // Real geometry-locked render of the attached 3D snapshot.
        let snapshotUrl: string | undefined = snapshotAtt.dataUrl;
        if (!snapshotUrl) {
          const file = attachmentRepository.get(snapshotAtt.id);
          if (file) snapshotUrl = URL.createObjectURL(file);
        }
        if (snapshotUrl) void runChatRender({ sourceUrl: snapshotUrl, text: cmd.text });
        else push({ type: 'error', message: 'Could not read the 3D snapshot. Capture it again and resend.' });
      } else if (lastRenderRef.current && RENDER_TWEAK.test(cmd.text)) {
        // Follow-up on the last render ("golden hour", "marble floors"…): same view, new look.
        void runChatRender({ reuseView: lastRenderRef.current.view, text: cmd.text });
      } else if (RENDER_TWEAK.test(cmd.text) && sceneHasWallsNow()) {
        // A render request with no earlier render: capture the current view, then render it.
        void (async () => {
          try {
            const rp = loadRenderPrefs();
            const walking = viewModeRef.current === 'walk';
            const view = await captureViewForRender(viewerHandleRef.current, {
              frameBuilding: rp.frameBuilding,
              ...(walking ? { viewKind: 'interior' as const, lensMm: walkLensRef.current, ceiling: rp.ceiling } : {}),
            });
            await runChatRender({ reuseView: view, text: cmd.text });
          } catch (e) {
            push({ type: 'error', message: e instanceof Error ? e.message : 'Could not capture the 3D view. Try the Render button.' });
          }
        })();
      } else {
        const reply = sceneHasWallsNow()
          ? 'I can render this model: try "golden hour with oak floors", or press Render. To work on another plan, upload it with +.'
          : 'Upload a floor plan with + and I will build the 3D model.';
        setTimeout(() => push({ type: 'message', role: 'assistant', id: nid(), text: reply }), 250);
      }
    }
    if (cmd.type === 'start-frozen-import') {
      // The sample is a real vector PDF run through the same pipeline as an upload.
      void (async () => {
        try {
          const res = await fetch('/CODE_06.pdf');
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const file = new File([await res.blob()], 'Sample plan (CODE-06).pdf', { type: 'application/pdf' });
          const id = crypto.randomUUID();
          attachmentRepository.put(id, file);
          setExtractMethod('geometric');
          void runLiveGeometricExtraction({ id, kind: 'pdf', name: file.name, byteSize: file.size, mime: 'application/pdf' });
        } catch {
          push({ type: 'error', message: 'Could not load the sample plan. Check your connection and try again.' });
        }
      })();
    }
    // Change Set 3: AI method → clean Gemini Multipass boundary (V2) or Progressive V3.
    if (cmd.type === 'start-extraction' && cmd.extractor === 'gemini') {
      const plan = resolveAiExtractionPlan('gemini', PROGRESSIVE_ENABLED);
      if (plan.progressiveRouteCalled) void startProgressiveExtraction(cmd.source);
      else void startAiExtraction(cmd.source);
      return;
    }
    // Change Set 2: production Geometric path → clean Pure MuPDF boundary.
    if (cmd.type === 'start-extraction') {
      if (cmd.source.kind !== 'pdf') {
        // PNG/JPEG must be routed to AI extraction, not Pure MuPDF.
        push({ type: 'error', message: 'This file requires AI extraction. Select AI mode to continue.' });
        return;
      }
      // §3: live-mupdf is the normal Geometric provider. frozen-code06 remains
      // a development-only rollback (never reachable from production UI).
      if (GEOMETRIC_EXTRACTION_PROVIDER === 'live-mupdf') {
        void runLiveGeometricExtraction(cmd.source);
      } else if (process.env.NODE_ENV !== 'production') {
        push({ type: 'message', role: 'user', id: nid(), text: `Extract ${cmd.source.name} (Geometric · frozen fixture — dev rollback).` });
        void startFrozenImport();
      } else {
        push({ type: 'error', message: 'Extraction provider unavailable.' });
      }
    }
    if (cmd.type === 'cancel-extraction') {
      extractionAbortRef.current?.abort();
    }
    if (cmd.type === 'export') {
      setTimeout(() => push({ type: 'export-ready', kind: cmd.kind, url: `#mock-${cmd.kind}` }), 250);
    }
    if (cmd.type === 'start-render') {
      push({ type: 'render-started', renderId: 'mock-render-1' });
      setTimeout(() => push({ type: 'render-complete', result: { renderId: 'mock-render-1', status: 'done', progress: 1, providerId: selection.render, message: 'Mock render complete' } }), 1200);
    }
  }, [push, selection, startFrozenImport, runLiveGeometricExtraction, runChatRender]);

  const onSelectModel = useCallback((slot: 'chat' | 'extraction' | 'render', id: string) => {
    setSelection((s) => ({ ...s, [slot]: id }));
  }, []);

  const startCleanProProject = useCallback(() => {
    const core = getPascalStores();
    const s = core.useScene.getState();
    const hasNodes = Object.keys(s.nodes ?? {}).length > 0;
    if (!hasNodes) {
      const siteId = 'site_scratch';
      const buildingId = 'building_scratch';
      const levelId = 'level_scratch';
      const slabId = 'slab_scratch';
      const site = SiteNode.parse({ id: siteId, name: 'Site', parentId: null });
      const building = BuildingNode.parse({ id: buildingId, name: 'Building 1', parentId: siteId });
      const level = LevelNode.parse({ id: levelId, name: 'Level 1', parentId: buildingId });
      const slab = SlabNode.parse({
        id: slabId,
        name: 'Ground Floor Slab',
        parentId: levelId,
        polygon: [
          [-10, -10],
          [10, -10],
          [10, 10],
          [-10, 10],
        ],
      });
      const nodes: Record<string, AnyNode> = {
        [siteId]: { ...site, children: [buildingId] } as AnyNode,
        [buildingId]: { ...building, children: [levelId] } as AnyNode,
        [levelId]: { ...level, children: [slabId] } as AnyNode,
        [slabId]: slab as AnyNode,
      };
      s.setScene(nodes as never, [siteId] as never, { installedPlugins: [builtinPlugin.id] });
      useViewer.getState().setSelection?.({
        buildingId: buildingId as `building_${string}`,
        levelId: levelId as `level_${string}`,
        selectedIds: [],
      });
    }
    setViewerVisible(true);
    setDocked(true);
    editorMode.requestPro();
  }, [editorMode]);


  // Derive the real build stages: extraction phases (from actual provider
  // events) followed by the Pascal construction stages. No fabricated
  // percentages — stage rows show real committed counts or activity states.
  const stages = useMemo(() => {
    const state = DIAG.importState;
    const committed = DIAG.committedWalls;
    const total = DIAG.expectedWalls;
    const orig = DIAG.originalWallCount;
    const comp = DIAG.completionWallCount;
    const finalized = DIAG.finalizedWallCount;
    const wallsDone = state === 'completed';
    const guideDone = wallsDone || DIAG.currentStage !== 'none';
    const reachedWalls = wallsDone || (DIAG.currentStage !== 'none' && DIAG.currentStage !== 'slab');
    const reachedCompletion = DIAG.wallMapPass && finalized > orig;
    const reachedFinalize = DIAG.wallMapPass;
    const windowsDone = DIAG.windowsInstalledNodes > 0 || DIAG.windowsExtracted >= 0 && state === 'completed';
    const doorsDone = DIAG.doorsAccepted > 0;
    const validationDone = DIAG.validationPass && state === 'completed';
    const finalLiveDone = DIAG.projectReady === 'READY' && DIAG.validationPass && DIAG.wallMapPass;
    // M4.4: split validation into three ordered phases.
    //  STRUCTURAL_VALIDATION: guide/slab/original/completion/finalized wall map.
    //  OPENING_VALIDATION: windows + doors + live hosts + parent-child + transforms.
    //  FINAL_LIVE_MODEL_VALIDATION: runs only after all install stages settle.
    // "Final live-model validation" must NOT show done while doors remain at zero.
    const structuralDone = DIAG.wallMapPass && state === 'completed';
    const openingDone =
      (DIAG.windowsInstalledNodes > 0 && DIAG.installedDoors > 0) &&
      DIAG.wallMapPass && state === 'completed';
    const finalLiveDone2 = openingDone && DIAG.validationPass && DIAG.projectReady === 'READY';
    const projectReady = DIAG.projectReady === 'READY' && DIAG.validationPass && DIAG.wallMapPass;

    const def: { key: string; name: string; status: 'pending' | 'active' | 'done' | 'review' | 'failed'; committed: number; total: number }[] = [
      // 1. Preparing the drawing
      { key: 'drawing', name: 'Preparing the drawing', status: state === 'idle' ? 'pending' : 'done', committed: 1, total: 1 },
      // 2. Aligning the Guide
      { key: 'guide', name: 'Aligning the Guide', status: guideDone ? 'done' : state === 'importing' ? 'active' : 'pending', committed: guideDone ? 1 : 0, total: 1 },
      // 3. Creating the building slab
      { key: 'slab', name: 'Creating the building slab', status: DIAG.currentStage === 'slab' && state === 'importing' ? 'active' : reachedWalls || wallsDone ? 'done' : 'pending', committed: 1, total: 1 },
      // 4. Building original walls
      { key: 'original-walls', name: 'Building original walls', status: state === 'importing' && !reachedCompletion ? 'active' : reachedCompletion || wallsDone ? 'done' : 'pending', committed: orig, total: orig },
      // 5. Completing walls and partitions
      { key: 'completion', name: 'Completing walls and partitions', status: reachedCompletion || wallsDone || reachedFinalize ? 'done' : reachedWalls ? 'active' : 'pending', committed: comp, total: comp },
      // 6. Finalizing the wall network
      { key: 'finalize', name: 'Finalizing the wall network', status: reachedFinalize ? 'done' : reachedWalls ? 'active' : 'pending', committed: finalized, total: finalized },
      // 7. Installing windows
      {
        key: 'windows',
        name: 'Installing windows',
        status: (DIAG.windowsInstalledNodes >= (DIAG.windowsEligible || DIAG.windowsExtracted) && (DIAG.windowsEligible || DIAG.windowsExtracted) > 0) || state === 'completed'
          ? 'done'
          : (DIAG.currentStage === 'windows' || DIAG.windowsInstalledNodes > 0)
          ? 'active'
          : 'pending',
        committed: DIAG.windowsInstalledNodes,
        total: DIAG.windowsEligible || DIAG.windowsExtracted,
      },
      // 8. Installing doors
      {
        key: 'doors',
        name: 'Installing doors',
        status: (DIAG.installedDoors >= (DIAG.doorsAutoInstallable || DIAG.doorsAccepted) && (DIAG.doorsAutoInstallable || DIAG.doorsAccepted) > 0) || state === 'completed'
          ? 'done'
          : (DIAG.currentStage === 'doors' || DIAG.installedDoors > 0)
          ? 'active'
          : 'pending',
        committed: DIAG.installedDoors,
        total: DIAG.doorsAutoInstallable || DIAG.doorsAccepted,
      },
      // 9. Structural validation
      { key: 'structural-validation', name: 'Structural validation', status: structuralDone ? 'done' : state === 'importing' ? 'active' : 'pending', committed: structuralDone ? 1 : 0, total: 1 },
      // 9b. Opening validation
      { key: 'opening-validation', name: 'Opening validation', status: openingDone ? 'done' : (DIAG.windowsInstalledNodes > 0 || DIAG.installedDoors > 0) ? 'active' : 'pending', committed: openingDone ? 1 : 0, total: 1 },
      // 9c. Final live-model validation (only after windows + doors settle)
      { key: 'final-validation', name: 'Final live-model validation', status: finalLiveDone2 ? 'done' : openingDone ? 'active' : 'pending', committed: finalLiveDone2 ? 1 : 0, total: 1 },
      // 10. Project ready
      { key: 'project-ready', name: 'Project ready', status: projectReady ? 'done' : 'pending', committed: projectReady ? 1 : 0, total: 1 },
    ];
    return def;
  }, [events, sceneReadyTick]);

  // Dev-only manual trigger for the frozen import (no UI button; used for the
  // Dev-only manual triggers. The frozen-import trigger (__code06Start) and the
  // viewer debug object remain dev-only (absent in production builds). The Pascal
  // replay hooks (__runCapturedPascalReplay / __pascalReplay) are SAFE diagnostics:
  // they make zero provider calls, expose no credentials/keys, and drive the same
  // runPascalSnapshotBuild entrypoint used by the real AI route — so they stay
  // available in production for acceptance runs.
  useEffect(() => {
    const w = window as unknown as {
      __runCapturedPascalReplay?: (url?: string) => Promise<void>;
      __pascalReplay?: (res: import('design-build-extraction-contracts').ExtractionResult, fileName?: string) => void;
      __code06Start?: () => void;
      __viewerDebug?: unknown;
      __frameProject?: () => void;
      __frameSelection?: () => void;
      __topView?: () => void;
    };
    // REQUIREMENT 8 / user directive: captured replay through the EXACT main-editor
    // runPascalSnapshotBuild entrypoint. Zero provider calls. Uses the live Viewer +
    // Pascal store + same progress panel. In console:
    //   window.__runCapturedPascalReplay()
    w.__runCapturedPascalReplay = async (url = '/ai-replay-fixture.json') => {
      // Cache-bust the fixture URL with a query param so the browser ALWAYS fetches
      // the current fixture (the real 14-wall / 2-door capture), never a stale cached
      // copy — even if the page bundle itself is cached from an earlier session.
      const sep = url.includes('?') ? '&' : '?';
      const bustUrl = `${url}${sep}v=${BUILD_GIT_COMMIT || Date.now()}`;
      const json = (await fetch(bustUrl, { cache: 'no-store' }).then((r) => r.json())) as { result?: import('design-build-extraction-contracts').ExtractionResult };
      if (!json.result) { console.error('[replay] fixture has no .result'); return; }
      void installExtractionResult({
        runId: `replay-${Date.now().toString(36)}`,
        extractionMethod: 'ai',
        result: json.result,
        source: { name: (json.result as { fileName?: string }).fileName ?? 'ai-replay-fixture' },
      });
    };
    // Lower-level hook (same entrypoint) for arbitrary captured results.
    w.__pascalReplay = (res: import('design-build-extraction-contracts').ExtractionResult, fileName = 'replay') => {
      void installExtractionResult({ runId: `replay-${Date.now().toString(36)}`, extractionMethod: 'ai', result: res, source: { name: fileName } });
    };
    if (process.env.NODE_ENV === 'production') return;
    w.__code06Start = () => { void startFrozenImport(); };
    w.__frameProject = () => frameEntireProject();
    w.__frameSelection = () => frameSelection();
    w.__topView = () => topViewAndFrame();
    w.__viewerDebug = {
      getFramingStatus: () => {
        const ctl = framingCtl.current;
        const h = viewerHandleRef.current;
        const core = getPascalStores();
        const st = core.useScene.getState() as unknown as { dirtyNodes: Set<unknown>; nodes: Record<string, unknown> };
        const reg = (core as unknown as { sceneRegistry?: { byType?: Record<string, Set<string> | string[]> } }).sceneRegistry;
        const wallReg = reg?.byType?.wall ? (Array.isArray(reg.byType.wall) ? reg.byType.wall.length : reg.byType.wall.size) : 0;
        return {
          runId: ctl.runId,
          viewerHandleReady: !!h?.camera,
          cameraReady: !!h?.camera,
          controlsReady: !!h?.controls,
          controlsAvailable: ctl.controlsAvailable,
          importState: DIAG.importState,
          committedWalls: DIAG.committedWalls,
          dirtyNodes: st.dirtyNodes.size,
          wallRegistryCount: wallReg,
          framingState: ctl.framingState,
          framingAttemptCount: ctl.attemptCount,
          buildingObjectCount: ctl.buildingCount,
          excludedObjectCount: ctl.excludedCount,
          wallObjectsIncluded: ctl.wallObjectsIncluded,
          slabObjectsIncluded: ctl.slabObjectsIncluded,
          guideObjectsIncluded: ctl.guideObjectsIncluded,
          totalFramingObjects: ctl.buildingCount,
          slabBoundsIncluded: ctl.slabObjectsIncluded > 0,
          framingBounds: ctl.bounds,
          bounds: ctl.bounds,
          cameraPositionBefore: ctl.camBefore,
          cameraPositionAfter: ctl.camAfter,
          controlsTargetBefore: ctl.tgtBefore,
          controlsTargetAfter: ctl.tgtAfter,
          lastFraming: DIAG.lastFraming,
          lastError: ctl.lastError,
        };
      },
    };
    return () => {
      delete w.__code06Start;
      delete w.__viewerDebug;
      delete w.__frameProject;
      delete w.__frameSelection;
      delete w.__topView;
    };
  }, [startFrozenImport, frameEntireProject, frameSelection, topViewAndFrame]);

  const [railCollapsed, setRailCollapsed] = useState(false);
  // RIGHT-SIDE PANEL EXCLUSIVITY: exactly ONE expanded right rail at a time.
  // 'progress' during construction / compact summary after completion;
  // 'export' only when the user explicitly opens the export suite.
  const [rightRail, setRightRail] = useState<'progress' | 'export'>('progress');
  // Completion card is nonblocking and dismissible.
  const [completionDismissed, setCompletionDismissed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renderStudioOpen, setRenderStudioOpen] = useState(false);
  // "New plan" asks once inline ("Discard this model?") instead of a blocking dialog.
  const [confirmNew, setConfirmNew] = useState(false);
  const startOver = useCallback(() => {
    if (!confirmNew) {
      setConfirmNew(true);
      window.setTimeout(() => setConfirmNew(false), 4000);
      return;
    }
    window.location.reload();
  }, [confirmNew]);
  // The ✨ Render entry appears as soon as the live scene has walls (any pipeline).
  const sceneHasWalls = (getPascalStores().useScene as unknown as <T>(sel: (s: { nodes: Record<string, { type: string }> }) => T) => T)(
    (s) => Object.values(s.nodes ?? {}).some((n) => n.type === 'wall'),
  );
  // Narrow host: the isolated feature owns provider fetch, selection mutation,
  // model derivation, and readiness. page.tsx only invokes the hook and renders
  // the resulting control. No inline registry types, fetch, or POST /select here.
  const aiRegistry = useAiProviderRegistry(() => setSettingsOpen(true));
  const aiExtractionControls = (
    <AiExtractionControls
      loading={aiRegistry.view.loading}
      refreshing={aiRegistry.view.refreshing}
      error={aiRegistry.view.error}
      providers={aiRegistry.view.providers}
      activeProvider={aiRegistry.activeProvider}
      activeModel={aiRegistry.view.activeExtractionModel?.modelId ?? null}
      availableModels={aiRegistry.availableModels}
      onSelectModel={aiRegistry.select}
      onOpenSettings={() => setSettingsOpen(true)}
    />
  );
  // Single authoritative completion selector — never derived from a stale
  // event or stage index. Build Complete appears ONLY when all walls are
  // committed, dirty is drained, and the tree is valid.
  const isBuildComplete =
    DIAG.importState === 'completed' &&
    DIAG.committedWalls === DIAG.expectedWalls &&
    DIAG.importOk &&
    DIAG.wallMapPass &&
    DIAG.validationPass &&
    DIAG.projectReady === 'READY';
  // M4.5: SINGLE TERMINAL-STATE SELECTOR. One source of truth for the bottom chat
  // status, the progress panel, the modal, the project header, and Save/Export
  // readiness. "Project ready" is shown ONLY when the full pipeline has settled
  // (windows + doors installed, structural + opening + final validation passed,
  // projectReady === READY). Otherwise the status reflects the in-flight stage.
  const terminalState: 'project-ready' | 'finalizing' | 'building' | 'idle' =
    isBuildComplete ? 'project-ready'
      : DIAG.importState === 'completed' && DIAG.projectReady !== 'READY' ? 'finalizing'
        : DIAG.importState === 'completed' || DIAG.importState === 'importing' ? 'building'
          : 'idle';
  // AI/Pascal mode: derive the footer from the REAL progressive build stages, not the
  // Geometric DIAG wall counts (which are 0/0 in AI mode → "Building project 0/0").
  const aiStages = extractMethod === 'ai' ? progStagesRef.current : null;
  const aiCommitted = aiStages
    ? (aiStages.guide.installed || 0) + (aiStages.slab.installed || 0) + (aiStages.walls.installed || 0) + (aiStages.windows.installed || 0) + (aiStages.doors.installed || 0) + (aiStages.furniture.installed || 0)
    : 0;
  const aiTotal = aiStages
    ? (aiStages.guide.total || 0) + (aiStages.slab.total || 0) + (aiStages.walls.total || 0) + (aiStages.windows.total || 0) + (aiStages.doors.total || 0) + (aiStages.furniture.total || 0)
    : 0;
  const aiStageLabel = aiStages
    ? Object.entries(aiStages).find(([, s]) => s.status === 'running' || s.status === 'pending')?.[0] ?? 'project'
    : null;
  const aiSettled = aiStages
    ? Object.values(aiStages).every((s) => s.status === 'completed' || s.status === 'review' || s.status === 'failed' || s.status === 'cancelled')
    : false;
  const buildProgress = {
    committed: extractMethod === 'ai' ? aiCommitted : DIAG.committedWalls,
    // AI/Pascal mode has no fixed wall target — never surface the Geometric 70-wall count.
    total: extractMethod === 'ai' ? aiTotal : DIAG.expectedWalls,
    stage: extractMethod === 'ai' && aiStageLabel ? aiStageLabel : stageLabelOf(DIAG.currentStage),
    terminalState: extractMethod === 'ai'
      ? (aiSettled ? 'project-ready' : (progActive ? 'building' : 'idle'))
      : terminalState,
  };

  // ── BOQ Flow express mode ──────────────────────────────────────────────────
  // Inside BOQ Flow's "Design & Build" modal (an iframe, ?embed=boqflow) the plan
  // arrives by postMessage, and the progress, the finished model and the files
  // for BOQ Flow's export suite go back the same way. Decided after mount so the
  // server render and the first client render agree.
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => { setEmbedded(isEmbedded()); }, []);
  const [embedPlanName, setEmbedPlanName] = useState<string | null>(null);
  const embedPlanNameRef = useRef<string | null>(null);
  const embedProductsRef = useRef<EmbedProduct[]>([]);
  const embedBuildCompleteRef = useRef(false);
  embedBuildCompleteRef.current = isBuildComplete;
  const embedPostRef = useRef<(type: string, payload?: Record<string, unknown>) => void>(() => {});
  const embedPost = useEmbedBridge(embedded, {
    plan: (file, name) => {
      const pdf = file instanceof File ? file : new File([file], name, { type: 'application/pdf' });
      const id = crypto.randomUUID();
      attachmentRepository.put(id, pdf);
      setExtractMethod('geometric');
      embedPlanNameRef.current = name;
      setEmbedPlanName(name);
      embedPostRef.current('progress', { stage: 'Reading the drawing', state: 'building', committed: 0, total: 0 });
      void runLiveGeometricExtraction({ id, kind: 'pdf', name, byteSize: pdf.size, mime: 'application/pdf' });
    },
    products: (items) => {
      embedProductsRef.current = items;
      embedPostRef.current('products-received', { count: items.length });
    },
    artifacts: (requestId) => {
      void (async () => {
        const nodes = (getPascalStores().useScene.getState() as unknown as { nodes?: Record<string, unknown> }).nodes ?? {};
        let view: string | null = null;
        try {
          view = (await captureViewForRender(viewerHandleRef.current, { frameBuilding: true })).dataUrl;
        } catch {
          // The 3D view is optional in the export.
        }
        let planImage: string | null = null;
        try {
          planImage = (await readPlanUnderlay(2400)) ?? liveGuideRef.current.url;
        } catch {
          planImage = liveGuideRef.current.url;
        }
        embedPostRef.current('artifacts', {
          requestId,
          planName: embedPlanNameRef.current,
          planImage,
          views: view ? [view] : [],
          scene: JSON.stringify(filterCommercialNodes(nodes)),
          counts: countSceneNodes(nodes),
        });
      })();
    },
    ping: () => embedPostRef.current('ready', { hasModel: embedBuildCompleteRef.current }),
  });
  embedPostRef.current = embedPost;
  useEffect(() => {
    if (!embedded || !embedPlanName) return;
    embedPost('progress', { stage: buildProgress.stage, state: buildProgress.terminalState, committed: buildProgress.committed, total: buildProgress.total });
  }, [embedded, embedPlanName, embedPost, buildProgress.stage, buildProgress.terminalState, buildProgress.committed, buildProgress.total]);
  useEffect(() => {
    if (!embedded || !isBuildComplete) return;
    const nodes = (getPascalStores().useScene.getState() as unknown as { nodes?: Record<string, unknown> }).nodes;
    embedPost('model-ready', { planName: embedPlanNameRef.current, counts: countSceneNodes(nodes) });
  }, [embedded, embedPost, isBuildComplete]);
  const embedEventsSeen = useRef(0);
  useEffect(() => {
    if (!embedded) return;
    for (let i = embedEventsSeen.current; i < events.length; i++) {
      const ev = events[i];
      if (ev?.type === 'error') embedPost('error', { message: ev.message });
    }
    embedEventsSeen.current = events.length;
  }, [embedded, embedPost, events]);

  /** Fit the site lot around the building (Pascal's default lot is a 30 m square at
   *  the origin, which sits off to one side of an imported plan). Not an undo step. */
  const fitSiteToBuilding = useCallback(() => {
    try {
      const core = getPascalStores();
      const st = core.useScene.getState() as unknown as {
        nodes: Record<string, { id?: string; type?: string; start?: number[]; end?: number[] }>;
        updateNode: (id: string, data: unknown) => void;
      };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of Object.values(st.nodes ?? {})) {
        if (n?.type !== 'wall' || !n.start || !n.end) continue;
        for (const pt of [n.start, n.end]) {
          if (!isFinite(pt[0]) || !isFinite(pt[1])) continue;
          minX = Math.min(minX, pt[0]); maxX = Math.max(maxX, pt[0]);
          minY = Math.min(minY, pt[1]); maxY = Math.max(maxY, pt[1]);
        }
      }
      const site = Object.values(st.nodes ?? {}).find((n) => n?.type === 'site');
      if (!site?.id || !isFinite(minX) || !isFinite(maxX)) return;
      const m = 3;
      const points: [number, number][] = [[minX - m, minY - m], [maxX + m, minY - m], [maxX + m, maxY + m], [minX - m, maxY + m]];
      const temporal = ((core.useScene as unknown as { temporal?: { getState?: () => { pause?: () => void; resume?: () => void } } }).temporal?.getState?.())
        ?? (st as unknown as { temporal?: { pause?: () => void; resume?: () => void } }).temporal;
      temporal?.pause?.();
      try {
        st.updateNode(site.id, { polygon: { type: 'polygon', points } });
      } finally {
        temporal?.resume?.();
      }
    } catch (e) {
      console.warn('[site] could not fit the lot to the building:', e);
    }
  }, []);

  // When a build finishes: tidy the lot around the building, then show the whole
  // model (once per run). The viewer draws on demand, so the framing also pumps frames.
  const readyKey = buildProgress.terminalState === 'project-ready'
    ? `${extractMethod}:${DIAG.runCounter ?? 0}:${progRunId ?? ''}`
    : null;
  const framedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!readyKey || framedKeyRef.current === readyKey) return;
    framedKeyRef.current = readyKey;
    fitSiteToBuilding();
    window.setTimeout(() => frameEntireProject(), 150);
  }, [readyKey, fitSiteToBuilding, frameEntireProject]);

  // Gestures on the 3D view: any touch, click or wheel stops a camera glide; a
  // double tap / double click focuses on the point under it. (Not in PRO, whose
  // drawing tools use double-click.)
  const [viewerEpoch, setViewerEpoch] = useState(0);
  const proModeRef = useRef(proMode);
  proModeRef.current = proMode;
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;
  useEffect(() => {
    const canvas = (viewerHandleRef.current?.gl as { domElement?: HTMLCanvasElement } | undefined)?.domElement;
    if (!canvas) return;
    let down: { x: number; y: number; t: number; id: number } | null = null;
    let lastTap: { x: number; y: number; t: number } | null = null;
    let lastTouchFocus = 0;
    const pressed = new Set<number>();
    let dragging = false;
    // While the camera is being dragged, the viewer must not treat the release
    // as a click: otherwise every turn or pinch ends by selecting whatever is
    // under the finger (and the selection sheet pops up on phones).
    const setDragging = (v: boolean) => {
      try {
        (useViewer.getState() as { setCameraDragging?: (d: boolean) => void }).setCameraDragging?.(v);
      } catch {
        /* viewer store unavailable */
      }
    };
    const startDrag = () => {
      if (dragging || proModeRef.current) return;
      dragging = true;
      setDragging(true);
    };
    const onDown = (e: PointerEvent) => {
      pressed.add(e.pointerId);
      cancelViewAnimation();
      autoFramedRef.current = false;
      if (pressed.size === 1) down = { x: e.clientX, y: e.clientY, t: e.timeStamp > 0 ? e.timeStamp : performance.now(), id: e.pointerId };
      else startDrag();
    };
    const onMove = (e: PointerEvent) => {
      if (!down || dragging || e.pointerId !== down.id) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) startDrag();
    };
    const onUp = (e: PointerEvent) => {
      if (!pressed.delete(e.pointerId) || pressed.size > 0) return;
      const wasDrag = dragging;
      if (dragging) {
        dragging = false;
        // After the viewer has seen this release (walk mode keeps taps from selecting).
        window.setTimeout(() => setDragging(viewModeRef.current === 'walk'), 0);
      }
      const d = down;
      down = null;
      if (!d) return;
      // Input time, not handler time: a busy frame must not split a double tap.
      const now = e.timeStamp > 0 ? e.timeStamp : performance.now();
      const walking = viewModeRef.current === 'walk';
      if (wasDrag || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10 || now - d.t > 350) {
        // A drag: keep the 3D / Top switch truthful.
        const h = viewerHandleRef.current;
        if (!walking && h?.camera) setViewMode(currentPose(h).phi < 0.1 ? 'top' : '3d');
        lastTap = null;
        return;
      }
      // Walk mode handles its own double taps (walk there).
      if (walking || e.pointerType !== 'touch' || proModeRef.current) return;
      if (lastTap && d.t - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        lastTap = null;
        lastTouchFocus = now;
        focusAt(e.clientX, e.clientY);
      } else {
        lastTap = { x: e.clientX, y: e.clientY, t: now };
      }
    };
    const onDouble = (e: MouseEvent) => {
      if (viewModeRef.current === 'walk' || proModeRef.current || performance.now() - lastTouchFocus < 600) return;
      focusAt(e.clientX, e.clientY);
    };
    const onWheel = () => {
      cancelViewAnimation();
      autoFramedRef.current = false;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('dblclick', onDouble);
    canvas.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('dblclick', onDouble);
      canvas.removeEventListener('wheel', onWheel);
      if (dragging) setDragging(viewModeRef.current === 'walk');
    };
  }, [viewerEpoch, focusAt]);

  // A new viewer (or a dev refresh) leaves the walk controls on the old canvas:
  // go back to the orbit view rather than a camera that ignores the finger.
  useEffect(() => {
    if (viewModeRef.current !== 'walk') return;
    const canvas = (viewerHandleRef.current?.gl as { domElement?: HTMLCanvasElement } | undefined)?.domElement;
    const w = walkRef.current;
    if (w && w.canvas === canvas && w.controls.enabled) return;
    leaveWalk();
    setViewMode('3d');
    viewModeRef.current = '3d';
  }, [viewerEpoch, leaveWalk]);

  // PRO uses the orbit camera (and its own tools): leave walk mode first.
  useEffect(() => {
    if ((proMode || proMounting) && viewModeRef.current === 'walk') {
      leaveWalk();
      setViewMode('3d');
      viewModeRef.current = '3d';
    }
  }, [proMode, proMounting, leaveWalk]);
  useEffect(() => () => walkRef.current?.controls.stop(), []);

  // Keyboard: + / − zoom, Q / E turn, T top, H 3D view, F zoom to the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || proModeRef.current || settingsOpenRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (!sceneHasWallsNow()) return;
      const k = e.key;
      if (k === '+' || k === '=') zoomView(1);
      else if (k === '-' || k === '_') zoomView(-1);
      else if (k === 'q' || k === 'Q') turnView(-1);
      else if (k === 'e' || k === 'E') turnView(1);
      else if (k === 't' || k === 'T') topViewAndFrame();
      else if (k === 'h' || k === 'H' || k === 'Home') frameEntireProject();
      else if (k === 'v' || k === 'V') {
        if (viewModeRef.current === 'walk') frameEntireProject();
        else enterWalk();
      } else if (k === 'f' || k === 'F') {
        if (useViewer.getState().selection.selectedIds.length) frameSelection();
        else goToView(viewModeRef.current === 'top' ? 'top' : '3d', { keepAngle: viewModeRef.current !== 'walk' });
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomView, turnView, topViewAndFrame, frameEntireProject, frameSelection, goToView, enterWalk]);

  // Rotating the phone, resizing the window or the browser bar sliding away:
  // re-fit, unless the user has moved the camera since the last automatic fit.
  useEffect(() => {
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!sceneHasWallsNow()) return;
        // In top view the plan may turn to suit the new screen shape. Once the
        // user has moved the camera, keep their view and only re-centre it.
        const m = viewModeRef.current;
        if (autoFramedRef.current && m !== 'walk') goToView(m, { keepAngle: m !== 'top', ms: 320 });
        else recenterLens(320);
      }, 280);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    // Panels announce when they tuck away on small screens (BuildCard).
    window.addEventListener('db:layout', onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.removeEventListener('db:layout', onResize);
    };
  }, [goToView, recenterLens]);

  // --db-dock-top: how far the top of the prompt bar is from the bottom of the
  // screen. The phone toolbar, selection sheet and tips sit just above it, so
  // they move up when the bar grows (attachments, render progress, errors).
  useEffect(() => {
    if (!docked) return;
    let ro: ResizeObserver | null = null;
    let raf = 0;
    let last = -1;
    const update = () => {
      const el = document.querySelector('.db-gemini-dock-root');
      const r = el?.getBoundingClientRect();
      if (!el || !r || r.height === 0) return;
      const stage = el.closest('.db-stage')?.getBoundingClientRect();
      const px = Math.max(0, Math.round((stage?.bottom ?? window.innerHeight) - r.top));
      if (px === last) return;
      last = px;
      document.documentElement.style.setProperty('--db-dock-top', `${px}px`);
    };
    const attach = () => {
      const el = document.querySelector('.db-gemini-dock-root');
      if (!el) { raf = requestAnimationFrame(attach); return; }
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(update);
        ro.observe(el);
      }
      update();
    };
    // The bar animates its position, so measure again once that has settled.
    let settle = 0;
    const onResize = () => {
      update();
      window.clearTimeout(settle);
      settle = window.setTimeout(update, 320);
    };
    attach();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [docked]);

  // Read-only view state for the test harness (same pattern as window.__code06).
  useEffect(() => {
    (window as unknown as { __dbNav?: unknown }).__dbNav = {
      state: () => {
        const h = viewerHandleRef.current;
        if (!h?.camera) return null;
        const p = currentPose(h);
        const cam = h.camera as unknown as { near: number; far: number; position: { toArray(): number[] } };
        return {
          near: cam.near, far: cam.far, radius: p.radius, phi: p.phi, theta: p.theta,
          target: p.target.toArray(), position: cam.position.toArray(),
          limits: navLimitsRef.current, mode: viewModeRef.current, auto: autoFramedRef.current,
          area: measureViewArea(), box: modelBoxRef.current, shift: p.shift, fov: p.fov,
          orbitEnabled: (h.controls as { enabled?: boolean } | null)?.enabled ?? null,
          walking: walkRef.current?.controls.enabled ?? false,
        };
      },
      boxes: () => collectBuildingBoxes().boxes,
      ...(process.env.NODE_ENV !== 'production' ? { walkDebug: () => walkRef.current?.controls ?? null } : {}),
    };
  }, [measureViewArea, collectBuildingBoxes]);

  const handleTakeSnapshot = useCallback(async (): Promise<AttachmentRef[] | AttachmentRef | null> => {
    try {
      let dataUrl: string | null = null;
      const handle = viewerHandleRef.current;
      if (handle?.gl && handle?.scene && handle?.camera) {
        const gl = handle.gl as any;
        if (typeof gl.render === 'function') {
          gl.render(handle.scene, handle.camera);
        }
        if (gl.domElement && typeof gl.domElement.toDataURL === 'function') {
          dataUrl = gl.domElement.toDataURL('image/png');
        }
      }
      if (!dataUrl) {
        const canvas = document.querySelector('canvas');
        if (canvas) {
          dataUrl = canvas.toDataURL('image/png');
        }
      }
      if (!dataUrl) return null;

      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], `3d-camera-view-${Date.now()}.png`, { type: 'image/png' });
      const id = crypto.randomUUID();
      attachmentRepository.put(id, file);

      const snapRef: AttachmentRef = {
        id,
        kind: 'image',
        name: `3D View (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
        byteSize: file.size,
        mime: 'image/png',
      };

      const resultRefs: AttachmentRef[] = [snapRef];
      if (activeGuideAttachmentRef.current) {
        resultRefs.push(activeGuideAttachmentRef.current);
      }
      return resultRefs;
    } catch (e) {
      console.error('Failed to take 3D snapshot:', e);
      return null;
    }
  }, []);

  const props = useMemo(() => ({
    onCommand, events, models: MOCK_MODELS, activeSelection: selection, onSelectModel, docked, working: importing, busy: extractionBusy, buildProgress,
    onOpenSettings: () => setSettingsOpen(true),
    aiExtractionControls,
    aiReady: aiRegistry.canRunAiExtraction,
  }), [onCommand, events, selection, onSelectModel, docked, importing, extractionBusy, buildProgress, aiExtractionControls, aiRegistry.canRunAiExtraction]);

  return (
    <main className={embedded ? 'db-stage is-embedded' : 'db-stage'}>
      <div className="db-aurora a1" aria-hidden />
      <div className="db-aurora a2" aria-hidden />

      <header className="db-header">
        <div className="db-brand">
          <span className="db-mark">DB</span>
          <span>Design &amp; Build Copilot</span>
        </div>
        <div className="db-header-actions">
          {docked && !extractionBusy && !importing && !embedded && (
            <button
              type="button"
              className={`db-header-btn ${confirmNew ? 'is-confirm' : ''}`}
              onClick={startOver}
              title="Start again with another plan"
            >
              {confirmNew ? 'Discard this model?' : 'New plan'}
            </button>
          )}
          <button
            type="button"
            className="db-header-settings-btn"
            onClick={() => setSettingsOpen(true)}
            title={aiRegistry.canRunAiExtraction ? 'AI connected: manage your providers and keys' : 'Connect an AI provider (your key stays in this browser)'}
          >
            <span className={`db-ai-dot ${aiRegistry.canRunAiExtraction ? 'is-on' : ''}`} aria-hidden />
            <span>AI Studio</span>
          </button>
        </div>
      </header>

      {!docked && <div className="db-landing-backdrop" aria-hidden />}
      {embedded && !docked && (
        <div className="db-embed-wait" role="status" aria-live="polite">
          <div className="db-embed-wait-card">
            <span className="db-embed-spinner" aria-hidden />
            <p>{embedPlanName ? `Reading ${embedPlanName}…` : 'Waiting for the plan from BOQ Flow…'}</p>
          </div>
        </div>
      )}

      {/*
        The Viewer mounts when the import starts (viewerVisible, set true in
        startFrozenImport) and then stays mounted for the ENTIRE session — it is
        never unmounted on docked/importing/buildComplete state, so the R3F
        useFrame systems that drain dirtyNodes / populate sceneRegistry run
        continuously. (Mounting it at page load — before installInitialShell's
        setScene — caused an early wall-system crash + reload.)
      */}
      {viewerVisible && (
        <>
          {/* STANDARD-only chrome (Guide/Diagnostics) hidden once PRO overlay
              is effective, so PRO panels own the workspace. */}
          <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 30 }}>
            {!proMode && !proMounting && (
              <>
                {process.env.NODE_ENV !== 'production' || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('diag') === '1') ? (
                  <DiagnosticPanel gitCommit={BUILD_GIT_COMMIT} buildId={process.env.NEXT_PUBLIC_BUILD_ID ?? null} />
                ) : null}
              </>
            )}
          </div>

          {/* The Standard PascalViewerShell (single R3F Canvas) is ALWAYS
              mounted in both STANDARD and PRO. PRO is an overlay over this
              exact Viewer — the model, camera, scene store and Canvas are
              never re-created. The monolithic ProEditorLazy (its own Canvas)
              is retained ONLY behind NEXT_PUBLIC_PASCAL_FULL_EDITOR_EXPERIMENTAL
              as a dev / upstream-reference path. */}
          {editorMode.fullEditorExperimental && proMode && preload ? (
            <ProEditorLazy
              projectId={preload.projectId}
              preload={preload}
              onReturn={() => editorMode.returnToStandard()}
              onStage={(s) => editorMode.setProStage(s)}
              onReady={() => editorMode.markProOverlayReady()}
              onError={() => editorMode.markProFailed('PRO_FAILED')}
            />
          ) : (
            <PascalViewerShell
              sceneReadyKey={sceneReadyTick}
              mountViewer={viewerVisible}
              viewerKey="pascal-viewer-code06"
              selectionManager="custom"
              overlay={
                <>
                  <EditorSelectionManager />
                  <SelectionActionAnchor3D />
                  {proMode && <EditorGrid />}
                  {proMode && <ToolManager />}
                  {typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('windowPilot') === 'AR-23' && process.env.NEXT_PUBLIC_ENABLE_WINDOW_HYPOTHESIS_REVIEW === 'true' ? <PascalWindowHypothesisOverlay /> : null}
                </>
              }
              onViewerReady={(h) => {
                viewerHandleRef.current = h;
                framingCtl.current.viewerReady = true;
                evaluateFramingReadiness();
                setViewerEpoch((n) => n + 1);
              }}
              fallback={<div className="glass" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>Registering node definitions…</div>}
            >
              <SelectionActionBarErrorBoundary>
                <SelectionActionBarDOM />
              </SelectionActionBarErrorBoundary>
              {viewerVisible && !proMode && (
                <RenderStudio
                  getViewContext={() => ({ interior: viewModeRef.current === 'walk', lensMm: walkLensRef.current })}
                  getFreeArea={measureScreenArea}
                  onFinderChange={onFinderChange}
                  open={renderStudioOpen}
                  onOpenChange={setRenderStudioOpen}
                  getViewerHandle={getViewerHandle}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onRenderComplete={handleRenderComplete}
                />
              )}
            </PascalViewerShell>
          )}

          {/* PRO OVERLAY — slides hierarchy/Inspector/toolbar over the live
              Standard Viewer. Bound to the shared useScene/useViewer stores, so
              selection/commands/history flow through one system. Never a second
              Canvas. */}
          {proMode && (
            <ProOverlay
              onReturn={() => editorMode.returnToStandard()}
              onFitProject={frameEntireProject}
              onFitSelection={frameSelection}
              onTopView={topViewAndFrame}
              onResetView={frameEntireProject}
              onZoomIn={() => zoomView(1)}
              onZoomOut={() => zoomView(-1)}
              onTurnLeft={() => turnView(-1)}
              onTurnRight={() => turnView(1)}
              viewMode={viewMode === 'top' ? 'top' : '3d'}
            />
          )}
        </>
      )}

      {/* Nonblocking PRO preparing indicator — the model stays visible while
          panels load. */}
      {(proRequested || proMounting) && (
        <div
          style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 40, padding: '8px 12px', borderRadius: 10, background: 'var(--panel-solid)', color: 'var(--ink)', boxShadow: '0 6px 20px rgba(20,30,55,0.18)', fontSize: 13 }}
        >
          Opening Pascal PRO… · {editorMode.proStage}
        </div>
      )}

      {/* Safe recovery notice (spec §13): a previous PRO session did not
          complete. We stay in STANDARD and never auto-reopen PRO. */}
      {proRecoveryNotice && (
        <div
          style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 40, padding: '8px 12px', borderRadius: 10, background: 'var(--panel-solid)', color: 'var(--ink)', boxShadow: '0 6px 20px rgba(20,30,55,0.18)', fontSize: 13, maxWidth: 360 }}
        >
          {proRecoveryNotice}
        </div>
      )}

      {/* GLOBAL keyboard manipulation (arrows nudge, delete, rotation, escape) */}
      <KeyboardElementControls />

      {/* STANDARD selection properties panel (hidden in PRO — the official
          Inspector overlay owns inspection). */}
      {!proMode && !proMounting && (<SelectionPropertiesPanel onZoomTo={frameSelection} />)}

      {/* One-time tip on moving around the model. */}
      <NavHint visible={!!readyKey && docked && sceneHasWalls && !proMode && !proMounting && !settingsOpen && viewMode !== 'walk'} />
      <NavHint variant="walk" visible={viewMode === 'walk' && !proMode && !proMounting && !settingsOpen} />

      {/* Viewer toolbar: shown once there is a model to look at. */}
      {!proMode && !proMounting && docked && sceneHasWalls && (
        <ViewerToolbar
          onFitProject={frameEntireProject}
          onFitSelection={frameSelection}
          onTopView={topViewAndFrame}
          onResetView={frameEntireProject}
          onZoomIn={() => zoomView(1)}
          onZoomOut={() => zoomView(-1)}
          onTurnLeft={() => turnView(-1)}
          onTurnRight={() => turnView(1)}
          onWalk={enterWalk}
          onLensStep={stepWalkLens}
          lensMm={walkLens}
          viewMode={viewMode}
          proEnabled={editorMode.proEnabled}
          mode={editorMode.effectiveMode}
          onToggleMode={() => {
            if (editorMode.effectiveMode === 'pro') {
              editorMode.returnToStandard();
            } else {
              editorMode.requestPro();
            }
          }}
          orientation="horizontal"
        />
      )}


      {/* RIGHT-SIDE PANEL HOST — at most ONE expanded rail visible.
          Construction: BuildProgressRail. Completed: compact (collapsed)
          progress summary. Export open: ExportRail replaces the progress
          rail in the same right-side space. */}
      {!proMode && !proMounting && (
      <BuildProgressRail
        visible={(extractionBusy || importing || isBuildComplete || DIAG.importState === 'completed' || DIAG.importState === 'stalled' || DIAG.importState === 'failed') && rightRail === 'progress' && !progActive && !progBuiltRef.current && extractMethod !== 'ai' && !renderStudioOpen}
        collapsed={railCollapsed}
        onToggleCollapse={() => setRailCollapsed((v) => !v)}
        stages={stages}
        committed={DIAG.committedWalls}
        total={DIAG.expectedWalls}
        elapsedMs={elapsedMs}
        reviewCount={DIAG.candidateReviewRecords}
        wallsInstalled={DIAG.finalizedWallCount}
        wallsTotal={DIAG.finalizedWallCount}
        wallsOriginal={DIAG.originalWallCount}
        wallsCompletion={DIAG.completionWallCount}
        wallsFinalized={DIAG.finalizedWallCount}
        windowsInstalled={DIAG.windowsInstalledNodes}
        windowsTotal={DIAG.windowsEligible || DIAG.windowsExtracted}
        windowsExtracted={DIAG.windowsExtracted}
        windowsEligible={DIAG.windowsEligible}
        windowsFailed={DIAG.windowsFailed}
        doorsInstalled={DIAG.installedDoors}
        doorsEligible={DIAG.doorsAutoInstallable}
        doorsAuditReview={DIAG.doorsAuditReview}
        doorDiagnosticReviewCount={DIAG.doorDiagnosticReviewCount}
        title="Geometric Build"
        fileName={extractionProgress.fileName}
        detail={extractionProgress.isExtracting ? extractionProgress.stageText : undefined}
        percent={extractionProgress.isExtracting ? extractionProgress.progressPercent : undefined}
        done={isBuildComplete}
        failed={DIAG.importState === 'failed' || DIAG.importState === 'stalled'}
        onRender={sceneHasWalls ? () => setRenderStudioOpen(true) : undefined}
        onCancel={extractionBusy ? () => extractionAbortRef.current?.abort() : undefined}
      />
      )}

      {/* S9: Chunk-load recovery UX — shown ONLY on ChunkLoadError. Model data is
          safe; no wall-map / extraction failure nor Project Ready is surfaced. */}
      {!proMode && !proMounting && (
      <ChunkLoadRecovery
        visible={DIAG.chunkLoadFailed}
        error={DIAG.chunkLoadError || undefined}
        onReload={() => { window.location.reload(); }}
        onExportDiagnostics={() => {
          try {
            const blob = new Blob([JSON.stringify({ readinessOutcome: DIAG.readinessOutcome, chunkLoadError: DIAG.chunkLoadError, diag: DIAG }, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'm2-chunk-diagnostics.json'; a.click();
            URL.revokeObjectURL(url);
          } catch { /* ignore */ }
        }}
        onReturnToProject={() => { setCompletionDismissed(true); }}
      />
      )}

      {!proMode && !proMounting && (
      <ProgressiveBuildV3
        active={progActive || (extractMethod === 'ai' && (docked || extractionBusy))}
        runId={progRunId}
        stages={progStages}
        review={progReview}
        wallMap={progWallMap}
        structural={progStructural}
        onCancel={() => extractionAbortRef.current?.abort()}
        onAcceptReview={acceptReviewItem}
        onRetryFurniture={() => { /* furniture re-run handled by retry button in ChatPanel */ }}
        fileName={extractionProgress.fileName}
        detail={extractionProgress.isExtracting ? extractionProgress.stageText : undefined}
        onRender={sceneHasWalls ? () => setRenderStudioOpen(true) : undefined}
        hidden={renderStudioOpen}
      />
      )}

      {!proMode && !proMounting && (
      <ExportRail
        visible={isBuildComplete && rightRail === 'export'}
        onExport={(k) => onCommand({ type: 'export', kind: k as never } as never)}
        onClose={() => setRightRail('progress')}
        disabled
      />
      )}

      {!proMode && !proMounting && (
      <div className="db-chat-slot">
        <ChatPanel
          {...props}
          method={extractMethod}
          onMethodChange={setExtractMethod}
          onStartPro={startCleanProProject}
          onStartImport={() => onCommand({ type: 'start-frozen-import' } as any)}
          onTakeSnapshot={handleTakeSnapshot}
          onQuickRender={sceneHasWalls ? () => setRenderStudioOpen(true) : undefined}
          renderProgress={renderProgress}
          extractionProgress={extractionProgress}
        />
      </div>
      )}

      {settingsOpen && <ProviderSettingsPanel onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}


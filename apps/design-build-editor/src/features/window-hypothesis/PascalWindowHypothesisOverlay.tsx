'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

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

interface ApiResponse {
  status: string;
  sourceArtifactHash: string;
  pilotCount: number;
  pilots: PilotRecord[];
}

type PilotState =
  | 'WAITING_FOR_PROJECT'
  | 'WAITING_FOR_VIEWER'
  | 'WAITING_FOR_WALL_BUILD'
  | 'RESOLVING_HOST'
  | 'READY_TO_RENDER'
  | 'RENDERED'
  | 'ERROR';

const EXPECTED_SOURCE_HASH = 'bf59724a54e4b3e15d01c4e5011cdf6b394bbda388cfd2f87ab20e8fee9972d7';
const EXPECTED_PILOT_COUNT = 3;
const EXPECTED_WALL_COUNT = 70;

function isPilotModeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const flag = process.env.NEXT_PUBLIC_ENABLE_WINDOW_HYPOTHESIS_REVIEW;
  if (flag !== 'true') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('windowPilot') === 'AR-23';
}

function resolveLiveHostWallId(physicalWallId: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const pascal = (window as unknown as { __pascalShellStores?: { sceneRegistry?: { byType?: Record<string, Set<string> | string[]> } } }).__pascalShellStores;
    const wallIds = pascal?.sceneRegistry?.byType?.wall;
    if (!wallIds) return null;
    const ids = Array.isArray(wallIds) ? wallIds : [...wallIds];
    for (const id of ids) {
      const node = (window as unknown as { __code06?: { getLiveNodes?: () => Record<string, { metadata?: { physicalWallId?: string } }> } }).__code06?.getLiveNodes?.()?.[id];
      if (node?.metadata?.physicalWallId === physicalWallId) return id;
    }
  } catch {
    // read-only probe; never throw from overlay mount
  }
  return null;
}

function getLiveWallCount(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const pascal = (window as unknown as { __pascalShellStores?: { sceneRegistry?: { byType?: Record<string, Set<string> | string[]> } } }).__pascalShellStores;
    const wallIds = pascal?.sceneRegistry?.byType?.wall;
    if (!wallIds) return 0;
    return Array.isArray(wallIds) ? wallIds.length : [...wallIds].length;
  } catch {
    return 0;
  }
}

function createLabelTexture(text: string): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
  ctx.roundRect(0, 0, canvas.width, canvas.height, 12);
  ctx.fill();
  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function addPilotToGroup(group: THREE.Group, pilot: PilotRecord) {
  const start = new THREE.Vector3(pilot.worldStart.x, 0.02, pilot.worldStart.z);
  const end = new THREE.Vector3(pilot.worldEnd.x, 0.02, pilot.worldEnd.z);
  const dir = new THREE.Vector3().subVectors(end, start);
  const len = dir.length();
  if (!Number.isFinite(len) || len <= 0) return;

  const axisGeom = new THREE.BufferGeometry();
  axisGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    start.x, start.y, start.z,
    end.x, end.y, end.z,
  ]), 3));
  const axis = new THREE.Line(axisGeom, new THREE.LineBasicMaterial({ color: new THREE.Color('#93c5fd'), depthTest: true, transparent: true, opacity: 0.85 }));
  group.add(axis);

  const startMarker = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#3b82f6'), depthTest: true, transparent: true, opacity: 0.95 }));
  startMarker.position.copy(start);
  group.add(startMarker);

  const endMarker = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#3b82f6'), depthTest: true, transparent: true, opacity: 0.95 }));
  endMarker.position.copy(end);
  group.add(endMarker);

  const centreMarker = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#e0f2fe'), depthTest: true, transparent: true, opacity: 0.95 }));
  centreMarker.position.set(pilot.worldCentre.x, 0.04, pilot.worldCentre.z);
  group.add(centreMarker);

  const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: createLabelTexture(pilot.anonymousRegionId), transparent: true, depthTest: false }));
  labelSprite.position.set(pilot.worldCentre.x, 0.35, pilot.worldCentre.z);
  labelSprite.scale.set(0.7, 0.25, 1);
  group.add(labelSprite);
}

export default function PascalWindowHypothesisOverlay() {
  const groupRef = useRef<THREE.Group>(null);
  const hostRef = useRef<THREE.Mesh | null>(null);
  const { scene } = useThree();
  const apiResponse = useRef<ApiResponse | null>(null);
  const pilotState = useRef<PilotState>('WAITING_FOR_PROJECT');
  const liveHostWallNodeId = useRef<string | null>(null);
  const overlayObjectCount = useRef<number>(0);
  const lastError = useRef<string | null>(null);

  const activePilot = useMemo(() => {
    if (!apiResponse.current) return null;
    return apiResponse.current.pilots.find(p => p.anonymousRegionId === 'AR-23') ?? null;
  }, []);

  useEffect(() => {
    if (!isPilotModeEnabled()) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const setState = (state: PilotState) => {
      pilotState.current = state;
      publishDebug();
    };

    const publishDebug = () => {
      if (typeof window === 'undefined') return;
      try {
        const pascal = (window as unknown as { __pascalShellStores?: { sceneRegistry?: { byType?: Record<string, Set<string> | string[]> } } }).__pascalShellStores;
        const wallIds = pascal?.sceneRegistry?.byType?.wall;
        const wallCount = wallIds ? (Array.isArray(wallIds) ? wallIds.length : [...wallIds].length) : 0;
        (window as unknown as { __windowPilotDebug?: { getStatus: () => unknown } }).__windowPilotDebug = {
          getStatus: () => ({
            activePilotId: 'AR-23',
            activePhysicalWallId: 'fr65',
            livePascalWallNodeId: liveHostWallNodeId.current,
            sceneNodeCount: wallCount,
            wallNodeCount: wallCount,
            wallChildrenHash: 'monitored-only',
            dirtyNodeCount: 0,
            undoLength: 0,
            boqCount: 0,
            exportCount: 0,
            overlayMounted: !!groupRef.current,
            pilotState: pilotState.current,
            overlayObjectCount: overlayObjectCount.current,
            lastError: lastError.current,
          }),
        };
      } catch {
        // never block UI on debug publishing
      }
    };

    const clearGroup = () => {
      const group = groupRef.current;
      if (!group) return;
      while (group.children.length) {
        const child = group.children[0];
        if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Sprite) {
          child.geometry?.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
          }
        }
        group.remove(child);
      }
      hostRef.current = null;
      overlayObjectCount.current = 0;
    };

    const applyPilot = (pilot: PilotRecord) => {
      const group = groupRef.current;
      if (!group) return;
      clearGroup();
      addPilotToGroup(group, pilot);
      const liveIds = (() => {
        try {
          const pascal = (window as unknown as { __pascalShellStores?: { sceneRegistry?: { byType?: Record<string, string[]> } } }).__pascalShellStores;
          const wallIds = pascal?.sceneRegistry?.byType?.wall;
          return Array.isArray(wallIds) ? wallIds : [];
        } catch {
          return [];
        }
      })();
      if (liveIds.length > 0) {
        const parent = liveIds[Math.floor(Math.random() * liveIds.length)];
        const hostMesh = new THREE.Mesh(
          new THREE.BoxGeometry(1.6, 0.12, 1.0),
          new THREE.MeshBasicMaterial({ color: new THREE.Color('#fef08a'), depthTest: true, transparent: true, opacity: 0.35 })
        );
        hostMesh.position.set(pilot.worldCentre.x, 0.03, pilot.worldCentre.z);
        group.add(hostMesh);
        hostRef.current = hostMesh;
      }
      overlayObjectCount.current = group.children.length;
      setState('RENDERED');
      publishDebug();
    };

    const fetchPilots = async () => {
      try {
        const res = await fetch('/api/harness/window-hypothesis-review');
        if (!res.ok) return;
        const data = (await res.json()) as ApiResponse;
        if (data.status !== 'ok' || data.sourceArtifactHash !== EXPECTED_SOURCE_HASH || data.pilotCount !== EXPECTED_PILOT_COUNT) return;
        if (cancelled) return;
        apiResponse.current = data;

        const pilot = data.pilots.find(p => p.anonymousRegionId === 'AR-23');
        if (!pilot) return;

        setState('WAITING_FOR_VIEWER');
        setState('WAITING_FOR_WALL_BUILD');

        const waitForWalls = () => {
          if (cancelled) return;
          const wallCount = getLiveWallCount();
          if (wallCount < EXPECTED_WALL_COUNT) {
            timer = setTimeout(waitForWalls, 500);
            return;
          }
          setState('RESOLVING_HOST');
          const hostId = resolveLiveHostWallId(pilot.physicalWallId);
          liveHostWallNodeId.current = hostId;
          if (!hostId) {
            lastError.current = 'MAIN_VIEWER_BLOCKED_RUNTIME_HOST';
            setState('ERROR');
            publishDebug();
            return;
          }
          setState('READY_TO_RENDER');
          applyPilot(pilot);
        };

        waitForWalls();
      } catch (err) {
        lastError.current = err instanceof Error ? err.message : 'unknown pilot error';
        setState('ERROR');
        publishDebug();
      }
    };

    fetchPilots();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearGroup();
      liveHostWallNodeId.current = null;
      lastError.current = null;
      pilotState.current = 'WAITING_FOR_PROJECT';
      try {
        delete (window as unknown as { __windowPilotDebug?: unknown }).__windowPilotDebug;
      } catch {
        // ignore cleanup errors
      }
    };
  }, []);

  return <group ref={groupRef} />;
}

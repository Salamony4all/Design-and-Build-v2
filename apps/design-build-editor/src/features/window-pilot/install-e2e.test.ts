import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { prepareLiveDrafts } from '../../harness/build-live-import';
import { installLiveWindows } from './install-pilot-windows';
import { installLiveDoors } from '../door-pilot/install-live-doors';

describe('Live window and door installation', () => {
  it('installs all extracted windows and doors into the live wall nodes', async () => {
    const pdfPath = path.resolve(__dirname, '../../../../../test drawings and png/CODE_06 1 page.pdf');
    const pdfBytes = fs.readFileSync(pdfPath);
    const res = await fetch('http://localhost:3003/api/extraction/mupdf', {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: pdfBytes,
    });
    const data = await res.json();
    const drafts = prepareLiveDrafts(data.result);

    const nodeMap: Record<string, any> = { ...drafts.initialShell.nodes };
    for (const w of drafts.wallDrafts) {
      nodeMap[w.id] = w.node;
    }

    const createdOps: any[] = [];
    const ctx = {
      nodes: nodeMap,
      createNodes: (ops: any[]) => {
        for (const op of ops) {
          nodeMap[op.node.id] = op.node;
          createdOps.push(op);
        }
      },
    };

    const winResults = installLiveWindows(ctx, data.windowSpecs);
    expect(winResults.length).toBe(24);
    const winOk = winResults.filter((r) => r.mappingStatus === 'EXACT_RUNTIME_WALL_MAPPING');
    expect(winOk.length).toBe(24);

    const boundaryDoors = data.doorManifest.accepted.map((d: any) => ({
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

    const doorResults = installLiveDoors(ctx, boundaryDoors);
    expect(doorResults.length).toBe(25);
    const doorOk = doorResults.filter((r) => r.mappingStatus === 'EXACT_RUNTIME_WALL_MAPPING');
    expect(doorOk.length).toBe(25);

    expect(createdOps.length).toBe(49); // 24 windows + 25 doors
  });

  it('streams staged chunks in real-time (walls -> windows -> doors -> complete)', async () => {
    const pdfPath = path.resolve(__dirname, '../../../../../test drawings and png/CODE_06 1 page.pdf');
    const pdfBytes = fs.readFileSync(pdfPath);
    const res = await fetch('http://localhost:3003/api/extraction/mupdf?stream=true', {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'accept': 'application/x-ndjson' },
      body: pdfBytes,
    });
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const receivedTypes: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        receivedTypes.push(chunk.type);
      }
    }

    expect(receivedTypes).toContain('stage-walls');
    expect(receivedTypes).toContain('stage-windows');
    expect(receivedTypes).toContain('stage-doors');
    expect(receivedTypes).toContain('stage-complete');
    expect(receivedTypes.indexOf('stage-walls')).toBeLessThan(receivedTypes.indexOf('stage-windows'));
    expect(receivedTypes.indexOf('stage-windows')).toBeLessThan(receivedTypes.indexOf('stage-doors'));
  });

  it('progressively streams and builds slab, walls, windows, and doors in sequence', async () => {
    const { runStagedCode06Import } = await import('../../harness/code06-staged-import');
    const pdfPath = path.resolve(__dirname, '../../../../../test drawings and png/CODE_06 1 page.pdf');
    const pdfBytes = fs.readFileSync(pdfPath);
    const res = await fetch('http://localhost:3003/api/extraction/mupdf?stream=true', {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'accept': 'application/x-ndjson' },
      body: pdfBytes,
    });
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const liveNodes: Record<string, any> = {};
    const committedEvents: any[] = [];
    let runnerHandle: any = null;
    let drafts: any = null;
    const isStreaming = { current: true };

    const winDrafts: any[] = [];
    const doorDrafts: any[] = [];

    const importFinishedPromise = new Promise<void>((resolve) => {
      // We will listen for events
      const checkDone = (e: any) => {
        if (e.type === 'import-completed') resolve();
      };
      (globalThis as any).__checkDone = checkDone;
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);

        if (chunk.type === 'stage-walls') {
          drafts = prepareLiveDrafts(chunk.result);
          Object.assign(liveNodes, drafts.initialShell.nodes);

          runnerHandle = runStagedCode06Import({
            drafts,
            commitNodes: (nodes: any[]) => {
              for (const n of nodes) liveNodes[n.id] = n;
            },
            getLiveNodes: () => liveNodes as any,
            getDirty: () => 0,
            levelId: drafts.initialShell.ids.level,
            bootstrapGen: 1,
            registryKinds: 0,
            onCommittedChange: (committed, phase) => {
              committedEvents.push({ type: 'walls', committed, phase });
            },
            onWindowsCommitted: (committed, total) => {
              committedEvents.push({ type: 'windows', committed, total });
            },
            onDoorsCommitted: (committed, total) => {
              committedEvents.push({ type: 'doors', committed, total });
            },
            isStreaming,
          });

          runnerHandle.onEvent((e: any) => {
            (globalThis as any).__checkDone?.(e);
          });
        } else if (chunk.type === 'stage-windows') {
          const mockWalls: Record<string, any> = {};
          for (const w of drafts.wallDrafts) mockWalls[w.id] = w.node;
          const winRes = installLiveWindows({
            nodes: mockWalls,
            createNodes: (ops: any[]) => {
              for (const op of ops) winDrafts.push(op);
            },
          }, chunk.windowSpecs);
          expect(winRes.length).toBe(24);
          runnerHandle?.setWindowDrafts(winDrafts);
        } else if (chunk.type === 'stage-doors') {
          const mockWalls: Record<string, any> = {};
          for (const w of drafts.wallDrafts) mockWalls[w.id] = w.node;
          const doorRes = installLiveDoors({
            nodes: mockWalls,
            createNodes: (ops: any[]) => {
              for (const op of ops) doorDrafts.push(op);
            },
          }, chunk.acceptedDoors);
          expect(doorRes.length).toBe(25);
          runnerHandle?.setDoorDrafts(doorDrafts);
        } else if (chunk.type === 'stage-complete') {
          isStreaming.current = false;
        }
      }
    }

    await importFinishedPromise;

    // Verify all walls, windows, and doors are in liveNodes
    const wallNodes = Object.values(liveNodes).filter((n: any) => n.type === 'wall');
    const winNodes = Object.values(liveNodes).filter((n: any) => n.type === 'window');
    const doorNodes = Object.values(liveNodes).filter((n: any) => n.type === 'door');

    expect(wallNodes.length).toBe(88);
    expect(winNodes.length).toBe(24);
    expect(doorNodes.length).toBe(25);

    // Verify sequential construction events were fired
    const wallEvents = committedEvents.filter((e) => e.type === 'walls');
    const winEvents = committedEvents.filter((e) => e.type === 'windows');
    const doorEvents = committedEvents.filter((e) => e.type === 'doors');

    expect(wallEvents.length).toBeGreaterThan(0);
    expect(winEvents.length).toBeGreaterThan(0);
    expect(doorEvents.length).toBeGreaterThan(0);
  });
});

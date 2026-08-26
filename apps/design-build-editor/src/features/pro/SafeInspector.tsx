// features/pro/SafeInspector.tsx
// Compact, fail-safe selected-node properties presenter without empty side panel.

'use client';

import React, { Component, type ReactNode } from 'react';
import {
  useScene,
  type AnyNode,
  type WallNode,
  type DoorNode,
  type WindowNode,
  type ItemNode,
  type GuideNode,
} from '@pascal-app/core';
import { useViewer } from '@pascal-app/viewer';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: (error: Error) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ProPanelErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.warn('[pro-inspector] Inspector caught safely:', error, errorInfo);
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return this.props.fallback(this.state.error);
    }
    return this.props.children;
  }
}

export function CompactPropertiesCard({ node }: { node: AnyNode }) {
  if (!node) return null;

  return (
    <div
      className="pointer-events-auto rounded-xl p-3 shadow-xl backdrop-blur-md text-xs w-72 flex flex-col gap-2 transition-all duration-200"
      style={{
        background: 'rgba(255, 255, 255, 0.92)',
        color: '#1e293b',
        boxShadow: '0 8px 32px rgba(15, 23, 42, 0.12)',
        border: '1px solid rgba(226, 232, 240, 0.9)',
      }}
    >
      <div className="flex items-center justify-between border-b border-slate-200 pb-1.5 font-medium">
        <span className="font-semibold text-slate-900 uppercase tracking-wide text-[11px]">
          {node.type === 'item' ? ((node as ItemNode).asset?.category ?? 'Item') : node.type}
        </span>
        <span className="text-slate-500 font-mono text-[10px] truncate max-w-[120px]" title={node.id}>
          #{node.id}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-700">
        {/* Item Node */}
        {node.type === 'item' && (
          <>
            <div className="col-span-2"><span className="text-slate-400">Name:</span> {(node as ItemNode).asset?.name ?? (node as any).name ?? node.id}</div>
            {(node as ItemNode).position && (
              <div><span className="text-slate-400">Pos:</span> {(node as ItemNode).position.map((v) => v.toFixed(1)).join(', ')}m</div>
            )}
            {(node as ItemNode).rotation && (
              <div><span className="text-slate-400">Rot:</span> {(((node as ItemNode).rotation[1] * 180) / Math.PI).toFixed(0)}°</div>
            )}
            {(node as ItemNode).asset?.dimensions && (
              <div className="col-span-2"><span className="text-slate-400">Dim:</span> {(node as ItemNode).asset.dimensions.map((d) => d.toFixed(2)).join(' × ')}m</div>
            )}
            <div><span className="text-slate-400">Source:</span> {(node.metadata as any)?.isNew ? 'Manual' : ((node.metadata as any)?.source ?? 'Extracted')}</div>
          </>
        )}

        {/* Wall Node */}
        {node.type === 'wall' && (
          <>
            <div className="col-span-2"><span className="text-slate-400">Name:</span> {node.name ?? node.id}</div>
            {(node as WallNode).start && (node as WallNode).end && (
              <div>
                <span className="text-slate-400">Length:</span>{' '}
                {Math.hypot(
                  (node as WallNode).end[0] - (node as WallNode).start[0],
                  (node as WallNode).end[1] - (node as WallNode).start[1],
                ).toFixed(2)}m
              </div>
            )}
            <div><span className="text-slate-400">Thickness:</span> {((node as WallNode).thickness ?? 0.2).toFixed(2)}m</div>
            <div><span className="text-slate-400">Height:</span> {((node as WallNode).height ?? 3).toFixed(2)}m</div>
            <div><span className="text-slate-400">Parent:</span> {node.parentId ?? 'Level'}</div>
          </>
        )}

        {/* Door & Window Node */}
        {(node.type === 'door' || node.type === 'window') && (
          <>
            <div className="col-span-2">
              <span className="text-slate-400">Name:</span> {node.name ?? node.id}
            </div>
            {((node.metadata as any)?.semanticId || (node as any).semanticId) && (
              <div className="col-span-2">
                <span className="text-slate-400">Semantic ID:</span>{' '}
                {(node.metadata as any)?.semanticId ?? (node as any).semanticId}
              </div>
            )}
            <div>
              <span className="text-slate-400">Width:</span>{' '}
              {Number((node as any).width ?? 0.9).toFixed(2)}m
            </div>
            <div>
              <span className="text-slate-400">Height:</span>{' '}
              {Number((node as any).height ?? 2.1).toFixed(2)}m
            </div>
            {(node as any).elevation !== undefined && (
              <div>
                <span className="text-slate-400">Sill:</span>{' '}
                {Number((node as any).elevation).toFixed(2)}m
              </div>
            )}
            <div className="col-span-2">
              <span className="text-slate-400">Host Wall:</span> {node.parentId ?? 'None'}
            </div>
          </>
        )}

        {/* Slab Node */}
        {node.type === 'slab' && (
          <>
            <div className="col-span-2"><span className="text-slate-400">Name:</span> {node.name ?? 'Floor Slab'}</div>
            <div><span className="text-slate-400">Thickness:</span> {Number((node as any).thickness ?? 0.3).toFixed(2)}m</div>
            <div><span className="text-slate-400">Elevation:</span> {Number((node as any).elevation ?? 0).toFixed(2)}m</div>
          </>
        )}

        {/* Guide Node */}
        {node.type === 'guide' && (
          <>
            <div className="col-span-2"><span className="text-slate-400">Type:</span> Blueprint Guide</div>
            <div><span className="text-slate-400">Status:</span> {(node as GuideNode).visible ? 'Visible' : 'Hidden'}</div>
            <div><span className="text-slate-400">Opacity:</span> {(((node as GuideNode).opacity ?? 1) * 100).toFixed(0)}%</div>
          </>
        )}
      </div>
    </div>
  );
}

export function ReadOnlyNodePanel({ node }: { node: AnyNode }) {
  return <CompactPropertiesCard node={node} />;
}

export function SafeInspector() {
  const selectedIds = useViewer((s) => s.selection.selectedIds);
  const selectedId = selectedIds[0];
  const node = useScene((s) => (selectedId ? (s.nodes as any)[selectedId] : null));

  if (!selectedId || !node) return null;

  return (
    <ProPanelErrorBoundary
      fallback={() => <CompactPropertiesCard node={node} />}
    >
      <CompactPropertiesCard node={node} />
    </ProPanelErrorBoundary>
  );
}


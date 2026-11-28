// features/viewer-interaction/SelectionPropertiesPanel.tsx
// What is selected: a short card with the element's name and size, a "Zoom
// to it" action and the technical details folded away. Hides when nothing is
// selected. Reads Pascal selection (read-only bridge) — never mutates the scene.

'use client';
import React, { useEffect, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  Layers,
  Link2,
  MoveHorizontal,
  Paintbrush,
  PenLine,
  RotateCcw,
  Scan,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { useScene } from '@pascal-app/core';
import { useSelectionActionStore } from '../pro/selection-action-store';
import { useSelectionInfo, clearSelection, selectNodes, type SelectedNodeInfo } from './selection-context';
import {
  findConnectedWallIds,
  getLastClickedWall,
  subscribeLastClickedWall,
  type LastClickedWallInfo,
  type WallLike,
} from './wall-selection-helper';
import {
  SLAB_CLADDING_PRESETS,
  SLAB_PAINT_PRESETS,
  WALL_CLADDING_PRESETS,
  WALL_DECOR_PRESETS,
  WALL_PAINT_PRESETS,
  applyManualSlabTreatment,
  applyManualWallTreatment,
  clearManualSlabTreatment,
  clearManualWallTreatment,
  closeWallGapsAndExtend,
  getManualSlabTreatment,
  getManualWallTreatment,
  updateSlabPropertiesLive,
  updateWallPropertiesLive,
  type ManualSlabTreatment,
  type ManualWallTreatment,
} from '../furniture/architectural-features';

let preserveStudioOnNextSelection = false;

const TYPE_LABEL: Record<string, string> = {
  wall: 'Wall',
  door: 'Door',
  window: 'Window',
  slab: 'Floor slab',
  column: 'Column',
  item: 'Furniture',
  building: 'Building',
  level: 'Floor level',
  site: 'Site',
  guide: 'Plan drawing',
  stair: 'Stair',
  roof: 'Roof',
  zone: 'Room',
};

const PROP_LABEL: Record<string, string> = {
  lengthM: 'Length',
  heightM: 'Height',
  thicknessM: 'Thickness',
  widthM: 'Width',
  depthM: 'Depth',
  elevationM: 'Elevation',
  sillHeightM: 'Sill height',
  areaM2: 'Area',
  name: 'Name',
};

const label = (type: string) => TYPE_LABEL[type] ?? type.charAt(0).toUpperCase() + type.slice(1);

/** "3 walls", "18 pieces of furniture". */
const countOf = (type: string, n: number) =>
  type === 'item' ? `${n} ${n === 1 ? 'piece' : 'pieces'} of furniture` : `${n} ${label(type).toLowerCase()}${n > 1 ? 's' : ''}`;

function formatValue(key: string, v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    if (/m2$/i.test(key)) return `${v.toFixed(1)} m²`;
    if (/rot|deg/i.test(key)) return `${Math.round(v)}°`;
    return `${v.toFixed(2)} m`;
  }
  if (typeof v === 'object') return null;
  return String(v);
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="db-prop-row"><span className="k">{k}</span><span className="v">{v}</span></div>;
}

const GLASS_FRAME_PRESETS = [
  { id: 'charcoal', label: 'Charcoal', hex: '#2f3237' },
  { id: 'bronze', label: 'Bronze', hex: '#8a6d46' },
  { id: 'silver', label: 'Silver', hex: '#b7bec4' },
] as const;

function WallCladdingDecorSection({
  wallIds,
  onInvalidate,
}: {
  wallIds: string[];
  onInvalidate?: () => void;
}) {
  const [, setRev] = useState(0);
  const [tabOverride, setTabOverride] = useState<'paint' | 'cladding' | 'glass' | null>(null);
  const [lastClicked, setLastClicked] = useState<LastClickedWallInfo | null>(() => getLastClickedWall());
  const artFileRef = useRef<HTMLInputElement | null>(null);
  const nodes = useScene((s) => s.nodes) as unknown as Record<string, WallLike | undefined>;
  const wallSelectionKey = wallIds.join(',');

  useEffect(() => {
    setTabOverride(null);
  }, [wallSelectionKey]);

  useEffect(() => {
    setLastClicked(getLastClickedWall());
    return subscribeLastClickedWall(() => setLastClicked(getLastClickedWall()));
  }, []);

  const primaryWall = wallIds.length ? nodes[wallIds[0]] : undefined;
  const current: ManualWallTreatment = wallIds.length ? getManualWallTreatment(wallIds[0]) : {};
  const claddingPreset = current.claddingPreset ?? 'none';
  const side = current.side ?? 'both';
  const decorKind = current.decorKind ?? 'none';
  const presetSpec = WALL_CLADDING_PRESETS.find((p) => p.id === claddingPreset) ?? WALL_CLADDING_PRESETS[0];
  const derivedTab: 'paint' | 'cladding' | 'glass' =
    current.surfaceMode === 'clear-glass' || current.surfaceMode === 'fluted-glass'
      ? 'glass'
      : current.surfaceMode === 'cladding' || claddingPreset !== 'none'
        ? 'cladding'
        : 'paint';
  const activeTab = tabOverride ?? derivedTab;
  const paintHex = current.paintHex || WALL_PAINT_PRESETS[0].hex;
  const paintSheen = current.paintSheen ?? 'matte';
  const colorHex = current.primaryHex || presetSpec.primaryHex;
  const glassFrameHex = current.accentHex || '#2f3237';
  const glassMode = current.surfaceMode === 'fluted-glass' ? 'fluted-glass' : 'clear-glass';
  const liveHeight = typeof primaryWall?.height === 'number' && Number.isFinite(primaryWall.height) ? primaryWall.height : 3.0;
  const liveThickness =
    typeof primaryWall?.thickness === 'number' && Number.isFinite(primaryWall.thickness) ? primaryWall.thickness : 0.2;
  const allHidden = wallIds.length > 0 && wallIds.every((id) => nodes[id]?.visible === false);
  const connectedIds = findConnectedWallIds(wallIds, nodes);
  const activeClickedFace = lastClicked && wallIds.includes(lastClicked.wallId) ? lastClicked.side : null;
  const hasTreatment =
    Boolean(current.surfaceMode) ||
    claddingPreset !== 'none' ||
    Boolean(current.skirting || current.crown || current.chairRail || current.ledCove) ||
    decorKind !== 'none';

  const applyPatch = (patch: Partial<ManualWallTreatment>) => {
    applyManualWallTreatment(wallIds, patch, onInvalidate);
    setRev((r) => r + 1);
  };

  const handleReset = () => {
    clearManualWallTreatment(wallIds, onInvalidate);
    setTabOverride(null);
    setRev((r) => r + 1);
  };

  const handleSelectConnected = () => {
    const chain = findConnectedWallIds(wallIds, nodes);
    if (chain.length > 0) {
      preserveStudioOnNextSelection = true;
      selectNodes(chain);
    }
  };

  const handleToggleVisible = () => {
    updateWallPropertiesLive(wallIds, { visible: allHidden }, onInvalidate);
    setRev((r) => r + 1);
  };

  const handleArtworkFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        applyPatch({
          decorKind:
            decorKind === 'sculptural-relief' || decorKind === 'triptych-gallery'
              ? decorKind
              : 'framed-canvas',
          decorImageUrl: reader.result,
          decorTitle: file.name.replace(/\.[^.]+$/, ''),
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const supportsArtUpload =
    decorKind === 'framed-canvas' || decorKind === 'sculptural-relief' || decorKind === 'triptych-gallery';

  return (
    <section className="db-wall-studio" aria-label="Wall Cladding and Decor">
      <div className="db-wall-studio__head">
        <span><Layers size={13} /> Wall Studio</span>
        <div className="db-wall-head-actions">
          {connectedIds.length > wallIds.length && (
            <button
              type="button"
              className="db-wall-btn"
              onClick={handleSelectConnected}
              title={`Select connected wall run (${connectedIds.length} walls)`}
            >
              <Link2 size={11} /> + Connected ({connectedIds.length})
            </button>
          )}
          <button
            type="button"
            className="db-wall-btn"
            onClick={() => {
              closeWallGapsAndExtend(wallIds, onInvalidate);
              setRev((r) => r + 1);
            }}
            title="Auto-close gaps or extend wall ends to nearest wall"
          >
            <MoveHorizontal size={11} /> Close gaps
          </button>
          <button
            type="button"
            className={`db-wall-btn ${allHidden ? 'off' : ''}`}
            onClick={handleToggleVisible}
            title={allHidden ? 'Show selected wall(s)' : 'Hide selected wall(s)'}
          >
            {allHidden ? <Eye size={11} /> : <EyeOff size={11} />} {allHidden ? 'Show' : 'Hide'}
          </button>
          {hasTreatment && (
            <button
              type="button"
              className="db-wall-reset"
              onClick={handleReset}
              title="Clear wall paint, cladding, trim and decor"
            >
              <RotateCcw size={11} /> Reset
            </button>
          )}
        </div>
      </div>

      {activeClickedFace && (
        <div className="db-wall-face-pill">
          <span>Clicked face: {activeClickedFace === 'interior' ? 'Interior' : 'Exterior'}</span>
          {side !== activeClickedFace && (
            <button
              type="button"
              className="db-wall-btn"
              onClick={() => applyPatch({ side: activeClickedFace })}
            >
              Apply to {activeClickedFace === 'interior' ? 'Int' : 'Ext'}
            </button>
          )}
        </div>
      )}

      <div className="db-wall-tabs" role="tablist" aria-label="Wall surface mode">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'paint'}
          className={activeTab === 'paint' ? 'on' : ''}
          onClick={() => setTabOverride('paint')}
        >
          <Paintbrush size={11} /> Paint
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'cladding'}
          className={activeTab === 'cladding' ? 'on' : ''}
          onClick={() => setTabOverride('cladding')}
        >
          <Layers size={11} /> Cladding
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'glass'}
          className={activeTab === 'glass' ? 'on' : ''}
          onClick={() => setTabOverride('glass')}
        >
          Glass
        </button>
      </div>

      {activeTab === 'paint' && (
        <>
          <div className="db-wall-label">Paint Colour</div>
          <div className="db-wall-swatches">
            {WALL_PAINT_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`db-wall-chip ${current.surfaceMode === 'paint' && paintHex.toLowerCase() === p.hex.toLowerCase() ? 'on' : ''}`}
                onClick={() => applyPatch({ surfaceMode: 'paint', paintHex: p.hex, primaryHex: p.hex })}
              >
                <span className="db-wall-dot" style={{ background: p.hex }} />
                <span>{p.label}</span>
              </button>
            ))}
          </div>

          <div className="db-wall-row">
            <div className="db-wall-seg" role="group" aria-label="Wall face side">
              {(['both', 'interior', 'exterior'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={side === s ? 'on' : ''}
                  onClick={() => applyPatch({ side: s })}
                >
                  {s === 'both' ? 'Both' : s === 'interior' ? 'Int' : 'Ext'}
                </button>
              ))}
            </div>
            <div className="db-wall-seg" role="group" aria-label="Paint sheen">
              {(['matte', 'satin'] as const).map((sh) => (
                <button
                  key={sh}
                  type="button"
                  className={paintSheen === sh ? 'on' : ''}
                  onClick={() => applyPatch({ surfaceMode: 'paint', paintHex, paintSheen: sh })}
                >
                  {sh === 'matte' ? 'Matte' : 'Satin'}
                </button>
              ))}
            </div>
            <label className="db-wall-color" title="Custom paint colour">
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(paintHex) ? paintHex : '#f2efe9'}
                onChange={(e) => applyPatch({ surfaceMode: 'paint', paintHex: e.target.value, primaryHex: e.target.value })}
                aria-label="Custom wall paint color"
              />
            </label>
          </div>
        </>
      )}

      {activeTab === 'cladding' && (
        <>
          <div className="db-wall-label">Cladding Finish</div>
          <div className="db-wall-swatches">
            {WALL_CLADDING_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`db-wall-chip ${claddingPreset === p.id && activeTab === 'cladding' ? 'on' : ''}`}
                onClick={() =>
                  applyPatch({
                    surfaceMode: p.id === 'none' ? undefined : 'cladding',
                    claddingPreset: p.id,
                    primaryHex: p.primaryHex,
                    accentHex: p.accentHex,
                  })
                }
              >
                <span className="db-wall-dot" style={{ background: p.primaryHex }} />
                <span>{p.label}</span>
              </button>
            ))}
          </div>

          <div className="db-wall-row">
            <div className="db-wall-seg" role="group" aria-label="Wall face side">
              {(['both', 'interior', 'exterior'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={side === s ? 'on' : ''}
                  onClick={() => applyPatch({ side: s })}
                >
                  {s === 'both' ? 'Both' : s === 'interior' ? 'Int' : 'Ext'}
                </button>
              ))}
            </div>
            <label className="db-wall-color" title="Custom finish tint">
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(colorHex) ? colorHex : '#c29d6e'}
                onChange={(e) => applyPatch({ primaryHex: e.target.value })}
                aria-label="Wall finish color"
              />
              <span>Tint</span>
            </label>
          </div>
        </>
      )}

      {activeTab === 'glass' && (
        <>
          <div className="db-wall-label">Glazed Partition Conversion</div>
          <div className="db-wall-toggles">
            <button
              type="button"
              className={`db-wall-chip ${current.surfaceMode === 'clear-glass' ? 'on' : ''}`}
              onClick={() => applyPatch({ surfaceMode: 'clear-glass', accentHex: glassFrameHex })}
            >
              Clear Glass
            </button>
            <button
              type="button"
              className={`db-wall-chip ${current.surfaceMode === 'fluted-glass' ? 'on' : ''}`}
              onClick={() => applyPatch({ surfaceMode: 'fluted-glass', accentHex: glassFrameHex })}
            >
              Fluted Glass
            </button>
          </div>
          <div className="db-wall-label">Mullion Frame Finish</div>
          <div className="db-wall-toggles">
            {GLASS_FRAME_PRESETS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`db-wall-chip ${glassFrameHex.toLowerCase() === f.hex.toLowerCase() && (current.surfaceMode === 'clear-glass' || current.surfaceMode === 'fluted-glass') ? 'on' : ''}`}
                onClick={() => applyPatch({ surfaceMode: glassMode, accentHex: f.hex })}
              >
                <span className="db-wall-dot" style={{ background: f.hex }} />
                <span>{f.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="db-wall-label">Dimensions (Live 3D)</div>
      <div className="db-wall-sliders">
        <label className="db-wall-slider">
          <span>Height</span>
          <input
            type="range"
            min={0.5}
            max={6.0}
            step={0.05}
            value={liveHeight}
            onChange={(e) => updateWallPropertiesLive(wallIds, { height: Number(e.target.value) }, onInvalidate)}
            aria-label="Wall height in meters"
          />
          <input
            type="number"
            min={0.5}
            max={6.0}
            step={0.05}
            value={Number(liveHeight.toFixed(2))}
            onChange={(e) => updateWallPropertiesLive(wallIds, { height: Number(e.target.value) }, onInvalidate)}
            aria-label="Wall height numeric input"
          />
        </label>
        <label className="db-wall-slider">
          <span>Thickness</span>
          <input
            type="range"
            min={0.02}
            max={0.6}
            step={0.002}
            value={liveThickness}
            onChange={(e) => updateWallPropertiesLive(wallIds, { thickness: Number(e.target.value) }, onInvalidate)}
            aria-label="Wall thickness in meters"
          />
          <input
            type="number"
            min={0.02}
            max={0.6}
            step={0.002}
            value={Number(liveThickness.toFixed(3))}
            onChange={(e) => updateWallPropertiesLive(wallIds, { thickness: Number(e.target.value) }, onInvalidate)}
            aria-label="Wall thickness numeric input"
          />
        </label>
      </div>

      <div className="db-wall-label">Mouldings &amp; LED Grazing</div>
      <div className="db-wall-toggles">
        <button
          type="button"
          className={`db-wall-chip ${current.skirting ? 'on' : ''}`}
          onClick={() => applyPatch({ skirting: !current.skirting })}
        >
          Skirting
        </button>
        <button
          type="button"
          className={`db-wall-chip ${current.crown ? 'on' : ''}`}
          onClick={() => applyPatch({ crown: !current.crown })}
        >
          Crown Cove
        </button>
        <button
          type="button"
          className={`db-wall-chip ${current.chairRail ? 'on' : ''}`}
          onClick={() => applyPatch({ chairRail: !current.chairRail })}
        >
          Dado Rail
        </button>
        <button
          type="button"
          className={`db-wall-chip ${current.ledCove ? 'on' : ''}`}
          onClick={() => applyPatch({ ledCove: !current.ledCove })}
        >
          <Sparkles size={11} /> LED Grazing
        </button>
      </div>

      <div className="db-wall-label">Wall Decor &amp; Artwork</div>
      <div className="db-wall-swatches">
        {WALL_DECOR_PRESETS.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`db-wall-chip ${decorKind === d.id ? 'on' : ''}`}
            onClick={() => applyPatch({ decorKind: d.id })}
          >
            {d.label}
          </button>
        ))}
      </div>

      {supportsArtUpload && (
        <div className="db-wall-upload">
          <button
            type="button"
            className="db-btn-quiet"
            onClick={() => artFileRef.current?.click()}
          >
            <Upload size={12} /> {current.decorImageUrl ? 'Replace Art Image' : 'Upload Artwork Photo'}
          </button>
          {current.decorImageUrl && (
            <div className="db-wall-art-preview">
              <img src={current.decorImageUrl} alt={current.decorTitle || 'Wall artwork'} />
              <span>{current.decorTitle || 'Custom Art'}</span>
              <button
                type="button"
                className="db-wall-reset"
                onClick={() => applyPatch({ decorImageUrl: undefined, decorTitle: undefined })}
              >
                Clear
              </button>
            </div>
          )}
          <input
            ref={artFileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={handleArtworkFile}
          />
        </div>
      )}
    </section>
  );
}

function SlabFinishesSection({
  slabIds,
  onInvalidate,
}: {
  slabIds: string[];
  onInvalidate?: () => void;
}) {
  const [, setRev] = useState(0);
  const [tabOverride, setTabOverride] = useState<'paint' | 'cladding' | null>(null);
  const nodes = useScene((s) => s.nodes) as unknown as Record<
    string,
    { elevation?: number; visible?: boolean; materialPreset?: string } | undefined
  >;
  const slabKey = slabIds.join(',');

  useEffect(() => {
    setTabOverride(null);
  }, [slabKey]);

  const primarySlab = slabIds.length ? nodes[slabIds[0]] : undefined;
  const current: ManualSlabTreatment = slabIds.length ? getManualSlabTreatment(slabIds[0]) : {};
  const derivedTab: 'paint' | 'cladding' = current.surfaceMode === 'paint' ? 'paint' : 'cladding';
  const activeTab = tabOverride ?? derivedTab;
  const claddingPreset = current.claddingPreset ?? 'parquet';
  const presetSpec =
    SLAB_CLADDING_PRESETS.find((p) => p.id === claddingPreset) ?? SLAB_CLADDING_PRESETS[0];
  const paintHex = current.paintHex || SLAB_PAINT_PRESETS[0].hex;
  const paintSheen = current.paintSheen ?? 'satin';
  const claddingColor = current.primaryHex || presetSpec.hex;
  const liveElevation =
    typeof primarySlab?.elevation === 'number' && Number.isFinite(primarySlab.elevation)
      ? primarySlab.elevation
      : 0.05;
  const allHidden = slabIds.length > 0 && slabIds.every((id) => nodes[id]?.visible === false);
  const hasTreatment = Boolean(current.surfaceMode || current.claddingPreset);

  const applyPatch = (patch: Partial<ManualSlabTreatment>) => {
    applyManualSlabTreatment(slabIds, patch, onInvalidate);
    setRev((r) => r + 1);
  };

  const handleReset = () => {
    clearManualSlabTreatment(slabIds, onInvalidate);
    setTabOverride(null);
    setRev((r) => r + 1);
  };

  return (
    <section className="db-wall-studio" aria-label="Floor Studio">
      <div className="db-wall-studio__head">
        <span><Layers size={13} /> Floor Studio</span>
        <div className="db-wall-head-actions">
          <button
            type="button"
            className={`db-wall-btn ${allHidden ? 'off' : ''}`}
            onClick={() => {
              updateSlabPropertiesLive(slabIds, { visible: allHidden }, onInvalidate);
              setRev((r) => r + 1);
            }}
            title={allHidden ? 'Show selected slab(s)' : 'Hide selected slab(s)'}
          >
            {allHidden ? <Eye size={11} /> : <EyeOff size={11} />} {allHidden ? 'Show' : 'Hide'}
          </button>
          {hasTreatment && (
            <button
              type="button"
              className="db-wall-reset"
              onClick={handleReset}
              title="Reset slab finish to classic parquet"
            >
              <RotateCcw size={11} /> Reset
            </button>
          )}
        </div>
      </div>

      <div className="db-wall-tabs" role="tablist" aria-label="Floor surface mode">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'paint'}
          className={activeTab === 'paint' ? 'on' : ''}
          onClick={() => setTabOverride('paint')}
        >
          <Paintbrush size={11} /> Paint / Screed
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'cladding'}
          className={activeTab === 'cladding' ? 'on' : ''}
          onClick={() => setTabOverride('cladding')}
        >
          <Layers size={11} /> Flooring
        </button>
      </div>

      {activeTab === 'paint' && (
        <>
          <div className="db-wall-label">Floor Screed / Coating</div>
          <div className="db-wall-swatches">
            {SLAB_PAINT_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`db-wall-chip ${current.surfaceMode === 'paint' && paintHex.toLowerCase() === p.hex.toLowerCase() ? 'on' : ''}`}
                onClick={() => applyPatch({ surfaceMode: 'paint', paintHex: p.hex, primaryHex: p.hex })}
              >
                <span className="db-wall-dot" style={{ background: p.hex }} />
                <span>{p.label}</span>
              </button>
            ))}
          </div>
          <div className="db-wall-row">
            <div className="db-wall-seg" role="group" aria-label="Floor finish sheen">
              {(['matte', 'satin', 'polished'] as const).map((sh) => (
                <button
                  key={sh}
                  type="button"
                  className={paintSheen === sh ? 'on' : ''}
                  onClick={() => applyPatch({ surfaceMode: 'paint', paintHex, paintSheen: sh })}
                >
                  {sh === 'polished' ? 'Polished' : sh === 'satin' ? 'Satin' : 'Matte'}
                </button>
              ))}
            </div>
            <label className="db-wall-color" title="Custom floor colour">
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(paintHex) ? paintHex : '#e3ded6'}
                onChange={(e) => applyPatch({ surfaceMode: 'paint', paintHex: e.target.value, primaryHex: e.target.value })}
                aria-label="Custom floor colour"
              />
            </label>
          </div>
        </>
      )}

      {activeTab === 'cladding' && (
        <>
          <div className="db-wall-label">Flooring Finish</div>
          <div className="db-wall-swatches">
            {SLAB_CLADDING_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`db-wall-chip ${current.surfaceMode !== 'paint' && claddingPreset === p.id ? 'on' : ''}`}
                onClick={() => applyPatch({ surfaceMode: 'cladding', claddingPreset: p.id, primaryHex: p.hex })}
              >
                <span className="db-wall-dot" style={{ background: p.hex }} />
                <span>{p.label}</span>
              </button>
            ))}
          </div>
          <div className="db-wall-row">
            <label className="db-wall-color" title="Custom floor tint">
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(claddingColor) ? claddingColor : '#c69d6b'}
                onChange={(e) => applyPatch({ surfaceMode: 'cladding', primaryHex: e.target.value })}
                aria-label="Floor finish tint"
              />
              <span>Tint</span>
            </label>
          </div>
        </>
      )}

      <div className="db-wall-label">Elevation (Live 3D)</div>
      <div className="db-wall-sliders">
        <label className="db-wall-slider">
          <span>Elevation</span>
          <input
            type="range"
            min={-0.5}
            max={1.0}
            step={0.01}
            value={liveElevation}
            onChange={(e) => updateSlabPropertiesLive(slabIds, { elevation: Number(e.target.value) }, onInvalidate)}
            aria-label="Slab elevation in meters"
          />
          <input
            type="number"
            min={-0.5}
            max={1.0}
            step={0.01}
            value={Number(liveElevation.toFixed(2))}
            onChange={(e) => updateSlabPropertiesLive(slabIds, { elevation: Number(e.target.value) }, onInvalidate)}
            aria-label="Slab elevation numeric input"
          />
        </label>
      </div>
    </section>
  );
}

export function SelectionPropertiesPanel({
  onZoomTo,
  onInvalidate,
}: {
  onZoomTo?: () => void;
  onInvalidate?: () => void;
}) {
  const { selected } = useSelectionInfo();
  const studioExpanded = useSelectionActionStore((s) => s.studioExpanded);
  const setStudioExpanded = useSelectionActionStore((s) => s.setStudioExpanded);
  const selectedIdsKey = selected.map((s) => s.nodeId).join(',');

  useEffect(() => {
    if (preserveStudioOnNextSelection) {
      preserveStudioOnNextSelection = false;
      return;
    }
    setStudioExpanded(false);
  }, [selectedIdsKey, setStudioExpanded]);

  if (selected.length === 0) return null;
  const wallIds = selected.every((s) => s.nodeType === 'wall') ? selected.map((s) => s.nodeId) : [];
  const slabIds = selected.every((s) => s.nodeType === 'slab') ? selected.map((s) => s.nodeId) : [];
  const canEditFinishes = wallIds.length > 0 || slabIds.length > 0;

  if (selected.length > 1) {
    const byType: Record<string, number> = {};
    for (const s of selected) byType[s.nodeType] = (byType[s.nodeType] ?? 0) + 1;
    // Pieces of one product (BOQ Flow's legend selects them): name the product.
    const names = new Set(selected.map((s) => (s.nodeType === 'item' ? String(s.editableProperties.name ?? '') : '')));
    const product = names.size === 1 ? [...names][0] : '';
    return (
      <aside className="db-props glass" aria-label="Selection">
        <div className="db-props__head">
          <div>
            <h3>{product || `${selected.length} elements`}</h3>
            <p>{product ? `${selected.length} pieces in the model` : Object.entries(byType).map(([t, n]) => countOf(t, n)).join(', ')}</p>
          </div>
          <button type="button" className="db-icon-btn" onClick={clearSelection} aria-label="Clear the selection"><X size={16} /></button>
        </div>
        {studioExpanded && wallIds.length > 0 && <WallCladdingDecorSection wallIds={wallIds} onInvalidate={onInvalidate} />}
        {studioExpanded && slabIds.length > 0 && <SlabFinishesSection slabIds={slabIds} onInvalidate={onInvalidate} />}
        {(canEditFinishes || onZoomTo) && (
          <div className="db-props__actions">
            {canEditFinishes && (
              <button
                type="button"
                className={`db-btn-quiet db-btn-edit ${studioExpanded ? 'on' : ''}`}
                onClick={() => setStudioExpanded(!studioExpanded)}
              >
                <PenLine size={14} /> {studioExpanded ? 'Done' : 'Edit'}
              </button>
            )}
            {onZoomTo && (
              <button type="button" className="db-btn-quiet" onClick={onZoomTo}><Scan size={14} /> Zoom to them</button>
            )}
          </div>
        )}
      </aside>
    );
  }

  const w: SelectedNodeInfo = selected[0];
  const main: [string, string][] = [];
  const extra: [string, string][] = [];
  for (const [k, v] of Object.entries(w.editableProperties)) {
    const text = formatValue(k, v);
    if (text === null) continue;
    if (PROP_LABEL[k]) main.push([PROP_LABEL[k], text]);
    else extra.push([k, text]);
  }
  const lengthText = main.find(([k]) => k === 'Length')?.[1];
  const badge = w.reviewStatus === 'approved' ? 'ok' : w.reviewStatus === 'review' ? 'review' : w.reviewStatus === 'invalid' ? 'invalid' : 'unset';
  const status = w.reviewStatus === 'approved' ? 'Checked' : w.reviewStatus === 'review' ? 'Needs review' : w.reviewStatus === 'invalid' ? 'Problem' : null;

  return (
    <aside className="db-props glass" aria-label="Selection">
      <div className="db-props__head">
        <div>
          <h3>{label(w.nodeType)}</h3>
          <p>
            {lengthText ? `${lengthText} long` : 'Selected'}
            {status && <span className={`db-badge ${badge}`}>{status}</span>}
          </p>
        </div>
        <button type="button" className="db-icon-btn" onClick={clearSelection} aria-label="Clear the selection"><X size={16} /></button>
      </div>
      {main
        .filter(
          ([k]) =>
            k !== 'Length' &&
            (!studioExpanded || wallIds.length !== 1 || (k !== 'Height' && k !== 'Thickness')) &&
            (!studioExpanded || slabIds.length !== 1 || k !== 'Elevation'),
        )
        .map(([k, v]) => <Row key={k} k={k} v={v} />)}
      {studioExpanded && wallIds.length === 1 && <WallCladdingDecorSection wallIds={wallIds} onInvalidate={onInvalidate} />}
      {studioExpanded && slabIds.length === 1 && <SlabFinishesSection slabIds={slabIds} onInvalidate={onInvalidate} />}
      {(canEditFinishes || onZoomTo) && (
        <div className="db-props__actions">
          {canEditFinishes && (
            <button
              type="button"
              className={`db-btn-quiet db-btn-edit ${studioExpanded ? 'on' : ''}`}
              onClick={() => setStudioExpanded(!studioExpanded)}
            >
              <PenLine size={14} /> {studioExpanded ? 'Done' : 'Edit'}
            </button>
          )}
          {onZoomTo && (
            <button type="button" className="db-btn-quiet" onClick={onZoomTo}><Scan size={14} /> Zoom to it</button>
          )}
        </div>
      )}
      <details className="db-props__details">
        <summary>Details</summary>
        <Row k="ID" v={w.nodeId} />
        <Row k="Type" v={w.nodeType} />
        {w.semanticId && <Row k="Semantic ID" v={w.semanticId} />}
        {w.sourceRecordId && <Row k="Source record" v={w.sourceRecordId} />}
        {w.extractionMethod && <Row k="Read by" v={w.extractionMethod} />}
        {w.confidence !== undefined && <Row k="Confidence" v={`${(w.confidence * 100).toFixed(0)}%`} />}
        {w.physicalWallId && <Row k="Physical wall" v={w.physicalWallId} />}
        {w.sourcePrimitives && <Row k="Drawing lines" v={String(w.sourcePrimitives.length)} />}
        {extra.map(([k, v]) => <Row key={k} k={k} v={v} />)}
      </details>
    </aside>
  );
}

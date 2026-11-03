import { useRef, useState, type ReactNode } from 'react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { UpdateChildCommand } from '@/store/commands';
import type { DungeonLayer, PathChild } from '@/store/types';
import { setPathFields, setPathPointHeight, type PathPatch } from '@dnd/core/src/store/pathCommands';
import { NumBox } from './PropCards';
import { pathKits } from '@dnd/core/src/assets/packCatalog';
import { pathNarrowestWidth } from '@dnd/core/src/geometry/pathGeometry';
import { pathMaterialPatch } from '@dnd/core/src/shared/plateaus';
import { ColorCtl, Seg, Select, Slider, Switch } from './controls';
import { WidthStepper } from './DockControls';
import {
  PATH_EDGE_CHOICES,
  PATH_END_CHOICES,
  PATH_HEIGHT_CHOICES,
  PATH_SORT_CHOICES,
  crossingOptions,
  pathHandlesOn,
  reversedPath,
} from './pathControls';

function usePath(layerId: string, pathId: string): PathChild | null {
  return useStore((s) => {
    const l = s.layers.find((x) => x.id === layerId) as DungeonLayer | undefined;
    const c = l?.children.find((x) => x.id === pathId);
    return c?.childType === 'path' ? c : null;
  });
}

function PathName({ path }: { path: PathChild }) {
  const [text, setText] = useState<string | null>(null);
  const cancelled = useRef(false);
  const commit = () => {
    const next = text?.trim();
    setText(null);
    if (cancelled.current || !next || next === path.name) return;
    const cmd = setPathFields(path.id, { name: next }, 'Rename path');
    if (cmd) undoManager.execute(cmd);
  };
  return (
    <label className="v2-field v2-selc__text">
      <span>Name</span>
      <input
        value={text ?? path.name}
        aria-label="Path name"
        spellCheck={false}
        onFocus={() => {
          cancelled.current = false;
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.stopPropagation();
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

/**
 * The selected path's card (plan §5.2): material, width, edge, ends, edge strip, sort,
 * what passes under a bridge, height mode, crossing, tint and opacity, and the verbs that
 * reshape it whole (reverse, close or open, handles on or off, fill for a closed path).
 * Every change is one undo entry; tint, opacity and end length land when the drag ends.
 */
export function PathFields({ layerId, pathId }: { layerId: string; pathId: string }) {
  const path = usePath(layerId, pathId);
  const kinds = useStore((s) => s.mapSettings.crossingKinds);
  useStore((s) => s.packs.installedPacks);
  if (!path) return null;

  const set = (patch: PathPatch, label: string) => {
    const cmd = setPathFields(path.id, patch, label);
    if (cmd) undoManager.execute(cmd);
  };
  const preview = (patch: Partial<PathChild>) => useStore.getState().updateChild(layerId, path.id, patch);
  const land = (label: string, before: Partial<PathChild>, after: Partial<PathChild>) => {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      undoManager.execute(new UpdateChildCommand(label, layerId, path.id, before, after));
    }
  };
  const reshape = (label: string, after: Partial<PathChild>) => {
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(after)) before[k] = (path as unknown as Record<string, unknown>)[k];
    land(label, before as Partial<PathChild>, after);
  };

  const materials = pathKits();
  const materialOptions = materials.map((m) => ({ value: m.id, label: m.label }));
  if (!materials.some((m) => m.id === path.materialId)) materialOptions.unshift({ value: path.materialId, label: path.materialId });
  const handlesOn = pathHandlesOn(path);
  // A shoreline band too wide for a tight lake is drawn narrower; say how narrow.
  const narrowest = pathNarrowestWidth(path);

  const row = (child: ReactNode) => <div className="v2-sel__row">{child}</div>;
  const last = path.points.length - 1;
  const setHeight = (index: number) => (v: number) => {
    const cmd = setPathPointHeight(path.id, index, v);
    if (cmd) undoManager.execute(cmd);
  };

  // One control to a row, so a segmented control never shares its width with another.
  return (
    <div className="v2-sel__rows v2-selc v2-selc--path" data-testid="v2-sel-path">
      <PathName path={path} />
      {row(
        <Select
          label="Material"
          width={170}
          value={path.materialId}
          options={materialOptions}
          onChange={(materialId) => {
            // A bridge's material brings a bridge's sort and heights with it (pathMaterialPatch).
            const layer = useStore.getState().layers.find((l) => l.id === layerId) as DungeonLayer;
            reshape('Path material', pathMaterialPatch(layer, path, materialId));
          }}
        />,
      )}
      {row(<WidthStepper value={path.width} onChange={(width) => set({ width }, 'Path width')} />)}
      {narrowest !== null && (
        <p className="v2-sel__note" data-testid="v2-path-narrowed">
          Narrowed to {narrowest.toFixed(2)} where the shape is tight
        </p>
      )}
      {row(<Seg label="Edge" value={path.edge} options={PATH_EDGE_CHOICES} onChange={(edge) => set({ edge }, 'Path edge')} />)}
      {!path.closed && (
        <>
          {row(<Seg label="Start" value={path.ends.start} options={PATH_END_CHOICES} onChange={(start) => set({ ends: { ...path.ends, start } }, 'Path ends')} />)}
          {row(<Seg label="End" value={path.ends.end} options={PATH_END_CHOICES} onChange={(end) => set({ ends: { ...path.ends, end } }, 'Path ends')} />)}
          {(path.ends.start !== 'cut' || path.ends.end !== 'cut') &&
            row(
              <Slider
                label="Length"
                value={path.ends.length}
                min={0.25}
                max={6}
                step={0.25}
                format={(v) => v.toFixed(2)}
                onChange={(length) => preview({ ends: { ...path.ends, length } })}
                onCommit={(length, start) => land('Path ends', { ends: { ...path.ends, length: start } }, { ends: { ...path.ends, length } })}
              />,
            )}
        </>
      )}
      {row(<Switch label="Flip" checked={path.flip} onChange={(flip) => set({ flip }, flip ? 'Flip path' : 'Unflip path')} />)}
      {path.closed && row(<Switch label="Fill" checked={!!path.fill} onChange={(fill) => set({ fill }, fill ? 'Fill path' : 'Unfill path')} />)}
      {row(<Seg label="Sort" value={path.sort} options={PATH_SORT_CHOICES} onChange={(sort) => set({ sort }, 'Path sort')} />)}
      {path.sort === 'overhead' &&
        row(
          <Seg
            label="Under"
            value={path.under ?? 'walkable'}
            options={[
              { value: 'walkable', label: 'Walkable' },
              { value: 'blocked', label: 'Blocked' },
            ]}
            onChange={(under) => set({ under }, 'Under the bridge')}
          />,
        )}
      {row(<Seg label="Height" value={path.heightMode} options={PATH_HEIGHT_CHOICES} onChange={(heightMode) => set({ heightMode }, 'Path height')} />)}
      {path.heightMode === 'set' && (
        <div className="v2-sel__row" data-testid="v2-path-heights">
          <NumBox label="Start" title="Start height" value={path.points[0].height ?? 0} format={(v) => String(v)} onCommit={setHeight(0)} />
          <NumBox label="End" title="End height" value={path.points[last].height ?? 0} format={(v) => String(v)} onCommit={setHeight(last)} />
        </div>
      )}
      {row(
        <Select
          label="Crossing"
          width={170}
          value={path.crossingId ?? ''}
          options={crossingOptions(kinds)}
          onChange={(v) => set({ crossingId: v || undefined }, 'Path crossing')}
        />,
      )}
      {row(
        <ColorCtl
          label="Tint"
          placement="beside"
          value={path.tint}
          onChange={(tint) => preview({ tint })}
          onCommit={(tint, start) => land('Path tint', { tint: start }, { tint })}
        />,
      )}
      {row(
        <Slider
          label="Opacity"
          value={path.opacity}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(opacity) => preview({ opacity })}
          onCommit={(opacity, start) => land('Path opacity', { opacity: start }, { opacity })}
        />,
      )}
      <div className="v2-sel__links">
        <button type="button" className="v2-rbtn" onClick={() => reshape('Reverse path', reversedPath(path))}>
          Reverse
        </button>
        <button
          type="button"
          className="v2-rbtn"
          disabled={!path.closed && path.points.length < 3}
          onClick={() => reshape(path.closed ? 'Open path' : 'Close path', path.closed ? { closed: false, fill: undefined } : { closed: true })}
        >
          {path.closed ? 'Open' : 'Close'}
        </button>
        <button
          type="button"
          className="v2-rbtn"
          aria-pressed={handlesOn}
          data-tip={handlesOn ? 'Make every point a sharp corner' : 'Curve through every point'}
          onClick={() =>
            reshape(handlesOn ? 'Handles off' : 'Handles on', {
              points: path.points.map((p) => {
                const q = { ...p };
                if (handlesOn) q.handles = null;
                else delete q.handles;
                return q;
              }),
            })
          }
        >
          {handlesOn ? 'Handles off' : 'Handles on'}
        </button>
      </div>
    </div>
  );
}

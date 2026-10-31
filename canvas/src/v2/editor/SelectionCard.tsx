import { useCallback, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChevronRight } from 'lucide-react';
import { boxesByFootprint, getWallBounds, unionChildBounds } from '@dnd/core/src/engine/hitTest';
import { getCatalogEntry } from '@dnd/core/src/assets/packCatalog';
import { blockedLayerReason } from '@dnd/core/src/engine/tools/layerGuard';
import { notify } from '@/lib/toast';
import { useStore } from '@/store/store';
import { selectChildById, selectLayerForChild, selectWallById } from '@/store/selectors';
import {
  CompositeCommand,
  ShapeStyleCommand,
  UpdateChildCommand,
  UpdateWallCommand,
} from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type {
  AnyChild,
  Command,
  DungeonLayer,
  DungeonStyle,
  LightChild,
  ShapeChild,
  TextChild,
  WallSegment,
  WaterChild,
} from '@/store/types';
import type { AssetTypeFilter } from '@/components/layers/AssetBrowserPanel';
import { PackThumbnailCanvas } from '@/components/shared/PackThumbnailCanvas';
import { cn } from '@/lib/utils';
import { doorOpeningLimit, polylineLength, resolveDoors, resolveWalls } from '@dnd/core/src/shared/wallResolve';
import { doorwayRoom, isOwnPiece, turnOwnPiece } from '@dnd/core/src/shared/doorwaySeal';
import { doorwayEditCommand, revertDoorwayLive, writeDoorwayLive } from '@dnd/core/src/store/doorwayCommands';
import type { DoorChild } from '@dnd/core/src/shared/types';
import { DOOR_ANGLE_STEP, doorAngleValue, doorStyleLabel, turnDoorAngle } from '@dnd/core/src/engine/tools/DoorTool';
import { doorWallLook } from '@dnd/core/src/engine/doorRenderer';
import { MAX_OPEN_ANGLE } from '@dnd/core/src/assets/doorKits';
import { edgeStyles, ringStyles } from '@dnd/core/src/shared/wallLook';
import { layerDrawStyle, layerLevelLook } from '@dnd/core/src/engine/levelLook';
import { conditionZoneId } from '@dnd/core/src/shared/prep';
import { resolveSelection } from '@dnd/core/src/store/selectionResolve';
import { wallStoneCount } from '@dnd/core/src/engine/wallNodeOverlay';
import type { ZoneChild, ZoneShape } from '@/store/types';
import { CardActions, LockFields, LockedNote } from './CardActions';
import { MixedCard } from './MixedCard';
import { RoomTargetCard } from './RoomCards';
import { PropTargetCard } from './PropCards';
import { LightTargetCard } from './LightCards';
import { LabelGroupFields, LabelTargetCard } from './LabelCard';
import { ColorCtl, Seg, Select, Slider, Switch } from './controls';
import { wallSetLabel } from './assetStrip';
import { SlideOver } from './SlideOver';
import { ZoneSheet } from './ZoneSheet';
import {
  BANK_TEXTURE_ID,
  MIXED_SWATCH,
  TEXTURE_DEFAULTS,
  cleanDoorName,
  DOOR_HINGES,
  DOOR_STATES,
  DOOR_SWINGS,
  DOOR_WIDTH_STEP,
  OPEN_ANGLE_STEP,
  doorModel,
  doorKitField,
  doorWidthValue,
  swingChoice,
  swingValue,
  doorStyleChange,
  type DoorLike,
  degToRad,
  fieldsGroup,
  hasStyleOverrides,
  isMixed,
  radToDeg,
  shapeFillModel,
  hasFillOverrides,
  fieldsForFloor,
  TEXTURE_SCALE_RANGE,
  shortTextureName,
  textureValue,
  waterModel,
  WALL_TYPE_CHOICES,
  wallModel,
  wallTypeChange,
  soleRoomTarget,
  resolvePropTarget,
  type RoomTarget,
  type Mixed,
  type TextureNumberKey,
} from './selectionModel';
import './selection-card.css';

const KIND_LABEL: Record<AnyChild['childType'], string> = {
  shape: 'Floor',
  asset: 'Prop',
  text: 'Label',
  light: 'Light',
  door: 'Door',
  water: 'Water',
  zone: 'Zone',
};

const NO_TARGET = { kind: 'none' } as const;

function fmtSq(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

type Box = { x: number; y: number; width: number; height: number };

/** The box around the drawn walls' lines, the way a floor's W and H measure its ring. */
function wallsBounds(walls: readonly WallSegment[]): Box | null {
  let out: Box | null = null;
  for (const w of walls) out = unionBounds(out, getWallBounds(w));
  return out;
}

function unionBounds(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

interface SelectionCardProps {
  /** Opens the map-wide list of triggers and notes. */
  onOpenPrep?: () => void;
  /** Opens the asset browser on `type`'s tab. Without it the texture row has no "Change". */
  onOpenAssets?: (type?: AssetTypeFilter) => void;
  /** Opens the layer list (a group card's "Select members" shows them there). */
  onOpenLayers?: () => void;
}

/** Floats over the canvas while something is selected: what it is, how big, its fields. */
export function SelectionCard({ onOpenPrep, onOpenAssets, onOpenLayers }: SelectionCardProps = {}) {
  const children = useStore(
    useShallow((s) =>
      s.selection.selectedIds
        .map((id) => selectChildById(s, id))
        .filter((c): c is AnyChild => c !== undefined),
    ),
  );
  const layerIds = useStore(
    useShallow((s) => children.map((c) => selectLayerForChild(s, c.id)?.id ?? null)),
  );
  // Drawn walls are not children; the selection holds them by id all the same.
  const walls = useStore(
    useShallow((s) =>
      s.selection.selectedIds
        .map((id) => selectWallById(s, id)?.wall)
        .filter((w): w is WallSegment => w !== undefined),
    ),
  );
  const wallLayerIds = useStore(
    useShallow((s) => walls.map((w) => selectWallById(s, w.id)?.layer.id ?? null)),
  );
  const [zoneMore, setZoneMore] = useState(false);
  // A room, an area or a level selected on its own has a card of its own.
  const roomTarget = useStore(useShallow((s) => soleRoomTarget(s, s.selection.selectedIds) ?? NO_TARGET));
  // One prop, several, or a whole group of them have cards of their own; a mix with anything
  // else keeps the card below.
  const selectedIds = useStore((s) => s.selection.selectedIds);
  const layers = useStore((s) => s.layers);
  const propTarget = useMemo(() => resolvePropTarget({ layers }, selectedIds), [layers, selectedIds]);
  // Rooms in a selection with anything else (or several rooms) go to the mixed card.
  const roomCount = useStore((s) => resolveSelection(s, s.selection.selectedIds).rooms.length);
  if (propTarget) return <PropTargetCard target={propTarget} onOpenLayers={onOpenLayers} />;

  const first = children[0];
  const total = children.length + walls.length;
  // One light on its own has the v2 light card (the v1 panel stays for `/`).
  if (total === 1 && roomCount === 0 && first?.childType === 'light' && layerIds[0]) {
    return <LightTargetCard light={first as LightChild} layerId={layerIds[0]} />;
  }
  // One label on its own has the v2 label card (the v1 panel stays for `/`).
  if (total === 1 && roomCount === 0 && first?.childType === 'text' && layerIds[0]) {
    return <LabelTargetCard key={first.id} label={first as TextChild} layerId={layerIds[0]} />;
  }
  if (total === 0 && roomTarget.kind !== 'none') {
    return <RoomTargetCard target={roomTarget as RoomTarget} onOpenAssets={onOpenAssets} />;
  }
  if (total + roomCount === 0) return null;
  const layerId = layerIds[0] ?? null;

  const many = total + roomCount > 1;
  // A mix boxes its lights by their marker, as the canvas box does.
  const bounds = unionBounds(
    unionChildBounds(children, boxesByFootprint(children, walls.length + roomCount)),
    walls.length > 0 ? wallsBounds(walls) : null,
  );
  const kind = first ? (KIND_LABEL[first.childType] ?? first.childType) : 'Wall';
  const locked = !many && !!(first ?? walls[0])?.locked;
  const title = first ? first.name || kind : 'Wall';
  const group = walls.length === 0 && roomCount === 0 ? fieldsGroup(children, layerIds) : null;
  const soleWall = !many && !first ? walls[0] : null;
  const soleWallLayerId = soleWall ? wallLayerIds[0] : null;

  // One drawn wall measures as its length, the number its box on the canvas shows too.
  const dims = soleWall ? (
    <div className="v2-sel__dims" style={{ gridTemplateColumns: '1fr' }}>
      <div className="v2-field">
        <span>Length</span>
        <span className="v2-num" data-testid="v2-sel-wall-length">{polylineLength(soleWall.points).toFixed(1)} sq</span>
      </div>
    </div>
  ) : bounds && (
    <div className="v2-sel__dims">
      <div className="v2-field">
        <span>W</span>
        <span className="v2-num">{fmtSq(Math.round(bounds.width * 10) / 10)} sq</span>
      </div>
      <div className="v2-field">
        <span>H</span>
        <span className="v2-num">{fmtSq(Math.round(bounds.height * 10) / 10)} sq</span>
      </div>
    </div>
  );

  if (many) {
    // Several things, of one kind or many (board S3): the kinds counted, the shared
    // verbs, arrange, and the fields every member agrees on.
    return (
      <MixedCard dims={dims}>
        {group?.kind === 'shape' ? (
          <ShapeFields layerId={group.layerId} ids={group.ids} onOpenAssets={onOpenAssets} />
        ) : group?.kind === 'water' ? (
          <WaterFields layerId={group.layerId} ids={group.ids} />
        ) : walls.length === 0 && roomCount === 0 && children.every((c) => c.childType === 'text') ? (
          <LabelGroupFields entries={children.map((c, i) => ({ id: c.id, layerId: layerIds[i] ?? '' }))} />
        ) : null}
      </MixedCard>
    );
  }

  return (
    <>
      <section className="v2-sel v2-float" data-testid="v2-selection-card" data-keys="canvas" data-chrome aria-label="Selection">
        <header className="v2-sel__head">
          <span className="v2-sel__name">{title}</span>
          <span className="v2-sel__kind" data-testid="v2-sel-kind">
            {locked ? `${kind} · locked` : kind}
          </span>
        </header>
        <CardActions />
        {locked && <LockedNote />}

        <LockFields locked={locked}>
          {/* A wall door's size is its width along the wall; its depth is the wall's. */}
          {first?.childType === 'door' && layerId ? <DoorDims layerId={layerId} doorId={first.id} /> : dims}

          {group?.kind === 'shape' ? (
            <ShapeFields layerId={group.layerId} ids={group.ids} onOpenAssets={onOpenAssets} />
          ) : group?.kind === 'water' ? (
            <WaterFields layerId={group.layerId} ids={group.ids} />
          ) : soleWall && soleWallLayerId ? (
            <WallFields layerId={soleWallLayerId} wallId={soleWall.id} />
          ) : (
            first && (
              <Fields child={first} layerId={layerId} onZoneMore={() => setZoneMore(true)} onOpenPrep={onOpenPrep} />
            )
          )}
        </LockFields>
      </section>

      <SlideOver
        title="Zone"
        open={zoneMore && first?.childType === 'zone' && !!layerId}
        onClose={() => setZoneMore(false)}
        testId="v2-zone-sheet"
        legacy={false}
      >
        {layerId && first?.childType === 'zone' && <ZoneSheet layerId={layerId} zoneId={first.id} />}
      </SlideOver>
    </>
  );
}

function Fields({
  child,
  layerId,
  onZoneMore,
  onOpenPrep,
}: {
  child: AnyChild;
  layerId: string | null;
  onZoneMore: () => void;
  onOpenPrep?: () => void;
}) {
  const triggerCount = useStore(
    (s) => (s.prep?.triggers ?? []).filter((t) => conditionZoneId(t.when) === child.id).length,
  );

  if (child.childType === 'door' && layerId) {
    return <DoorFields layerId={layerId} doorId={child.id} />;
  }
  if (child.childType === 'zone') {
    return (
      <div className="v2-sel__rows">
        {layerId && <ZoneName layerId={layerId} zone={child} />}
        {layerId && <ZoneFields layerId={layerId} zone={child} />}
        <div className="v2-sel__row">
          <span>Shape</span>
          <span>{child.shape.kind}</span>
        </div>
        <div className="v2-sel__row">
          <span>Triggers</span>
          <span className="v2-num">{triggerCount}</span>
        </div>
        <div className="v2-sel__links">
          <button type="button" className="v2-link" onClick={onZoneMore}>
            More…
          </button>
          {onOpenPrep && (
            <button type="button" className="v2-link v2-sel__quiet" onClick={onOpenPrep}>
              Prep overview
            </button>
          )}
        </div>
      </div>
    );
  }
  return <p className="v2-sel__note">Nothing else to set on this one yet.</p>;
}

/** A zone's name, typed in place: one undo step on Enter or blur, Esc puts it back. */
function ZoneName({ layerId, zone }: { layerId: string; zone: ZoneChild }) {
  const [text, setText] = useState<string | null>(null);
  const cancelled = useRef(false);
  const commit = () => {
    const next = text?.trim();
    setText(null);
    if (cancelled.current || !next || next === zone.name) return;
    undoManager.execute(new UpdateChildCommand('Rename zone', layerId, zone.id, { name: zone.name }, { name: next }));
  };
  return (
    <label className="v2-field v2-selc__text">
      <span>Name</span>
      <input
        value={text ?? zone.name}
        aria-label="Zone name"
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
 * A zone's place in numbers: X and Y (its corner for a rect, its centre otherwise), and its
 * Radius or W and H. Typed values preview live and land as one undo step.
 */
function ZoneFields({ layerId, zone }: { layerId: string; zone: ZoneChild }) {
  const { live, commit, revert } = useLiveEdit(layerId);
  const s = zone.shape;
  const set = (patch: (shape: ZoneShape) => ZoneShape) =>
    live([zone.id], (c) => ({ shape: patch((c as ZoneChild).shape) }));
  const done = () => commit('Zone shape');
  const pos = s.kind === 'rect' ? { x: s.x, y: s.y } : s.position;
  const at = (axis: 'x' | 'y') => (v: number) =>
    set((sh) => (sh.kind === 'rect' ? { ...sh, [axis]: v } : { ...sh, position: { ...sh.position, [axis]: v } }));
  return (
    <div className="v2-zone__grid" data-testid="v2-zone-fields">
      <NumField label="X" title="Zone X" value={pos.x} mixed={false} onLive={at('x')} onCommit={done} onRevert={revert} />
      <NumField label="Y" title="Zone Y" value={pos.y} mixed={false} onLive={at('y')} onCommit={done} onRevert={revert} />
      {s.kind === 'circle' && (
        <NumField
          label="R"
          title="Zone radius"
          value={s.radius}
          mixed={false}
          onLive={(v) => v > 0 && set((sh) => (sh.kind === 'circle' ? { ...sh, radius: v } : sh))}
          onCommit={done}
          onRevert={revert}
        />
      )}
      {s.kind === 'rect' && (
        <>
          <NumField
            label="W"
            title="Zone width"
            value={s.width}
            mixed={false}
            onLive={(v) => v > 0 && set((sh) => (sh.kind === 'rect' ? { ...sh, width: v } : sh))}
            onCommit={done}
            onRevert={revert}
          />
          <NumField
            label="H"
            title="Zone height"
            value={s.height}
            mixed={false}
            onLive={(v) => v > 0 && set((sh) => (sh.kind === 'rect' ? { ...sh, height: v } : sh))}
            onCommit={done}
            onRevert={revert}
          />
        </>
      )}
    </div>
  );
}

/* ── Live edits ─────────────────────────────────────────── */

type Patch = Record<string, unknown>;
type MakeCommand = (id: string, before: Patch, after: Patch) => Command;

function liveLayer(layerId: string): DungeonLayer | undefined {
  const layer = useStore.getState().layers.find((l) => l.id === layerId);
  return layer && layer.type === 'dungeon' ? (layer as DungeonLayer) : undefined;
}

function run(label: string, cmds: Command[], alwaysGroup = false): void {
  if (cmds.length === 0) return;
  undoManager.execute(cmds.length === 1 && !alwaysGroup ? cmds[0] : new CompositeCommand(label, cmds));
}

/**
 * A gesture patches the store on every tick, off the undo stack, and lands as one entry when
 * it ends. Each child's own value is captured at its first tick, so undo gives every child
 * back what it had, not the one value the control was showing.
 */
function useLiveEdit(layerId: string) {
  const prior = useRef<Map<string, Patch> | null>(null);

  const live = useCallback(
    (ids: readonly string[], patch: Patch | ((child: AnyChild) => Patch)) => {
      const layer = liveLayer(layerId);
      if (!layer) return;
      const snap = prior.current ?? new Map<string, Patch>();
      for (const c of layer.children) {
        if (!ids.includes(c.id)) continue;
        const keys = Object.keys(typeof patch === 'function' ? patch(c) : patch);
        const entry = snap.get(c.id) ?? {};
        for (const k of keys) if (!(k in entry)) entry[k] = structuredClone((c as unknown as Patch)[k]);
        snap.set(c.id, entry);
      }
      prior.current = snap;
      useStore.setState((s) => {
        const l = s.layers.find((x) => x.id === layerId);
        if (!l || l.type !== 'dungeon') return;
        for (const c of (l as DungeonLayer).children) {
          if (ids.includes(c.id)) Object.assign(c, typeof patch === 'function' ? patch(c) : patch);
        }
      });
    },
    [layerId],
  );

  const commit = useCallback(
    (label: string, make?: MakeCommand, alwaysGroup = false) => {
      const snap = prior.current;
      prior.current = null;
      const layer = snap && liveLayer(layerId);
      if (!snap || !layer) return;
      const cmds: Command[] = [];
      for (const [id, before] of snap) {
        const c = layer.children.find((x) => x.id === id) as unknown as Patch | undefined;
        if (!c) continue;
        const after: Patch = {};
        for (const k of Object.keys(before)) after[k] = c[k];
        if (Object.keys(before).every((k) => Object.is(before[k], after[k]))) continue;
        cmds.push(
          make
            ? make(id, before, after)
            : new UpdateChildCommand(label, layerId, id, before as Partial<AnyChild>, after as Partial<AnyChild>),
        );
      }
      run(label, cmds, alwaysGroup);
    },
    [layerId],
  );

  /** Puts back what the gesture started from, with nothing on the undo stack. */
  const revert = useCallback(() => {
    const snap = prior.current;
    prior.current = null;
    if (!snap) return;
    useStore.setState((s) => {
      const l = s.layers.find((x) => x.id === layerId);
      if (!l || l.type !== 'dungeon') return;
      for (const c of (l as DungeonLayer).children) {
        const before = snap.get(c.id);
        if (before) Object.assign(c, structuredClone(before));
      }
    });
  }, [layerId]);

  return { live, commit, revert };
}

/* ── Floors ─────────────────────────────────────────────── */

const FILL_OPEN_KEY = 'v2-sel-fill-open';

function loadFillOpen(): boolean {
  try {
    return sessionStorage.getItem(FILL_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function saveFillOpen(open: boolean): void {
  try {
    sessionStorage.setItem(FILL_OPEN_KEY, open ? '1' : '0');
  } catch {
    /* private mode: the disclosure just forgets */
  }
}

const fmtScale = (v: number) => `×${v.toFixed(2)}`;
const fmtDeg = (v: number) => `${Math.round(v)}°`;
const fmtPct = (v: number) => `${Math.round(v * 100)}%`;

function mixedFormat<T>(model: Mixed<T>, fmt: (v: number) => string): (v: number) => string {
  return (v) => (isMixed(model) ? 'Mixed' : fmt(v));
}

function ShapeFields({
  layerId,
  ids,
  onOpenAssets,
}: {
  layerId: string;
  ids: readonly string[];
  onOpenAssets?: (type?: AssetTypeFilter) => void;
}) {
  const layer = useStore((s) => s.layers.find((l) => l.id === layerId)) as DungeonLayer | undefined;
  // Pack labels and thumbnails arrive after boot; re-read the catalogue when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  const { live, commit, revert } = useLiveEdit(layerId);
  const [fillOpen, setFillOpen] = useState(loadFillOpen);

  const shapes = (layer?.children ?? []).filter(
    (c): c is ShapeChild => c.childType === 'shape' && ids.includes(c.id),
  );
  if (!layer || shapes.length === 0) return null;

  const style = layer.style as DungeonStyle;
  const m = shapeFillModel(shapes, style);
  const head = shapes[0];

  // Colour pins only the floors it paints, and Tint only the textured ones: a colour
  // pinned under a texture shows nowhere and would later shadow the layer's colour.
  const colourIds = m.plainIds.length > 0 ? m.plainIds : ids;
  const tintIds = m.texturedIds.length > 0 ? m.texturedIds : ids;
  const setColor = (color: string) =>
    live(colourIds, (c) => ({ styleOverrides: { ...(c.styleOverrides ?? {}), floorColor: color } }));
  const commitColor = () =>
    commit(
      'Floor colour',
      (id, before, after) =>
        new ShapeStyleCommand(
          'Floor colour',
          layerId,
          id,
          before.styleOverrides as Partial<DungeonStyle> | undefined,
          after.styleOverrides as Partial<DungeonStyle> | undefined,
        ),
      true,
    );
  const resetColor = () =>
    run(
      'Reset to layer defaults',
      shapes
        .filter(hasStyleOverrides)
        .map(
          (s) =>
            new ShapeStyleCommand(
              'Reset to layer defaults',
              layerId,
              s.id,
              s.styleOverrides as Partial<DungeonStyle>,
              undefined,
            ),
        ),
      true,
    );

  const fillChanged = hasFillOverrides(shapes);
  const resetFill = () =>
    run(
      'Reset fill',
      shapes
        .filter((s) => hasFillOverrides([s]))
        .map(
          (s) =>
            new UpdateChildCommand(
              'Reset fill',
              layerId,
              s.id,
              {
                textureScale: s.textureScale,
                textureOffsetX: s.textureOffsetX,
                textureOffsetY: s.textureOffsetY,
                textureFillRotation: s.textureFillRotation,
                textureTint: s.textureTint,
              } as Partial<AnyChild>,
              { ...TEXTURE_DEFAULTS } as Partial<AnyChild>,
            ),
        ),
      true,
    );

  const numSlider = (key: TextureNumberKey) => ({
    onChange: (v: number) => live(ids, { [key]: v }),
    onCommit: () => commit('Texture fill'),
  });

  const textureId = isMixed(m.textureId) ? undefined : m.textureId;
  const textureName = isMixed(m.textureId)
    ? 'Mixed'
    : textureId
      ? shortTextureName(textureId, getCatalogEntry(textureId)?.label)
      : 'None';
  const tint = isMixed(m.textureTint) ? MIXED_SWATCH : m.textureTint;
  const tintNone = !isMixed(m.textureTint) && m.textureTint.toLowerCase() === TEXTURE_DEFAULTS.textureTint;
  const color = isMixed(m.floorColor) ? MIXED_SWATCH : m.floorColor;
  const rows = fieldsForFloor(m.textured, m.hasOverrides);
  const resetLink = (
    <button type="button" className="v2-link v2-selc__end" data-tip="Back to the layer's colour" onClick={resetColor}>
      Reset
    </button>
  );

  const toggleFill = () => {
    setFillOpen((o) => {
      saveFillOpen(!o);
      return !o;
    });
  };

  return (
    <div className="v2-sel__rows v2-selc" data-testid="v2-sel-floor">
      {rows.colour && (
        <div className="v2-sel__row">
          <ColorCtl label="Colour" value={color} onChange={setColor} onCommit={commitColor} placement="beside" />
          <span className="v2-selc__value v2-num">{isMixed(m.floorColor) ? 'Mixed' : color.toUpperCase()}</span>
          {m.hasOverrides && resetLink}
        </div>
      )}

      {rows.pinned && (
        <div className="v2-sel__row" data-testid="v2-sel-floor-pinned">
          <span className="v2-selc__label">Colour</span>
          <span
            className="v2-selc__value v2-selc__value--quiet"
            data-tip="Hidden by the texture; shows if it comes off"
          >
            Own, under texture
          </span>
          {resetLink}
        </div>
      )}

      <div className="v2-sel__row">
        <span className="v2-selc__label">Texture</span>
        <span className="v2-tile v2-selc__thumb">
          {onOpenAssets ? (
            <button
              type="button"
              className="v2-tile__pick"
              aria-label={`Texture ${textureName}, change`}
              data-tip="Change texture"
              onClick={() => onOpenAssets('floor')}
            >
              <TextureThumb id={textureId} />
            </button>
          ) : (
            <span className="v2-tile__pick">
              <TextureThumb id={textureId} />
            </span>
          )}
        </span>
        <span className="v2-selc__value v2-selc__name" title={textureName}>
          {textureName}
        </span>
        {onOpenAssets && (
          <button type="button" className="v2-link v2-selc__end" onClick={() => onOpenAssets('floor')}>
            Change
          </button>
        )}
      </div>

      {rows.tint && (
        <div className={cn('v2-sel__row', tintNone && 'v2-selc--none')}>
          <ColorCtl
            label="Tint"
            placement="beside"
            value={tint}
            onChange={(c) => live(tintIds, { textureTint: c })}
            onCommit={() => commit('Texture tint')}
          />
          <span className="v2-selc__value v2-num">
            {isMixed(m.textureTint) ? 'Mixed' : tintNone ? 'None' : m.textureTint.toUpperCase()}
          </span>
        </div>
      )}

      {rows.fill && (
        <div className="v2-selc__foldhead">
          <button
            type="button"
            className="v2-selc__disclose"
            aria-expanded={fillOpen}
            aria-controls="v2-sel-fill"
            onClick={toggleFill}
          >
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
            <span>Fill</span>
          </button>
          {fillChanged && (
            <button
              type="button"
              className="v2-link v2-selc__end"
              aria-label="Reset fill"
              data-tip="Scale, rotate, offset and tint back to default"
              onClick={resetFill}
            >
              Reset
            </button>
          )}
        </div>
      )}

      {rows.fill && fillOpen && (
        <div className="v2-selc__group" id="v2-sel-fill" data-testid="v2-sel-fill">
          <div className="v2-sel__row">
            <Slider
              label="Scale"
              min={TEXTURE_SCALE_RANGE.min}
              max={TEXTURE_SCALE_RANGE.max}
              step={TEXTURE_SCALE_RANGE.step}
              value={textureValue(head, 'textureScale')}
              format={mixedFormat(m.textureScale, fmtScale)}
              {...numSlider('textureScale')}
            />
          </div>
          <div className="v2-sel__row">
            <Slider
              label="Rotate"
              min={0}
              max={360}
              step={1}
              value={Math.round(radToDeg(textureValue(head, 'textureFillRotation')))}
              format={mixedFormat(m.textureFillRotation, fmtDeg)}
              onChange={(deg) => live(ids, { textureFillRotation: degToRad(deg) })}
              onCommit={() => commit('Texture fill')}
            />
          </div>
          <div className="v2-sel__row">
            <span className="v2-selc__label">Offset</span>
            <NumField
              label="X"
              title="Offset X"
              value={textureValue(head, 'textureOffsetX')}
              mixed={isMixed(m.textureOffsetX)}
              onLive={(v) => live(ids, { textureOffsetX: v })}
              onCommit={() => commit('Texture fill')}
              onRevert={revert}
            />
            <NumField
              label="Y"
              title="Offset Y"
              value={textureValue(head, 'textureOffsetY')}
              mixed={isMixed(m.textureOffsetY)}
              onLive={(v) => live(ids, { textureOffsetY: v })}
              onCommit={() => commit('Texture fill')}
              onRevert={revert}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function TextureThumb({ id }: { id: string | undefined }) {
  if (!id) return <span className="v2-selc__none">None</span>;
  return <PackThumbnailCanvas textureId={id} fit="cover" />;
}

/** A number typed in cells: live while typing, one undo step on Enter or blur, Esc puts it back. */
function NumField({
  label,
  title,
  value,
  mixed,
  onLive,
  onCommit,
  onRevert,
  step = 0.1,
}: {
  label: string;
  title: string;
  value: number;
  mixed: boolean;
  onLive: (v: number) => void;
  onCommit: () => void;
  onRevert: () => void;
  step?: number;
}) {
  // null while not editing: the field then shows the store's value.
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (mixed ? '' : String(Math.round(value * 100) / 100));
  return (
    <label className="v2-field v2-selc__num">
      <span>{label}</span>
      <input
        type="number"
        className="v2-num"
        step={step}
        value={shown}
        placeholder={mixed ? 'Mixed' : undefined}
        aria-label={title}
        onFocus={() => setText(shown)}
        onChange={(e) => {
          setText(e.target.value);
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onLive(v);
        }}
        onBlur={() => {
          setText(null);
          onCommit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.stopPropagation();
            onRevert();
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

/* ── Water ──────────────────────────────────────────────── */

function WaterFields({ layerId, ids }: { layerId: string; ids: readonly string[] }) {
  const layer = useStore((s) => s.layers.find((l) => l.id === layerId)) as DungeonLayer | undefined;
  const { live, commit } = useLiveEdit(layerId);
  const bodies = (layer?.children ?? []).filter(
    (c): c is WaterChild => c.childType === 'water' && ids.includes(c.id),
  );
  if (bodies.length === 0) return null;

  const m = waterModel(bodies);
  const head = bodies[0];
  const tint = isMixed(m.tint) ? MIXED_SWATCH : m.tint;

  const setBanks = (on: boolean) => {
    const next = on ? BANK_TEXTURE_ID : '';
    run(
      on ? 'Show banks' : 'Hide banks',
      bodies
        .filter((b) => b.bankTextureId !== next)
        .map(
          (b) =>
            new UpdateChildCommand(on ? 'Show banks' : 'Hide banks', layerId, b.id, { bankTextureId: b.bankTextureId }, {
              bankTextureId: next,
            }),
        ),
    );
  };

  return (
    <div className="v2-sel__rows v2-selc" data-testid="v2-sel-water">
      <div className="v2-sel__row">
        <Switch label="Banks" checked={m.banks === true} onChange={setBanks} />
        {isMixed(m.banks) && <span className="v2-selc__value">Mixed</span>}
      </div>
      <div className="v2-sel__row">
        <ColorCtl
          label="Tint"
          placement="beside"
          value={tint}
          onChange={(c) => live(ids, { tint: c })}
          onCommit={() => commit('Water tint')}
        />
        <span className="v2-selc__value v2-num">{isMixed(m.tint) ? 'Mixed' : tint.toUpperCase()}</span>
      </div>
      <div className="v2-sel__row">
        <Slider
          label="Opacity"
          min={0}
          max={1}
          step={0.05}
          value={head.opacity}
          format={mixedFormat(m.opacity, fmtPct)}
          onChange={(v) => live(ids, { opacity: v })}
          onCommit={() => commit('Water opacity')}
        />
      </div>
    </div>
  );
}

/* ── Doors ──────────────────────────────────────────────── */

/**
 * A door and what its wall says about it. `room` is the widest its opening may get where
 * it sits (its wall, or the straight run of walls the wall is part of), which caps every
 * width the card can set; `wallSetId` is the set Auto builds its kit from.
 */
function useDoorHost(layerId: string, doorId: string) {
  return useStore(
    useShallow((s) => {
      const none = { door: null, room: Infinity, wallSetId: undefined };
      const layer = s.layers.find((l) => l.id === layerId);
      if (!layer || layer.type !== 'dungeon') return none;
      const dungeon = layer as DungeonLayer;
      const c = dungeon.children.find((x) => x.id === doorId);
      if (!c || c.childType !== 'door') return none;
      const walls = resolveWalls(dungeon);
      const resolved = resolveDoors(dungeon, walls).find((r) => r.door.id === doorId);
      // A detached door has no opening to fit, so nothing caps it, and no wall to take a kit from.
      if (!resolved?.wall) return { ...none, door: c as DoorLike };
      return {
        door: c as DoorLike,
        // In a doorway the walls follow the door, as far as its neighbours allow.
        room: doorwayRoom(dungeon, doorId) ?? doorOpeningLimit(resolved, walls),
        // Resolved the way the renderer builds the door: the wall's own pin, its ring's, else the layer's.
        wallSetId: doorWallLook(
          resolved,
          layerDrawStyle(dungeon),
          ringStyles(dungeon, layerLevelLook(dungeon)),
          edgeStyles(dungeon, layerLevelLook(dungeon)),
        ).setId,
      };
    }),
  );
}

/**
 * A door's width, live while dragged or typed and one undo step when the gesture ends.
 * The walls around a doorway follow it (`writeDoorwayLive` / `doorwayEditCommand`): the
 * pieces either side meet the door's edges at every width, so the opening is the door.
 */
function useDoorWidthEdit(layerId: string, doorId: string) {
  // The layer as the gesture found it: every tick is computed from it, so nothing drifts.
  const from = useRef<DungeonLayer | null>(null);
  const live = useCallback(
    (width: number) => {
      from.current ??= liveLayer(layerId) ?? null;
      if (from.current) writeDoorwayLive(from.current, doorId, {}, { width });
    },
    [layerId, doorId],
  );
  const commit = useCallback(
    (label: string) => {
      const start = from.current;
      from.current = null;
      const door = liveLayer(layerId)?.children.find((c) => c.id === doorId) as DoorChild | undefined;
      if (!start || !door) return;
      const width = door.width;
      // Rewind the preview and replay it as one command, so undo has a clean before.
      revertDoorwayLive(start, doorId);
      const cmd = doorwayEditCommand(label, start, doorId, {}, {}, { width });
      if (cmd) undoManager.execute(cmd);
    },
    [layerId, doorId],
  );
  const revert = useCallback(() => {
    if (from.current) revertDoorwayLive(from.current, doorId);
    from.current = null;
  }, [doorId]);
  return { live, commit, revert };
}

/** A wall door's size row: W is its width along the wall, typed. Its depth is the wall's. */
function DoorDims({ layerId, doorId }: { layerId: string; doorId: string }) {
  const { door, room, wallSetId } = useDoorHost(layerId, doorId);
  const { live, commit, revert } = useDoorWidthEdit(layerId, doorId);
  if (!door) return null;
  const span = doorModel(door, room, wallSetId).width;
  if (!span) return null;
  return (
    <div className="v2-sel__dims" style={{ gridTemplateColumns: '1fr' }}>
      <NumField
        label="W"
        title="Door width"
        value={span.value}
        mixed={false}
        onLive={(v) => live(doorWidthValue(v, span))}
        onCommit={() => commit('Door width')}
        onRevert={revert}
      />
    </div>
  );
}

/** Radians to the 0–180° a door reads as (a door is the same turned a half turn). */
const doorDeg = (rad: number) => ((Math.round((rad * 180) / Math.PI) % 180) + 180) % 180;

/**
 * A door's angle. A door on its own piece of wall (a free-standing door) turns here: its
 * piece turns about the door's centre, live while typed and one undo step when the edit
 * ends. Any other door reads its wall's angle, which only turning the wall changes.
 */
function DoorAngleRow({ layerId, doorId }: { layerId: string; doorId: string }) {
  const { own, deg } = useStore(
    useShallow((s) => {
      const layer = s.layers.find((l) => l.id === layerId);
      if (!layer || layer.type !== 'dungeon') return { own: false, deg: 0 };
      const dungeon = layer as DungeonLayer;
      const r = resolveDoors(dungeon, resolveWalls(dungeon)).find((x) => x.door.id === doorId);
      return { own: isOwnPiece(dungeon, doorId) !== null, deg: doorDeg(r?.angle ?? 0) };
    }),
  );
  // The layer as the edit found it: every tick turns from it, so nothing drifts.
  const from = useRef<DungeonLayer | null>(null);
  const write = (turn: NonNullable<ReturnType<typeof turnOwnPiece>>, side: 'before' | 'after', door: Partial<DoorChild>) => {
    const s = useStore.getState();
    s.updateWall(layerId, turn.wallId, { points: turn[side] });
    s.updateChild(layerId, doorId, door as Partial<AnyChild>);
  };
  const live = (v: number) => {
    from.current ??= liveLayer(layerId) ?? null;
    const turn = from.current && turnOwnPiece(from.current, doorId, (doorAngleValue(v) * Math.PI) / 180);
    if (turn) write(turn, 'after', turn.door);
  };
  const land = (start: DungeonLayer, rad: number) => {
    const turn = turnOwnPiece(start, doorId, rad);
    const door = start.children.find((c): c is DoorChild => c.id === doorId && c.childType === 'door');
    if (!turn || !door) return;
    const before = { angle: door.angle, position: door.position };
    // Rewind any live preview, then land the turn as one command.
    write(turn, 'before', before);
    if (doorDeg(door.angle) === doorDeg(rad) && turn.after.every((p, i) => p[0] === turn.before[i][0] && p[1] === turn.before[i][1])) return;
    undoManager.execute(
      new CompositeCommand('Turn door', [
        new UpdateWallCommand(layerId, turn.wallId, { points: turn.before }, { points: turn.after }),
        new UpdateChildCommand('Turn door', layerId, doorId, before as Partial<AnyChild>, turn.door as Partial<AnyChild>),
      ]),
    );
  };
  const commit = () => {
    const start = from.current;
    from.current = null;
    const now = liveLayer(layerId)?.children.find((c): c is DoorChild => c.id === doorId && c.childType === 'door');
    if (start && now) land(start, now.angle);
  };
  const revert = () => {
    const start = from.current;
    from.current = null;
    const door = start?.children.find((c): c is DoorChild => c.id === doorId && c.childType === 'door');
    const piece = start && isOwnPiece(start, doorId);
    if (!piece || !door) return;
    useStore.getState().updateWall(layerId, piece.id, { points: piece.points });
    useStore.getState().updateChild(layerId, doorId, { angle: door.angle, position: door.position } as Partial<AnyChild>);
  };

  if (!own) {
    return (
      <div className="v2-sel__row" data-testid="v2-door-angle">
        <span className="v2-rrow__lbl">Angle</span>
        <span className="v2-selc__value v2-num">{deg}°</span>
        <span className="v2-rquiet">Turn the wall to turn this door</span>
      </div>
    );
  }
  return (
    <div className="v2-sel__row" data-testid="v2-door-angle">
      <NumField label="Angle" title="Door angle" value={deg} mixed={false} step={DOOR_ANGLE_STEP} onLive={live} onCommit={commit} onRevert={revert} />
      <button
        type="button"
        className="v2-rbtn"
        onClick={() => {
          const layer = liveLayer(layerId);
          if (layer) land(layer, (turnDoorAngle(deg) * Math.PI) / 180);
        }}
      >
        Turn 90°
      </button>
    </div>
  );
}

/**
 * A door's fields: name, style, state, secret and, for a door on a wall, its width.
 * A joint between two rooms wears the same fields less the width, which it was drawn at.
 * A single or double wall door picks its kit (Material: Auto follows the wall's set), and
 * a door built from one also hangs: how far it opens, which edge it hangs on, which way
 * it swings and whether its hinges show.
 * Each change is one undo step; a width or opening drag is one step for the whole drag.
 */
function DoorFields({ layerId, doorId }: { layerId: string; doorId: string }) {
  const { door, room, wallSetId } = useDoorHost(layerId, doorId);
  const { live, commit } = useLiveEdit(layerId);
  const width = useDoorWidthEdit(layerId, doorId);
  const [nameText, setNameText] = useState<string | null>(null);
  const cancelled = useRef(false);
  if (!door) return null;

  const m = doorModel(door, room, wallSetId);
  const { kit, material, width: span } = m;
  const update = (label: string, before: Partial<DoorLike>, after: Partial<DoorLike>) =>
    undoManager.execute(
      new UpdateChildCommand(label, layerId, doorId, before as Partial<AnyChild>, after as Partial<AnyChild>),
    );

  const commitName = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setNameText(null);
      return;
    }
    const next = nameText === null ? null : cleanDoorName(nameText, door.name);
    setNameText(null);
    if (next !== null) update('Rename door', { name: door.name }, { name: next });
  };

  return (
    <div className="v2-sel__rows v2-selc" data-testid="v2-sel-door">
      <label className="v2-field v2-selc__text">
        <span>Name</span>
        <input
          value={nameText ?? door.name}
          aria-label="Door name"
          placeholder={doorStyleLabel(m.style)}
          spellCheck={false}
          onFocus={() => {
            cancelled.current = false;
          }}
          onChange={(e) => setNameText(e.target.value)}
          onBlur={commitName}
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
      <div className="v2-sel__row">
        <Select
          label="Style"
          value={m.style}
          options={m.styles}
          onChange={(next) => {
            if (next === m.style) return;
            const { before, after } = doorStyleChange(door, next, room);
            const layer = liveLayer(layerId);
            // A wall door's width rides with its doorway's walls; a joint has no walls to move.
            const cmd =
              door.childType === 'door' && layer
                ? doorwayEditCommand('Door style', layer, doorId, { style: door.style }, { style: next }, { width: (after as Partial<DoorChild>).width })
                : null;
            if (cmd) undoManager.execute(cmd);
            else update('Door style', before, after);
          }}
        />
      </div>
      {/* An archway cannot be shut, so it has no state to set. */}
      {m.showState && (
        <div className="v2-sel__row">
          <Seg
            label="State"
            value={m.state}
            options={DOOR_STATES}
            onChange={(next) => {
              if (next !== door.state) update('Door state', { state: door.state }, { state: next });
            }}
          />
        </div>
      )}
      {/* How far a kit door stands open, under the state. While it is shut this sets the
          angle it will open to, and the value says so. */}
      {kit && m.showState && (
        <div className="v2-sel__row">
          <Slider
            label="Opens to"
            min={0}
            max={MAX_OPEN_ANGLE}
            step={OPEN_ANGLE_STEP}
            value={kit.openAngle}
            format={(v) => (kit.opensLater ? `${fmtDeg(v)} when open` : fmtDeg(v))}
            onChange={(v) => live([doorId], { openAngle: v })}
            onCommit={() => commit('Door opening')}
          />
        </div>
      )}
      <div className="v2-sel__row">
        <Switch
          label="Secret"
          checked={m.secret}
          onChange={(v) => update(v ? 'Make door secret' : 'Make door plain', { isSecret: door.isSecret }, { isSecret: v })}
        />
      </div>
      {span && (
        <div className="v2-sel__row">
          <Slider
            label="Width"
            min={span.min}
            max={span.max}
            step={DOOR_WIDTH_STEP}
            value={span.value}
            format={(v) => `${v.toFixed(2)} sq`}
            onChange={(v) => width.live(doorWidthValue(v, span))}
            onCommit={() => width.commit('Door width')}
          />
        </div>
      )}
      {door.childType === 'door' && <DoorAngleRow layerId={layerId} doorId={doorId} />}
      {material && (
        <div className="v2-sel__row">
          <Select
            label="Material"
            value={material.value}
            options={material.options}
            onChange={(next) => {
              if (next === material.value) return;
              update('Door material', { kit: door.childType === 'door' ? door.kit : undefined }, { kit: doorKitField(next) });
            }}
          />
        </div>
      )}
      {kit && door.childType === 'door' && (
        <>
          {kit.hinge && (
            <div className="v2-sel__row">
              <Seg
                label="Hinge"
                value={kit.hinge}
                options={DOOR_HINGES}
                onChange={(next) => {
                  if (next !== kit.hinge) update('Door hinge', { hinge: door.hinge }, { hinge: next });
                }}
              />
            </div>
          )}
          <div className="v2-sel__row">
            <Seg
              label="Swing"
              value={swingChoice(kit.swing)}
              options={DOOR_SWINGS}
              onChange={(next) => {
                const swing = swingValue(next);
                if (swing !== kit.swing) update('Door swing', { swing: door.swing }, { swing });
              }}
            />
          </div>
          <div className="v2-sel__row">
            <Switch
              label="Hinges"
              checked={kit.hinges}
              onChange={(v) => update(v ? 'Show hinges' : 'Hide hinges', { hinges: door.hinges }, { hinges: v })}
            />
          </div>
        </>
      )}
    </div>
  );
}

/* ── Rooms ──────────────────────────────────────────────── */

/* ── Drawn walls ────────────────────────────────────────── */

/**
 * A drawn wall: how it treats light and sight (the dock's three types), and the set its
 * stones or rock come from, its own pin or the layer's. The set is shown, not picked here:
 * the Walls strip picks it for the layer.
 */
function WallFields({ layerId, wallId }: { layerId: string; wallId: string }) {
  const { wall, style } = useStore(
    useShallow((s) => {
      const found = selectWallById(s, wallId);
      return { wall: found?.wall, style: found?.layer.style };
    }),
  );
  // The kits arrive with the packs, after boot; re-read when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  if (!wall || !style) return null;
  const m = wallModel(wall, style, wallSetLabel);

  return (
    <div className="v2-sel__rows v2-selc" data-testid="v2-sel-wall">
      <div className="v2-sel__row">
        <Seg
          label="Type"
          value={m.type}
          options={WALL_TYPE_CHOICES}
          onChange={(next) => {
            const change = wallTypeChange(wall, next);
            if (!change) return;
            const layer = liveLayer(layerId);
            const reason = blockedLayerReason(layer);
            if (reason) {
              notify.warning(reason);
              return;
            }
            undoManager.execute(new UpdateWallCommand(layerId, wallId, change.before, change.after));
          }}
        />
      </div>
      <div className="v2-sel__row">
        <span className="v2-selc__label">Set</span>
        <span className="v2-selc__value">{m.setName ?? 'None'}</span>
      </div>
      <WallStones layerId={layerId} wall={wall} />
    </div>
  );
}

/** How many stones the wall shows (a cave band's rock is a walk, not stones). */
function WallStones({ layerId, wall }: { layerId: string; wall: WallSegment }) {
  const layer = useStore((s) => s.layers.find((l) => l.id === layerId)) as DungeonLayer | undefined;
  const count = useMemo(() => (layer ? wallStoneCount(layer, wall) : null), [layer, wall]);
  return (
    <div className="v2-sel__row" data-testid="v2-wall-stones">
      <span className="v2-selc__label">Stones</span>
      <span className="v2-selc__value v2-num">{count === null ? 'Cave rock' : `${count} stones`}</span>
    </div>
  );
}

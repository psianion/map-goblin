import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
  Box,
  ChevronDown,
  ChevronRight,
  Crosshair,
  DoorOpen,
  Eye,
  EyeOff,
  GripVertical,
  Lightbulb,
  Lock,
  LockOpen,
  Minus,
  MoreHorizontal,
  Mountain,
  Plus,
  Search,
  Settings2,
  Square,
  SquareDashed,
  Type,
  Waves,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useVirtualizer } from '@tanstack/react-virtual';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '@/store/store';
import { TERRAIN_PANEL_ID, type AnyChild, type DungeonLayer, type Layer, type WallSegment } from '@/store/types';
import { PropertyCommand, ReorderChildCommand, TerrainAppearanceCommand, UpdateWallCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { cn } from '@/lib/utils';
import { ContextMenu, useContextMenu } from '@/components/ui/context-menu';
import { openCanvasMenuRef } from '@/components/canvas/canvasMenuRef';
import { buildLayerTileMenu } from '@/canvas/menuRegistry';
import { computeChildDragReorder } from '@/components/layers/childReorder';
import { getChildBounds, getWallBounds } from '@dnd/core/src/engine/hitTest';
import { wallStoneCount } from '@dnd/core/src/engine/wallNodeOverlay';
import { standaloneWallLook } from '@dnd/core/src/shared/wallLook';
import { layerDrawStyle } from '@dnd/core/src/engine/levelLook';
import { isLayerEffectivelyVisible } from '@/store/selectors';
import { SlideOver } from './SlideOver';
import { LevelIcon } from './roomIcons';
import { useLayerThumb } from './layerThumbs';
import { wallSetLabel } from './assetStrip';
import { jumpToPoint } from './jumpTo';
import { buildSheetRows, KIND_LABEL, VIRTUAL_ROWS, type RowKind, type SheetRow } from './layerRows';
import {
  addLayerOnShownLevel,
  deleteLayer,
  moveLayerOnto,
  moveLayerToLevelTop,
  renameLayer,
  toggleLayerLocked,
  toggleLayerVisible,
  toggleSolo,
} from './layerActions';
import { loadLayersSheetFilter, saveLayersSheetFilter } from '../viewPrefs';
import './layers-sheet.css';

const ROW_H = 30;

const KIND_ICON: Record<RowKind, ReactNode> = {
  room: <SquareDashed size={13} strokeWidth={1.75} />,
  wall: <Minus size={13} strokeWidth={1.75} />,
  door: <DoorOpen size={13} strokeWidth={1.75} />,
  asset: <Box size={13} strokeWidth={1.75} />,
  light: <Lightbulb size={13} strokeWidth={1.75} />,
  text: <Type size={13} strokeWidth={1.75} />,
  zone: <Crosshair size={13} strokeWidth={1.75} />,
  shape: <Square size={13} strokeWidth={1.75} />,
  water: <Waves size={13} strokeWidth={1.75} />,
};

/** Set by a row click, so the reveal that follows the selection leaves the scroll alone. */
const sheetOrigin = { current: false };

function toggleObjectFlag(row: Extract<SheetRow, { kind: 'object' }>, key: 'visible' | 'locked') {
  const was = key === 'visible' ? row.visible !== false : row.locked === true;
  const label = key === 'visible' ? (was ? 'Hide' : 'Show') : was ? 'Unlock' : 'Lock';
  if (row.wall) {
    undoManager.execute(new UpdateWallCommand(row.layerId, row.id, { [key]: row.wall[key] }, { [key]: !was }));
  } else if (row.child) {
    undoManager.execute(
      new PropertyCommand(label, { type: 'child', layerId: row.layerId, childId: row.id }, { [key]: row.child[key] }, { [key]: !was }),
    );
  }
}

function objectCentre(row: Extract<SheetRow, { kind: 'object' }>): { x: number; y: number } | null {
  if (row.room) return { x: row.room.anchor[0], y: row.room.anchor[1] };
  const b = row.child ? getChildBounds(row.child) : row.wall ? getWallBounds(row.wall) : null;
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
}

function selectObject(row: Extract<SheetRow, { kind: 'object' }>, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
  const s = useStore.getState();
  const ids = s.selection.selectedIds;
  sheetOrigin.current = true;
  if (e.ctrlKey || e.metaKey) {
    s.setSelectedIds(ids.includes(row.id) ? ids.filter((x) => x !== row.id) : [...ids, row.id]);
    return;
  }
  if (e.shiftKey) {
    if (!ids.includes(row.id)) s.setSelectedIds([...ids, row.id]);
    return;
  }
  s.setActiveLayerId(row.layerId);
  s.setSelectedIds([row.id]);
}

/** Inline name field: Enter keeps, Escape reverts, blank keeps the old name. */
function RenameField({ value, label, onDone }: { value: string; label: string; onDone: (name: string | null) => void }) {
  const [draft, setDraft] = useState(value);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      className="v2-lrow__rename"
      aria-label={label}
      value={draft}
      autoFocus
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(draft)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(draft);
        else if (e.key === 'Escape') finish(null);
      }}
    />
  );
}

function IconButton({
  label,
  onClick,
  children,
  className,
  testId,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={cn('v2-ib v2-ib--sm', className)}
      aria-label={label}
      data-tip={label}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {children}
    </button>
  );
}

function LayerThumb({ layer }: { layer: DungeonLayer }) {
  const url = useLayerThumb(layer.id);
  return (
    <span className="v2-lrow__thumb">
      {url ? <img src={url} alt="" draggable={false} /> : <span className="v2-lrow__swatch" style={{ background: layer.style.floorColor, borderColor: layer.style.wallColor }} />}
    </span>
  );
}

interface RowProps {
  row: SheetRow;
  focused: boolean;
  onFocusRow: (key: string) => void;
  renaming: string | null;
  setRenaming: (key: string | null) => void;
  onToggleLevel: (levelId: string) => void;
  onOpenLayerSettings: (id: string) => void;
}

function LevelRowView({ row, focused, onFocusRow, onToggleLevel }: RowProps & { row: Extract<SheetRow, { kind: 'level' }> }) {
  const { setNodeRef, isOver } = useDroppable({ id: row.key, data: { type: 'level', levelId: row.level.id } });
  const count =
    row.matchCount !== null
      ? `${row.matchCount} layer${row.matchCount === 1 ? '' : 's'} match${row.matchCount === 1 ? 'es' : ''}`
      : `${row.layerCount} layer${row.layerCount === 1 ? '' : 's'}`;
  return (
    <div
      ref={setNodeRef}
      className={cn('v2-lrow v2-lrow--level', isOver && 'v2-lrow--drop')}
      role="treeitem"
      aria-level={1}
      aria-expanded={row.open}
      aria-selected={false}
      tabIndex={focused ? 0 : -1}
      data-row-key={row.key}
      data-testid="v2-layers-level"
      data-level-id={row.level.id}
      onFocus={() => onFocusRow(row.key)}
      onClick={() => onToggleLevel(row.level.id)}
    >
      <span className="v2-lrow__fold">{row.open ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}</span>
      <LevelIcon size={13} />
      <span className="v2-lrow__name">{row.level.name || 'Unnamed level'}</span>
      <span className="v2-lrow__count">{count}</span>
    </div>
  );
}

function LayerRowView({ row, focused, onFocusRow, renaming, setRenaming, onOpenLayerSettings }: RowProps & { row: Extract<SheetRow, { kind: 'layer' }> }) {
  const layer = row.layer;
  const active = useStore((s) => s.ui.activeLayerId === layer.id);
  const soloed = useStore((s) => s.ui.solo?.layerId === layer.id);
  const shown = useStore((s) => isLayerEffectivelyVisible(s, layer));
  const menu = useContextMenu();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: layer.id,
    data: { type: 'layer', levelId: row.levelId },
  });
  const isRenaming = renaming === row.key;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, paddingLeft: 6 + row.depth * 12 }}
      className={cn('v2-lrow v2-lrow--layer', active && 'v2-lrow--on', !shown && 'v2-lrow--dim', isDragging && 'v2-lrow--lifted')}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={row.open}
      aria-selected={active}
      tabIndex={focused ? 0 : -1}
      data-row-key={row.key}
      data-layer-id={layer.id}
      data-testid="v2-layers-layer"
      onFocus={() => onFocusRow(row.key)}
      onClick={() => useStore.getState().setActiveLayerId(layer.id)}
      onDoubleClick={() => setRenaming(row.key)}
      onContextMenu={menu.open}
    >
      <span className="v2-lrow__grip" aria-label={`Drag ${layer.name}`} {...attributes} {...listeners} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <GripVertical size={12} strokeWidth={1.75} />
      </span>
      <IconButton label={row.open ? 'Collapse' : 'Expand'} className="v2-lrow__fold" onClick={() => useStore.getState().toggleExpandedLayerId(layer.id)}>
        {row.open ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}
      </IconButton>
      <LayerThumb layer={layer} />
      {isRenaming ? (
        <RenameField
          value={layer.name}
          label="Layer name"
          onDone={(name) => {
            if (name !== null) renameLayer(layer, name);
            setRenaming(null);
          }}
        />
      ) : (
        <span className="v2-lrow__name">
          {layer.name || 'Unnamed layer'}
          {row.nameMatch && <span className="v2-lrow__why">layer name</span>}
        </span>
      )}
      <span className="v2-lrow__count v2-num">{row.count}</span>
      <span className="v2-lrow__icons">
        <IconButton
          label={soloed ? 'Unsolo' : layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
          className={cn(!layer.visible && 'v2-lrow__ic--off', soloed && 'v2-lrow__ic--solo')}
          testId="v2-layers-eye"
          onClick={(e) => (e.altKey ? toggleSolo(layer.id) : toggleLayerVisible(layer))}
        >
          {layer.visible ? <Eye size={13} strokeWidth={1.75} /> : <EyeOff size={13} strokeWidth={1.75} />}
        </IconButton>
        <IconButton label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`} className={cn(!layer.locked && 'v2-lrow__ic--quiet')} testId="v2-layers-lock" onClick={() => toggleLayerLocked(layer)}>
          {layer.locked ? <Lock size={13} strokeWidth={1.75} /> : <LockOpen size={13} strokeWidth={1.75} />}
        </IconButton>
        <IconButton
          label="Layer menu"
          testId="v2-layers-more"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            menu.openAt(r.left, r.bottom + 4);
          }}
        >
          <MoreHorizontal size={13} strokeWidth={1.75} />
        </IconButton>
      </span>
      {menu.pos && (
        <ContextMenu
          pos={menu.pos}
          onClose={menu.close}
          items={buildLayerTileMenu(layer, { onRename: () => setRenaming(row.key), onSettings: () => onOpenLayerSettings(layer.id) })}
        />
      )}
    </div>
  );
}

function GroupRowView({ row, focused, onFocusRow }: RowProps & { row: Extract<SheetRow, { kind: 'group' }> }) {
  return (
    <div
      className="v2-lrow v2-lrow--group"
      style={{ paddingLeft: 6 + row.depth * 12 }}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={row.open}
      aria-selected={false}
      tabIndex={focused ? 0 : -1}
      data-row-key={row.key}
      data-testid="v2-layers-group"
      data-kind={row.type}
      onFocus={() => onFocusRow(row.key)}
      onClick={() => useStore.getState().toggleChildGroup(`${row.layerId}:${row.type}`)}
    >
      <span className="v2-lrow__fold">{row.open ? <ChevronDown size={11} strokeWidth={2} /> : <ChevronRight size={11} strokeWidth={2} />}</span>
      {KIND_ICON[row.type]}
      <span className="v2-lrow__name">{KIND_LABEL[row.type]}</span>
      <span className="v2-lrow__count v2-num">{row.count}</span>
    </div>
  );
}

function WallMeta({ layerId, wall }: { layerId: string; wall: WallSegment }) {
  const layer = useStore((s) => s.layers.find((l) => l.id === layerId)) as DungeonLayer | undefined;
  const text = useMemo(() => {
    if (!layer) return '';
    const look = standaloneWallLook(wall, layerDrawStyle(layer));
    const stones = wallStoneCount(layer, wall);
    const set = look.setId ? wallSetLabel(look.setId) : 'no set';
    return stones === null ? set : `${stones} stones · ${set}`;
  }, [layer, wall]);
  return <span className="v2-lrow__meta">{text}</span>;
}

function ObjectRowView({ row, focused, onFocusRow, renaming, setRenaming }: RowProps & { row: Extract<SheetRow, { kind: 'object' }> }) {
  const selected = useStore((s) => s.selection.selectedIds.includes(row.id));
  const reveal = useStore((s) => s.ui.revealChildId === row.id);
  const ref = useRef<HTMLDivElement | null>(null);
  const sortable = useSortable({ id: row.id, data: { type: 'child', layerId: row.layerId, kind: row.type }, disabled: !row.child });
  useEffect(() => {
    if (!reveal) return;
    ref.current?.scrollIntoView?.({ block: 'nearest' });
    useStore.getState().setRevealChildId(null);
  }, [reveal]);
  const isRenaming = renaming === row.key;
  return (
    <div
      ref={(el) => {
        ref.current = el;
        sortable.setNodeRef(el);
      }}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition, paddingLeft: 6 + row.depth * 12 }}
      className={cn('v2-lrow v2-lrow--object', selected && 'v2-lrow--sel', row.visible === false && 'v2-lrow--dim')}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      tabIndex={focused ? 0 : -1}
      data-row-key={row.key}
      data-object-id={row.id}
      data-kind={row.type}
      data-testid="v2-layers-object"
      onFocus={() => onFocusRow(row.key)}
      onClick={(e) => selectObject(row, e)}
      onDoubleClick={() => {
        const c = objectCentre(row);
        if (c) jumpToPoint(c, ref.current?.closest('.v2-sheet') ?? null);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        selectObject(row, { shiftKey: false, ctrlKey: false, metaKey: false });
        openObjectMenu(row, e.clientX, e.clientY);
      }}
    >
      {row.child ? (
        <span className="v2-lrow__grip" aria-label={`Drag ${row.name}`} {...sortable.attributes} {...sortable.listeners} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
          <GripVertical size={12} strokeWidth={1.75} />
        </span>
      ) : (
        <span className="v2-lrow__grip v2-lrow__grip--none" />
      )}
      <span className="v2-lrow__kind">{KIND_ICON[row.type]}</span>
      {isRenaming && row.child ? (
        <RenameField
          value={row.child.name}
          label="Object name"
          onDone={(name) => {
            const next = name?.trim();
            if (row.child && next && next !== row.child.name) {
              undoManager.execute(new PropertyCommand('Rename', { type: 'child', layerId: row.layerId, childId: row.id }, { name: row.child.name }, { name: next }));
            }
            setRenaming(null);
          }}
        />
      ) : (
        <span className="v2-lrow__name">{row.name}</span>
      )}
      {row.wall && <WallMeta layerId={row.layerId} wall={row.wall} />}
      {row.type !== 'room' && (
        <span className="v2-lrow__icons">
          <IconButton
            label={row.visible === false ? `Show ${row.name}` : `Hide ${row.name}`}
            className={cn(row.visible === false && 'v2-lrow__ic--off')}
            testId="v2-layers-obj-eye"
            onClick={() => toggleObjectFlag(row, 'visible')}
          >
            {row.visible === false ? <EyeOff size={13} strokeWidth={1.75} /> : <Eye size={13} strokeWidth={1.75} />}
          </IconButton>
          <IconButton
            label={row.locked ? `Unlock ${row.name}` : `Lock ${row.name}`}
            className={cn(!row.locked && 'v2-lrow__ic--quiet')}
            testId="v2-layers-obj-lock"
            onClick={() => toggleObjectFlag(row, 'locked')}
          >
            {row.locked ? <Lock size={13} strokeWidth={1.75} /> : <LockOpen size={13} strokeWidth={1.75} />}
          </IconButton>
          <IconButton
            label="Object menu"
            testId="v2-layers-obj-more"
            onClick={(e) => {
              selectObject(row, { shiftKey: false, ctrlKey: false, metaKey: false });
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              openObjectMenu(row, r.left, r.bottom + 4);
            }}
          >
            <MoreHorizontal size={13} strokeWidth={1.75} />
          </IconButton>
        </span>
      )}
    </div>
  );
}

/** The object's own canvas menu, at a viewport point. */
function openObjectMenu(row: Extract<SheetRow, { kind: 'object' }>, x: number, y: number) {
  const world = objectCentre(row) ?? { x: 0, y: 0 };
  const target = row.room
    ? ({ kind: 'room', roomId: row.id, layerId: row.layerId } as const)
    : row.wall
      ? ({ kind: 'wall', wallId: row.id } as const)
      : ({ kind: 'child', childId: row.id } as const);
  openCanvasMenuRef.current?.({ x, y, world, target });
}

function RowView(props: RowProps) {
  const { row } = props;
  if (row.kind === 'level') return <LevelRowView {...props} row={row} />;
  if (row.kind === 'layer') return <LayerRowView {...props} row={row} />;
  if (row.kind === 'group') return <GroupRowView {...props} row={row} />;
  return <ObjectRowView {...props} row={row} />;
}

/** Terrain and Background, pinned under the tree: they belong to the whole map. */
function PinnedRows({ onOpenLayerSettings }: { onOpenLayerSettings: (id: string) => void }) {
  const bg = useStore((s) => s.layers.find((l) => l.type === 'background')) as Layer | undefined;
  const terrainVisible = useStore((s) => s.mapSettings.terrain?.visible ?? true);
  const activeId = useStore((s) => s.ui.activeLayerId);
  return (
    <div className="v2-lsheets__pinned" data-testid="v2-layers-pinned">
      <div
        className={cn('v2-lrow v2-lrow--pinned', activeId === TERRAIN_PANEL_ID && 'v2-lrow--on', !terrainVisible && 'v2-lrow--dim')}
        data-testid="v2-layers-terrain"
        onClick={() => useStore.getState().setActiveLayerId(TERRAIN_PANEL_ID)}
      >
        <span className="v2-lrow__kind">
          <Mountain size={13} strokeWidth={1.75} />
        </span>
        <span className="v2-lrow__name">Terrain</span>
        <span className="v2-lrow__meta">map-wide</span>
        <span className="v2-lrow__icons">
          <IconButton
            label={terrainVisible ? 'Hide Terrain' : 'Show Terrain'}
            className={cn(!terrainVisible && 'v2-lrow__ic--off')}
            onClick={() => undoManager.execute(new TerrainAppearanceCommand({ visible: terrainVisible }, { visible: !terrainVisible }))}
          >
            {terrainVisible ? <Eye size={13} strokeWidth={1.75} /> : <EyeOff size={13} strokeWidth={1.75} />}
          </IconButton>
          <IconButton label="Terrain settings" onClick={() => onOpenLayerSettings(TERRAIN_PANEL_ID)}>
            <Settings2 size={13} strokeWidth={1.75} />
          </IconButton>
        </span>
      </div>
      {bg && (
        <div
          className={cn('v2-lrow v2-lrow--pinned', activeId === bg.id && 'v2-lrow--on', !bg.visible && 'v2-lrow--dim')}
          data-testid="v2-layers-background"
          onClick={() => useStore.getState().setActiveLayerId(bg.id)}
        >
          <span className="v2-lrow__kind">
            <Square size={13} strokeWidth={1.75} />
          </span>
          <span className="v2-lrow__name">{bg.name || 'Background'}</span>
          <span className="v2-lrow__meta">map-wide</span>
          <span className="v2-lrow__icons">
            <IconButton label={bg.visible ? 'Hide Background' : 'Show Background'} className={cn(!bg.visible && 'v2-lrow__ic--off')} onClick={() => toggleLayerVisible(bg)}>
              {bg.visible ? <Eye size={13} strokeWidth={1.75} /> : <EyeOff size={13} strokeWidth={1.75} />}
            </IconButton>
            <IconButton label={bg.locked ? 'Unlock Background' : 'Lock Background'} className={cn(!bg.locked && 'v2-lrow__ic--quiet')} onClick={() => toggleLayerLocked(bg)}>
              {bg.locked ? <Lock size={13} strokeWidth={1.75} /> : <LockOpen size={13} strokeWidth={1.75} />}
            </IconButton>
            <IconButton label="Background settings" onClick={() => onOpenLayerSettings(bg.id)}>
              <Settings2 size={13} strokeWidth={1.75} />
            </IconButton>
          </span>
        </div>
      )}
    </div>
  );
}

/** The parent row of `index` (the nearest row above it at a lower depth). */
function parentIndex(rows: SheetRow[], index: number): number {
  const depthOf = (r: SheetRow) => (r.kind === 'level' ? 0 : r.depth);
  const d = depthOf(rows[index]);
  for (let i = index - 1; i >= 0; i--) if (depthOf(rows[i]) < d) return i;
  return -1;
}

/**
 * The Layers sheet (board L3): every level, its layers top of the stack first, and each
 * layer's objects by kind (rooms and drawn walls included), each row with its eye and
 * lock. Replaces the v1 layer panel on /v2.
 */
export function LayersSheet({ open, onClose, onOpenLayerSettings }: { open: boolean; onClose: () => void; onOpenLayerSettings: (id: string) => void }) {
  return (
    <SlideOver
      title="Layers"
      open={open}
      onClose={onClose}
      testId="v2-layers-sheet"
      legacy={false}
      className="v2-lsheets"
      header={
        <header className="v2-sheet__head">
          <h2>Layers</h2>
          <span className="v2-lsheets__headacts">
            <button type="button" className="v2-ib" aria-label="Add layer" data-tip="Add layer" data-testid="v2-layers-add" onClick={() => addLayerOnShownLevel()}>
              <Plus size={15} strokeWidth={1.75} />
            </button>
            <button type="button" className="v2-ib" aria-label="Close Layers" onClick={onClose}>
              <X size={15} strokeWidth={1.75} />
            </button>
          </span>
        </header>
      }
      footer={<PinnedRows onOpenLayerSettings={onOpenLayerSettings} />}
    >
      <LayersTree onOpenLayerSettings={onOpenLayerSettings} />
    </SlideOver>
  );
}

export function LayersTree({ onOpenLayerSettings }: { onOpenLayerSettings: (id: string) => void }) {
  const st = useStore(
    useShallow((s) => ({
      layers: s.layers,
      levels: s.levels,
      activeLevelId: s.ui.activeLevelId,
      expandedLayerIds: s.ui.expandedLayerIds,
      childGroupOverrides: s.ui.childGroupOverrides,
    })),
  );
  const [filter, setFilterState] = useState(loadLayersSheetFilter);
  const setFilter = (v: string) => {
    setFilterState(v);
    saveLayersSheetFilter(v);
  };
  const [levelOverrides, setLevelOverrides] = useState<Set<string>>(() => new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => buildSheetRows({ ...st, levelOverrides, filter }), [st, levelOverrides, filter]);
  const focusIndex = Math.max(0, rows.findIndex((r) => r.key === focusKey));

  const onToggleLevel = useCallback((levelId: string) => {
    setLevelOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(levelId)) next.delete(levelId);
      else next.add(levelId);
      return next;
    });
  }, []);

  // A canvas selection opens its row's layer and kind group, and scrolls to it.
  const selectedIds = useStore(useShallow((s) => s.selection.selectedIds));
  useEffect(() => {
    if (sheetOrigin.current) {
      sheetOrigin.current = false;
      return;
    }
    const id = selectedIds[0];
    if (!id) return;
    const s = useStore.getState();
    for (const layer of s.layers) {
      if (layer.type !== 'dungeon') continue;
      const child = layer.children.find((c) => c.id === id);
      const kind: RowKind | null = child
        ? child.childType
        : layer.standaloneWalls.some((w) => w.id === id)
          ? 'wall'
          : (layer.rooms ?? []).some((r) => r.id === id)
            ? 'room'
            : null;
      if (!kind) continue;
      if (!s.ui.expandedLayerIds.includes(layer.id)) s.toggleExpandedLayerId(layer.id);
      const key = `${layer.id}:${kind}`;
      const open = (kind !== 'asset') !== s.ui.childGroupOverrides.includes(key);
      if (!open) s.toggleChildGroup(key);
      const level = layer.levelId;
      if (s.levels.length > 1) {
        setLevelOverrides((prev) => {
          const isOpen = (level === s.ui.activeLevelId) !== prev.has(level);
          if (isOpen) return prev;
          const next = new Set(prev);
          if (next.has(level)) next.delete(level);
          else next.add(level);
          return next;
        });
      }
      s.setRevealChildId(id);
      break;
    }
  }, [selectedIds]);

  const virtual = rows.length > VIRTUAL_ROWS;
  // The windowed list is the layer panel's own (VirtualChildList); the compiler leaves this
  // component unmemoised, which it can afford.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
    initialRect: { width: 320, height: 600 },
    getItemKey: (i) => rows[i]?.key ?? i,
  });

  // A revealed object row inside the window: bring the window to it first.
  const revealId = useStore((s) => s.ui.revealChildId);
  useEffect(() => {
    if (!virtual || !revealId) return;
    const idx = rows.findIndex((r) => r.kind === 'object' && r.id === revealId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'center' });
  }, [virtual, revealId, rows, virtualizer]);

  const focusRow = (index: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!row) return;
    setFocusKey(row.key);
    if (virtual) virtualizer.scrollToIndex(rows.indexOf(row));
    requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>(`[data-row-key="${row.key}"]`)?.focus());
  };

  const onTreeKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (!t.dataset.rowKey) return;
    const i = rows.findIndex((r) => r.key === t.dataset.rowKey);
    const row = rows[i];
    if (!row) return;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case 'ArrowDown':
        handled();
        focusRow(i + 1);
        return;
      case 'ArrowUp':
        handled();
        focusRow(i - 1);
        return;
      case 'Home':
        handled();
        focusRow(0);
        return;
      case 'End':
        handled();
        focusRow(rows.length - 1);
        return;
      case 'ArrowRight':
      case 'ArrowLeft': {
        handled();
        const opening = e.key === 'ArrowRight';
        const openable = row.kind !== 'object';
        const isOpen = openable && row.open;
        if (openable && opening !== isOpen) {
          if (row.kind === 'level') onToggleLevel(row.level.id);
          else if (row.kind === 'layer') useStore.getState().toggleExpandedLayerId(row.layer.id);
          else if (row.kind === 'group') useStore.getState().toggleChildGroup(`${row.layerId}:${row.type}`);
        } else if (opening && isOpen) focusRow(i + 1);
        else if (!opening) {
          const p = parentIndex(rows, i);
          if (p >= 0) focusRow(p);
        }
        return;
      }
      case 'Enter':
        handled();
        if (row.kind === 'layer') useStore.getState().setActiveLayerId(row.layer.id);
        else if (row.kind === 'object') selectObject(row, e);
        else if (row.kind === 'level') onToggleLevel(row.level.id);
        else useStore.getState().toggleChildGroup(`${row.layerId}:${row.type}`);
        return;
      case 'F2':
        if (row.kind === 'layer' || (row.kind === 'object' && row.child)) {
          handled();
          setRenaming(row.key);
        }
        return;
      case ' ':
        if (row.kind === 'layer') {
          handled();
          toggleLayerVisible(row.layer);
        } else if (row.kind === 'object' && row.type !== 'room') {
          handled();
          toggleObjectFlag(row, 'visible');
        }
        return;
      case 'Delete':
        if (row.kind === 'layer') {
          handled();
          deleteLayer(row.layer.id);
        }
        return;
      default:
        return;
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const a = active.data.current as { type?: string; layerId?: string } | undefined;
    const o = over.data.current as { type?: string; levelId?: string; layerId?: string } | undefined;
    if (a?.type === 'layer') {
      if (o?.type === 'layer') moveLayerOnto(String(active.id), String(over.id));
      else if (o?.type === 'level' && o.levelId) moveLayerToLevelTop(String(active.id), o.levelId);
      return;
    }
    if (a?.type === 'child' && o?.type === 'child' && a.layerId === o.layerId && a.layerId) {
      const layer = useStore.getState().layers.find((l) => l.id === a.layerId);
      if (layer?.type !== 'dungeon') return;
      const move = computeChildDragReorder(layer.children as AnyChild[], String(active.id), String(over.id));
      if (move) undoManager.execute(new ReorderChildCommand('Reorder', layer.id, move.fromIndex, move.toIndex));
    }
  };

  // One sortable list in row order: layers (moved within and across levels) and children
  // (moved within their kind group); onDragEnd tells them apart by their data.
  const sortIds = useMemo(
    () =>
      rows.flatMap((r) => (r.kind === 'layer' ? [r.layer.id] : r.kind === 'object' && r.child ? [r.id] : [])),
    [rows],
  );

  const rowProps = (row: SheetRow, index: number): RowProps => ({
    row,
    focused: index === focusIndex,
    onFocusRow: setFocusKey,
    renaming,
    setRenaming,
    onToggleLevel,
    onOpenLayerSettings,
  });

  let body: ReactNode;
  if (rows.length === 0) {
    body = <p className="v2-lsheets__empty">{filter ? 'Nothing matches' : 'No layers yet'}</p>;
  } else if (virtual) {
    body = (
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div key={item.key} data-index={item.index} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${item.start}px)` }}>
            <RowView {...rowProps(rows[item.index], item.index)} />
          </div>
        ))}
      </div>
    );
  } else {
    body = rows.map((row, i) => <RowView key={row.key} {...rowProps(row, i)} />);
  }

  return (
    <div className="v2-lsheets__wrap">
      <div className="v2-rsheet__filter">
        <label className="v2-rfilter">
          <Search size={13} strokeWidth={1.75} />
          <input
            value={filter}
            placeholder="Filter layers and objects"
            aria-label="Filter layers and objects"
            data-testid="v2-layers-filter"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.stopPropagation();
              if (filter) setFilter('');
              else e.currentTarget.blur();
            }}
          />
          {filter && (
            <button type="button" className="v2-ib v2-ib--sm" aria-label="Clear filter" onClick={() => setFilter('')}>
              <X size={12} strokeWidth={1.75} />
            </button>
          )}
        </label>
      </div>
      <div className="v2-lsheets__scroll" ref={scrollRef}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={sortIds} strategy={verticalListSortingStrategy}>
            <div className="v2-lsheets__tree" role="tree" aria-label="Layers" ref={treeRef} onKeyDown={onTreeKey} data-testid="v2-layers-tree">
              {body}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

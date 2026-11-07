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
  Layers as LevelGlyph,
  Lightbulb,
  Lock,
  LockOpen,
  Minus,
  MoreHorizontal,
  Mountain,
  Plus,
  Route,
  Search,
  Settings2,
  Square,
  SquareDashed,
  Type,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useVirtualizer } from '@tanstack/react-virtual';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconKeyButton } from '@/editor/components';
import { Input } from '@/ui/input';
import { useStore } from '@/store/store';
import { TERRAIN_PANEL_ID, type AnyChild, type DungeonLayer, type Layer, type WallSegment } from '@/store/types';
import { PropertyCommand, ReorderChildCommand, TerrainAppearanceCommand, UpdateWallCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { cn } from '@/lib/utils';
import { ContextMenu, useContextMenu } from '@/editor/RowMenu';
import { openCanvasMenuRef } from '@/editor/canvasMenuRef';
import { buildLayerTileMenu } from '@/canvas/menuRegistry';
import { computeChildDragReorder } from '@/editor/childReorder';
import { getChildBounds, getWallBounds } from '@dnd/core/src/engine/hitTest';
import { wallStoneCount } from '@dnd/core/src/engine/wallNodeOverlay';
import { standaloneWallLook } from '@dnd/core/src/shared/wallLook';
import { layerDrawStyle } from '@dnd/core/src/engine/levelLook';
import { isLayerEffectivelyVisible } from '@/store/selectors';
import { useLayerThumb } from '@/editor/models/layerThumbs';
import { wallSetLabel } from '@/editor/models/assetStrip';
import { jumpToPoint } from '@/editor/models/jumpTo';
import { buildSheetRows, KIND_LABEL, VIRTUAL_ROWS, type RowKind, type SheetRow } from '@/editor/models/layerRows';
import {
  addLayerOnShownLevel,
  deleteLayer,
  moveLayerOnto,
  moveLayerToLevelTop,
  renameLayer,
  toggleLayerLocked,
  toggleLayerVisible,
  toggleSolo,
} from '@/editor/models/layerActions';
import { loadLayersSheetFilter, saveLayersSheetFilter } from '@/editor/viewPrefs';
import { SheetFrame } from './SheetFrame';

const ROW_H = 30;
const INDENT = 12;

const KIND_ICON: Record<RowKind, LucideIcon> = {
  room: SquareDashed,
  wall: Minus,
  door: DoorOpen,
  asset: Box,
  light: Lightbulb,
  text: Type,
  zone: Crosshair,
  pathway: Route,
  shape: Square,
  plateau: Mountain,
};

const row = 'flex h-[30px] cursor-default items-center gap-1.5 rounded-control pr-1 text-[12px] text-text outline-none hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-focus';
const glyph = 'size-3.5 shrink-0 text-text-3';
const name = 'min-w-0 flex-1 truncate';
const count = 'font-mono text-[11px] text-text-3 tabular-nums';
const icons = 'flex shrink-0 gap-[2px] opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100';

/** Set by a row click, so the reveal that follows the selection leaves the scroll alone. */
const sheetOrigin = { current: false };

type ObjectRow = Extract<SheetRow, { kind: 'object' }>;

function toggleObjectFlag(r: ObjectRow, key: 'visible' | 'locked') {
  const was = key === 'visible' ? r.visible !== false : r.locked === true;
  const label = key === 'visible' ? (was ? 'Hide' : 'Show') : was ? 'Unlock' : 'Lock';
  if (r.wall) {
    undoManager.execute(new UpdateWallCommand(r.layerId, r.id, { [key]: r.wall[key] }, { [key]: !was }));
  } else if (r.child) {
    undoManager.execute(new PropertyCommand(label, { type: 'child', layerId: r.layerId, childId: r.id }, { [key]: r.child[key] }, { [key]: !was }));
  }
}

function objectCentre(r: ObjectRow): { x: number; y: number } | null {
  if (r.room) return { x: r.room.anchor[0], y: r.room.anchor[1] };
  const b = r.child ? getChildBounds(r.child) : r.wall ? getWallBounds(r.wall) : null;
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
}

function selectObject(r: ObjectRow, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
  const s = useStore.getState();
  const ids = s.selection.selectedIds;
  sheetOrigin.current = true;
  if (e.ctrlKey || e.metaKey) {
    s.setSelectedIds(ids.includes(r.id) ? ids.filter((x) => x !== r.id) : [...ids, r.id]);
    return;
  }
  if (e.shiftKey) {
    if (!ids.includes(r.id)) s.setSelectedIds([...ids, r.id]);
    return;
  }
  s.setActiveLayerId(r.layerId);
  s.setSelectedIds([r.id]);
}

/** The object's own canvas menu, at a viewport point. */
function openObjectMenu(r: ObjectRow, x: number, y: number) {
  const world = objectCentre(r) ?? { x: 0, y: 0 };
  const target = r.room
    ? ({ kind: 'room', roomId: r.id, layerId: r.layerId } as const)
    : r.wall
      ? ({ kind: 'wall', wallId: r.id } as const)
      : ({ kind: 'child', childId: r.id } as const);
  openCanvasMenuRef.current?.({ x, y, world, target });
}

/** Inline name field: Enter keeps, Escape reverts, blank keeps the old name. */
function RenameField({ value, label, onDone }: { value: string; label: string; onDone: (name: string | null) => void }) {
  const [draft, setDraft] = useState(value);
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  return (
    <Input
      className="h-6 min-w-0 flex-1 px-1.5"
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

/** A row's 26 icon button; its click is the row's own, not a row pick. */
function RowButton({ icon, label, onClick, quiet, testId }: { icon: LucideIcon; label: string; onClick: (e: React.MouseEvent) => void; quiet?: boolean; testId?: string }) {
  return (
    <IconKeyButton
      size={26}
      icon={icon}
      label={label}
      tabIndex={-1}
      data-tip={label}
      data-testid={testId}
      className={cn(quiet && 'text-text-3')}
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        onClick(e);
      }}
      onDoubleClick={(e: React.MouseEvent) => e.stopPropagation()}
    />
  );
}

const Fold = ({ open }: { open: boolean }) =>
  open ? <ChevronDown aria-hidden strokeWidth={2} className={glyph} /> : <ChevronRight aria-hidden strokeWidth={2} className={glyph} />;

function LayerThumb({ layer }: { layer: DungeonLayer }) {
  const url = useLayerThumb(layer.id);
  return (
    <span className="relative block h-5 w-7 shrink-0 overflow-hidden rounded-key border border-line" style={url ? undefined : { background: layer.style.floorColor }}>
      {url && <img src={url} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />}
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

function LevelRowView({ row: r, focused, onFocusRow, onToggleLevel }: RowProps & { row: Extract<SheetRow, { kind: 'level' }> }) {
  const { setNodeRef, isOver } = useDroppable({ id: r.key, data: { type: 'level', levelId: r.level.id } });
  const what =
    r.matchCount !== null
      ? `${r.matchCount} layer${r.matchCount === 1 ? '' : 's'} match${r.matchCount === 1 ? 'es' : ''}`
      : `${r.layerCount} layer${r.layerCount === 1 ? '' : 's'}`;
  return (
    <div
      ref={setNodeRef}
      className={cn(row, 'pl-1.5 font-medium', isOver && 'ring-[1.5px] ring-ink ring-inset')}
      role="treeitem"
      aria-level={1}
      aria-expanded={r.open}
      aria-selected={false}
      tabIndex={focused ? 0 : -1}
      data-row-key={r.key}
      data-testid="shell-layers-level"
      data-level-id={r.level.id}
      onFocus={() => onFocusRow(r.key)}
      onClick={() => onToggleLevel(r.level.id)}
    >
      <Fold open={r.open} />
      <LevelGlyph aria-hidden strokeWidth={1.75} className={glyph} />
      <span className={name}>{r.level.name || 'Unnamed level'}</span>
      <span className={count}>{what}</span>
    </div>
  );
}

function LayerRowView({ row: r, focused, onFocusRow, renaming, setRenaming, onOpenLayerSettings }: RowProps & { row: Extract<SheetRow, { kind: 'layer' }> }) {
  const layer = r.layer;
  const active = useStore((s) => s.ui.activeLayerId === layer.id);
  const soloed = useStore((s) => s.ui.solo?.layerId === layer.id);
  const shown = useStore((s) => isLayerEffectivelyVisible(s, layer));
  const menu = useContextMenu();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: layer.id, data: { type: 'layer', levelId: r.levelId } });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, paddingLeft: 6 + r.depth * INDENT }}
      className={cn('group/row', row, active && 'bg-panel-3 hover:bg-panel-3', !shown && 'text-text-3', isDragging && 'relative z-10 bg-panel shadow-e')}
      role="treeitem"
      aria-level={r.depth + 1}
      aria-expanded={r.open}
      aria-selected={active}
      tabIndex={focused ? 0 : -1}
      data-row-key={r.key}
      data-layer-id={layer.id}
      data-testid="shell-layers-layer"
      onFocus={() => onFocusRow(r.key)}
      onClick={() => useStore.getState().setActiveLayerId(layer.id)}
      onDoubleClick={() => setRenaming(r.key)}
      onContextMenu={menu.open}
    >
      <span className="flex cursor-grab text-text-3" aria-label={`Drag ${layer.name}`} {...attributes} {...listeners} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <GripVertical aria-hidden strokeWidth={1.75} className="size-3" />
      </span>
      <span
        className="flex"
        role="button"
        tabIndex={-1}
        aria-label={r.open ? 'Collapse' : 'Expand'}
        onClick={(e) => {
          e.stopPropagation();
          useStore.getState().toggleExpandedLayerId(layer.id);
        }}
      >
        <Fold open={r.open} />
      </span>
      <LayerThumb layer={layer} />
      {renaming === r.key ? (
        <RenameField
          value={layer.name}
          label="Layer name"
          onDone={(next) => {
            if (next !== null) renameLayer(layer, next);
            setRenaming(null);
          }}
        />
      ) : (
        <span className={name}>
          {layer.name || 'Unnamed layer'}
          {r.nameMatch && <span className="ml-1.5 text-[10px] text-text-3">layer name</span>}
        </span>
      )}
      <span className={count}>{r.count}</span>
      <span className={cn(icons, (!layer.visible || soloed || layer.locked) && 'opacity-100')}>
        <RowButton
          icon={layer.visible ? Eye : EyeOff}
          label={soloed ? 'Unsolo' : layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
          testId="shell-layers-eye"
          onClick={(e) => (e.altKey ? toggleSolo(layer.id) : toggleLayerVisible(layer))}
        />
        <RowButton icon={layer.locked ? Lock : LockOpen} label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`} quiet={!layer.locked} testId="shell-layers-lock" onClick={() => toggleLayerLocked(layer)} />
        <RowButton
          icon={MoreHorizontal}
          label="Layer menu"
          testId="shell-layers-more"
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            menu.openAt(rect.left, rect.bottom + 4);
          }}
        />
      </span>
      {menu.pos && (
        <ContextMenu
          pos={menu.pos}
          onClose={menu.close}
          items={buildLayerTileMenu(layer, { onRename: () => setRenaming(r.key), onSettings: () => onOpenLayerSettings(layer.id) })}
        />
      )}
    </div>
  );
}

function GroupRowView({ row: r, focused, onFocusRow }: RowProps & { row: Extract<SheetRow, { kind: 'group' }> }) {
  const Icon = KIND_ICON[r.type];
  return (
    <div
      className={row}
      style={{ paddingLeft: 6 + r.depth * INDENT }}
      role="treeitem"
      aria-level={r.depth + 1}
      aria-expanded={r.open}
      aria-selected={false}
      tabIndex={focused ? 0 : -1}
      data-row-key={r.key}
      data-testid="shell-layers-group"
      data-kind={r.type}
      onFocus={() => onFocusRow(r.key)}
      onClick={() => useStore.getState().toggleChildGroup(`${r.layerId}:${r.type}`)}
    >
      <Fold open={r.open} />
      <Icon aria-hidden strokeWidth={1.75} className={glyph} />
      <span className={cn(name, 'text-text-2')}>{KIND_LABEL[r.type]}</span>
      <span className={count}>{r.count}</span>
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
  return <span className="shrink-0 text-[10px] text-text-3">{text}</span>;
}

function ObjectRowView({ row: r, focused, onFocusRow, renaming, setRenaming }: RowProps & { row: ObjectRow }) {
  const selected = useStore((s) => s.selection.selectedIds.includes(r.id));
  const reveal = useStore((s) => s.ui.revealChildId === r.id);
  const ref = useRef<HTMLDivElement | null>(null);
  const sortable = useSortable({ id: r.id, data: { type: 'child', layerId: r.layerId, kind: r.type }, disabled: !r.child });
  useEffect(() => {
    if (!reveal) return;
    ref.current?.scrollIntoView?.({ block: 'nearest' });
    useStore.getState().setRevealChildId(null);
  }, [reveal]);
  const Icon = KIND_ICON[r.type];
  return (
    <div
      ref={(el) => {
        ref.current = el;
        sortable.setNodeRef(el);
      }}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition, paddingLeft: 6 + r.depth * INDENT }}
      className={cn('group/row', row, selected && 'bg-panel-3 hover:bg-panel-3', r.visible === false && 'text-text-3')}
      role="treeitem"
      aria-level={r.depth + 1}
      aria-selected={selected}
      tabIndex={focused ? 0 : -1}
      data-row-key={r.key}
      data-object-id={r.id}
      data-kind={r.type}
      data-testid="shell-layers-object"
      onFocus={() => onFocusRow(r.key)}
      onClick={(e) => selectObject(r, e)}
      onDoubleClick={() => {
        const c = objectCentre(r);
        if (c) jumpToPoint(c, ref.current?.closest('[data-sheet]') ?? null);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        selectObject(r, { shiftKey: false, ctrlKey: false, metaKey: false });
        openObjectMenu(r, e.clientX, e.clientY);
      }}
    >
      {r.child ? (
        <span className="flex cursor-grab text-text-3" aria-label={`Drag ${r.name}`} {...sortable.attributes} {...sortable.listeners} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
          <GripVertical aria-hidden strokeWidth={1.75} className="size-3" />
        </span>
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <Icon aria-hidden strokeWidth={1.75} className={glyph} />
      {renaming === r.key && r.child ? (
        <RenameField
          value={r.child.name}
          label="Object name"
          onDone={(next) => {
            const trimmed = next?.trim();
            if (r.child && trimmed && trimmed !== r.child.name) {
              undoManager.execute(new PropertyCommand('Rename', { type: 'child', layerId: r.layerId, childId: r.id }, { name: r.child.name }, { name: trimmed }));
            }
            setRenaming(null);
          }}
        />
      ) : (
        <span className={name}>{r.name}</span>
      )}
      {r.wall && <WallMeta layerId={r.layerId} wall={r.wall} />}
      {r.type !== 'room' && (
        <span className={cn(icons, (r.visible === false || r.locked) && 'opacity-100')}>
          <RowButton icon={r.visible === false ? EyeOff : Eye} label={r.visible === false ? `Show ${r.name}` : `Hide ${r.name}`} testId="shell-layers-obj-eye" onClick={() => toggleObjectFlag(r, 'visible')} />
          <RowButton icon={r.locked ? Lock : LockOpen} label={r.locked ? `Unlock ${r.name}` : `Lock ${r.name}`} quiet={!r.locked} testId="shell-layers-obj-lock" onClick={() => toggleObjectFlag(r, 'locked')} />
          <RowButton
            icon={MoreHorizontal}
            label="Object menu"
            testId="shell-layers-obj-more"
            onClick={(e) => {
              selectObject(r, { shiftKey: false, ctrlKey: false, metaKey: false });
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              openObjectMenu(r, rect.left, rect.bottom + 4);
            }}
          />
        </span>
      )}
    </div>
  );
}

function RowView(props: RowProps) {
  const { row: r } = props;
  if (r.kind === 'level') return <LevelRowView {...props} row={r} />;
  if (r.kind === 'layer') return <LayerRowView {...props} row={r} />;
  if (r.kind === 'group') return <GroupRowView {...props} row={r} />;
  return <ObjectRowView {...props} row={r} />;
}

/** Terrain and Background, pinned under the tree: they belong to the whole map. */
function PinnedRows({ onOpenLayerSettings }: { onOpenLayerSettings: (id: string) => void }) {
  const bg = useStore((s) => s.layers.find((l) => l.type === 'background')) as Layer | undefined;
  const terrainVisible = useStore((s) => s.mapSettings.terrain?.visible ?? true);
  const activeId = useStore((s) => s.ui.activeLayerId);
  const pinned = (on: boolean, dim: boolean) => cn('group/row', row, 'pl-1.5', on && 'bg-panel-3 hover:bg-panel-3', dim && 'text-text-3');
  return (
    <div className="flex flex-col border-t border-line px-1.5 py-1" data-testid="shell-layers-pinned">
      <div className={pinned(activeId === TERRAIN_PANEL_ID, !terrainVisible)} data-testid="shell-layers-terrain" onClick={() => useStore.getState().setActiveLayerId(TERRAIN_PANEL_ID)}>
        <Mountain aria-hidden strokeWidth={1.75} className={glyph} />
        <span className={name}>Terrain</span>
        <span className="text-[10px] text-text-3">map-wide</span>
        <span className={cn(icons, 'opacity-100')}>
          <RowButton
            icon={terrainVisible ? Eye : EyeOff}
            label={terrainVisible ? 'Hide Terrain' : 'Show Terrain'}
            onClick={() => undoManager.execute(new TerrainAppearanceCommand({ visible: terrainVisible }, { visible: !terrainVisible }))}
          />
          <RowButton icon={Settings2} label="Terrain settings" onClick={() => onOpenLayerSettings(TERRAIN_PANEL_ID)} />
        </span>
      </div>
      {bg && (
        <div className={pinned(activeId === bg.id, !bg.visible)} data-testid="shell-layers-background" onClick={() => useStore.getState().setActiveLayerId(bg.id)}>
          <Square aria-hidden strokeWidth={1.75} className={glyph} />
          <span className={name}>{bg.name || 'Background'}</span>
          <span className="text-[10px] text-text-3">map-wide</span>
          <span className={cn(icons, 'opacity-100')}>
            <RowButton icon={bg.visible ? Eye : EyeOff} label={bg.visible ? 'Hide Background' : 'Show Background'} onClick={() => toggleLayerVisible(bg)} />
            <RowButton icon={bg.locked ? Lock : LockOpen} label={bg.locked ? 'Unlock Background' : 'Lock Background'} quiet={!bg.locked} onClick={() => toggleLayerLocked(bg)} />
            <RowButton icon={Settings2} label="Background settings" onClick={() => onOpenLayerSettings(bg.id)} />
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

function LayersTree({ onOpenLayerSettings }: { onOpenLayerSettings: (id: string) => void }) {
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
    const r = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!r) return;
    setFocusKey(r.key);
    if (virtual) virtualizer.scrollToIndex(rows.indexOf(r));
    requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>(`[data-row-key="${r.key}"]`)?.focus());
  };

  const onTreeKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (!t.dataset.rowKey) return;
    const i = rows.findIndex((r) => r.key === t.dataset.rowKey);
    const r = rows[i];
    if (!r) return;
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
        const openable = r.kind !== 'object';
        const isOpen = openable && r.open;
        if (openable && opening !== isOpen) {
          if (r.kind === 'level') onToggleLevel(r.level.id);
          else if (r.kind === 'layer') useStore.getState().toggleExpandedLayerId(r.layer.id);
          else if (r.kind === 'group') useStore.getState().toggleChildGroup(`${r.layerId}:${r.type}`);
        } else if (opening && isOpen) focusRow(i + 1);
        else if (!opening) {
          const p = parentIndex(rows, i);
          if (p >= 0) focusRow(p);
        }
        return;
      }
      case 'Enter':
        handled();
        if (r.kind === 'layer') useStore.getState().setActiveLayerId(r.layer.id);
        else if (r.kind === 'object') selectObject(r, e);
        else if (r.kind === 'level') onToggleLevel(r.level.id);
        else useStore.getState().toggleChildGroup(`${r.layerId}:${r.type}`);
        return;
      case 'F2':
        if (r.kind === 'layer' || (r.kind === 'object' && r.child)) {
          handled();
          setRenaming(r.key);
        }
        return;
      case ' ':
        if (r.kind === 'layer') {
          handled();
          toggleLayerVisible(r.layer);
        } else if (r.kind === 'object' && r.type !== 'room') {
          handled();
          toggleObjectFlag(r, 'visible');
        }
        return;
      case 'Delete':
        if (r.kind === 'layer') {
          handled();
          deleteLayer(r.layer.id);
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

  // One sortable list in row order: layers (within and across levels) and children (within
  // their kind group); onDragEnd tells them apart by their data.
  const sortIds = useMemo(() => rows.flatMap((r) => (r.kind === 'layer' ? [r.layer.id] : r.kind === 'object' && r.child ? [r.id] : [])), [rows]);

  const rowProps = (r: SheetRow, index: number): RowProps => ({
    row: r,
    focused: index === focusIndex,
    onFocusRow: setFocusKey,
    renaming,
    setRenaming,
    onToggleLevel,
    onOpenLayerSettings,
  });

  let body: ReactNode;
  if (rows.length === 0) {
    body = <p className="py-6 text-center text-[12px] text-text-3">{filter ? 'Nothing matches' : 'No layers yet'}</p>;
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
    body = rows.map((r, i) => <RowView key={r.key} {...rowProps(r, i)} />);
  }

  return (
    <>
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <label className="relative block min-w-0 flex-1">
          <Search aria-hidden strokeWidth={1.75} className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-text-3" />
          <Input
            value={filter}
            placeholder="Filter layers and objects"
            aria-label="Filter layers and objects"
            data-testid="shell-layers-filter"
            className="pl-7"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.stopPropagation();
              if (filter) setFilter('');
              else e.currentTarget.blur();
            }}
          />
        </label>
        {filter && <IconKeyButton size={26} icon={X} label="Clear filter" onClick={() => setFilter('')} />}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1" ref={scrollRef}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={sortIds} strategy={verticalListSortingStrategy}>
            <div role="tree" aria-label="Layers" ref={treeRef} onKeyDown={onTreeKey} data-testid="shell-layers-tree">
              {body}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </>
  );
}

/**
 * The Layers sheet: every level, its layers top of the stack first, and each layer's objects
 * by kind (rooms and drawn walls included), each row with its eye, lock and menu; Terrain
 * and Background pinned at the foot. Rows reorder by dragging, rename in place, solo with Alt.
 */
export function LayersSheet({ onClose, onOpenLayerSettings }: { onClose: () => void; onOpenLayerSettings: (id: string) => void }) {
  return (
    <SheetFrame
      title="Layers"
      onClose={onClose}
      testId="shell-layers-sheet"
      scroll={false}
      actions={<IconKeyButton size={26} icon={Plus} label="Add layer" data-testid="shell-layers-add" onClick={() => addLayerOnShownLevel()} />}
      footer={<PinnedRows onOpenLayerSettings={onOpenLayerSettings} />}
    >
      <LayersTree onOpenLayerSettings={onOpenLayerSettings} />
    </SheetFrame>
  );
}

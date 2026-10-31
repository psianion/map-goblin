import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { EyeOff, Eye, Layers, Lock, LockOpen, Mountain, Plus, Settings2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '@/store/store';
import { TERRAIN_PANEL_ID, type Layer } from '@/store/types';
import { TerrainAppearanceCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { priorActiveLayerRef } from '@/components/toolbar/toolConstants';
import { ContextMenu, useContextMenu } from '@/components/ui/context-menu';
import { buildLayerTileMenu } from '@/canvas/menuRegistry';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { layerObjectCount } from '@dnd/core/src/store/layerCommands';
import { TERRAIN_THUMB, startLayerThumbs, useLayerThumb } from './layerThumbs';
import { disposeLayerThumbRenderer, renderLayerThumb } from './layerThumbRender';
import { LevelPicker } from './LevelPicker';
import { layerOnLevel } from './roomModel';
import { useDropTarget } from './dropToLayer';
import {
  addLayerOnShownLevel,
  deleteLayer,
  moveLayerOnto,
  renameLayer,
  requestTileRename,
  setStripFocused,
  subscribeTileRename,
  tileRenameTarget,
  toggleLayerLocked,
  toggleLayerVisible,
  toggleSolo,
} from './layerActions';
import { checkRename } from './layerSheetModel';
// The settings glyph on the active tile is styled with the sheet it opens.
import './layer-sheet.css';
import './filmstrip.css';

/** Whether focus landed by keyboard (the browser's own focus-visible rule). */
function focusedByKeys(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/** The inline name field: Enter keeps what was typed, Escape the old name. */
function TileRename({ name, onRename }: { name: string; onRename: (next: string | null) => void }) {
  const [draft, setDraft] = useState(name);
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onRename(value);
  };
  return (
    <input
      className="v2-tile__rename"
      aria-label="Layer name"
      value={draft}
      autoFocus
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(draft)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(draft);
        else if (e.key === 'Escape') finish(null);
      }}
    />
  );
}

/** The name under a tile, or its inline name field while it is being renamed. */
function TileName({
  name,
  count,
  renaming,
  onStartRename,
  onRename,
}: {
  name: string;
  count?: number;
  renaming: boolean;
  onStartRename?: () => void;
  onRename?: (next: string | null) => void;
}) {
  if (renaming && onRename) return <TileRename name={name} onRename={onRename} />;
  return (
    <span className="v2-tile__name" onDoubleClick={onStartRename}>
      <span data-testid="v2-film-name">{name}</span>
      {count !== undefined && (
        <b className="v2-num" data-testid="v2-film-count">
          {count}
        </b>
      )}
    </span>
  );
}

interface TileProps {
  id: string;
  name: string;
  count?: number;
  active: boolean;
  visible: boolean;
  locked?: boolean;
  /** Dimmed by a solo on another layer. */
  soloOut?: boolean;
  /** The soloed layer: its eye reads inverted. */
  soloed?: boolean;
  /** A canvas drag is over this tile and would drop here. */
  drop?: boolean;
  /** A map layer tile: a drop target, sortable, renamed in place. */
  layerTile?: boolean;
  /** Takes the strip's roving focus. */
  focusable: boolean;
  preview: ReactNode;
  renaming?: boolean;
  onPick: () => void;
  onToggleVisible: (e: React.MouseEvent) => void;
  onToggleLock?: () => void;
  /** Opens the layer sheet; the glyph shows on the active tile, double-click on the picture works on any. */
  onSettings: () => void;
  onStartRename?: () => void;
  onRename?: (next: string | null) => void;
  onMenu?: (x: number, y: number) => void;
  onKey?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  onFocusTile?: () => void;
  /** Drag-to-reorder wiring, for the map layer tiles (see SortableTile). */
  sortable?: ReturnType<typeof useSortable>;
}

/** A map layer tile, sortable within the level on show. */
function SortableTile(props: TileProps) {
  const sortable = useSortable({ id: props.id, disabled: props.renaming });
  return <Tile {...props} sortable={sortable} />;
}

/** A tile: a glimpse of the layer, its name and count under it, eye and lock on hover. */
function Tile(props: TileProps) {
  const {
    id,
    name,
    count,
    active,
    visible,
    locked,
    soloOut,
    soloed,
    drop,
    layerTile,
    focusable,
    preview,
    renaming = false,
    onPick,
    onToggleVisible,
    onToggleLock,
    onSettings,
    onStartRename,
    onRename,
    onMenu,
    onKey,
    onFocusTile,
    sortable,
  } = props;
  const style: CSSProperties | undefined = sortable
    ? { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }
    : undefined;
  return (
    <div
      ref={sortable?.setNodeRef}
      style={style}
      className={cn(
        'v2-tile v2-tile--named',
        active && 'v2-tile--on',
        !visible && 'v2-tile--hidden',
        soloOut && 'v2-tile--soloout',
        drop && 'v2-tile--drop',
        sortable?.isDragging && 'v2-tile--lifted',
      )}
      data-testid="v2-film-tile"
      data-active={active || undefined}
      data-layer-tile={layerTile ? id : undefined}
      role="option"
      aria-selected={active}
      aria-label={name}
      tabIndex={focusable ? 0 : -1}
      onKeyDown={onKey}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onFocusTile?.();
      }}
      onContextMenu={(e) => {
        if (!onMenu) return;
        e.preventDefault();
        e.stopPropagation();
        onMenu(e.clientX, e.clientY);
      }}
      {...(sortable?.listeners ?? {})}
    >
      <div className="v2-tile__box">
        <button
          type="button"
          className="v2-tile__pick"
          tabIndex={-1}
          onClick={onPick}
          onDoubleClick={onSettings}
          aria-pressed={active}
          aria-label={`Draw on ${name}`}
          data-tip={visible ? `${name}${count !== undefined ? ` · ${count} objects` : ''}` : `${name} (hidden)`}
        >
          {preview}
        </button>
        <button
          type="button"
          tabIndex={-1}
          className={cn('v2-tile__eye', soloed && 'v2-tile__eye--solo')}
          aria-label={visible ? `Hide ${name}` : `Show ${name}`}
          data-tip={soloed ? 'Soloed: click to show all' : visible ? 'Hide (Alt: solo)' : 'Show'}
          data-testid="v2-film-eye"
          onClick={onToggleVisible}
        >
          {visible ? <Eye size={10} strokeWidth={2} /> : <EyeOff size={10} strokeWidth={2} />}
        </button>
        {active && (
          <button
            type="button"
            tabIndex={-1}
            className="v2-ib v2-tile__set"
            aria-label="Layer settings"
            data-tip="Layer settings"
            onClick={onSettings}
          >
            <Settings2 size={10} strokeWidth={2} />
          </button>
        )}
        {onToggleLock && (
          <button
            type="button"
            tabIndex={-1}
            className={cn('v2-tile__lock', locked && 'v2-tile__lock--on')}
            aria-label={locked ? `Unlock ${name}` : `Lock ${name}`}
            data-tip={locked ? 'Locked: click to unlock' : 'Lock'}
            onClick={onToggleLock}
          >
            {locked ? <Lock size={9} strokeWidth={2} /> : <LockOpen size={9} strokeWidth={2} />}
          </button>
        )}
      </div>
      <TileName name={name} count={count} renaming={renaming} onStartRename={onStartRename} onRename={onRename} />
    </div>
  );
}

function Swatch({ fill, edge }: { fill: string; edge?: string }) {
  const style: CSSProperties = { background: fill, borderColor: edge ?? fill };
  return <span className="v2-tile__swatch" style={style} />;
}

/** The layer as the canvas draws it, framed to its content; `fallback` until a picture exists. */
function Thumb({ thumbKey, fallback }: { thumbKey: string; fallback: ReactNode }) {
  const url = useLayerThumb(thumbKey);
  if (!url) return <>{fallback}</>;
  return <img className="v2-tile__thumb" src={url} alt="" draggable={false} data-testid="v2-film-thumb" />;
}

/** Fade the edges a scroller can still move toward; no bar is ever shown. */
function useEdgeFade(ref: RefObject<HTMLDivElement | null>, deps: unknown[]) {
  const [fade, setFade] = useState({ l: false, r: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const l = el.scrollLeft > 1;
      const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setFade((p) => (p.l === l && p.r === r ? p : { l, r }));
    };
    update();
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('scroll', update, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      el.removeEventListener('wheel', onWheel);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return fade;
}

interface FilmstripProps {
  onOpenLayers: () => void;
  /** Opens one layer's settings sheet; `target` is a layer id or TERRAIN_PANEL_ID. */
  onOpenLayerSettings: (target: string) => void;
  /**
   * Show the map-wide tiles (Background, Terrain). The Rooms tab leaves them out: rooms
   * live on a level's dungeon layers only, and the tab's row needs the room.
   */
  mapWide?: boolean;
}

/**
 * Every layer in draw order, bottom first, so the rightmost tile is the top of the stack.
 * Picking a tile is picking where tools draw; the tiles carry the daily layer verbs (board
 * L1, L2): eye and lock, Alt-click solo, rename in place, a menu, drag to reorder, and a
 * drop target for a canvas drag.
 */
export function Filmstrip({ onOpenLayers, onOpenLayerSettings, mapWide = true }: FilmstripProps) {
  const layers = useStore(useShallow((s) => s.layers));
  const levels = useStore(useShallow((s) => s.levels));
  const activeLevelId = useStore((s) => s.ui.activeLevelId);
  const activeLayerId = useStore((s) => s.ui.activeLayerId);
  const solo = useStore((s) => s.ui.solo);
  const terrainVisible = useStore((s) => s.mapSettings.terrain?.visible ?? true);
  const terrainPainted = useStore((s) => !!s.mapSettings.terrain?.bounds);
  const renaming = useSyncExternalStore(subscribeTileRename, tileRenameTarget, () => null);
  const dropTarget = useDropTarget();
  const scrollRef = useRef<HTMLDivElement>(null);
  const menu = useContextMenu();
  const [menuLayerId, setMenuLayerId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  // Tile pictures follow the store while the strip is up.
  useEffect(() => {
    const stop = startLayerThumbs(renderLayerThumb);
    return () => {
      stop();
      disposeLayerThumbRenderer();
    };
  }, []);

  // A rename asked for elsewhere ends when the strip goes.
  useEffect(() => () => requestTileRename(null), []);

  const background = layers.find((l) => l.type === 'background');
  // The tiles are the level on show's layers; Background and Terrain belong to the whole map.
  const dungeon = layers.filter((l) => l.type !== 'background' && layerOnLevel(l, levels, activeLevelId));
  const fade = useEdgeFade(scrollRef, [dungeon.length]);

  // Keep the active tile in view when it changes from elsewhere (layer sheet, shortcuts).
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>('[data-active]');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeLayerId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // A tile click only changes where new things draw: the selection stays (decision L-3).
  const pick = (id: string) => useStore.getState().setActiveLayerId(id);

  const pickTerrain = () => {
    // Same bookkeeping as the layer panel's Terrain row, so Escape can step back out.
    const current = useStore.getState().ui.activeLayerId;
    if (current !== TERRAIN_PANEL_ID) priorActiveLayerRef.current = current;
    pick(TERRAIN_PANEL_ID);
  };

  const eyeClick = (layer: Layer) => (e: React.MouseEvent) => {
    if (e.altKey && layer.type === 'dungeon') toggleSolo(layer.id);
    else toggleLayerVisible(layer);
  };

  const addLayer = () => {
    const id = addLayerOnShownLevel();
    notify.subtle('Layer added', { icon: 'plus' });
    requestTileRename(id);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) moveLayerOnto(String(active.id), String(over.id));
  };

  const ids = dungeon.map((l) => l.id);
  const roving = focusId && ids.includes(focusId) ? focusId : ids.includes(activeLayerId) ? activeLayerId : ids[0];

  const focusTile = (id: string | undefined) => {
    if (!id) return;
    setFocusId(id);
    scrollRef.current?.querySelector<HTMLElement>(`[data-layer-tile="${id}"]`)?.focus();
  };

  const openMenu = (layerId: string, x: number, y: number) => {
    setMenuLayerId(layerId);
    menu.openAt(x, y);
  };

  const tileKeys = (layer: Layer) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const i = ids.indexOf(layer.id);
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case 'ArrowRight':
        stop();
        focusTile(ids[Math.min(ids.length - 1, i + 1)]);
        return;
      case 'ArrowLeft':
        stop();
        focusTile(ids[Math.max(0, i - 1)]);
        return;
      case 'Home':
        stop();
        focusTile(ids[0]);
        return;
      case 'End':
        stop();
        focusTile(ids.at(-1));
        return;
      case 'Enter':
        stop();
        pick(layer.id);
        return;
      case 'F2':
        stop();
        requestTileRename(layer.id);
        return;
      case ' ':
        stop();
        toggleLayerVisible(layer);
        return;
      case 'Delete':
        stop();
        deleteLayer(layer.id);
        return;
      case 'ContextMenu':
      case 'F10':
        if (e.key === 'F10' && !e.shiftKey) return;
        stop();
        {
          const r = e.currentTarget.getBoundingClientRect();
          openMenu(layer.id, r.left, r.top);
        }
        return;
      default:
        return;
    }
  };

  const menuLayer = menuLayerId ? layers.find((l) => l.id === menuLayerId) : undefined;

  return (
    <div
      className={cn('v2-film', !mapWide && 'v2-film--level')}
      data-testid="v2-filmstrip"
      role="group"
      aria-label="Layers"
      // Tiles outside the scroll (Background, Terrain) and the scroll's floor (four tiles, or
      // every tile when there are fewer): the CSS floor for how far the strip shrinks.
      style={{ '--v2-film-fixed': mapWide ? (background ? 2 : 1) : 0, '--v2-film-floor': Math.min(4, dungeon.length) } as CSSProperties}
    >
      <LevelPicker />
      {mapWide && background && background.type === 'background' && (
        <Tile
          id={background.id}
          name={background.name || 'Background'}
          active={activeLayerId === background.id}
          visible={background.visible}
          locked={background.locked}
          focusable={false}
          preview={
            background.backgroundTexture ? (
              <Thumb thumbKey={background.id} fallback={<Swatch fill={background.backgroundColor} edge="transparent" />} />
            ) : (
              <Swatch fill={background.backgroundColor} edge="transparent" />
            )
          }
          onPick={() => pick(background.id)}
          onToggleVisible={eyeClick(background)}
          onToggleLock={() => toggleLayerLocked(background)}
          onSettings={() => onOpenLayerSettings(background.id)}
        />
      )}
      {mapWide && (
        <Tile
          id={TERRAIN_PANEL_ID}
          name="Terrain"
          active={activeLayerId === TERRAIN_PANEL_ID}
          visible={terrainVisible}
          focusable={false}
          preview={
            terrainPainted ? (
              <Thumb thumbKey={TERRAIN_THUMB} fallback={<Mountain size={16} strokeWidth={1.75} />} />
            ) : (
              <Mountain size={16} strokeWidth={1.75} />
            )
          }
          onPick={pickTerrain}
          onToggleVisible={() =>
            undoManager.execute(new TerrainAppearanceCommand({ visible: terrainVisible }, { visible: !terrainVisible }))
          }
          onSettings={() => onOpenLayerSettings(TERRAIN_PANEL_ID)}
        />
      )}
      {mapWide && <span className="v2-film__divider" role="presentation" />}
      <div
        ref={scrollRef}
        className={cn('v2-film__scroll', fade.l && 'v2-film__scroll--fade-l', fade.r && 'v2-film__scroll--fade-r')}
        role="listbox"
        aria-label="Layers on this level"
        aria-orientation="horizontal"
        // The strip stops only its own keys (tileKeys); Ctrl+Z, Escape and the rest reach the map.
        data-keys="canvas"
        // The key hint is for keyboard focus; a click leaves the status line to the tool.
        onFocus={(e) => setStripFocused(focusedByKeys(e.target))}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setStripFocused(false);
        }}
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
            {dungeon.map((layer) => {
              const name = layer.name || 'Unnamed layer';
              const soloed = solo?.layerId === layer.id;
              return (
                <SortableTile
                  key={layer.id}
                  id={layer.id}
                  name={name}
                  count={layerObjectCount(layer)}
                  active={activeLayerId === layer.id}
                  visible={layer.visible}
                  locked={layer.locked}
                  // Solo shows on the strip: every tile the solo hides is dimmed.
                  soloOut={!!solo && !soloed}
                  soloed={soloed}
                  onFocusTile={() => setFocusId(layer.id)}
                  drop={dropTarget?.layerId === layer.id}
                  layerTile
                  focusable={roving === layer.id}
                  renaming={renaming === layer.id}
                  preview={
                    layer.type === 'dungeon' ? (
                      <Thumb thumbKey={layer.id} fallback={<Swatch fill={layer.style.floorColor} edge={layer.style.wallColor} />} />
                    ) : (
                      <Layers size={16} strokeWidth={1.75} />
                    )
                  }
                  onPick={() => pick(layer.id)}
                  onToggleVisible={eyeClick(layer)}
                  onToggleLock={() => toggleLayerLocked(layer)}
                  onSettings={() => onOpenLayerSettings(layer.id)}
                  onStartRename={() => requestTileRename(layer.id)}
                  onRename={(next) => {
                    requestTileRename(null);
                    if (next === null) return;
                    const out = checkRename(next, layer.name);
                    if (out.kind === 'commit') renameLayer(layer, out.name);
                  }}
                  onMenu={(x, y) => openMenu(layer.id, x, y)}
                  onKey={tileKeys(layer)}
                />
              );
            })}
          </SortableContext>
        </DndContext>
      </div>
      <button type="button" className="v2-tile--add" onClick={addLayer} aria-label="Add layer" data-tip="Add layer">
        <Plus size={15} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className="v2-ib v2-tile--btn"
        onClick={onOpenLayers}
        aria-label="All layers"
        data-tip="All layers"
        data-testid="v2-open-layers"
      >
        <Layers size={16} strokeWidth={1.75} />
      </button>
      {menu.pos && menuLayer && (
        <ContextMenu
          pos={menu.pos}
          onClose={() => {
            menu.close();
            setMenuLayerId(null);
          }}
          items={buildLayerTileMenu(menuLayer, { onRename: () => requestTileRename(menuLayer.id) })}
        />
      )}
    </div>
  );
}

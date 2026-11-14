import { useEffect, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Eye, EyeOff, Layers as LayersIcon, Lock, LockOpen, Mountain, Plus, Settings2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DockColumn, Tile, Button, cn } from '@dnd/ui';
import { useStore } from '@/store/store';
import { TERRAIN_PANEL_ID, type Layer } from '@/store/types';
import { TerrainAppearanceCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { priorActiveLayerRef } from '@/editor/toolConstants';
import { ContextMenu, useContextMenu } from '@/editor/RowMenu';
import { buildLayerTileMenu } from '@/canvas/menuRegistry';
import { notify } from '@dnd/ui/toast';
import { layerObjectCount } from '@dnd/core/src/store/layerCommands';
import { TERRAIN_THUMB, startLayerThumbs, useLayerThumb } from '@/editor/models/layerThumbs';
import { disposeLayerThumbRenderer, renderLayerThumb } from '@/editor/models/layerThumbRender';
import { layerOnLevel } from '@/editor/models/roomModel';
import { useDropTarget } from '@/editor/dropToLayer';
import {
  addLayerOnShownLevel,
  deleteLayer,
  moveLayerOnto,
  renameLayer,
  requestTileRename,
  subscribeTileRename,
  tileRenameTarget,
  toggleLayerLocked,
  toggleLayerVisible,
  toggleSolo,
} from '@/editor/models/layerActions';
import { checkRename } from '@/editor/models/layerSheetModel';
import { useShell } from '@/editor/shell/shellStore';
import { RenameDialog } from './RenameDialog';

const small = 'size-4 rounded-key p-0 text-text-2 hover:bg-panel-3 [&_svg]:size-2.5';

interface TileProps {
  id: string;
  name: string;
  tip: string;
  active: boolean;
  visible: boolean;
  locked?: boolean;
  /** Dimmed by a solo on another layer. */
  soloOut?: boolean;
  soloed?: boolean;
  /** A canvas drag is over this tile and would drop here. */
  drop?: boolean;
  /** A map layer: a drop target, sortable, renamed with F2 or a double-click. */
  layerTile?: boolean;
  preview: ReactNode;
  onPick: () => void;
  onToggleVisible: (e: MouseEvent) => void;
  onToggleLock?: () => void;
  onSettings: () => void;
  onRename?: () => void;
  onMenu?: (x: number, y: number) => void;
  onKey?: (e: KeyboardEvent<HTMLDivElement>) => void;
  sortable?: ReturnType<typeof useSortable>;
}

/** A layer tile: the composite tile with its eye, lock and, when active, settings over the picture. */
function LayerTile(props: TileProps) {
  const { id, name, tip, active, visible, locked, soloOut, soloed, drop, layerTile, preview, sortable } = props;
  const style: CSSProperties | undefined = sortable
    ? { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }
    : undefined;
  return (
    <div
      ref={sortable?.setNodeRef}
      style={style}
      className={cn('group/tile relative shrink-0', soloOut && 'opacity-40', sortable?.isDragging && 'z-10 opacity-80')}
      data-layer-tile={layerTile ? id : undefined}
      data-testid="shell-layer-tile"
      data-name={name}
      data-active={active || undefined}
      data-hidden={!visible || undefined}
      onKeyDown={props.onKey}
      onContextMenu={(e) => {
        if (!props.onMenu) return;
        e.preventDefault();
        e.stopPropagation();
        props.onMenu(e.clientX, e.clientY);
      }}
      {...(sortable?.attributes ?? {})}
      {...(sortable?.listeners ?? {})}
    >
      <Tile
        name={name}
        active={active}
        aria-label={`Draw on ${name}`}
        data-tip={tip}
        className={cn(!visible && '[&_[data-slot=tile-thumb]]:opacity-50', drop && '[&_[data-slot=tile-thumb]]:outline-dashed [&_[data-slot=tile-thumb]]:outline-[1.5px] [&_[data-slot=tile-thumb]]:outline-offset-[-1.5px] [&_[data-slot=tile-thumb]]:outline-ink')}
        onClick={props.onPick}
        onDoubleClick={props.onRename ?? props.onSettings}
      >
        {preview}
      </Tile>
      <Button
        variant="ghost"
        className={cn(small, 'absolute top-[3px] left-[3px] bg-panel/80', visible && !soloed && 'opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100')}
        aria-label={visible ? `Hide ${name}` : `Show ${name}`}
        aria-pressed={soloed || undefined}
        data-tip={soloed ? 'Soloed: click to show all' : visible ? 'Hide (Alt: solo)' : 'Show'}
        data-testid="shell-layer-eye"
        onClick={props.onToggleVisible}
      >
        {visible ? <Eye aria-hidden strokeWidth={2} /> : <EyeOff aria-hidden strokeWidth={2} />}
      </Button>
      {props.onToggleLock && (
        <Button
          variant="ghost"
          className={cn(small, 'absolute top-[3px] right-[3px] bg-panel/80', !locked && 'opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100')}
          aria-label={locked ? `Unlock ${name}` : `Lock ${name}`}
          data-tip={locked ? 'Locked: click to unlock' : 'Lock'}
          onClick={props.onToggleLock}
        >
          {locked ? <Lock aria-hidden strokeWidth={2} /> : <LockOpen aria-hidden strokeWidth={2} />}
        </Button>
      )}
      {active && (
        <Button
          variant="ghost"
          className={cn(small, 'absolute top-[27px] right-[3px] bg-panel/80')}
          aria-label="Layer settings"
          data-tip="Layer settings"
          onClick={props.onSettings}
        >
          <Settings2 aria-hidden strokeWidth={2} />
        </Button>
      )}
    </div>
  );
}

function SortableLayerTile(props: TileProps) {
  const sortable = useSortable({ id: props.id });
  return <LayerTile {...props} sortable={sortable} />;
}

/** The layer as the canvas draws it, framed to its content, or a flat swatch until one exists. */
function Thumb({ thumbKey, fallback }: { thumbKey: string; fallback: ReactNode }) {
  const url = useLayerThumb(thumbKey);
  if (!url) return <>{fallback}</>;
  return <img className="absolute inset-0 size-full object-cover" src={url} alt="" draggable={false} data-testid="shell-layer-thumb" />;
}

const Swatch = ({ fill }: { fill: string }) => <span className="absolute inset-0" style={{ background: fill }} />;

/**
 * The dock's Layers column: Background and Terrain for the whole map, then the level on
 * show's layers in draw order, bottom first. A tile picks where tools draw; it carries the
 * daily verbs: eye (Alt solos), lock, settings, rename (double-click or F2), a menu, drag to
 * reorder, and a drop target for a canvas drag.
 */
export function LayersColumn() {
  const layers = useStore(useShallow((s) => s.layers));
  const levels = useStore(useShallow((s) => s.levels));
  const activeLevelId = useStore((s) => s.ui.activeLevelId);
  const activeLayerId = useStore((s) => s.ui.activeLayerId);
  const solo = useStore((s) => s.ui.solo);
  const terrainVisible = useStore((s) => s.mapSettings.terrain?.visible ?? true);
  const terrainPainted = useStore((s) => !!s.mapSettings.terrain?.bounds);
  const renaming = useSyncExternalStore(subscribeTileRename, tileRenameTarget, () => null);
  const dropTarget = useDropTarget();
  const menu = useContextMenu();
  const [menuLayerId, setMenuLayerId] = useState<string | null>(null);
  const openSheet = useShell((s) => s.openSheet);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Tile pictures follow the store while the column is up.
  useEffect(() => {
    const stop = startLayerThumbs(renderLayerThumb);
    return () => {
      stop();
      disposeLayerThumbRenderer();
    };
  }, []);
  // A rename asked for elsewhere ends when the column goes.
  useEffect(() => () => requestTileRename(null), []);

  const background = layers.find((l) => l.type === 'background');
  const shown = layers.filter((l) => l.type !== 'background' && layerOnLevel(l, levels, activeLevelId));
  const ids = shown.map((l) => l.id);
  const renamed = renaming ? layers.find((l) => l.id === renaming) : undefined;
  const menuLayer = menu.pos && menuLayerId ? layers.find((l) => l.id === menuLayerId) : undefined;

  // A tile click only changes where new things draw: the selection stays.
  const pick = (id: string) => useStore.getState().setActiveLayerId(id);
  const pickTerrain = () => {
    const current = useStore.getState().ui.activeLayerId;
    if (current !== TERRAIN_PANEL_ID) priorActiveLayerRef.current = current;
    pick(TERRAIN_PANEL_ID);
  };
  const eye = (layer: Layer) => (e: MouseEvent) => {
    if (e.altKey && layer.type === 'dungeon') toggleSolo(layer.id);
    else toggleLayerVisible(layer);
  };
  const add = () => {
    const id = addLayerOnShownLevel();
    notify.subtle('Layer added', { icon: 'plus' });
    requestTileRename(id);
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) moveLayerOnto(String(active.id), String(over.id));
  };
  const settings = (target: string) => openSheet({ kind: 'layer', target });
  const keys = (layer: Layer) => (e: KeyboardEvent<HTMLDivElement>) => {
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === 'F2') {
      stop();
      requestTileRename(layer.id);
    } else if (e.key === 'Delete') {
      stop();
      deleteLayer(layer.id);
    } else if (e.key === ' ') {
      stop();
      toggleLayerVisible(layer);
    }
  };

  return (
    <DockColumn
      title="Layers"
      data-column="layers"
      control={
        <>
          <Button variant="ghost" size="icon-xs" aria-label="Add layer" data-tip="Add layer" className="size-4 p-0 text-text-3" onClick={add}>
            <Plus aria-hidden strokeWidth={1.75} className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="All layers"
            data-tip="All layers"
            data-testid="shell-open-layers"
            className="size-4 p-0 text-text-3"
            onClick={() => openSheet('layers')}
          >
            <LayersIcon aria-hidden strokeWidth={1.75} className="size-3.5" />
          </Button>
        </>
      }
    >
      <div className="flex max-w-[436px] gap-1.5 overflow-x-auto" role="group" aria-label="Layers" data-keys="canvas">
        {background && (
          <LayerTile
            id={background.id}
            name={background.name || 'Background'}
            tip={background.name || 'Background'}
            active={activeLayerId === background.id}
            visible={background.visible}
            locked={background.locked}
            preview={
              background.type === 'background' && background.backgroundTexture ? (
                <Thumb thumbKey={background.id} fallback={<Swatch fill={background.backgroundColor} />} />
              ) : (
                <Swatch fill={background.type === 'background' ? background.backgroundColor : 'transparent'} />
              )
            }
            onPick={() => pick(background.id)}
            onToggleVisible={eye(background)}
            onToggleLock={() => toggleLayerLocked(background)}
            onSettings={() => settings(background.id)}
          />
        )}
        {/* Only an older map with terrain paint has a Terrain row: nothing paints it any more. */}
        {terrainPainted && (
          <LayerTile
            id={TERRAIN_PANEL_ID}
            name="Terrain"
            tip="Old terrain paint"
            active={activeLayerId === TERRAIN_PANEL_ID}
            visible={terrainVisible}
            preview={<Thumb thumbKey={TERRAIN_THUMB} fallback={<Mountain aria-hidden strokeWidth={1.75} className="absolute inset-0 m-auto size-4 text-text-3" />} />}
            onPick={pickTerrain}
            onToggleVisible={() => undoManager.execute(new TerrainAppearanceCommand({ visible: terrainVisible }, { visible: !terrainVisible }))}
            onSettings={() => settings(TERRAIN_PANEL_ID)}
          />
        )}
        <span role="presentation" className="mx-0.5 h-11 w-px shrink-0 bg-line" />
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
            {shown.map((layer) => {
              const name = layer.name || 'Unnamed layer';
              const soloed = solo?.layerId === layer.id;
              return (
                <SortableLayerTile
                  key={layer.id}
                  id={layer.id}
                  name={name}
                  tip={layer.visible ? `${name} · ${layerObjectCount(layer)} objects` : `${name} (hidden)`}
                  active={activeLayerId === layer.id}
                  visible={layer.visible}
                  locked={layer.locked}
                  soloOut={!!solo && !soloed}
                  soloed={soloed}
                  drop={dropTarget?.layerId === layer.id}
                  layerTile
                  preview={
                    layer.type === 'dungeon' ? (
                      <Thumb thumbKey={layer.id} fallback={<Swatch fill={layer.style.floorColor} />} />
                    ) : (
                      <LayersIcon aria-hidden strokeWidth={1.75} className="absolute inset-0 m-auto size-4 text-text-3" />
                    )
                  }
                  onPick={() => pick(layer.id)}
                  onToggleVisible={eye(layer)}
                  onToggleLock={() => toggleLayerLocked(layer)}
                  onSettings={() => settings(layer.id)}
                  onRename={() => requestTileRename(layer.id)}
                  onMenu={(x, y) => {
                    setMenuLayerId(layer.id);
                    menu.openAt(x, y);
                  }}
                  onKey={keys(layer)}
                />
              );
            })}
          </SortableContext>
        </DndContext>
      </div>
      <RenameDialog
        open={!!renamed}
        title="Rename layer"
        label="Name"
        value={renamed?.name ?? ''}
        onClose={() => requestTileRename(null)}
        onRename={(next) => {
          if (!renamed) return;
          const out = checkRename(next, renamed.name);
          if (out.kind === 'commit') renameLayer(renamed, out.name);
        }}
      />
      {menu.pos && menuLayer && (
        <ContextMenu
          pos={menu.pos}
          onClose={() => {
            menu.close();
            setMenuLayerId(null);
          }}
          items={buildLayerTileMenu(menuLayer, { onRename: () => requestTileRename(menuLayer.id), onSettings: () => settings(menuLayer.id) })}
        />
      )}
    </DockColumn>
  );
}

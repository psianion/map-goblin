import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { EyeOff, Eye, Layers, Lock, Mountain, Plus, Settings2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { TERRAIN_PANEL_ID, type Layer } from '@/store/types';
import { createDungeonLayer } from '@/store/factories';
import { AddLayerCommand, PropertyCommand, TerrainAppearanceCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { priorActiveLayerRef } from '@/components/toolbar/toolConstants';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { TERRAIN_THUMB, startLayerThumbs, useLayerThumb } from './layerThumbs';
import { disposeLayerThumbRenderer, renderLayerThumb } from './layerThumbRender';
import { LevelPicker } from './LevelPicker';
import { layerOnLevel } from './roomModel';
// The settings glyph on the active tile is styled with the sheet it opens.
import './layer-sheet.css';
import './filmstrip.css';

/** Same naming rule as the layer panel's "+": one past the highest "Layer N". */
function nextLayerName(layers: Layer[]): string {
  const max = layers.reduce((m, l) => {
    const hit = l.type === 'dungeon' ? /^Layer (\d+)$/.exec(l.name) : null;
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return `Layer ${max + 1}`;
}

/** A new layer on the level on show. */
function addLayer() {
  const s = useStore.getState();
  const layer = createDungeonLayer(nextLayerName(s.layers), s.ui.activeLevelId);
  undoManager.execute(new AddLayerCommand('Add layer', layer));
  useStore.getState().setActiveLayerId(layer.id);
  notify.subtle('Layer added', { icon: 'plus' });
}

function toggleLayerProp(layer: Layer, key: 'visible' | 'locked') {
  if (key === 'visible' && useStore.getState().ui.solo) useStore.getState().clearSolo();
  const was = layer[key];
  const label =
    key === 'visible' ? (was ? 'Hide layer' : 'Show layer') : was ? 'Unlock layer' : 'Lock layer';
  undoManager.execute(
    new PropertyCommand(label, { type: 'layer', layerId: layer.id }, { [key]: was }, { [key]: !was }),
  );
}

interface TileProps {
  name: string;
  active: boolean;
  visible: boolean;
  locked?: boolean;
  preview: ReactNode;
  onPick: () => void;
  onToggleVisible: () => void;
  onUnlock?: () => void;
  /** Opens the layer sheet; the glyph shows on the active tile, double-click works on any. */
  onSettings: () => void;
}

/** A 40px layer tile: a glimpse of the layer, its name on hover, eye on hover, lock when locked. */
function Tile({ name, active, visible, locked, preview, onPick, onToggleVisible, onUnlock, onSettings }: TileProps) {
  return (
    <div
      className={cn('v2-tile', active && 'v2-tile--on', !visible && 'v2-tile--hidden')}
      data-testid="v2-film-tile"
      data-active={active || undefined}
    >
      <button
        type="button"
        className="v2-tile__pick"
        onClick={onPick}
        onDoubleClick={onSettings}
        aria-pressed={active}
        aria-label={`Draw on ${name}`}
        data-tip={visible ? name : `${name} (hidden)`}
      >
        {preview}
      </button>
      <button
        type="button"
        className="v2-tile__eye"
        aria-label={visible ? `Hide ${name}` : `Show ${name}`}
        data-tip={visible ? 'Hide' : 'Show'}
        onClick={onToggleVisible}
      >
        {visible ? <Eye size={10} strokeWidth={2} /> : <EyeOff size={10} strokeWidth={2} />}
      </button>
      {active && (
        <button
          type="button"
          className="v2-ib v2-tile__set"
          aria-label="Layer settings"
          data-tip="Layer settings"
          onClick={onSettings}
        >
          <Settings2 size={10} strokeWidth={2} />
        </button>
      )}
      {locked && onUnlock && (
        <button type="button" className="v2-tile__lock" aria-label={`Unlock ${name}`} data-tip="Locked" onClick={onUnlock}>
          <Lock size={9} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

function Swatch({ fill, edge }: { fill: string; edge?: string }) {
  const style: CSSProperties = { background: fill, borderColor: edge ?? fill };
  return <span className="v2-tile__swatch" style={style} />;
}

/** The layer as the canvas draws it, framed to the map; `fallback` until a picture exists. */
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

/** Every layer in draw order, bottom first. Picking a tile is picking where tools draw. */
export function Filmstrip({ onOpenLayers, onOpenLayerSettings, mapWide = true }: FilmstripProps) {
  const layers = useStore(useShallow((s) => s.layers));
  const levels = useStore(useShallow((s) => s.levels));
  const activeLevelId = useStore((s) => s.ui.activeLevelId);
  const activeLayerId = useStore((s) => s.ui.activeLayerId);
  const terrainVisible = useStore((s) => s.mapSettings.terrain?.visible ?? true);
  const terrainPainted = useStore((s) => !!s.mapSettings.terrain?.bounds);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Tile pictures follow the store while the strip is up.
  useEffect(() => {
    const stop = startLayerThumbs(renderLayerThumb);
    return () => {
      stop();
      disposeLayerThumbRenderer();
    };
  }, []);

  const background = layers.find((l) => l.type === 'background');
  // The tiles are the level on show's layers; Background and Terrain belong to the whole map.
  const dungeon = layers.filter((l) => l.type !== 'background' && layerOnLevel(l, levels, activeLevelId));
  const fade = useEdgeFade(scrollRef, [dungeon.length]);

  // Keep the active tile in view when it changes from elsewhere (layer sheet, shortcuts).
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>('[data-active]');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeLayerId]);

  const pick = (id: string) => {
    const s = useStore.getState();
    s.setActiveLayerId(id);
    s.setSelectedIds([]);
  };

  const pickTerrain = () => {
    // Same bookkeeping as the layer panel's Terrain row, so Escape can step back out.
    const current = useStore.getState().ui.activeLayerId;
    if (current !== TERRAIN_PANEL_ID) priorActiveLayerRef.current = current;
    pick(TERRAIN_PANEL_ID);
  };

  return (
    <div
      className={cn('v2-film', !mapWide && 'v2-film--level')}
      data-testid="v2-filmstrip"
      role="group"
      aria-label="Layers"
      // Tiles outside the scroll (Background, Terrain): the CSS floor for how far the strip shrinks.
      style={{ '--v2-film-fixed': mapWide ? (background ? 2 : 1) : 0 } as CSSProperties}
    >
      <LevelPicker />
      {mapWide && background && background.type === 'background' && (
        <Tile
          name={background.name || 'Background'}
          active={activeLayerId === background.id}
          visible={background.visible}
          locked={background.locked}
          preview={
            background.backgroundTexture ? (
              <Thumb
                thumbKey={background.id}
                fallback={<Swatch fill={background.backgroundColor} edge="transparent" />}
              />
            ) : (
              <Swatch fill={background.backgroundColor} edge="transparent" />
            )
          }
          onPick={() => pick(background.id)}
          onToggleVisible={() => toggleLayerProp(background, 'visible')}
          onUnlock={() => toggleLayerProp(background, 'locked')}
          onSettings={() => onOpenLayerSettings(background.id)}
        />
      )}
      {mapWide && (
      <Tile
        name="Terrain"
        active={activeLayerId === TERRAIN_PANEL_ID}
        visible={terrainVisible}
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
      >
        {dungeon.map((layer) => (
          <Tile
            key={layer.id}
            name={layer.name || 'Unnamed layer'}
            active={activeLayerId === layer.id}
            visible={layer.visible}
            locked={layer.locked}
            preview={
              layer.type === 'dungeon' ? (
                <Thumb
                  thumbKey={layer.id}
                  fallback={<Swatch fill={layer.style.floorColor} edge={layer.style.wallColor} />}
                />
              ) : (
                <Layers size={16} strokeWidth={1.75} />
              )
            }
            onPick={() => pick(layer.id)}
            onToggleVisible={() => toggleLayerProp(layer, 'visible')}
            onUnlock={() => toggleLayerProp(layer, 'locked')}
            onSettings={() => onOpenLayerSettings(layer.id)}
          />
        ))}
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
    </div>
  );
}

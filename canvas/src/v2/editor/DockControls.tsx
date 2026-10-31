import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Minus, MoreHorizontal, Plus, Star, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { selectActiveLayer, selectSelectedIds } from '@/store/selectors';
import type { DungeonLayer, DungeonStyle, RoomLook, ToolType } from '@/store/types';
import { GROUP_WALL_TYPE, STYLE_TO_LOOK_KEY, wallTypeGroup } from '@dnd/core/src/shared/wallLook';
import { MIXED_SWATCH, WALL_TYPE_CHOICES } from './selectionModel';
import { DUNGEON_STYLE_PRESETS, matchPresetId, type MapStylePreset } from '@/store/presetRegistry';
import { LayerWallLookCommand, PresetApplyCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { DEFAULT_TERRAIN_PALETTE } from '@/store/slices/mapSettings';
import { TERRAIN_BRUSH_RANGES, WATER_RANGES } from '@/store/slices/tools';
import { familyKeyOf, getCatalogEntry } from '@dnd/core/src/assets/packCatalog';
import {
  minDoorWidth,
  doorAngleValue,
  doorStyleLabel,
  turnDoorAngle,
  PLACEABLE_DOOR_STYLES,
} from '@dnd/core/src/engine/tools/DoorTool';
import { NumBox } from './PropCards';
import { LABEL_SIZE_RANGE } from '@dnd/core/src/engine/tools/TextTool';
import { LABEL_STYLES } from '@dnd/core/src/shared/labelStyles';
import { PackThumbnailCanvas } from '@/components/shared/PackThumbnailCanvas';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { AssetTypeFilter } from '@/components/layers/AssetBrowserPanel';
import { STYLE_TOOLS, type DockTabId } from './dockTabs';
import { ColorCtl, Ctl, DockPopover, RangeInput, Seg, Select, Slider, Switch } from './controls';
import {
  TERRAIN_SLOT_COUNT,
  WATER_BANK_TEXTURE,
  floorCandidates,
  floorColourGesture,
  floorColourValue,
  floorScopeLabel,
  floorTargetsOf,
  type FloorTargets,
  pickAssetForTool,
  pickFloorTexture,
  pickTerrainSlotTexture,
  pickWallSet,
  pickedFloorTexture,
  propCandidates,
  wallSetCandidates,
  wallSetLabel,
  wallSetThumb,
  wallWidthIgnored,
} from './assetStrip';
import { lookGesture, resolvedLookOf, setLook, targetName, useLookTarget, type LookTarget } from './roomLook';
import { RoomSettings } from './RoomsDock';
import { PropSettings } from './PropsDock';
import { LightPresets, LightSettings } from './LightsDock';
import './dock-settings.css';
import './labels.css';

// The popover moved to the shared controls; kept here so older imports still resolve.
export { DockPopover };

/* ── Layer style edits, undoable ───────────────────────── */

function useActiveDungeonLayer(): DungeonLayer | null {
  const layer = useStore(useShallow(selectActiveLayer));
  return layer && layer.type === 'dungeon' ? (layer as DungeonLayer) : null;
}

function patchStyle(layer: DungeonLayer, partial: Partial<DungeonStyle>) {
  useStore.getState().updateLayer(layer.id, { style: { ...layer.style, ...partial } } as Partial<DungeonLayer>);
}

/** A layer wall change, which reaches the walls already drawn (see LayerWallLookCommand). */
function commitWallLook(layer: DungeonLayer, field: 'wallWidth' | 'wallTextureTint', next: unknown, start: unknown) {
  if (next === start) return;
  undoManager.execute(
    new LayerWallLookCommand(`Change ${field}`, layer.id, { [field]: next }, { [field]: start }),
  );
}

/**
 * The part of a preset a room, area or level can pin: the keys its look shares with a layer
 * style (floor texture and tint, wall set, wall tint, wall width). The rest of a preset (plain
 * floor and wall colours, edge settings) is layer-only and has no place on a scope's look.
 */
function presetLook(preset: MapStylePreset): Partial<RoomLook> {
  const out: Record<string, unknown> = {};
  for (const [styleKey, value] of Object.entries(preset.dungeonStyle)) {
    const lookKey = STYLE_TO_LOOK_KEY[styleKey as keyof DungeonStyle];
    if (lookKey && value !== undefined) out[lookKey] = value;
  }
  return out as Partial<RoomLook>;
}

/** Whether a scope's resolved look already wears every key the preset would pin. */
function presetWorn(look: Partial<Record<keyof RoomLook, unknown>> | null, preset: MapStylePreset): boolean {
  if (!look) return false;
  const keys = Object.entries(presetLook(preset));
  return keys.length > 0 && keys.every(([k, v]) => look[k as keyof RoomLook] === v);
}

/**
 * A preset picked while a room, area or level is selected pins its look keys on that scope,
 * as one undo step, and leaves the layer's own style exactly as it was.
 */
function applyPresetToTarget(target: LookTarget, preset: MapStylePreset) {
  const patch = presetLook(preset);
  if (Object.keys(patch).length === 0) return;
  setLook(target, patch);
  const name = targetName(useStore.getState(), target);
  notify.action(`Applied '${preset.label}' to ${name}`, { label: 'Undo', onClick: () => undoManager.undo(), icon: 'palette' });
}

function applyPreset(layer: DungeonLayer, preset: MapStylePreset) {
  undoManager.execute(
    new PresetApplyCommand(`Apply preset: ${preset.label}`, layer.id, preset, structuredClone(layer.style)),
  );
  notify.action(`Applied '${preset.label}'`, { label: 'Undo', onClick: () => undoManager.undo(), icon: 'palette' });
}

/* ── Swatches ──────────────────────────────────────────── */

const SWATCH_ROW = 7;

function PresetSwatch({ preset, on, disabled, onPick }: { preset: MapStylePreset; on: boolean; disabled: boolean; onPick: () => void }) {
  const s = preset.dungeonStyle;
  return (
    <button
      type="button"
      className={cn('v2-swatch', on && 'v2-swatch--on')}
      aria-pressed={on}
      aria-label={preset.label}
      data-tip={disabled ? `${preset.label} (pick a layer first)` : preset.label}
      disabled={disabled}
      onClick={onPick}
    >
      <span className="v2-swatch__floor" style={{ background: s.floorColor ?? '#c8b89a' }} />
      <span className="v2-swatch__wall" style={{ background: s.wallColor ?? '#222' }} />
    </button>
  );
}

function StylePresets() {
  const layer = useActiveDungeonLayer();
  // With a room, area or level selected the presets act on it, never on the layer: the same
  // rule every other control in the Floors and Walls tabs follows.
  const target = useLookTarget();
  const targetLook = useStore(useShallow((s) => (target ? resolvedLookOf(s, target) : null)));
  const [more, setMore] = useState(false);
  const activeId = target ? undefined : layer ? matchPresetId(layer.style) : undefined;
  const row = DUNGEON_STYLE_PRESETS.slice(0, SWATCH_ROW);
  const swatch = (p: MapStylePreset) => (
    <PresetSwatch
      key={p.id}
      preset={p}
      on={target ? presetWorn(targetLook, p) : p.id === activeId}
      disabled={!layer && !target}
      onPick={() => {
        if (target) applyPresetToTarget(target, p);
        else if (layer) applyPreset(layer, p);
        setMore(false);
      }}
    />
  );
  return (
    <div className="v2-swatches" data-testid="v2-swatches">
      {row.map(swatch)}
      {DUNGEON_STYLE_PRESETS.length > SWATCH_ROW && (
        <>
          <button
            type="button"
            className={cn('v2-ib', more && 'v2-ib--on')}
            aria-label="All styles"
            data-tip="All styles"
            onClick={() => setMore((m) => !m)}
          >
            <MoreHorizontal size={15} strokeWidth={1.75} />
          </button>
          <DockPopover open={more} onClose={() => setMore(false)} className="v2-pop--swatches" label="All styles">
            <p className="v2-pop__title">Styles</p>
            <div className="v2-swatch-grid">{DUNGEON_STYLE_PRESETS.map(swatch)}</div>
          </DockPopover>
        </>
      )}
    </div>
  );
}

/**
 * The map's six terrain textures, one per brush slot. A click picks the slot; a second
 * click on an empty one, or "More", opens the floor textures, and a pick from there
 * fills the slot in hand. Right-click or the corner cross empties a slot.
 */
function TerrainSlots({ onAssign }: { onAssign: () => void }) {
  const slot = useStore((s) => s.tools.settings.terrainBrush.slot);
  const erasing = useStore((s) => s.tools.eraseMode);
  const palette = useStore(useShallow((s) => s.mapSettings.terrain?.palette ?? DEFAULT_TERRAIN_PALETTE));
  // Pack thumbnails arrive after boot; re-read the catalogue when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  const slots = Array.from({ length: TERRAIN_SLOT_COUNT }, (_, i) => palette[i] ?? null);
  const select = (i: number) => useStore.getState().updateTerrainBrushSettings({ slot: i });
  return (
    <div className="v2-tslots" data-testid="v2-swatches">
      <div className="v2-swatches" role="group" aria-label="Terrain textures">
        {slots.map((id, i) => {
          const on = slot === i;
          if (!id) {
            return (
              <button
                key={i}
                type="button"
                className={cn('v2-swatch v2-tslot--empty', on && 'v2-swatch--on')}
                aria-pressed={on}
                aria-label={`Slot ${i + 1}, empty`}
                data-tip="Assign a texture"
                data-testid={`v2-tslot-${i}`}
                onClick={() => (on ? onAssign() : select(i))}
              >
                <Plus size={12} strokeWidth={1.75} />
              </button>
            );
          }
          const name = getCatalogEntry(id)?.label ?? id;
          return (
            <span key={i} className="v2-tslot">
              <button
                type="button"
                className={cn('v2-swatch', on && 'v2-swatch--on')}
                aria-pressed={on}
                aria-label={`Slot ${i + 1}, ${name}`}
                data-tip={name}
                data-testid={`v2-tslot-${i}`}
                onClick={() => select(i)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  pickTerrainSlotTexture(i, null);
                }}
              >
                <PackThumbnailCanvas textureId={id} />
              </button>
              <button
                type="button"
                className="v2-tslot__clear"
                aria-label={`Clear slot ${i + 1}`}
                data-tip="Clear slot"
                onClick={() => pickTerrainSlotTexture(i, null)}
              >
                <X size={9} strokeWidth={1.75} />
              </button>
            </span>
          );
        })}
        <button type="button" className="v2-link" onClick={onAssign}>
          More
        </button>
      </div>
      {!slots[slot] && !erasing && (
        <span className="v2-dock__note v2-tslots__note" data-testid="v2-tslot-note">
          Assign a texture to this slot to paint.
        </span>
      )}
    </div>
  );
}

/* ── Asset strips: recents first, then suggestions ──────── */

interface StripTile {
  /** What a pick hands over: an asset id, or a wall-set id. */
  id: string;
  /** The pack texture the tile shows. */
  textureId: string;
  label: string;
}

/**
 * A row of pack thumbnails, built like the terrain slots. `fit="cover"` fills each tile
 * from the middle of the texture, for pieces too long and thin to read whole. Whole tiles only: when the dock
 * runs short of room the row gives up tiles from the end, never half of one, and the
 * link after it stays put.
 */
function AssetStrip({
  label,
  tiles,
  isOn,
  disabled,
  onPick,
  testId,
  fit,
  className,
  starred,
  children,
}: {
  label: string;
  className?: string;
  tiles: StripTile[];
  fit?: 'contain' | 'cover';
  isOn: (id: string) => boolean;
  /** Tiles the DM starred carry a small star in the corner. */
  starred?: (id: string) => boolean;
  disabled?: boolean;
  onPick: (id: string) => void;
  testId: string;
  /** The link to the longer list, if there is one. */
  children?: ReactNode;
}) {
  return (
    <div className={cn('v2-swatches v2-strip', className)} role="group" aria-label={label} data-testid={testId}>
      {tiles.length === 0 ? (
        <span className="v2-dock__note">No packs installed</span>
      ) : (
        <div className="v2-strip__tiles">
          {tiles.map((t) => {
            const on = isOn(t.id);
            const tile = (
              <button
                key={t.id}
                type="button"
                className={cn('v2-swatch', on && 'v2-swatch--on')}
                aria-pressed={on}
                aria-label={t.label}
                data-tip={disabled ? `${t.label} (pick a layer first)` : t.label}
                disabled={disabled}
                onClick={() => onPick(t.id)}
              >
                <PackThumbnailCanvas textureId={t.textureId} fit={fit} />
              </button>
            );
            if (!starred?.(t.id)) return tile;
            return (
              <span key={t.id} className="v2-strip__slot">
                {tile}
                <span className="v2-strip__fav" aria-label="Favourite" role="img">
                  <Star size={8} strokeWidth={0} fill="currentColor" />
                </span>
              </span>
            );
          })}
        </div>
      )}
      {children}
    </div>
  );
}

const assetTile = (id: string): StripTile => ({ id, textureId: id, label: getCatalogEntry(id)?.label ?? id });

/** The floors a pick in the Floors tab changes (floorTargetsOf), kept current. */
function useFloorTargets(): FloorTargets {
  const layers = useStore((s) => s.layers);
  const activeLayerId = useStore((s) => s.ui.activeLayerId);
  const selectedIds = useStore(selectSelectedIds);
  // Hidden by solo counts as hidden: re-read when solo moves.
  useStore((s) => s.ui.solo);
  return floorTargetsOf(layers, activeLayerId, selectedIds);
}

/** Floor textures: what the target floors wear, and what the layer's new ones take. */
function FloorStrip({ onMore }: { onMore: () => void }) {
  const layer = useActiveDungeonLayer();
  const recent = useStore((s) => s.assets.recentlyUsed);
  const targets = useFloorTargets();
  // Pack thumbnails arrive after boot; re-read the catalogue when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  const target = useLookTarget();
  const look = useStore((s) => (target ? resolvedLookOf(s, target)?.floorTextureId : undefined));
  const picked = target ? look || undefined : pickedFloorTexture(targets);
  const tiles = floorCandidates(recent, picked, layer?.style.defaultTextureId).map(assetTile);
  return (
    <AssetStrip
      label="Floor textures"
      tiles={tiles}
      isOn={(id) => id === picked}
      disabled={!layer && !target}
      onPick={pickFloorTexture}
      testId="v2-strip-floors"
    >
      <button type="button" className="v2-link" onClick={onMore}>
        More
      </button>
    </AssetStrip>
  );
}

/**
 * Wall sets, each shown by the middle of its straight run (a cave kit by its short
 * straight piece), cropped square so the tile shows the material rather than a thin
 * band. There is no longer list to open.
 */
function WallStrip() {
  const layer = useActiveDungeonLayer();
  const recent = useStore((s) => s.assets.recentlyUsed);
  useStore((s) => s.packs.installedPacks);
  const target = useLookTarget();
  const look = useStore((s) => (target ? resolvedLookOf(s, target)?.wallTextureSetId : undefined));
  const current = target ? look || undefined : layer?.style.wallTextureSetId;
  const tiles = wallSetCandidates(recent, current).map(
    (set): StripTile => ({ id: set, textureId: wallSetThumb(set) ?? '', label: wallSetLabel(set) }),
  );
  return (
    <AssetStrip
      label="Wall sets"
      tiles={tiles}
      isOn={(id) => id === current}
      disabled={!layer && !target}
      onPick={(id) => {
        if (target) setLook(target, { wallTextureSetId: id });
        else if (layer) pickWallSet(layer, id);
      }}
      testId="v2-strip-walls"
      fit="cover"
      className="v2-strip--walls"
    />
  );
}

/** Props for the brush: one to stamp, or several in the scatter pool, all marked; starred ones first. */
function PropStrip({ onMore }: { onMore: () => void }) {
  const recent = useStore((s) => s.assets.recentlyUsed);
  const favourites = useStore((s) => s.assets.favourites);
  const assetIds = useStore((s) => s.tools.settings.scatterBrush.assetIds);
  useStore((s) => s.packs.installedPacks);
  const tiles = propCandidates(recent, assetIds, favourites).map(assetTile);
  return (
    <AssetStrip
      label="Props"
      tiles={tiles}
      isOn={(id) => assetIds.includes(id)}
      starred={(id) => favourites.includes(id) || favourites.includes(familyKeyOf(id))}
      onPick={pickAssetForTool}
      testId="v2-strip-props"
    >
      <button type="button" className="v2-link" onClick={onMore} data-testid="v2-props-library">
        Library
      </button>
    </AssetStrip>
  );
}

/** What each style tile shows: a sample of the style, drawn in CSS (labels.css). */
const STYLE_GLYPH: Record<string, ReactNode> = {
  'room-name': <span className="v2-lglyph v2-lglyph--room">Aa</span>,
  'door-tag': <span className="v2-lglyph v2-lglyph--pill">Door</span>,
  'gm-note': <span className="v2-lglyph v2-lglyph--note">Note</span>,
  'number-pin': <span className="v2-lglyph v2-lglyph--pin">3</span>,
  callout: <span className="v2-lglyph v2-lglyph--callout">Aa</span>,
  custom: <span className="v2-lglyph">Aa</span>,
};

/**
 * The Label tool's styles (board T1): one pick, inverted ink. A pick puts the dock's Size and
 * Colour back to the style's; they then set the labels placed after it.
 */
function LabelStyleTiles() {
  const label = useStore(useShallow((s) => s.tools.settings.label));
  return (
    <div className="v2-swatches v2-lstyles" role="radiogroup" aria-label="Label styles" data-testid="v2-swatches">
      {LABEL_STYLES.map((s) => {
        const on = s.id === label.style;
        const key = s.id ?? 'custom';
        const look = [`${fixed(1)(s.fontSize)} sq`, s.weight === 'bold' ? 'bold' : null, s.backdrop ?? null, s.binds ? `follows a ${s.binds}` : null]
          .filter(Boolean)
          .join(' · ');
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={s.name}
            className={cn('v2-lstyle', on && 'v2-lstyle--on')}
            data-tip={s.name}
            data-tip-key={look}
            data-testid={`v2-label-style-${key}`}
            onClick={() => {
              const st = useStore.getState();
              st.updateToolSettings({
                label: { ...label, style: s.id, fontSize: s.fontSize, color: s.color === 'ink' ? null : s.color },
              });
              // A pick takes up the Label tool, as a prop pick takes up the brush.
              if (st.tools.activeTool !== 'text') st.setActiveTool('text');
            }}
          >
            <span className="v2-lstyle__box">{STYLE_GLYPH[key]}</span>
            <span className="v2-lstyle__nm">{s.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The row of presets for the tool in hand, and for floors, walls and props the assets to draw with. */
export function ToolSwatches({
  tool,
  tab,
  onOpenAssets,
}: {
  tool: ToolType;
  tab: DockTabId;
  onTab: (t: DockTabId) => void;
  onOpenAssets: (type?: AssetTypeFilter) => void;
}) {
  if (tool === 'terrain') return <TerrainSlots onAssign={() => onOpenAssets('floor')} />;
  if (STYLE_TOOLS.includes(tool)) {
    return (
      <>
        <StylePresets />
        <span className="v2-vr" role="presentation" />
        {tool === 'wall' ? <WallStrip /> : <FloorStrip onMore={() => onOpenAssets('floor')} />}
      </>
    );
  }
  if (tab === 'lights') return <LightPresets />;
  if (tool === 'text') return <LabelStyleTiles />;
  // "Library" opens the props browser (the shell maps the Object type to it).
  if (tool === 'scatterBrush') return <PropStrip onMore={() => onOpenAssets('object')} />;
  return null;
}

/* ── Settings: the controls a DM reaches for while drawing ─
 *
 * Chosen per tool, most-touched first. Props and Lights keep the rest behind their own
 * "⋯" card (PropsDock, LightsDock); every other tool carries all its settings here.
 *
 *   Rectangle, Polygon, Path   presets · floor colour (tint of textured floors) · wall width
 *   Regular polygon            presets · floor colour · sides · wall width
 *   Terrain                    textures · size · strength · tint · tint opacity
 *   Water                      river/lake · width (river) · banks
 *   Wall                       type · width (not for cave kits) · wall tint (textured walls)
 *   Door                       style · secret · width
 *   Props                      mode · scale, angle, mirror, variant (stamp) or radius, density (scatter) · ⋯
 *   Light                      presets · bright · dim · colour · flicker · ⋯
 *   Label                      size · colour
 *   Zone                       shape
 */

const fixed = (n: number) => (v: number) => v.toFixed(n);
const percent = (v: number) => `${Math.round(v * 100)}%`;

/** A look drag on the selected room, area or level, rebuilt when the selection moves to another. */
function useTargetGesture(target: LookTarget | null) {
  return useMemo(() => (target ? lookGesture(target) : null), [target]);
}

/**
 * A colour pinned on the selected room, area or level (`lookKey` of its look). Shows what
 * the scope resolves to; a visit to the picker previews live and lands as one undo step.
 */
function TargetColour({ target, lookKey, label }: { target: LookTarget; lookKey: 'floorTint' | 'wallTextureTint'; label: string }) {
  const value = useStore((s) => resolvedLookOf(s, target)?.[lookKey] ?? '#ffffff');
  const name = useStore((s) => targetName(s, target));
  const gesture = useTargetGesture(target);
  return (
    <ColorCtl
      label={label}
      tip={`${label} of ${name}`}
      value={value}
      onChange={(c) => gesture?.preview({ [lookKey]: c })}
      onCommit={() => gesture?.commit()}
    />
  );
}

/**
 * The wall width: the selected room's, area's or level's when one is selected, else the
 * layer's. Absent when the walls are a cave kit's rock, which has no width to set.
 */
function WallWidth({ layer, label }: { layer: DungeonLayer | null; label: string }) {
  const target = useLookTarget();
  if (target) return <TargetWallWidth target={target} label={label} />;
  return layer ? <LayerWallWidth layer={layer} label={label} /> : null;
}

function TargetWallWidth({ target, label }: { target: LookTarget; label: string }) {
  useStore((s) => s.packs.installedPacks);
  const look = useStore(useShallow((s) => resolvedLookOf(s, target)));
  const gesture = useTargetGesture(target);
  if (!look || wallWidthIgnored(look.wallTextureSetId || undefined)) return null;
  return (
    <Slider
      label={label}
      value={look.wallWidth}
      min={0.05}
      max={1}
      step={0.05}
      format={fixed(2)}
      onChange={(v) => gesture?.preview({ wallWidth: v })}
      onCommit={() => gesture?.commit()}
    />
  );
}

function LayerWallWidth({ layer, label }: { layer: DungeonLayer; label: string }) {
  // The kits arrive with the packs, after boot; re-read when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  if (wallWidthIgnored(layer.style.wallTextureSetId)) return null;
  return (
    <Slider
      label={label}
      value={layer.style.wallWidth}
      min={0.05}
      max={1}
      step={0.05}
      format={fixed(2)}
      onChange={(v) => patchStyle(layer, { wallWidth: v })}
      onCommit={(v, start) => commitWallLook(layer, 'wallWidth', v, start)}
    />
  );
}

function SidesCtl() {
  const sides = useStore((s) => s.tools.settings.regularPolygon.sides);
  const set = (n: number) =>
    useStore.getState().updateToolSettings({ regularPolygon: { sides: Math.min(32, Math.max(3, n)) } });
  return (
    <Ctl label="Sides" wide>
      <span className="v2-stepper">
        <button type="button" aria-label="Fewer sides" disabled={sides <= 3} onClick={() => set(sides - 1)}>
          <Minus size={10} />
        </button>
        <span className="v2-num">{sides}</span>
        <button type="button" aria-label="More sides" disabled={sides >= 32} onClick={() => set(sides + 1)}>
          <Plus size={10} />
        </button>
      </span>
    </Ctl>
  );
}

/**
 * The colour of the floors as they look: a textured floor's tint, a plain floor's colour.
 * It paints the selected floors, or with none selected every floor on the layer, and the
 * layer's next floors start with it. A drag in the picker previews live and lands as one
 * undo step.
 */
function FloorColour() {
  const target = useLookTarget();
  if (target) return <TargetColour target={target} lookKey="floorTint" label="Floor" />;
  return <LayerFloorColour />;
}

function LayerFloorColour() {
  const targets = useFloorTargets();
  // Which floors count as textured depends on the packs, which arrive after boot.
  useStore((s) => s.packs.installedPacks);
  const gesture = useRef<ReturnType<typeof floorColourGesture> | null>(null);
  gesture.current ??= floorColourGesture();
  const { colour, mixed } = floorColourValue(targets);
  return (
    <ColorCtl
      label="Floor"
      tip={`Colour of ${floorScopeLabel(targets)}`}
      value={mixed ? MIXED_SWATCH : colour}
      readout={mixed ? 'Mixed' : undefined}
      onChange={(c) => gesture.current?.preview(c)}
      onCommit={() => gesture.current?.commit()}
    />
  );
}

function DrawingSettings({ tool }: { tool: ToolType }) {
  const layer = useActiveDungeonLayer();
  const target = useLookTarget();
  if (!layer && !target) return <span className="v2-dock__note">Pick a layer to draw on</span>;
  return (
    <>
      <FloorColour />
      {tool === 'regularPolygon' && <SidesCtl />}
      <WallWidth layer={layer} label="Wall" />
    </>
  );
}

function WallSettings() {
  const layer = useActiveDungeonLayer();
  const target = useLookTarget();
  const targetSet = useStore((s) => (target ? resolvedLookOf(s, target)?.wallTextureSetId : undefined));
  const wallType = useStore((s) => s.tools.settings.wallType);
  const set = useStore.getState().updateToolSettings;
  return (
    <>
      <Seg
        label="Type"
        value={wallTypeGroup(wallType)}
        options={WALL_TYPE_CHOICES}
        onChange={(g) => {
          // Picking the group a stored type already belongs to keeps that type.
          if (wallTypeGroup(wallType) !== g) set({ wallType: GROUP_WALL_TYPE[g] });
        }}
      />
      <WallWidth layer={layer} label="Width" />
      {target ? (
        // A level's tint tints the sets of its layers even when the level names no set itself.
        (targetSet || target.kind === 'level') && (
          <TargetColour target={target} lookKey="wallTextureTint" label="Wall tint" />
        )
      ) : layer?.style.wallTextureSetId && (
        <ColorCtl
          label="Wall tint"
          value={layer.style.wallTextureTint}
          onChange={(c) => patchStyle(layer, { wallTextureTint: c })}
          onCommit={(c, start) => commitWallLook(layer, 'wallTextureTint', c, start)}
        />
      )}
    </>
  );
}

function DoorSettings() {
  const style = useStore((s) => s.tools.settings.doorStyle) ?? 'single';
  const width = useStore((s) => s.tools.settings.doorWidth) ?? 1;
  const secret = useStore((s) => s.tools.settings.doorSecret) ?? false;
  const angle = useStore((s) => s.tools.settings.doorAngle) ?? 0;
  const set = useStore.getState().updateToolSettings;
  return (
    <>
      <Select
        label="Style"
        width={80}
        value={style}
        options={PLACEABLE_DOOR_STYLES.map((value) => ({ value, label: doorStyleLabel(value) }))}
        // A wider style takes the width up with it, as the v1 options do.
        onChange={(v) => set({ doorStyle: v, doorWidth: Math.max(width, minDoorWidth(v)) })}
      />
      <Switch label="Secret" checked={secret} onChange={(v) => set({ doorSecret: v })} />
      <Slider
        label="Width"
        value={width}
        min={minDoorWidth(style)}
        max={4}
        step={0.25}
        format={fixed(2)}
        onChange={(v) => set({ doorWidth: v })}
      />
      {/* The angle of a door placed on open floor; one on a wall takes the wall's. */}
      <Ctl label="Angle" width={56}>
        <NumBox
          label=""
          title="Door angle"
          value={angle}
          format={(v) => String(Math.round(v))}
          unit="°"
          onCommit={(v) => set({ doorAngle: doorAngleValue(v) })}
        />
      </Ctl>
      <button
        type="button"
        className="v2-rbtn"
        data-tip="Turn the next free-standing door a quarter"
        onClick={() => set({ doorAngle: turnDoorAngle(angle) })}
      >
        Turn 90°
      </button>
    </>
  );
}

function TerrainSettings() {
  const brush = useStore(useShallow((s) => s.tools.settings.terrainBrush));
  const set = useStore.getState().updateTerrainBrushSettings;
  return (
    <>
      <Slider
        label="Size"
        width={56}
        value={brush.radius}
        {...TERRAIN_BRUSH_RANGES.radius}
        format={fixed(1)}
        onChange={(v) => set({ radius: v })}
      />
      <Slider
        label="Strength"
        width={72}
        value={brush.strength}
        {...TERRAIN_BRUSH_RANGES.strength}
        format={percent}
        onChange={(v) => set({ strength: v })}
      />
      {/* The colour and how much of it, in one column: the row has six slots to hold. */}
      <ColorCtl
        label="Tint"
        value={brush.tintColor}
        readout={percent(brush.tintOpacity)}
        onChange={(c) => set({ tintColor: c })}
      >
        <RangeInput
          label="Tint opacity"
          className="v2-tint__range"
          value={brush.tintOpacity}
          {...TERRAIN_BRUSH_RANGES.tintOpacity}
          onChange={(v) => set({ tintOpacity: v })}
        />
      </ColorCtl>
    </>
  );
}

function WaterSettings() {
  const water = useStore(useShallow((s) => s.tools.settings.water));
  const set = useStore.getState().updateWaterSettings;
  return (
    <>
      <Seg
        label="Kind"
        value={water.mode}
        options={[
          { value: 'river', label: 'River' },
          { value: 'lake', label: 'Lake' },
        ]}
        onChange={(v) => set({ mode: v })}
      />
      {water.mode === 'river' && (
        <Slider label="Width" width={56} value={water.width} {...WATER_RANGES.width} format={fixed(1)} onChange={(v) => set({ width: v })} />
      )}
      <Switch
        label="Banks"
        checked={!!water.bankTextureId}
        onChange={(on) => set({ bankTextureId: on ? WATER_BANK_TEXTURE : '' })}
      />
    </>
  );
}

function LabelSettings() {
  const label = useStore(useShallow((s) => s.tools.settings.label));
  const layer = useActiveDungeonLayer();
  const set = (patch: Partial<typeof label>) => useStore.getState().updateToolSettings({ label: { ...label, ...patch } });
  // Until a colour is picked, a label takes its layer's ink (`style.wallColor`, the grid
  // lines colour); the swatch shows that.
  const color = label.color ?? layer?.style.wallColor ?? '#222222';
  return (
    <>
      <Slider label="Size" value={label.fontSize} {...LABEL_SIZE_RANGE} format={fixed(1)} onChange={(v) => set({ fontSize: v })} />
      <ColorCtl label="Colour" value={color} onChange={(c) => set({ color: c })} />
    </>
  );
}

function ZoneSettings() {
  const mode = useStore((s) => s.tools.settings.zone.mode);
  return (
    <Seg
      label="Shape"
      value={mode}
      options={[
        { value: 'point', label: 'Point' },
        { value: 'circle', label: 'Circle' },
        { value: 'rect', label: 'Rect' },
      ]}
      onChange={(v) => useStore.getState().updateToolSettings({ zone: { mode: v } })}
    />
  );
}

function QuickSettings({ tool }: { tool: ToolType }) {
  switch (tool) {
    case 'rectangle':
    case 'polygon':
    case 'regularPolygon':
    case 'path':
      return <DrawingSettings tool={tool} />;
    case 'wall':
      return <WallSettings />;
    case 'door':
      return <DoorSettings />;
    case 'terrain':
      return <TerrainSettings />;
    case 'water':
      return <WaterSettings />;
    case 'scatterBrush':
      return <PropSettings />;
    case 'light':
      return <LightSettings />;
    case 'text':
      return <LabelSettings />;
    case 'zone':
      return <ZoneSettings />;
    case 'roomRect':
    case 'roomPolygon':
    case 'divide':
      return <RoomSettings tool={tool} />;
    default:
      return null;
  }
}

/** The few controls that matter for the tool in hand (Props and Lights carry their own "⋯"). */
export function ToolSettings({ tool }: { tool: ToolType }) {
  return (
    <div className={cn('v2-dock__section v2-settings', `v2-settings--${tool}`)} data-testid="v2-settings">
      <QuickSettings tool={tool} />
    </div>
  );
}

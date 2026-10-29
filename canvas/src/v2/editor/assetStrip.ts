import { useStore } from '@/store/store';
import { CompositeCommand, LayerStyleChangeCommand, LayerWallLookCommand, UpdateChildCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { selectActiveLayer } from '@/store/selectors';
import type { Command, DungeonLayer, DungeonStyle, Layer, MapBuilderStore, ShapeChild } from '@/store/types';
import {
  type CatalogEntry,
  getBandSet,
  getBandSetIds,
  familyOfKey,
  getCatalogEntry,
  getEntriesByType,
  getWallPieces,
  getWallSetDefaults,
  getWallSetIds,
  hasLiveTexture,
  isBandSet,
} from '@dnd/core/src/assets/packCatalog';
import { blockedLayerReason } from '@dnd/core/src/engine/tools/layerGuard';
import { pickAsset } from '@dnd/core/src/store/pickAsset';
import { notify } from '@/lib/toast';
import { DEFAULT_TERRAIN_PALETTE } from '@/store/slices/mapSettings';
import { FLOOR_TOOLS } from './dockTabs';
import { WATER_BANK_TEXTURE_ID } from '@dnd/core/src/engine/water/waterTextures';
import { selectedLookTarget, setLook, targetName } from './roomLook';

/**
 * The dock's asset strips: what each one offers, in what order, and what a pick does.
 * One recents list (assets.recentlyUsed) feeds every strip; each keeps the kinds it
 * draws with, then fills up from the catalogue.
 */

/** Tiles in a strip before "More" takes over. */
export const STRIP_CAP = 7;

/** Recents first, then suggestions, each id once and blanks skipped, at most `cap`. */
export function orderStripCandidates(
  recent: readonly (string | null | undefined)[],
  suggested: readonly (string | null | undefined)[],
  cap = STRIP_CAP,
): string[] {
  const out: string[] = [];
  for (const id of [...recent, ...suggested]) {
    if (out.length >= cap) break;
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The layer as the store holds it now, not as the strip last rendered it. */
function liveLayer(layer: DungeonLayer): DungeonLayer {
  const live = useStore.getState().layers.find((l) => l.id === layer.id);
  return live && live.type === 'dungeon' ? (live as DungeonLayer) : layer;
}

/** The pack whose textures lead the suggestions, when it has any of the kind asked for. */
export const PREFERRED_PACK = 'gg-forge';

/** Catalogue ids with the preferred pack's first, each pack keeping its own order. */
function preferredFirst(entries: readonly CatalogEntry[]): string[] {
  const preferred = entries.filter((e) => e.packId === PREFERRED_PACK);
  const rest = entries.filter((e) => e.packId !== PREFERRED_PACK);
  return [...preferred, ...rest].map((e) => e.id);
}

const ofType =
  (...types: string[]) =>
  (id: string | null | undefined): id is string => {
    const type = id ? getCatalogEntry(id)?.type : undefined;
    return type !== undefined && types.includes(type);
  };

/* ── Floors ─────────────────────────────────────────────── */

/** The shapes selected on `layer`. */
export function selectedShapes(layer: DungeonLayer, selectedIds: readonly string[]): ShapeChild[] {
  return layer.children.filter((c): c is ShapeChild => c.childType === 'shape' && selectedIds.includes(c.id));
}

function layerShapes(layer: DungeonLayer): ShapeChild[] {
  return layer.children.filter((c): c is ShapeChild => c.childType === 'shape');
}

const isDungeon = (l: Layer): l is DungeonLayer => l.type === 'dungeon';

/**
 * Which floors a floor pick (texture or colour) changes: the selected ones; else every
 * floor on the active layer; else, when the active layer has none (a fresh, empty layer
 * over the drawn map), every floor on every visible, unlocked layer.
 */
export type FloorScope = 'selected' | 'layer' | 'map';

export interface FloorTargets {
  scope: FloorScope;
  parts: { layer: DungeonLayer; shapes: ShapeChild[] }[];
  /** The active map layer: the one whose next floors take the pick. */
  active: DungeonLayer | undefined;
}

export function floorTargetsOf(
  layers: readonly Layer[],
  activeLayerId: string | null | undefined,
  selectedIds: readonly string[],
): FloorTargets {
  const dungeons = layers.filter(isDungeon);
  const active = dungeons.find((l) => l.id === activeLayerId);
  const picked = dungeons
    .map((layer) => ({ layer, shapes: selectedShapes(layer, selectedIds) }))
    .filter((p) => p.shapes.length > 0);
  if (picked.length > 0) return { scope: 'selected', parts: picked, active };
  if (active && layerShapes(active).length > 0) {
    return { scope: 'layer', parts: [{ layer: active, shapes: layerShapes(active) }], active };
  }
  const map = dungeons
    .filter((layer) => !blockedLayerReason(layer))
    .map((layer) => ({ layer, shapes: layerShapes(layer) }))
    .filter((p) => p.shapes.length > 0);
  if (map.length > 0) return { scope: 'map', parts: map, active };
  return { scope: 'layer', parts: [], active };
}

/** The floor targets as the store holds them now. */
export function floorTargets(store: MapBuilderStore = useStore.getState()): FloorTargets {
  return floorTargetsOf(store.layers, store.ui.activeLayerId, store.selection.selectedIds);
}

/** What the target floors are called, for tips, hints and toasts. */
export function floorScopeLabel(t: FloorTargets): string {
  if (t.scope === 'selected') return 'the selected floors';
  if (t.parts.length === 0) return 'new floors on this layer';
  return t.scope === 'map' ? 'every floor on the map' : 'every floor on this layer';
}

/**
 * The texture the strip marks: the one the target floors share, or the active layer's
 * default while there are no floors to change.
 */
export function pickedFloorTexture(t: FloorTargets): string | undefined {
  const shapes = t.parts.flatMap((p) => p.shapes);
  if (shapes.length === 0) return t.active?.style.defaultTextureId;
  const first = shapes[0].textureId;
  return shapes.every((s) => s.textureId === first) ? first : undefined;
}

/**
 * Recent floor textures, then the one in use, the layer's default, and the catalogue
 * (the preferred pack's floors before the rest).
 */
export function floorCandidates(recent: readonly string[], picked: string | undefined, layerDefault: string | undefined): string[] {
  const isFloor = ofType('floor');
  const catalogue = preferredFirst(getEntriesByType('floor'));
  return orderStripCandidates(recent.filter(isFloor), [picked, layerDefault, ...catalogue].filter(isFloor));
}

/** The warning for a target that may not be written, if any. */
function blockedTarget(t: FloorTargets): string | null {
  for (const p of t.parts) {
    const reason = blockedLayerReason(p.layer);
    if (reason) return reason;
  }
  return null;
}

/**
 * Retexture the target floors (see floorTargetsOf). Each keeps its tint, scale and the
 * rest. The texture also becomes the one the active layer's next floors take. One undo
 * step for all of it.
 */
export function pickFloorTexture(textureId: string): void {
  const store = useStore.getState();
  // A selected room, area or level takes the texture as its own pin, not its floors'.
  const target = selectedLookTarget(store);
  if (target) {
    setLook(target, { floorTextureId: textureId });
    notify.subtle(`${targetName(store, target)}: ${getCatalogEntry(textureId)?.label ?? 'texture'}`, { icon: 'palette' });
    store.trackRecentUse(textureId);
    return;
  }
  const t = floorTargets(store);
  const cmds: Command[] = t.parts.flatMap(({ layer, shapes }) =>
    shapes
      .filter((s) => s.textureId !== textureId)
      .map((s) => new UpdateChildCommand('Set Texture', layer.id, s.id, { textureId: s.textureId }, { textureId })),
  );
  if (cmds.length > 0) {
    const reason = blockedTarget(t);
    if (reason) {
      notify.warning(reason);
      return;
    }
  }
  const active = t.active;
  if (active && active.style.defaultTextureId !== textureId) {
    cmds.push(
      new LayerStyleChangeCommand('Set Texture', active.id, 'defaultTextureId', active.style.defaultTextureId, textureId),
    );
  }
  if (cmds.length > 0) {
    undoManager.execute(cmds.length === 1 ? cmds[0] : new CompositeCommand('Set Texture', cmds));
    const label = floorScopeLabel(t);
    notify.subtle(`${label[0].toUpperCase()}${label.slice(1)}: ${getCatalogEntry(textureId)?.label ?? 'texture'}`, {
      icon: 'palette',
    });
  }
  store.trackRecentUse(textureId);
}

/* ── Floor colour: what a floor looks like, textured or not ─ */

type IsLive = (textureId: string | undefined) => boolean;

/**
 * The colour a floor shows: a textured floor its tint (multiplied over the art), a plain
 * one its fill colour (its own, else the layer's).
 */
export function floorSeenColour(shape: ShapeChild, style: DungeonStyle, isLive: IsLive = hasLiveTexture): string {
  if (isLive(shape.textureId)) return shape.textureTint || '#ffffff';
  const own = (shape.styleOverrides as { floorColor?: string } | undefined)?.floorColor;
  return own ?? style.floorColor;
}

/** The colour the dock's Floor control shows for its target, and whether the floors disagree. */
export function floorColourValue(t: FloorTargets, isLive: IsLive = hasLiveTexture): { colour: string; mixed: boolean } {
  const all = t.parts.flatMap(({ layer, shapes }) => shapes.map((s) => floorSeenColour(s, layer.style, isLive).toLowerCase()));
  if (all.length === 0) {
    const style = t.active?.style;
    return { colour: style?.defaultTextureTint ?? style?.floorColor ?? '#ffffff', mixed: false };
  }
  return { colour: all[0], mixed: all.some((c) => c !== all[0]) };
}

export type FloorLookPatch = Pick<ShapeChild, 'textureTint' | 'styleOverrides'>;
type FloorDefaults = Pick<DungeonStyle, 'floorColor' | 'defaultTextureTint'>;

/** `overrides` with its floor colour set to `colour`, or taken off when `colour` is undefined. */
function withFloorColour(
  overrides: Record<string, unknown> | undefined,
  colour: string | undefined,
): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = { ...(overrides ?? {}) };
  if (colour === undefined) delete next.floorColor;
  else next.floorColor = colour;
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * What a Floor colour pick writes on one layer's target floors. A textured floor takes it
 * as its tint, a plain one as its colour. `viaLayer` (every floor of the active layer):
 * the colour goes on the layer, which its plain floors then follow, and the floors' own
 * colours come off. Otherwise (a selection, or floors on other layers) a plain floor gets
 * its own colour, as does a textured one that already had one under its texture.
 */
export function floorColourPatches(
  shapes: readonly ShapeChild[],
  viaLayer: boolean,
  colour: string,
  isLive: IsLive = hasLiveTexture,
): Map<string, FloorLookPatch> {
  const out = new Map<string, FloorLookPatch>();
  for (const s of shapes) {
    const own = (s.styleOverrides as { floorColor?: string } | undefined)?.floorColor;
    const textured = isLive(s.textureId);
    const pin = !viaLayer && (own !== undefined || !textured) ? colour : undefined;
    out.set(s.id, {
      textureTint: textured ? colour : s.textureTint,
      styleOverrides: withFloorColour(s.styleOverrides, pin),
    });
  }
  return out;
}

/**
 * The active layer's defaults a Floor colour pick sets: the tint its next textured floors
 * start with, and (unless only some floors are selected, when the layer colour would
 * repaint the rest) the colour its plain floors take.
 */
export function floorColourDefaults(scope: FloorScope, colour: string): Partial<FloorDefaults> {
  return scope === 'selected' ? { defaultTextureTint: colour } : { defaultTextureTint: colour, floorColor: colour };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

interface FloorColourSnap {
  scope: FloorScope;
  /** Each target floor's look before the gesture, by layer then shape. */
  layers: Map<string, Map<string, FloorLookPatch>>;
  activeId: string | undefined;
  style: FloorDefaults;
}

/**
 * A Floor colour gesture: every tick of a drag in the picker repaints the target floors
 * off the undo stack, and the end lands as one undo step. The target is read at the first
 * tick, so a drag keeps it throughout and undo hands each floor back its own look.
 */
export function floorColourGesture() {
  let snap: FloorColourSnap | null = null;

  const begin = (): FloorColourSnap | null => {
    const t = floorTargets();
    const reason = blockedTarget(t);
    if (reason) {
      notify.warning(reason);
      return null;
    }
    if (t.parts.length === 0 && !t.active) return null;
    return {
      scope: t.scope,
      layers: new Map(
        t.parts.map(({ layer, shapes }) => [
          layer.id,
          new Map(
            shapes.map((s): [string, FloorLookPatch] => [
              s.id,
              structuredClone({ textureTint: s.textureTint, styleOverrides: s.styleOverrides }),
            ]),
          ),
        ]),
      ),
      activeId: t.active?.id,
      style: { floorColor: t.active?.style.floorColor ?? '', defaultTextureTint: t.active?.style.defaultTextureTint },
    };
  };

  return {
    /** Repaint the target floors in `colour`, off the undo stack. */
    preview(colour: string): void {
      snap ??= begin();
      const s = snap;
      if (!s) return;
      useStore.setState((st) => {
        for (const l of st.layers) {
          if (!isDungeon(l)) continue;
          const before = s.layers.get(l.id);
          if (before) {
            const shapes = l.children.filter((c): c is ShapeChild => c.childType === 'shape' && before.has(c.id));
            const viaLayer = s.scope === 'layer' && l.id === s.activeId;
            const next = floorColourPatches(
              shapes.map((c) => ({ ...c, ...before.get(c.id) })),
              viaLayer,
              colour,
            );
            for (const c of shapes) Object.assign(c, structuredClone(next.get(c.id)));
          }
          if (l.id === s.activeId) Object.assign(l.style, floorColourDefaults(s.scope, colour));
        }
      });
    },

    /** Land the gesture as one undo step; nothing when it changed nothing. */
    commit(): void {
      const s = snap;
      snap = null;
      if (!s) return;
      const label = 'Floor colour';
      const cmds: Command[] = [];
      const layers = useStore.getState().layers.filter(isDungeon);
      for (const [layerId, shapes] of s.layers) {
        const layer = layers.find((l) => l.id === layerId);
        if (!layer) continue;
        for (const [id, before] of shapes) {
          const c = layer.children.find((x) => x.id === id) as ShapeChild | undefined;
          if (!c) continue;
          const after: FloorLookPatch = { textureTint: c.textureTint, styleOverrides: c.styleOverrides };
          if (!sameJson(before, after)) cmds.push(new UpdateChildCommand(label, layerId, id, { ...before }, { ...after }));
        }
      }
      const active = layers.find((l) => l.id === s.activeId);
      if (active) {
        for (const key of ['floorColor', 'defaultTextureTint'] as const) {
          if (active.style[key] !== s.style[key]) {
            cmds.push(new LayerStyleChangeCommand(label, active.id, key, s.style[key], active.style[key]));
          }
        }
      }
      if (cmds.length > 0) undoManager.execute(new CompositeCommand(label, cmds));
    },
  };
}

/* ── Walls ──────────────────────────────────────────────── */

/**
 * The piece that stands for a wall set: its first straight run, or for a cave kit (a band
 * set, rock the walk lays along the floor edge) its short straight piece.
 */
export function wallSetThumb(setId: string): string | undefined {
  if (isBandSet(setId)) return getBandSet(setId).find((e) => e.material === 'wall_short')?.id;
  return getWallPieces(setId, 'straight')[0]?.id;
}

/** A set's name as the layer panel shows it: GG_Fieldstone reads Fieldstone. */
export function wallSetLabel(setId: string): string {
  return setId.replace(/^GG_/, '').replace(/_/g, ' ');
}

/** The set a recent wall piece belongs to: a composed set's piece, or a cave kit's. */
export function wallSetForAsset(id: string): string | undefined {
  const entry = getCatalogEntry(id);
  if (entry?.type === 'wall') return entry.set;
  return entry?.set && isBandSet(entry.set) ? entry.set : undefined;
}

/** Every set a layer's walls can take: the composed stone sets, then the cave kits. */
export function installedWallSets(): string[] {
  return [...getWallSetIds(), ...getBandSetIds()];
}

/**
 * Whether walls of this set ignore the width setting. A cave kit's rock is laid at the
 * size it was drawn, matched to the curve rather than stretched, so only its tint applies.
 */
export function wallWidthIgnored(setId: string | undefined): boolean {
  return isBandSet(setId);
}

/** Sets picked lately, then the layer's own, then every installed set. */
export function wallSetCandidates(recent: readonly string[], current: string | undefined): string[] {
  const installed = installedWallSets();
  const usable = (s: string | undefined): s is string => !!s && installed.includes(s) && !!wallSetThumb(s);
  return orderStripCandidates(recent.map(wallSetForAsset).filter(usable), [current, ...installed].filter(usable));
}

/**
 * The layer's wall set and the width it reads right at, for every wall already on the
 * layer too: their own wall pins go (see LayerWallLookCommand).
 */
export function pickWallSet(picked: DungeonLayer, setId: string): void {
  const layer = liveLayer(picked);
  const thumb = wallSetThumb(setId);
  if (thumb) useStore.getState().trackRecentUse(thumb);
  if (layer.style.wallTextureSetId === setId) return;
  undoManager.execute(
    new LayerWallLookCommand('Layer wall texture', layer.id, {
      wallTextureSetId: setId,
      wallWidth: getWallSetDefaults(setId).defaultWidth,
    }),
  );
}

/* ── Terrain and water ──────────────────────────────────── */

/** Brush slots on the map's terrain palette. */
export const TERRAIN_SLOT_COUNT = 6;

/** The bank texture water takes when banks are on. */
export const WATER_BANK_TEXTURE = WATER_BANK_TEXTURE_ID;

/**
 * Put a texture in a terrain palette slot, or empty it with null. The palette is map
 * data, written the same way the v1 terrain options write it.
 */
export function pickTerrainSlotTexture(slot: number, textureId: string | null): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= TERRAIN_SLOT_COUNT) return;
  const store = useStore.getState();
  const palette = store.mapSettings.terrain?.palette ?? DEFAULT_TERRAIN_PALETTE;
  const next = Array.from({ length: TERRAIN_SLOT_COUNT }, (_, i) => palette[i] ?? null);
  if (next[slot] === textureId) return;
  next[slot] = textureId;
  store.setTerrainData({ palette: next });
  if (textureId) {
    store.trackRecentUse(textureId);
    notify.subtle(`Slot ${slot + 1}: ${getCatalogEntry(textureId)?.label ?? 'texture'}`, { icon: 'palette' });
  }
}

/* ── Props ──────────────────────────────────────────────── */

/** Tiles in the Props strip: favourites, recents and the catalogue share them. */
export const PROP_STRIP_CAP = 8;

/**
 * Starred props, then recent props and scatter, then what the brush holds, then the catalogue's
 * objects. A starred family (its key) stands in as its first member.
 */
export function propCandidates(
  recent: readonly string[],
  picked: readonly string[],
  favourites: readonly string[] = [],
): string[] {
  // A cave kit's rock pieces are objects in the pack, but they are walls, never props.
  const isObject = ofType('object', 'scatter');
  const isProp = (id: string | null | undefined): id is string => isObject(id) && !wallSetForAsset(id);
  const catalogue = getEntriesByType('object').map((e) => e.id);
  const starred = favourites.map((f) => (getCatalogEntry(f) ? f : familyOfKey(f)[0]?.id));
  return orderStripCandidates(
    [...starred, ...recent].filter(isProp),
    [...picked, ...catalogue].filter(isProp),
    PROP_STRIP_CAP,
  );
}

/* ── Picks from the asset browser ───────────────────────── */

/** The active map layer, when it is one floors can go on. */
function activeDungeon(store: MapBuilderStore): DungeonLayer | undefined {
  const active = selectActiveLayer(store);
  return active && active.type === 'dungeon' ? (active as DungeonLayer) : undefined;
}

/** "Click a texture to apply it to …", naming the floors a pick changes right now. */
function applyHint(t: FloorTargets): string {
  if (t.parts.length === 0) return 'Click a texture to use it for new floors on this layer';
  return `Click a texture to apply it to ${floorScopeLabel(t)}`;
}

/**
 * What a click on a floor texture does, for the asset browser's Floor tab. Follows
 * pickAssetForTool's order: selected floors, the terrain slot, then the floors
 * floorTargetsOf names.
 */
export function floorBrowserHint(store: MapBuilderStore): string {
  const target = selectedLookTarget(store);
  if (target) return `Click a texture to pin it on ${targetName(store, target)}`;
  const t = floorTargets(store);
  if (t.scope !== 'selected' && store.tools.activeTool === 'terrain') {
    return `Click a texture to assign it to slot ${store.tools.settings.terrainBrush.slot + 1}`;
  }
  if (t.parts.length === 0 && !t.active) return 'Pick a map layer to texture its floors';
  return applyHint(t);
}

/**
 * What the asset browser's other tabs say a click will do, when it is not just stamping a
 * prop: those tabs hold floor textures too (All), which go where the Floor tab's go.
 */
export function assetBrowserHint(store: MapBuilderStore): string | undefined {
  const target = selectedLookTarget(store);
  if (target) return `Click a texture to pin it on ${targetName(store, target)}`;
  const t = floorTargets(store);
  if (t.scope === 'selected') return applyHint(t);
  if (store.tools.activeTool === 'terrain') {
    return `Click a texture to assign it to slot ${store.tools.settings.terrainBrush.slot + 1}`;
  }
  if (FLOOR_TOOLS.includes(store.tools.activeTool) && t.active) return `${applyHint(t)}, or a prop to stamp it`;
  return undefined;
}

/**
 * A pick read against the selection and the tool in hand, the same from the asset browser
 * and the dock. A floor texture goes on the selected floors whatever the tool; with none
 * selected it fills the brush's slot while painting terrain, and otherwise goes on the
 * floors floorTargetsOf names (and the active layer's next ones). A wall piece while
 * drawing walls sets the layer's wall set, and anything else is a prop for the brush.
 */
export function pickAssetForTool(assetId: string): void {
  const store = useStore.getState();
  const entry = getCatalogEntry(assetId);
  const tool = store.tools.activeTool;
  if (entry?.type === 'floor') {
    const t = floorTargets(store);
    if (!selectedLookTarget(store) && t.scope !== 'selected' && tool === 'terrain') {
      pickTerrainSlotTexture(store.tools.settings.terrainBrush.slot, assetId);
    } else if (t.parts.length === 0 && !t.active && !selectedLookTarget(store)) {
      notify.warning('Pick a map layer first');
    } else {
      pickFloorTexture(assetId);
    }
    return;
  }
  const target = selectedLookTarget(store);
  const wallSet = tool === 'wall' || target ? wallSetForAsset(assetId) : undefined;
  if (wallSet && target) {
    setLook(target, { wallTextureSetId: wallSet });
    return;
  }
  if (!wallSet) {
    pickAsset(store, assetId);
    return;
  }
  const layer = activeDungeon(store);
  if (!layer) {
    notify.warning('Pick a map layer first');
    return;
  }
  pickWallSet(layer, wallSet);
}

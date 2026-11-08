// The Look columns of the Floor and Wall tools: what the tool draws with. A colour tile, the
// style presets in the caption's dropdown, the texture or wall-set strip, From library.
//
// Every control acts on the picked room, area or level when one is picked, else on the
// floors the strip targets (the picked floors, else the layer's), the way the dock always
// has. Drags in a colour picker preview live and land as one undo step when it closes.

import { useMemo, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { selectSelectedIds } from '@/store/selectors';
import { LayerWallLookCommand, PresetApplyCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer, DungeonStyle, RoomLook } from '@/store/types';
import { DUNGEON_STYLE_PRESETS, matchPresetId, type MapStylePreset } from '@/store/presetRegistry';
import { STYLE_TO_LOOK_KEY } from '@dnd/core/src/shared/wallLook';
import { getCatalogEntry } from '@dnd/core/src/assets/packCatalog';
import { AddTile, DockColumn, Tile } from '@/editor/components';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { PackThumbnailCanvas } from '@/editor/PackThumbnailCanvas';
import { notify } from '@/lib/toast';
import { MIXED_SWATCH } from '@/editor/models/selectionModel';
import {
  floorCandidates,
  floorColourGesture,
  floorColourValue,
  floorTargetsOf,
  pickedFloorTexture,
  pickFloorTexture,
  pickWallSet,
  wallSetCandidates,
  wallSetLabel,
  wallSetThumb,
} from '@/editor/models/assetStrip';
import { lookGesture, resolvedLookOf, setLook, targetName, useLookTarget, type LookTarget } from '@/editor/models/roomLook';
import { activeDungeonLayer } from './layerStyle';
import { openAssets } from './openAssets';

/** Tiles in a strip: the four the mockup shows, so the dock keeps its width across tools. */
const STRIP_TILES = 4;

function useActiveLayer(): DungeonLayer | null {
  return useStore(useShallow((s) => activeDungeonLayer(s)));
}

/* ── Style presets ─────────────────────────────────────── */

/** The keys of a preset a room, area or level can pin: those its look shares with a layer style. */
function presetLook(preset: MapStylePreset): Partial<RoomLook> {
  const out: Record<string, unknown> = {};
  for (const [styleKey, value] of Object.entries(preset.dungeonStyle)) {
    const lookKey = STYLE_TO_LOOK_KEY[styleKey as keyof DungeonStyle];
    if (lookKey && value !== undefined) out[lookKey] = value;
  }
  return out as Partial<RoomLook>;
}

function presetWorn(look: Partial<Record<keyof RoomLook, unknown>> | null, preset: MapStylePreset): boolean {
  if (!look) return false;
  const keys = Object.entries(presetLook(preset));
  return keys.length > 0 && keys.every(([k, v]) => look[k as keyof RoomLook] === v);
}

function applyPreset(target: LookTarget | null, layer: DungeonLayer | null, preset: MapStylePreset): void {
  if (target) {
    setLook(target, presetLook(preset));
    notify.action(`Applied '${preset.label}' to ${targetName(useStore.getState(), target)}`, {
      label: 'Undo',
      onClick: () => undoManager.undo(),
      icon: 'palette',
    });
    return;
  }
  if (!layer) return;
  undoManager.execute(new PresetApplyCommand(`Apply preset: ${preset.label}`, layer.id, preset, structuredClone(layer.style)));
  notify.action(`Applied '${preset.label}'`, { label: 'Undo', onClick: () => undoManager.undo(), icon: 'palette' });
}

/** The caption's dropdown: the five styles, the one worn checked. */
function PresetMenu() {
  const layer = useActiveLayer();
  const target = useLookTarget();
  const targetLook = useStore(useShallow((s) => (target ? resolvedLookOf(s, target) : null)));
  const worn = target
    ? DUNGEON_STYLE_PRESETS.find((p) => presetWorn(targetLook, p))?.id
    : layer
      ? matchPresetId(layer.style)
      : undefined;
  const label = DUNGEON_STYLE_PRESETS.find((p) => p.id === worn)?.label ?? 'Styles';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={!layer && !target}
        render={
          <Button variant="ghost" className="h-5 gap-1 px-1 text-[11px] text-text-2" aria-label={`Style presets, ${label}`} />
        }
      >
        {label}
        <ChevronDown aria-hidden strokeWidth={1.75} className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={worn ?? ''}
          onValueChange={(id: string) => {
            const preset = DUNGEON_STYLE_PRESETS.find((p) => p.id === id);
            if (preset) applyPreset(target, layer, preset);
          }}
        >
          {DUNGEON_STYLE_PRESETS.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={p.id}>
              {p.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── Colour tile ───────────────────────────────────────── */

interface Gesture {
  preview: (colour: string) => void;
  commit: () => void;
}

/** A tile showing a colour; it opens a picker, previews every tick and lands one undo step on close. */
function ColourTile({ name, value, gesture, testId }: { name: string; value: string; gesture: Gesture; testId: string }) {
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) gesture.commit();
      }}
    >
      <PopoverTrigger render={<Tile name={name} color={value} aria-label={name} data-testid={testId} />} />
      <PopoverContent side="top" align="start" className="w-auto">
        <HexColorPicker color={value} onChange={gesture.preview} />
      </PopoverContent>
    </Popover>
  );
}

/** A look gesture on the picked scope, rebuilt when the selection moves to another. */
function useScopeGesture(target: LookTarget | null, key: 'floorTint' | 'wallTextureTint'): Gesture | null {
  return useMemo(() => {
    if (!target) return null;
    const g = lookGesture(target);
    return { preview: (c) => g.preview({ [key]: c }), commit: () => g.commit() };
  }, [target, key]);
}

/* ── Floor ─────────────────────────────────────────────── */

/** The floors a pick changes, kept current: the picked floors, else the active layer's. */
function useFloorTargets() {
  const layers = useStore((s) => s.layers);
  const activeLayerId = useStore((s) => s.ui.activeLayerId);
  const selectedIds = useStore(selectSelectedIds);
  // Hidden by solo counts as hidden: re-read when solo moves.
  useStore((s) => s.ui.solo);
  return floorTargetsOf(layers, activeLayerId, selectedIds);
}

function FloorColourTile() {
  const target = useLookTarget();
  const targets = useFloorTargets();
  // Which floors count as textured depends on the packs, which arrive after boot.
  useStore((s) => s.packs.installedPacks);
  const scopeColour = useStore((s) => (target ? (resolvedLookOf(s, target)?.floorTint ?? '#ffffff') : null));
  const scopeGesture = useScopeGesture(target, 'floorTint');
  const floors = useRef<ReturnType<typeof floorColourGesture> | null>(null);
  floors.current ??= floorColourGesture();
  const { colour, mixed } = floorColourValue(targets);
  const gesture: Gesture = scopeGesture ?? {
    preview: (c) => floors.current?.preview(c),
    commit: () => floors.current?.commit(),
  };
  return (
    <ColourTile name="Colour" value={scopeColour ?? (mixed ? MIXED_SWATCH : colour)} gesture={gesture} testId="design-floor-colour" />
  );
}

function FloorStrip() {
  const layer = useActiveLayer();
  const recent = useStore((s) => s.assets.recentlyUsed);
  const targets = useFloorTargets();
  // Pack thumbnails arrive after boot; re-read the catalogue when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  const target = useLookTarget();
  const scopeTexture = useStore((s) => (target ? resolvedLookOf(s, target)?.floorTextureId : undefined));
  const picked = target ? scopeTexture || undefined : pickedFloorTexture(targets);
  const ids = floorCandidates(recent, picked, layer?.style.defaultTextureId).slice(0, STRIP_TILES);
  return (
    <>
      {ids.map((id) => {
        const name = getCatalogEntry(id)?.label ?? id;
        return (
          <Tile key={id} name={name} aria-label={name} active={id === picked} disabled={!layer && !target} onClick={() => pickFloorTexture(id)}>
            <PackThumbnailCanvas textureId={id} fit="cover" />
          </Tile>
        );
      })}
    </>
  );
}

export function FloorLook() {
  return (
    <DockColumn title="Look" control={<PresetMenu />} data-column="look" data-testid="design-floor-look">
      <FloorColourTile />
      <FloorStrip />
      <AddTile name="From library" onClick={() => openAssets('floor')} />
    </DockColumn>
  );
}

/* ── Wall ──────────────────────────────────────────────── */

/** The wall tint, shown only when the walls are drawn from a set (a plain line has none to tint). */
function WallTintTile({ layer }: { layer: DungeonLayer | null }) {
  const target = useLookTarget();
  const scope = useStore(useShallow((s) => (target ? resolvedLookOf(s, target) : null)));
  const scopeGesture = useScopeGesture(target, 'wallTextureTint');
  // The layer's own tint: patched live while the picker moves, one LayerWallLook step on close.
  const start = useRef<string | null>(null);
  const layerGesture: Gesture | null = layer
    ? {
        preview: (c) => {
          start.current ??= layer.style.wallTextureTint;
          useStore.getState().updateLayer(layer.id, { style: { ...liveStyle(layer.id), wallTextureTint: c } } as Partial<DungeonLayer>);
        },
        commit: () => {
          const from = start.current;
          start.current = null;
          const now = liveStyle(layer.id)?.wallTextureTint;
          if (from === null || now === undefined || now === from) return;
          undoManager.execute(new LayerWallLookCommand('Wall tint', layer.id, { wallTextureTint: now }, { wallTextureTint: from }));
        },
      }
    : null;
  // A level's tint tints the sets of its layers even when the level names no set itself.
  const shows = target ? Boolean(scope?.wallTextureSetId) || target.kind === 'level' : Boolean(layer?.style.wallTextureSetId);
  const gesture = scopeGesture ?? layerGesture;
  if (!shows || !gesture) return null;
  const value = (target ? scope?.wallTextureTint : layer?.style.wallTextureTint) ?? '#ffffff';
  return <ColourTile name="Tint" value={value} gesture={gesture} testId="design-wall-tint" />;
}

function liveStyle(layerId: string): DungeonStyle | undefined {
  const l = useStore.getState().layers.find((x) => x.id === layerId);
  return l && l.type === 'dungeon' ? (l as DungeonLayer).style : undefined;
}

function WallSetStrip({ layer }: { layer: DungeonLayer | null }) {
  const recent = useStore((s) => s.assets.recentlyUsed);
  useStore((s) => s.packs.installedPacks);
  const target = useLookTarget();
  const scopeSet = useStore((s) => (target ? resolvedLookOf(s, target)?.wallTextureSetId : undefined));
  const current = target ? scopeSet || undefined : layer?.style.wallTextureSetId;
  const sets = wallSetCandidates(recent, current).slice(0, STRIP_TILES);
  return (
    <>
      {sets.map((set) => {
        const name = wallSetLabel(set);
        const thumb = wallSetThumb(set);
        return (
          <Tile
            key={set}
            name={name}
            aria-label={name}
            active={set === current}
            disabled={!layer && !target}
            onClick={() => {
              if (target) setLook(target, { wallTextureSetId: set });
              else if (layer) pickWallSet(layer, set);
            }}
          >
            {thumb ? <PackThumbnailCanvas textureId={thumb} fit="cover" /> : null}
          </Tile>
        );
      })}
    </>
  );
}

export function WallLook() {
  const layer = useActiveLayer();
  return (
    <DockColumn title="Look" control={<PresetMenu />} data-column="look" data-testid="design-wall-look">
      <WallTintTile layer={layer} />
      <WallSetStrip layer={layer} />
    </DockColumn>
  );
}

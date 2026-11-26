// The room, area and level cards' custom rows: typed names and numbers, the Area pick, the
// Floor, Walls and Place look sections (what the scope pins, else where it inherits from,
// with Reset), the room's Key, and the counts with their way into the rooms list.

import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import type { MapBuilderStore } from '@/store/types';
import { getCatalogEntry } from '@dnd/core/src/assets/packCatalog';
import { roomKeyOf } from '@dnd/core/src/shared/prep';
import { Caption, ColourRow, InputRow, PlaceTiles, SecondaryButton, Seg, SelectRow, SettingRow, SliderRow } from '@dnd/ui';
import { lightsInRoom } from '@dnd/core/src/shared/lightSwitches';
import { switchRoomCommand } from '@dnd/core/src/store/lightCommands';
import { undoManager } from '@/store/undoManager';
import { PackThumbnailCanvas } from '@/editor/PackThumbnailCanvas';
import type { SettingProps } from '@/editor/registry/types';
import { openAssets } from '@/editor/families/design/openAssets';
import { chainOf, inheritedPlace, lookGesture, ownLook, resolvedLookOf, setLook, type LookTarget } from '@/editor/models/roomLook';
import { FLOOR_KEYS, PLACE_KEYS, WALL_KEYS, keySummary, roomLightsSummary, sectionLabel, sectionLook, type LookScope } from '@/editor/models/roomModel';
import { installedWallSets, wallSetLabel, wallSetThumb, wallSetTileLabel, wallWidthMin } from '@/editor/models/assetStrip';
import { SwatchPicker } from '@/editor/SwatchPicker';
import { shortTextureName } from '@/editor/models/selectionModel';
import { openRoomKey } from '@/editor/models/roomActions';
import { usePreview } from '@/editor/viewPrefs';
import type { RoomKey } from '@/store/types';

/** A text typed in place: landed on Enter or blur, Escape puts the stored value back. */
export function TypedField({ def, value, onChange }: SettingProps<string>) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <InputRow
      label={def.label}
      value={draft ?? value}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onChange(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/** The value as plain words, for a count or a size. */
export function ReadoutField({ def, value }: SettingProps<string>) {
  return (
    <SettingRow label={def.label}>
      <span className="text-[12px] text-text">{value}</span>
    </SettingRow>
  );
}

/* ── Area ──────────────────────────────────────────────── */

export const NO_AREA = 'none';
export const NEW_AREA = 'new';

/** The layer's areas, None and New area. Areas come and go, so they are read live. */
export function AreaPick({ def, value, onChange }: SettingProps<string>) {
  const areas = useStore(
    useShallow((s) => {
      const id = s.selection.selectedIds[0];
      for (const l of s.layers) {
        if (l.type !== 'dungeon' || !l.rooms?.some((r) => r.id === id)) continue;
        return (l.areas ?? []).map((a) => `${a.id}\u0000${a.name}`);
      }
      return [];
    }),
  );
  const options = useMemo(
    () => [
      { value: NO_AREA, label: 'None' },
      ...areas.map((a) => {
        const [id, name] = a.split('\u0000');
        return { value: id, label: name || 'Unnamed area' };
      }),
      { value: NEW_AREA, label: 'New area…' },
    ],
    [areas],
  );
  return <SelectRow label={def.label} value={value} options={options} onValueChange={onChange} />;
}

/* ── Look sections ─────────────────────────────────────── */

const scopeOf = (t: LookTarget): LookScope => t.kind;

/** "Pinned" or "Inherits …" over the section, and Reset when the scope pins any of it. */
function SectionHead({ title, target, keys }: { title: string; target: LookTarget; keys: readonly string[] }) {
  const { label, pinned } = useStore(
    useShallow((s: MapBuilderStore) => {
      const chain = chainOf(s, target);
      if (!chain) return { label: '', pinned: false };
      const look = sectionLook(chain, scopeOf(target), keys as Parameters<typeof sectionLook>[2]);
      return { label: sectionLabel(look, chain), pinned: look.pinned };
    }),
  );
  return (
    <div className="mb-1 flex items-center gap-2">
      <Caption>{title}</Caption>
      <span className="text-[11px] text-text-3" data-testid={`look-${title.toLowerCase()}-source`}>
        {label}
      </span>
      {pinned && (
        <SecondaryButton className="ml-auto" onClick={() => setLook(target, Object.fromEntries(keys.map((k) => [k, undefined])))}>
          Reset
        </SecondaryButton>
      )}
    </div>
  );
}

function useLook(target: LookTarget) {
  // Pack labels and thumbnails arrive after boot.
  useStore((s) => s.packs.installedPacks);
  return useStore(useShallow((s) => resolvedLookOf(s, target)));
}

/** Floor: the texture (Change opens the library on floors) and its tint. */
export function FloorSection({ value: target }: SettingProps<LookTarget>) {
  const look = useLook(target);
  const tint = useMemo(() => lookGesture(target), [target]);
  if (!look) return null;
  const id = look.floorTextureId || undefined;
  const name = id ? shortTextureName(id, getCatalogEntry(id)?.label) : 'None';
  return (
    <div className="flex flex-col gap-px" data-testid="look-floor">
      <SectionHead title="Floor" target={target} keys={FLOOR_KEYS} />
      <SettingRow label="Texture">
        <span className="flex items-center gap-1.5">
          <span className="block h-6 w-8 overflow-hidden rounded-control border border-line bg-panel-2" title={name}>
            {id ? <PackThumbnailCanvas textureId={id} fit="cover" /> : null}
          </span>
          <SecondaryButton onClick={() => openAssets('floor')}>Change</SecondaryButton>
        </span>
      </SettingRow>
      <ColourRow
        label="Tint"
        value={look.floorTint}
        onValueChange={(c) => {
          tint.preview({ floorTint: c });
          queueCommit(() => tint.commit());
        }}
      />
    </div>
  );
}

/** Walls: the set, its tint (a level's tints its layers' sets even when it names none) and width. */
export function WallsSection({ value: target }: SettingProps<LookTarget>) {
  const look = useLook(target);
  const tint = useMemo(() => lookGesture(target), [target]);
  const width = useMemo(() => lookGesture(target), [target]);
  if (!look) return null;
  const sets = installedWallSets();
  const setId = look.wallTextureSetId;
  const ids = setId && !sets.includes(setId) ? [setId, ...sets] : sets;
  const swatches = [{ value: NONE_SET, label: 'None' }, ...ids.map((id) => ({ value: id, label: wallSetTileLabel(id), title: wallSetLabel(id), art: wallSetThumb(id) }))];
  return (
    <div className="flex flex-col gap-px" data-testid="look-walls">
      <SectionHead title="Walls" target={target} keys={WALL_KEYS} />
      <SwatchPicker label="Set" name="Wall set" swatches={swatches} value={setId || NONE_SET} onPick={(v) => setLook(target, { wallTextureSetId: v === NONE_SET ? '' : v })} twoLines />
      {(setId || target.kind === 'level') && (
        <ColourRow
          label="Tint"
          value={look.wallTextureTint}
          onValueChange={(c) => {
            tint.preview({ wallTextureTint: c });
            queueCommit(() => tint.commit());
          }}
        />
      )}
      <SliderRow
        label="Width"
        value={look.wallWidth}
        min={wallWidthMin(setId || undefined)}
        max={1}
        step={0.05}
        format={(v) => v.toFixed(2)}
        onValueChange={(v) => {
          width.preview({ wallWidth: v });
          queueCommit(() => width.commit());
        }}
      />
    </div>
  );
}

const NONE_SET = 'none';

/** Place: Follows (what the scope above gives it, drawn faded), or one of the three pinned. */
export function PlaceSection({ value: target }: SettingProps<LookTarget>) {
  const { own, follows } = useStore(
    useShallow((s: MapBuilderStore) => ({ own: ownLook(s, target)?.place ?? null, follows: inheritedPlace(s, target) })),
  );
  const unlit = usePreview() === 'unlit';
  if (!follows) return null;
  return (
    <div className="flex flex-col gap-px" data-testid="look-place">
      <SectionHead title="Place" target={target} keys={PLACE_KEYS} />
      <PlaceTiles value={own} inherit={{ label: 'Follows', resolves: follows }} onPick={(place) => setLook(target, { place: place ?? undefined })} />
      {unlit && <p className="mt-1.5 text-[11px] text-text-3">Shown unlit. Pick a time under Preview as, on the status bar, to see these changes.</p>}
    </div>
  );
}

let commitTimer: ReturnType<typeof setTimeout> | null = null;

/** A picker or slider reports no end; a quiet moment lands the look gesture as one step. */
function queueCommit(fn: () => void): void {
  if (commitTimer) clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    commitTimer = null;
    fn();
  }, 400);
}

/* ── Key and counts ────────────────────────────────────── */

/** What the room's key holds, in a line, and the way into it in the rooms list. */
export function KeyField({ value: roomId }: SettingProps<string>) {
  const key = useStore((s) => roomKeyOf(s.prep, roomId) as RoomKey | undefined);
  return (
    <div className="flex flex-col gap-1.5" data-testid="room-key">
      <Caption>Key</Caption>
      <span className="text-[11px] text-text-3">{keySummary(key)}</span>
      <SecondaryButton className="self-start" onClick={() => openRoomKey(roomId)}>
        Open room key
      </SecondaryButton>
    </div>
  );
}

/** A count, and Open list for the rooms list. */
export function CountField({ def, value }: SettingProps<string>) {
  return (
    <SettingRow label={def.label}>
      <span className="flex items-center gap-2">
        <span className="text-[12px] text-text">{value}</span>
        <SecondaryButton onClick={() => useStore.getState().setRoomsSheetOpen(true)}>Open list</SecondaryButton>
      </span>
    </SettingRow>
  );
}

/* ── Lights ────────────────────────────────────────────── */

/**
 * The room's lights (`lightsInRoom`, darkness sources left out): how many and how many burn,
 * and All on or All off as one step. Neither cell is chosen while the room is mixed. Hidden
 * for a room with no lights.
 */
export function LightsField({ value: roomId }: SettingProps<string>) {
  const lights = useStore(
    useShallow((s: MapBuilderStore) => lightsInRoom({ layers: s.layers, levels: s.levels }, roomId).filter((l) => !l.darkness)),
  );
  if (lights.length === 0) return null;
  const { label, state } = roomLightsSummary(lights);
  const run = (on: boolean) => {
    const cmd = switchRoomCommand(roomId, on);
    if (cmd) undoManager.execute(cmd);
  };
  return (
    <div className="mt-2.5 flex flex-col gap-px" data-testid="room-lights">
      <Caption className="mb-1.5">Lights</Caption>
      <SettingRow label={label}>
        <Seg
          aria-label="Switch the room's lights"
          value={state === 'mixed' ? '' : state}
          onValueChange={(v) => run(v === 'on')}
          options={[
            { value: 'on', label: 'All on' },
            { value: 'off', label: 'All off' },
          ]}
        />
      </SettingRow>
    </div>
  );
}

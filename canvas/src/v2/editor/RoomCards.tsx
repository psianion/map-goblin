import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import {
  AddAreaCommand,
  AssignRoomsToAreaCommand,
  RenameAreaCommand,
  RenameLevelCommand,
  RenameRoomCommand,
  SetRoomNumberCommand,
} from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { getCatalogEntry } from '@dnd/core/src/assets/packCatalog';
import { roomKeyOf } from '@dnd/core/src/shared/prep';
import type { DungeonLayer, Level, MapBuilderStore, Room, RoomArea, RoomLook } from '@/store/types';
import type { AssetTypeFilter } from '@/components/layers/AssetBrowserPanel';
import { PackThumbnailCanvas } from '@/components/shared/PackThumbnailCanvas';
import { cn } from '@/lib/utils';
import { ColorCtl, Slider } from './controls';
import { installedWallSets, wallSetLabel, wallWidthIgnored } from './assetStrip';
import { shortTextureName, type RoomTarget } from './selectionModel';
import { chainOf, lookGesture, resolvedLookOf, setLook, type LookTarget } from './roomLook';
import {
  FLOOR_KEYS,
  MOOD_KEYS,
  WALL_KEYS,
  keySummary,
  layerOnLevel,
  levelDungeons,
  roomCountLabel,
  sectionLabel,
  sectionLook,
  type LookScope,
} from './roomModel';
import { addLayerToLevel, nextAreaName, openRoomKey } from './roomActions';
import './rooms.css';

/*
 * The selection card for a room, an area or a level (boards 2, 7 and 8): its own fields,
 * then the look sections every scope shares. Floor and Walls say where their values come
 * from ("Inherits <scope>") until the scope pins one ("Pinned", with Reset). Mood sets how
 * much sky light reaches the scope, its tint, and whether Dark hides it from sight.
 */

const KIND: Record<RoomTarget['kind'], string> = { room: 'Room', area: 'Area', level: 'Level' };

function nameOf(target: RoomTarget): string {
  if (target.kind === 'room') return target.room.name;
  if (target.kind === 'area') return target.area.name;
  return target.level.name;
}

/** The whole card for a room, an area or a level. */
export function RoomTargetCard({
  target,
  onOpenAssets,
}: {
  target: RoomTarget;
  onOpenAssets?: (type?: AssetTypeFilter) => void;
}) {
  const look: LookTarget =
    target.kind === 'room'
      ? { kind: 'room', layerId: target.layer.id, roomId: target.room.id }
      : target.kind === 'area'
        ? { kind: 'area', layerId: target.layer.id, areaId: target.area.id }
        : { kind: 'level', levelId: target.level.id };
  // The rooms sheet takes the right edge; the card moves left of it rather than hide under it.
  const besideSheet = useStore((s) => s.ui.roomsSheetOpen);
  const lookKey = JSON.stringify(look);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => look, [lookKey]);
  return (
    <section
      className="v2-sel v2-float"
      data-testid="v2-selection-card"
      data-room-kind={target.kind}
      data-beside-sheet={besideSheet ? 'true' : undefined}
      data-chrome
      aria-label="Selection"
    >
      <header className="v2-sel__head">
        <span className="v2-sel__name">{nameOf(target) || KIND[target.kind]}</span>
        <span className="v2-sel__kind">{KIND[target.kind]}</span>
      </header>
      {target.kind === 'room' ? (
        <RoomOwnFields room={target.room} layer={target.layer} />
      ) : target.kind === 'area' ? (
        <AreaOwnFields area={target.area} layer={target.layer} />
      ) : (
        <LevelOwnFields level={target.level} />
      )}
      <LookSections target={stable} scope={target.kind} onOpenAssets={onOpenAssets} />
      {target.kind === 'room' && <KeySection roomId={target.room.id} />}
    </section>
  );
}

/* ── Typed fields ───────────────────────────────────────── */

/** A text field that commits on blur or Enter; Escape puts the stored value back. */
function TextField({
  label,
  value,
  onCommit,
  mono,
  numeric,
  className,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  mono?: boolean;
  numeric?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return (
    <label className={cn('v2-field v2-rfield', className)}>
      <input
        value={draft ?? value}
        aria-label={label}
        inputMode={numeric ? 'numeric' : undefined}
        className={cn(mono && 'v2-num', numeric && 'v2-rfield__num')}
        spellCheck={false}
        onFocus={() => {
          cancelled.current = false;
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = draft;
          setDraft(null);
          if (cancelled.current) {
            cancelled.current = false;
            return;
          }
          if (next !== null && next !== value) onCommit(next);
        }}
        onKeyDown={(e) => {
          // Keys typed here are not canvas shortcuts.
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function Row({ label, children, testId }: { label?: string; children: ReactNode; testId?: string }) {
  return (
    <div className="v2-rrow" data-testid={testId}>
      {label !== undefined && <span className="v2-rrow__lbl">{label}</span>}
      {children}
    </div>
  );
}

/* ── Room ───────────────────────────────────────────────── */

function RoomOwnFields({ room, layer }: { room: Room; layer: DungeonLayer }) {
  const total = layer.rooms?.length ?? 0;
  const areas = layer.areas ?? [];
  const doors = room.doors?.length ?? 0;

  const rename = (raw: string) => {
    const next = raw.trim();
    if (next && next !== room.name) undoManager.execute(new RenameRoomCommand(layer.id, room.id, room.name, next));
  };
  const renumber = (raw: string) => {
    const n = Number(raw.trim());
    if (!Number.isInteger(n) || n < 1 || n === room.number) return;
    undoManager.execute(new SetRoomNumberCommand(layer.id, room.id, n));
  };
  const pickArea = (value: string) => {
    if (value === '__new') {
      const area = { id: crypto.randomUUID(), name: nextAreaName(layer) };
      undoManager.execute(new AddAreaCommand(layer.id, area, [room.id]));
      return;
    }
    const next = value || null;
    if (next === (room.areaId ?? null)) return;
    undoManager.execute(new AssignRoomsToAreaCommand(layer.id, [room.id], next));
  };

  return (
    <div className="v2-rcard__own">
      <Row label="Number">
        <TextField
          label="Room number"
          value={room.number !== undefined ? String(room.number) : ''}
          onCommit={renumber}
          mono
          numeric
          className="v2-rfield--narrow"
        />
        <span className="v2-rquiet">of {total}</span>
      </Row>
      <Row label="Name">
        <TextField label="Room name" value={room.name} onCommit={rename} />
      </Row>
      <Row label="Size">
        <span className="v2-num v2-rsmall">{room.area !== undefined ? `${Math.round(room.area)} sq` : '—'}</span>
        <span className="v2-rtags">
          <span className="v2-rtag">
            {doors} door{doors === 1 ? '' : 's'}
          </span>
          {room.orphaned && <span className="v2-rtag">No floor here</span>}
        </span>
      </Row>
      <Row label="Area">
        <select
          className="v2-field v2-rselect"
          aria-label="Area"
          value={room.areaId && areas.some((a) => a.id === room.areaId) ? room.areaId : ''}
          onChange={(e) => pickArea(e.target.value)}
        >
          <option value="">None</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          <option value="__new">New area…</option>
        </select>
      </Row>
    </div>
  );
}

function KeySection({ roomId }: { roomId: string }) {
  const key = useStore((s) => roomKeyOf(s.prep, roomId));
  return (
    <div className="v2-rsec" data-testid="v2-room-key-summary">
      <div className="v2-rsec__head">
        <span className="v2-rsec__title">Key</span>
      </div>
      <div className="v2-rrow">
        <span className="v2-rquiet v2-rsec__summary">{keySummary(key)}</span>
        <button type="button" className="v2-link v2-rend" onClick={() => openRoomKey(roomId)}>
          Open room key
        </button>
      </div>
    </div>
  );
}

/* ── Area ───────────────────────────────────────────────── */

function AreaOwnFields({ area, layer }: { area: RoomArea; layer: DungeonLayer }) {
  const count = (layer.rooms ?? []).filter((r) => r.areaId === area.id).length;
  return (
    <div className="v2-rcard__own">
      <Row label="Name">
        <TextField
          label="Area name"
          value={area.name}
          onCommit={(raw) => {
            const next = raw.trim();
            if (next && next !== area.name) undoManager.execute(new RenameAreaCommand(layer.id, area.id, next));
          }}
        />
      </Row>
      <Row label="Rooms">
        <span className="v2-num v2-rsmall">{count}</span>
        <button type="button" className="v2-link v2-rend" onClick={() => useStore.getState().setRoomsSheetOpen(true)}>
          Open list
        </button>
      </Row>
    </div>
  );
}

/* ── Level ──────────────────────────────────────────────── */

function LevelOwnFields({ level }: { level: Level }) {
  const { layers, levels } = useStore(useShallow((s) => ({ layers: s.layers, levels: s.levels })));
  const onLevel = layers.filter((l) => l.type !== 'background' && layerOnLevel(l, levels, level.id));
  const dungeons = levelDungeons(layers, levels, level.id);
  const rooms = dungeons.reduce((n, l) => n + (l.rooms?.length ?? 0), 0);
  const areas = dungeons.reduce((n, l) => n + (l.areas?.length ?? 0), 0);
  return (
    <div className="v2-rcard__own">
      <Row label="Name">
        <TextField
          label="Level name"
          value={level.name}
          onCommit={(raw) => {
            const next = raw.trim();
            if (next && next !== level.name) undoManager.execute(new RenameLevelCommand(level.id, next));
          }}
        />
      </Row>
      <Row label="Layers">
        <span className="v2-rtags v2-rtags--start">
          {onLevel.map((l) => (
            <span key={l.id} className="v2-rtag">
              {l.name || 'Unnamed layer'}
            </span>
          ))}
        </span>
        <button type="button" className="v2-link v2-rend" onClick={() => addLayerToLevel(level.id)}>
          Add layer
        </button>
      </Row>
      <Row label="Rooms">
        <span className="v2-num v2-rsmall">{roomCountLabel(rooms, areas)}</span>
        <button
          type="button"
          className="v2-link v2-rend"
          onClick={() => {
            const s = useStore.getState();
            if (s.ui.activeLevelId !== level.id) s.setActiveLevelId(level.id);
            s.setRoomsSheetOpen(true);
          }}
        >
          Open list
        </button>
      </Row>
    </div>
  );
}

/* ── Look sections ──────────────────────────────────────── */

const OPEN_KEY = 'v2-room-card-folds';

function loadFolds(): Record<string, boolean> {
  try {
    return JSON.parse(sessionStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

function saveFolds(folds: Record<string, boolean>): void {
  try {
    sessionStorage.setItem(OPEN_KEY, JSON.stringify(folds));
  } catch {
    /* private mode: the folds just forget */
  }
}

/** What a section header reads: "Pinned" or "Inherits …", and whether Reset applies. */
function useSection(target: LookTarget, scope: LookScope, keys: readonly (keyof RoomLook)[]) {
  return useStore(
    useShallow((s: MapBuilderStore) => {
      const chain = chainOf(s, target);
      if (!chain) return { label: '', pinned: false };
      const look = sectionLook(chain, scope, keys as Parameters<typeof sectionLook>[2]);
      return { label: sectionLabel(look, chain), pinned: look.pinned };
    }),
  );
}

function Section({
  title,
  target,
  scope,
  keys,
  folds,
  onFold,
  children,
  testId,
}: {
  title: string;
  target: LookTarget;
  scope: LookScope;
  keys: readonly (keyof RoomLook)[];
  folds: Record<string, boolean>;
  onFold: (title: string) => void;
  children: ReactNode;
  testId: string;
}) {
  const { label, pinned } = useSection(target, scope, keys);
  const open = folds[title] !== false;
  const reset = () => setLook(target, Object.fromEntries(keys.map((k) => [k, undefined])) as Partial<RoomLook>);
  return (
    <div className="v2-rsec" data-testid={testId}>
      <div className="v2-rsec__head">
        <button type="button" className="v2-selc__disclose" aria-expanded={open} onClick={() => onFold(title)}>
          <ChevronRight size={12} strokeWidth={2} aria-hidden />
          <span>{title}</span>
        </button>
        <span className="v2-rquiet" data-testid={`${testId}-source`}>
          {label}
        </span>
        {pinned && (
          <button type="button" className="v2-link v2-rend" onClick={reset} data-tip={`Back to what ${title.toLowerCase()} inherits`}>
            Reset
          </button>
        )}
      </div>
      {open && children}
    </div>
  );
}

const MOODS = [
  { value: '', label: 'Inherit' },
  { value: 'lit', label: 'Lit' },
  { value: 'dim', label: 'Dim' },
  { value: 'dark', label: 'Dark' },
] as const;

function LookSections({
  target,
  scope,
  onOpenAssets,
}: {
  target: LookTarget;
  scope: LookScope;
  onOpenAssets?: (type?: AssetTypeFilter) => void;
}) {
  const look = useStore(useShallow((s) => resolvedLookOf(s, target)));
  const ownMood = useStore((s) => {
    const chain = chainOf(s, target);
    if (!chain) return undefined;
    const own = scope === 'room' ? chain.room?.look : scope === 'area' ? chain.area?.look : chain.level.look;
    return own?.mood;
  });
  // Pack labels and thumbnails arrive after boot; re-read the catalogue when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  const [folds, setFolds] = useState(loadFolds);
  const floorTint = useMemo(() => lookGesture(target), [target]);
  const wallTint = useMemo(() => lookGesture(target), [target]);
  const width = useMemo(() => lookGesture(target), [target]);
  const moodTint = useMemo(() => lookGesture(target), [target]);
  if (!look) return null;

  const fold = (title: string) =>
    setFolds((f) => {
      const next = { ...f, [title]: f[title] === false };
      saveFolds(next);
      return next;
    });

  const textureId = look.floorTextureId || undefined;
  const textureName = textureId ? shortTextureName(textureId, getCatalogEntry(textureId)?.label) : 'None';
  const tintNone = look.floorTint.toLowerCase() === '#ffffff';
  const sets = installedWallSets();
  const setId = look.wallTextureSetId;
  const setOptions = setId && !sets.includes(setId) ? [setId, ...sets] : sets;
  const wallTintNone = look.wallTextureTint.toLowerCase() === '#ffffff';
  const shared = { target, scope, folds, onFold: fold };

  return (
    <>
      <Section title="Floor" keys={FLOOR_KEYS} testId="v2-look-floor" {...shared}>
        <div className="v2-rrow">
          <span className="v2-rrow__lbl">Texture</span>
          <span className="v2-tile v2-selc__thumb">
            <span className="v2-tile__pick">
              {textureId ? <PackThumbnailCanvas textureId={textureId} fit="cover" /> : <span className="v2-selc__none">None</span>}
            </span>
          </span>
          <span className="v2-selc__value v2-selc__name" title={textureName}>
            {textureName}
          </span>
          {onOpenAssets && (
            <button type="button" className="v2-link v2-rend" onClick={() => onOpenAssets('floor')}>
              Change
            </button>
          )}
        </div>
        <div className={cn('v2-rrow v2-selc', tintNone && 'v2-selc--none')}>
          <ColorCtl
            label="Tint"
            placement="beside"
            value={look.floorTint}
            onChange={(c) => floorTint.preview({ floorTint: c })}
            onCommit={() => floorTint.commit()}
          />
          <span className="v2-selc__value v2-num">{tintNone ? 'None' : look.floorTint.toUpperCase()}</span>
        </div>
      </Section>

      <Section title="Walls" keys={WALL_KEYS} testId="v2-look-walls" {...shared}>
        <div className="v2-rrow">
          <span className="v2-rrow__lbl">Set</span>
          <select
            className="v2-field v2-rselect"
            aria-label="Wall set"
            value={setId}
            onChange={(e) => setLook(target, { wallTextureSetId: e.target.value })}
          >
            <option value="">None</option>
            {setOptions.map((id) => (
              <option key={id} value={id}>
                {wallSetLabel(id)}
              </option>
            ))}
          </select>
        </div>
        {/* A level's tint tints its layers' own sets even when the level names none. */}
        {(setId || scope === 'level') && (
          <div className={cn('v2-rrow v2-selc', wallTintNone && 'v2-selc--none')}>
            <ColorCtl
              label="Tint"
              placement="beside"
              value={look.wallTextureTint}
              onChange={(c) => wallTint.preview({ wallTextureTint: c })}
              onCommit={() => wallTint.commit()}
            />
            <span className="v2-selc__value v2-num">{wallTintNone ? 'None' : look.wallTextureTint.toUpperCase()}</span>
          </div>
        )}
        {!wallWidthIgnored(setId || undefined) && (
          <div className="v2-rrow v2-selc">
            <Slider
              label="Width"
              min={0.05}
              max={1}
              step={0.05}
              value={look.wallWidth}
              format={(v) => v.toFixed(2)}
              onChange={(v) => width.preview({ wallWidth: v })}
              onCommit={() => width.commit()}
            />
          </div>
        )}
      </Section>

      {/* How much sky light reaches the scope (Lit 100 %, Dim 40 %, Dark 0 %), its tint, and
          whether Dark counts as darkness for the players' sight. */}
      <Section title="Mood" keys={MOOD_KEYS} testId="v2-look-mood" {...shared}>
        <div className="v2-rrow">
          <span className="v2-rrow__lbl">Darkness</span>
          <span className="v2-seg" role="group" aria-label="Darkness">
            {MOODS.map((m) => (
              <button
                key={m.value}
                type="button"
                aria-pressed={(ownMood ?? '') === m.value}
                onClick={() => (ownMood ?? '') !== m.value && setLook(target, { mood: m.value || undefined })}
              >
                {m.label}
              </button>
            ))}
          </span>
        </div>
        <div className="v2-rrow v2-selc">
          <ColorCtl
            label="Tint"
            placement="beside"
            value={look.moodTint}
            tip="Mood tint"
            onChange={(c) => moodTint.preview({ moodTint: c })}
            onCommit={() => moodTint.commit()}
          />
          <span className="v2-selc__value v2-num">{look.moodTint.toUpperCase()}</span>
        </div>
        <div className="v2-rrow">
          <span className="v2-rrow__lbl v2-prow__wide">Dark hides from sight</span>
          <button
            type="button"
            role="switch"
            aria-checked={look.moodVision !== 'visible'}
            aria-label="Dark hides from sight"
            className={cn('v2-switch', look.moodVision !== 'visible' && 'v2-switch--on')}
            onClick={() => setLook(target, { moodVision: look.moodVision === 'visible' ? 'darkness' : 'visible' })}
          >
            <span />
          </button>
        </div>
      </Section>
    </>
  );
}

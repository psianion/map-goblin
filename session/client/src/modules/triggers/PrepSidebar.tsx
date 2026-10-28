// table-shell-redesign — the DM's Prep sidebar body. Migrated off the old `TriggerPanel.tsx`
// rail popover (M4/M3, deleted with this change) into the left sidebar's content seam
// (`session/sidebars.ts`), and extended per the approved mockup
// (docs/mockups/table-shell-redesign-mockup.html): triggers and notes now group by the zone
// that anchors them (mirrors the canvas editor's own `canvas/src/components/maps/PrepPanel.tsx`
// grouping), rows carry a shape-coded state mark instead of colour alone (chrome style guide's
// "state never leans on hue"), a note can be shared straight into the player Journal, and a
// quick-actions strip covers the DM's on-the-fly moves without leaving the sidebar.
//
// Prep (`TriggerDef[]`/`RoomNote[]`/`RoomKey[]`) still lives server-side, authored in the map
// editor — this is the one place in session/client that reaches for it over REST rather than
// the WS snapshot (SessionControls's own DM-only scene library does the same).
//
// Prep v3 adds the room key: a Rooms section lists each keyed room as a card, read-aloud first
// with Share (the one way it reaches a player), then the DM's own notes, the encounter with
// Spawn, treasure, traps and checks.

import { useEffect, useMemo, useState } from 'react';
import {
  roomLabel,
  type RoomKey,
  type RoomNote,
  type ScenePrep,
  type TriggerCondition,
  type TriggerDef,
} from '@dnd/core/src/shared/prep';
import type { Mood, Room, ZoneChild } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import {
  JOURNAL_KICKERS,
  roomEditsOf,
  roomShareKey,
  roomSpawnKey,
  sceneTriggersOf,
  shareReceiptsOf,
  type JournalKicker,
  type TriggersState,
} from '@dnd/mechanics/triggers';
import { Switch } from '../../components/controls';
import { frameWorldPoint } from '../../renderer/camera';
import { getScenePrep, type ResolvedRoomVerdict } from '../../session/auth';
import { registerSidebar } from '../../session/sidebars';
import { useModuleState, useSessionStore } from '../../session/store';
import { mapLights, patchLightLocal, type LightHit } from '../lights/lights';
import { NoteImage } from './NoteImage';
import { prepBadge, useMarkPrepSeen } from './prepActivity';

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('triggers', action, payload);

const fmtTime = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

const CONDITION_LABEL: Record<TriggerCondition['kind'], string> = {
  'room-revealed': 'Room revealed',
  'enter-region': 'Enters region',
  'within-radius': 'Within radius',
};

const KICKER_LABEL: Record<JournalKicker, string> = {
  place: 'Place',
  person: 'Person',
  missive: 'Missive',
  lore: 'Lore',
};

// No-scroll ledger (docs/2026-08-22-table-shell-plan.md): 10 rows at 40px fit. Past it the
// rows compact to 32px and the condition line moves off the row entirely, into its title.
const DENSE_AT = 10;

const JOURNAL_TITLE_MAX = 120;
const JOURNAL_BODY_MAX = 4000;

/** A fetch result tagged with the scene it answers — so a slow response for a scene the DM
 *  has already switched away from is never shown as this one's. */
type PrepFetch =
  | {
      sceneId: string;
      prep: ScenePrep | null;
      inertById: Record<string, string>;
      inertNoteById: Record<string, string>;
      roomVerdicts: Record<string, ResolvedRoomVerdict>;
    }
  | { sceneId: string; error: string };

/** Every zone on the loaded map, by id. `TODO(table-shell-redesign)`: a zone→room mapping
 *  (for the mockup's reveal-state mark on each group) is not reachable from here without
 *  either a server change (the REST prep answer only carries `inert`, never `roomId`) or
 *  re-deriving room containment client-side the way the canvas editor's `pointInPolygon` does
 *  — both out of this pass's 15-minute timebox for that one mockup detail, so the mark is
 *  skipped rather than guessed at. */
function zonesOf(layers: readonly Layer[]): Map<string, ZoneChild> {
  const zones = new Map<string, ZoneChild>();
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const child of layer.children) {
      if (child.childType === 'zone') zones.set(child.id, child as ZoneChild);
    }
  }
  return zones;
}

/** Point/circle zones anchor on their own position; a rect zone pans to its centre — same
 *  reading the canvas editor's own `zoneAnchor` (`PrepPanel.tsx`) uses. */
function zoneAnchor(zone: ZoneChild): { x: number; y: number } {
  const shape = zone.shape;
  if (shape.kind === 'rect') return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  return { x: shape.position.x, y: shape.position.y };
}

/** Every room on the loaded map, by id — what room-anchored prep and the room keys name. */
function roomsOf(layers: readonly Layer[]): Map<string, Room> {
  const rooms = new Map<string, Room>();
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const room of layer.rooms ?? []) rooms.set(room.id, room);
  }
  return rooms;
}

function conditionLine(when: TriggerCondition, zoneName: string | undefined): string {
  const label = CONDITION_LABEL[when.kind];
  return zoneName ? `${label} · ${zoneName}` : label;
}

interface Group {
  /** The zone id, or `room:<id>` for prep anchored to a room. */
  zoneId: string;
  zoneName: string;
  zone: ZoneChild | null;
  /** Where the header pans to, when its anchor still exists. */
  at: { x: number; y: number } | null;
  triggers: TriggerDef[];
  notes: RoomNote[];
}

function groupByZone(
  prep: ScenePrep | null,
  zones: Map<string, ZoneChild>,
  rooms: Map<string, Room> = new Map(),
): Group[] {
  // Prep arrives over REST well before the map document lands in the editor store, and until
  // it does there are no zones to match against — every group would read "Deleted zone" and
  // then quietly correct itself, which is an alarming thing to say about a scene that is
  // merely still loading. An empty zone index means "not resolved yet", not "all deleted":
  // a map that anchors prep to a zone always ships that zone, so the two cases never overlap.
  const resolving = zones.size === 0;
  const byZone = new Map<string, Group>();
  const groupFor = (zoneId: string): Group => {
    let g = byZone.get(zoneId);
    if (!g) {
      const zone = zones.get(zoneId) ?? null;
      g = {
        zoneId,
        zoneName: zone?.name ?? (resolving ? '' : 'Deleted zone'),
        zone,
        at: zone ? zoneAnchor(zone) : null,
        triggers: [],
        notes: [],
      };
      byZone.set(zoneId, g);
    }
    return g;
  };
  // Prep anchored to a room (v3) groups under the room, named the way the table names rooms.
  const groupForRoom = (roomId: string): Group => {
    const key = `room:${roomId}`;
    let g = byZone.get(key);
    if (!g) {
      const room = rooms.get(roomId);
      g = {
        zoneId: key,
        zoneName: room ? roomLabel(room) || 'Room' : rooms.size === 0 ? '' : 'Deleted room',
        zone: null,
        at: room ? { x: room.anchor[0], y: room.anchor[1] } : null,
        triggers: [],
        notes: [],
      };
      byZone.set(key, g);
    }
    return g;
  };
  for (const t of prep?.triggers ?? []) {
    const when = t.when;
    ('roomId' in when ? groupForRoom(when.roomId) : groupFor(when.zoneId)).triggers.push(t);
  }
  for (const n of prep?.notes ?? []) (n.roomId ? groupForRoom(n.roomId) : groupFor(n.zoneId)).notes.push(n);
  // Name order keeps the list stable while prep is being edited; unanchored (deleted zone or
  // room) groups sink to the bottom, same as the canvas editor's own list.
  return [...byZone.values()].sort((a, b) => {
    if (!a.at !== !b.at) return a.at ? -1 : 1;
    return a.zoneName.localeCompare(b.zoneName);
  });
}

export function PrepSidebar() {
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const state = useModuleState<TriggersState>('triggers');
  const layers = useStore((s) => s.layers);
  const [fetched, setFetched] = useState<PrepFetch | null>(null);

  // Refetches on every scene switch — quiet by design (see the endpoint's own PUT), so
  // nothing else tells this panel prep changed underneath it.
  useEffect(() => {
    if (!sceneId) return;
    const { token } = useSessionStore.getState();
    if (!token) return;
    getScenePrep(sceneId, token)
      .then((res) => {
        const inertById: Record<string, string> = {};
        for (const r of res.resolved) if (r.inert) inertById[r.id] = r.inert;
        const inertNoteById: Record<string, string> = {};
        for (const r of res.resolvedNotes ?? []) if (r.inert) inertNoteById[r.id] = r.inert;
        const roomVerdicts: Record<string, ResolvedRoomVerdict> = {};
        for (const r of res.resolvedRooms ?? []) roomVerdicts[r.roomId] = r;
        setFetched({ sceneId, prep: res.prep, inertById, inertNoteById, roomVerdicts });
      })
      .catch((e) => setFetched({ sceneId, error: e instanceof Error ? e.message : String(e) }));
  }, [sceneId]);

  const current = fetched?.sceneId === sceneId ? fetched : null;
  const prep = current && 'prep' in current ? current.prep : null;
  const inertById = current && 'inertById' in current ? current.inertById : {};
  const inertNoteById = current && 'inertNoteById' in current ? current.inertNoteById : {};
  const roomVerdicts = current && 'roomVerdicts' in current ? current.roomVerdicts : {};
  const error = current && 'error' in current ? current.error : null;

  const scene = sceneId && state ? sceneTriggersOf(state, sceneId) : undefined;
  const zones = useMemo(() => zonesOf(layers), [layers]);
  const rooms = useMemo(() => roomsOf(layers), [layers]);
  const groups = useMemo(() => groupByZone(prep, zones, rooms), [prep, zones, rooms]);
  const triggers = prep?.triggers ?? [];
  const notes = prep?.notes ?? [];
  const keys = useMemo(() => sortedKeys(prep?.rooms ?? [], rooms), [prep, rooms]);
  const dense = triggers.length > DENSE_AT;

  useMarkPrepSeen(sceneId, scene?.log ?? []);

  const encounterTriggers = triggers.filter((t) => t.actions.some((a) => a.kind === 'encounter'));
  const namedLights = useMemo(() => mapLights(layers).filter((hit) => !!hit.light.name), [layers]);

  if (error) {
    return (
      <p role="alert" className="px-3.5 text-xs text-danger">
        Couldn't load this scene's prep: {error}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-1 text-sm">
      {triggers.length === 0 && notes.length === 0 && keys.length === 0 ? (
        <div className="flex flex-col gap-0.5 px-3.5 py-1 text-sm">
          <p className="text-text-secondary">No prep for this scene.</p>
          <p className="text-text-muted">Author triggers and notes in the Editor, or send a card on the fly.</p>
        </div>
      ) : (
        groups.map((g) => (
          <ZoneGroup
            key={g.zoneId}
            group={g}
            dense={dense}
            scene={scene}
            inertById={inertById}
            inertNoteById={inertNoteById}
            sceneId={sceneId}
          />
        ))
      )}

      {keys.length > 0 && sceneId && (
        <RoomsSection keys={keys} rooms={rooms} verdicts={roomVerdicts} scene={scene} sceneId={sceneId} />
      )}

      <QuickActions encounterTriggers={encounterTriggers} namedLights={namedLights} sceneId={sceneId} />

      {triggers.length > 0 && (
        <p className="px-3.5 pt-1 text-xs text-text-muted">Fired triggers narrate into the log under "Triggers".</p>
      )}
    </div>
  );
}

function ZoneGroup({
  group,
  dense,
  scene,
  inertById,
  inertNoteById,
  sceneId,
}: {
  group: Group;
  dense: boolean;
  scene: TriggersState['byScene'][string] | undefined;
  inertById: Record<string, string>;
  inertNoteById: Record<string, string>;
  sceneId: string | null;
}) {
  const pannable = !!group.at;
  const onPan = (): void => {
    if (group.at) frameWorldPoint(group.at.x, group.at.y);
  };
  return (
    <section className="mt-1.5" data-testid="prep-zone-group" data-zone-id={group.zoneId}>
      <button
        type="button"
        disabled={!pannable}
        onClick={onPan}
        title={pannable ? (group.zone ? 'Pan to zone' : 'Pan to room') : undefined}
        className="group flex w-full items-center gap-1.5 rounded px-3.5 py-1 text-left text-[12px] font-medium text-text-secondary transition-colors duration-150 ease-settle enabled:hover:bg-surface-2/60 disabled:cursor-default motion-reduce:transition-none"
      >
        {group.zoneName ? (
          <span className="min-w-0 flex-1 truncate">{group.zoneName}</span>
        ) : (
          // Still resolving (see `groupByZone`): a quiet bar, not a wrong name.
          <span data-testid="zone-name-loading" className="h-2.5 w-24 rounded-full bg-surface-2" />
        )}
        {pannable && (
          <span className="shrink-0 text-[10px] text-text-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
            pan
          </span>
        )}
      </button>
      <ul className="flex flex-col">
        {group.triggers.map((t) => (
          <TriggerRow key={t.id} t={t} dense={dense} scene={scene} inert={inertById[t.id]} />
        ))}
        {group.notes.map((n) => (
          <NoteRow key={n.id} note={n} sceneId={sceneId!} inert={inertNoteById[n.id]} />
        ))}
      </ul>
    </section>
  );
}

/** The row's shape-coded state mark — armed (filled), fired (hollow), disabled (flat), never
 *  colour alone (chrome style guide's "state never leans on hue"). */
function StateMark({ tone, title }: { tone: 'armed' | 'fired' | 'off'; title: string }) {
  const toneClass =
    tone === 'armed'
      ? 'bg-accent-dim'
      : tone === 'fired'
        ? 'border-[1.5px] border-border-structure bg-transparent'
        : 'bg-surface-3';
  return <span title={title} aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${toneClass}`} />;
}

function TriggerRow({
  t,
  dense,
  scene,
  inert,
}: {
  t: TriggerDef;
  dense: boolean;
  scene: TriggersState['byScene'][string] | undefined;
  inert?: string;
}) {
  const firedAt = scene?.fired[t.id];
  const fired = firedAt !== undefined;
  // "Enabled" as the table is actually playing it: authored on, and not switched off at the
  // table this session. A trigger authored off has nothing for the switch to turn on —
  // `set-enabled` is a runtime override of prep, not a rewrite of it — so the switch is inert
  // too and its title says why.
  const runtimeEnabled = t.enabled && !scene?.disabled[t.id];
  const off = !runtimeEnabled;
  const mark = off ? 'off' : fired ? 'fired' : 'armed';
  const markTitle = off ? 'Disabled — will not fire on its own' : fired ? `Fired ${fmtTime(firedAt)}` : 'Armed';

  return (
    <li
      data-testid="trigger-row"
      title={dense ? conditionLine(t.when, undefined) : undefined}
      className={`flex shrink-0 items-center gap-2 rounded px-3.5 ${dense ? 'h-8' : 'h-10'} ${off ? 'bg-surface-0' : ''}`}
    >
      <StateMark tone={mark} title={markTitle} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`min-w-0 truncate text-[13px] ${off ? 'font-normal text-text-dim' : 'text-text-primary'}`}>
            {t.name}
          </span>
          {inert && (
            <span
              title={inert}
              className="shrink-0 rounded border border-warning/45 px-1 text-[10px] uppercase tracking-[.06em] text-warning"
            >
              Inert
            </span>
          )}
        </div>
        {!dense && (
          <p className="truncate text-[11.5px] text-text-muted">{conditionLine(t.when, undefined)}</p>
        )}
      </div>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          disabled={fired}
          aria-label={`Fire: ${t.name}`}
          onClick={() => send('fire', { triggerId: t.id })}
          className="h-6 shrink-0 rounded border border-border-default bg-surface-2 px-2 text-[11.5px] text-text-primary transition-colors duration-150 ease-settle hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:border-transparent disabled:bg-transparent disabled:font-normal disabled:text-text-muted disabled:opacity-100 disabled:hover:bg-transparent motion-reduce:transition-none"
        >
          {fired ? (
            <>
              Fired <span className="font-mono">{fmtTime(firedAt)}</span>
            </>
          ) : (
            'Fire'
          )}
        </button>
        <Switch
          testId={`trigger-enabled-${t.id}`}
          checked={runtimeEnabled}
          disabled={!t.enabled}
          title={t.enabled ? 'Enabled' : 'Off in prep'}
          onToggle={() => send('set-enabled', { triggerId: t.id, enabled: !runtimeEnabled })}
        >
          <span className="sr-only">{`${t.name}: enabled`}</span>
        </Switch>
      </span>
    </li>
  );
}
/** One readable room note: title row, expand for the body and any handout images, and the
 *  share verb — publishing is the one way anything reaches a player (chrome style guide),
 *  so this button is the DM's own deliberate act. A shared note's receipt (from
 *  `shareReceiptsOf`) replaces the button with when it went out, same mockup treatment as a
 *  fired trigger's timestamp. */
function NoteRow({ note, sceneId, inert }: { note: RoomNote; sceneId: string; inert?: string }) {
  const [open, setOpen] = useState(false);
  const state = useModuleState<TriggersState>('triggers');
  const receipt = state ? shareReceiptsOf(state)[note.id] : undefined;
  const shared = !!receipt;

  return (
    <li className="flex shrink-0 flex-col">
      <div data-testid="note-row" className="flex h-10 items-center gap-2 rounded px-3.5">
        <StateMark tone={shared ? 'fired' : 'armed'} title={shared ? `Shared ${fmtTime(receipt.at)}` : 'Not shared'} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded py-1 text-left transition-colors duration-150 ease-settle hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none"
        >
          <span className="min-w-0 truncate text-[13px] text-text-primary">{note.title || 'Untitled note'}</span>
          {note.showOnReveal && !inert && (
            <span className="shrink-0 rounded border border-border-structure px-1 text-[10px] uppercase tracking-[.06em] text-text-secondary">
              On reveal
            </span>
          )}
          {inert && (
            <span
              title={inert}
              className="shrink-0 rounded border border-warning/45 px-1 text-[10px] uppercase tracking-[.06em] text-warning"
            >
              Inert
            </span>
          )}
        </button>
        {shared ? (
          <button type="button" disabled className="h-6 shrink-0 rounded px-2 text-[11.5px] text-text-muted">
            Shared <span className="font-mono">{fmtTime(receipt.at)}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => send('share-note', { sceneId, noteId: note.id })}
            className="h-6 shrink-0 rounded border border-accent-dim/60 px-2 text-[11.5px] text-accent-active transition-colors duration-150 ease-settle hover:bg-accent-active/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none"
          >
            Share
          </button>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-2 px-3.5 pb-2 pl-9">
          {note.body && (
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-text-secondary">{note.body}</p>
          )}
          {note.imageKeys.map((key) => (
            <NoteImage key={key} sceneId={sceneId} imageKey={key} />
          ))}
        </div>
      )}
    </li>
  );
}

/** Room keys in the table's own reading order: by number, then by label. A key whose room is
 *  gone sinks to the bottom. */
function sortedKeys(keys: readonly RoomKey[], rooms: Map<string, Room>): RoomKey[] {
  return [...keys].sort((a, b) => {
    const ra = rooms.get(a.roomId);
    const rb = rooms.get(b.roomId);
    if (!ra !== !rb) return ra ? -1 : 1;
    const na = ra?.number ?? Infinity;
    const nb = rb?.number ?? Infinity;
    if (na !== nb) return na - nb;
    return (ra?.name ?? '').localeCompare(rb?.name ?? '');
  });
}

const ABILITY_LABEL = (ability: string): string => ability.toUpperCase();

/** The DM's room key, one card per keyed room (prep v3). */
function RoomsSection({
  keys,
  rooms,
  verdicts,
  scene,
  sceneId,
}: {
  keys: readonly RoomKey[];
  rooms: Map<string, Room>;
  verdicts: Record<string, ResolvedRoomVerdict>;
  scene: TriggersState['byScene'][string] | undefined;
  sceneId: string;
}) {
  return (
    <section className="mt-1.5" data-testid="prep-rooms">
      <p className="px-3.5 py-1 text-[10px] font-semibold uppercase tracking-[.07em] text-text-muted">Rooms</p>
      <ul className="flex flex-col">
        {keys.map((key) => (
          <RoomKeyCard
            key={key.roomId}
            roomKey={key}
            room={rooms.get(key.roomId)}
            verdict={verdicts[key.roomId]}
            spawnedAt={scene?.fired[roomSpawnKey(key.roomId)]}
            sceneId={sceneId}
          />
        ))}
      </ul>
    </section>
  );
}

const MOOD_CHOICES: readonly { value: '' | Mood; label: string }[] = [
  { value: '', label: 'Inherit' },
  { value: 'lit', label: 'Lit' },
  { value: 'dim', label: 'Dim' },
  { value: 'dark', label: 'Dark' },
];

/**
 * The room's live mood at the table: Inherit (the map's look chain) or a pinned Lit, Dim or
 * Dark (`set-room`). A pill, quiet until pinned, like the seats' level pills.
 */
function MoodPill({ roomId, label, sceneId }: { roomId: string; label: string; sceneId: string }) {
  const state = useModuleState<TriggersState>('triggers');
  const scene = state?.byScene[sceneId];
  const mood = scene ? roomEditsOf(scene)[roomId]?.mood : undefined;
  return (
    <span className="relative shrink-0">
      <select
        aria-label={`Mood: ${label}`}
        data-testid="room-mood"
        value={mood ?? ''}
        onChange={(e) => send('set-room', { sceneId, roomId, patch: { mood: e.target.value || null } })}
        className={`h-6 appearance-none rounded border py-px pl-1.5 pr-4 text-[11px] focus:border-border-focus focus:outline-none ${
          mood ? 'border-border-structure bg-surface-3 font-medium text-text-primary' : 'border-border-default bg-transparent text-text-muted'
        }`}
      >
        {MOOD_CHOICES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        width="10"
        height="10"
        className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 9L12 15L18 9" />
      </svg>
    </span>
  );
}

/**
 * One room's key. The header row carries what the DM reaches for mid-scene — the room's name
 * and Share for its read-aloud — and expands to the rest: the DM's notes, the encounter with
 * Spawn, treasure, traps and checks. Share snapshots exactly the read-aloud (`share-card` with
 * the room id), receipted like a note's; Spawn runs the key's encounter with the room as the
 * spawn region (`spawn-encounter`) and stays available for a second wave.
 */
function RoomKeyCard({
  roomKey,
  room,
  verdict,
  spawnedAt,
  sceneId,
}: {
  roomKey: RoomKey;
  room: Room | undefined;
  verdict: ResolvedRoomVerdict | undefined;
  spawnedAt: number | undefined;
  sceneId: string;
}) {
  const [open, setOpen] = useState(false);
  const state = useModuleState<TriggersState>('triggers');
  const receipt = state ? shareReceiptsOf(state)[roomShareKey(roomKey.roomId)] : undefined;
  const label = (room ? roomLabel(room) : verdict?.label) || 'Room';
  const readAloud = roomKey.readAloud.trim();
  const inert = verdict?.inert ?? (!room ? 'room was deleted' : undefined);
  const encounter = roomKey.encounter;
  const roster = encounter?.monsters.map((m) => (m.count > 1 ? `${m.count} × ${m.name}` : m.name)).join(', ');

  return (
    <li className="flex shrink-0 flex-col" data-testid="room-key-card" data-room-id={roomKey.roomId}>
      <div className="flex h-10 items-center gap-2 rounded px-3.5">
        <StateMark tone={receipt ? 'fired' : 'armed'} title={receipt ? `Read-aloud shared ${fmtTime(receipt.at)}` : 'Read-aloud not shared'} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded py-1 text-left transition-colors duration-150 ease-settle hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none"
        >
          <span className="min-w-0 truncate text-[13px] text-text-primary">{label}</span>
          {inert && (
            <span
              title={inert}
              className="shrink-0 rounded border border-warning/45 px-1 text-[10px] uppercase tracking-[.06em] text-warning"
            >
              Inert
            </span>
          )}
        </button>
        {room && <MoodPill roomId={roomKey.roomId} label={label} sceneId={sceneId} />}
        {room && (
          <button
            type="button"
            aria-label={`Pan to ${label}`}
            onClick={() => frameWorldPoint(room.anchor[0], room.anchor[1])}
            className="h-6 shrink-0 rounded px-1.5 text-[10px] text-text-muted hover:bg-surface-2 hover:text-text-dim"
          >
            pan
          </button>
        )}
        {readAloud &&
          (receipt ? (
            <button type="button" disabled className="h-6 shrink-0 rounded px-2 text-[11.5px] text-text-muted">
              Shared <span className="font-mono">{fmtTime(receipt.at)}</span>
            </button>
          ) : (
            <button
              type="button"
              aria-label={`Share read-aloud: ${label}`}
              onClick={() => send('share-card', { sceneId, roomId: roomKey.roomId })}
              className="h-6 shrink-0 rounded border border-accent-dim/60 px-2 text-[11.5px] text-accent-active transition-colors duration-150 ease-settle hover:bg-accent-active/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none"
            >
              Share
            </button>
          ))}
      </div>
      {open && (
        <div className="flex flex-col gap-2 px-3.5 pb-2 pl-9 text-[12.5px] leading-relaxed">
          {readAloud && (
            <KeyBlock title="Read-aloud">
              <p className="whitespace-pre-wrap border-l-2 border-border-structure pl-2 text-text-primary">{readAloud}</p>
            </KeyBlock>
          )}
          {roomKey.notes.trim() && (
            <KeyBlock title="DM notes">
              <p className="whitespace-pre-wrap text-text-secondary">{roomKey.notes}</p>
            </KeyBlock>
          )}
          {encounter && encounter.monsters.length > 0 && (
            <KeyBlock title="Encounter">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-text-secondary">
                  {encounter.name ? <span className="text-text-primary">{encounter.name}</span> : null}
                  {encounter.name && roster ? ' — ' : ''}
                  {roster}
                </span>
                <button
                  type="button"
                  disabled={!!inert || !!verdict?.encounterInert}
                  title={verdict?.encounterInert ?? inert ?? (spawnedAt !== undefined ? `Spawned ${fmtTime(spawnedAt)}` : undefined)}
                  aria-label={`Spawn encounter: ${label}`}
                  onClick={() => send('spawn-encounter', { sceneId, roomId: roomKey.roomId })}
                  className="shrink-0 rounded border border-border-default px-2 py-0.5 text-[11px] text-text-dim hover:border-border-structure hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {spawnedAt !== undefined ? 'Spawn again' : 'Spawn'}
                </button>
              </div>
            </KeyBlock>
          )}
          {roomKey.treasure.trim() && (
            <KeyBlock title="Treasure">
              <p className="whitespace-pre-wrap text-text-secondary">{roomKey.treasure}</p>
            </KeyBlock>
          )}
          {roomKey.traps.length > 0 && (
            <KeyBlock title="Traps">
              <ul className="flex flex-col gap-0.5 text-text-secondary">
                {roomKey.traps.map((trap) => (
                  <li key={trap.id}>
                    {trap.text}
                    {(trap.save || trap.damage) && (
                      <span className="text-text-muted">
                        {' · '}
                        {[trap.save ? `${ABILITY_LABEL(trap.save.ability)} DC ${trap.save.dc}` : null, trap.damage]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </KeyBlock>
          )}
          {roomKey.checks.length > 0 && (
            <KeyBlock title="Checks">
              <ul className="flex flex-col gap-0.5 text-text-secondary">
                {roomKey.checks.map((check) => (
                  <li key={check.id}>
                    <span className="text-text-muted">{`${ABILITY_LABEL(check.ability)} DC ${check.dc}`}</span> {check.text}
                  </li>
                ))}
              </ul>
            </KeyBlock>
          )}
        </div>
      )}
    </li>
  );
}

function KeyBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[10px] uppercase tracking-[.05em] text-text-muted">{title}</p>
      {children}
    </div>
  );
}

/** Bottom-of-sidebar strip (mockup): sending a card, spawning an authored encounter, and a
 *  one-click light toggle for anything the DM named — everything a DM reaches for without
 *  leaving the sidebar. Doors are skipped: there's no name on a door today for a row to read
 *  (TODO once doors carry one). */
function QuickActions({
  encounterTriggers,
  namedLights,
  sceneId,
}: {
  encounterTriggers: TriggerDef[];
  namedLights: readonly LightHit[];
  sceneId: string | null;
}) {
  const state = useModuleState<TriggersState>('triggers');
  const scene = sceneId && state ? sceneTriggersOf(state, sceneId) : undefined;
  const [composerOpen, setComposerOpen] = useState(false);
  const [kicker, setKicker] = useState<JournalKicker>('missive');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const valid =
    trimmedTitle.length > 0 &&
    trimmedTitle.length <= JOURNAL_TITLE_MAX &&
    trimmedBody.length > 0 &&
    trimmedBody.length <= JOURNAL_BODY_MAX;

  const shareCard = (): void => {
    if (!valid) return;
    send('share-card', { sceneId: sceneId ?? undefined, kicker, title: trimmedTitle, body: trimmedBody });
    setTitle('');
    setBody('');
    setComposerOpen(false);
  };

  return (
    <div className="border-t border-border-subtle px-3.5 pt-2">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.07em] text-text-muted">Quick actions</p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setComposerOpen((v) => !v)}
          aria-expanded={composerOpen}
          className="rounded border border-border-default bg-surface-2 px-2.5 py-1 text-[11.5px] text-text-dim transition-colors duration-150 ease-settle hover:border-border-structure hover:text-text-primary motion-reduce:transition-none"
        >
          Send a card
        </button>
      </div>

      {composerOpen && (
        <div className="mt-2 flex flex-col gap-1.5">
          <select
            aria-label="Card kind"
            value={kicker}
            onChange={(e) => setKicker(e.target.value as JournalKicker)}
            className="rounded border border-border-default bg-surface-0 px-2 py-1 text-[12px] text-text-primary"
          >
            {JOURNAL_KICKERS.map((k) => (
              <option key={k} value={k}>
                {KICKER_LABEL[k]}
              </option>
            ))}
          </select>
          <input
            aria-label="Card title"
            placeholder="Card title"
            value={title}
            maxLength={JOURNAL_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded border border-border-default bg-surface-0 px-2 py-1 text-[12px] text-text-primary placeholder:text-text-muted"
          />
          <textarea
            aria-label="Card text"
            placeholder="What the players are told"
            rows={2}
            value={body}
            maxLength={JOURNAL_BODY_MAX}
            onChange={(e) => setBody(e.target.value)}
            className="resize-none rounded border border-border-default bg-surface-0 px-2 py-1 text-[12px] text-text-primary placeholder:text-text-muted"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setComposerOpen(false);
                setTitle('');
                setBody('');
              }}
              className="rounded px-2.5 py-1 text-[11.5px] text-text-muted hover:bg-surface-2 hover:text-text-dim"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!valid}
              onClick={shareCard}
              className="rounded bg-accent-active px-3 py-1 text-[11.5px] font-semibold text-on-accent transition-colors duration-150 ease-settle hover:bg-accent-active/90 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
            >
              Share
            </button>
          </div>
        </div>
      )}

      {encounterTriggers.length > 0 && (
        <div className="mt-2 flex flex-col gap-0.5">
          <p className="text-[10px] uppercase tracking-[.05em] text-text-muted">Spawn encounter</p>
          {encounterTriggers.map((t) => {
            const fired = scene?.fired[t.id] !== undefined;
            return (
              <div key={t.id} className="flex items-center gap-2 py-0.5 text-[12px] text-text-secondary">
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <button
                  type="button"
                  disabled={fired}
                  onClick={() => send('fire', { triggerId: t.id })}
                  className="rounded border border-border-default px-2 py-0.5 text-[11px] text-text-dim hover:border-border-structure hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {fired ? 'Spawned' : 'Spawn'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {namedLights.length > 0 && (
        <div className="mt-2 flex flex-col gap-0.5">
          <p className="text-[10px] uppercase tracking-[.05em] text-text-muted">Lights</p>
          {namedLights.map(({ light }) => (
            <div key={light.id} className="flex items-center gap-2 py-0.5 text-[12px] text-text-secondary">
              <span className="min-w-0 flex-1 truncate">{light.name}</span>
              <button
                type="button"
                onClick={() => {
                  const visible = !light.visible;
                  patchLightLocal(light.id, { visible });
                  send('set-light', { lightId: light.id, patch: { visible } });
                }}
                className="rounded border border-border-default px-2 py-0.5 text-[11px] text-text-dim hover:border-border-structure hover:text-text-primary"
              >
                {light.visible ? 'Douse' : 'Relight'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

registerSidebar('dm', {
  title: 'Prep',
  component: PrepSidebar,
  badge: prepBadge,
});

// table-shell-redesign — the DM's Prep sidebar body. Migrated off the old `TriggerPanel.tsx`
// rail popover (M4/M3, deleted with this change) into the left sidebar's content seam
// (`session/sidebars.ts`), and extended per the approved mockup
// (docs/mockups/table-shell-redesign-mockup.html): triggers and notes now group by the zone
// that anchors them (mirrors the canvas editor's own `canvas/src/components/maps/PrepPanel.tsx`
// grouping), rows carry a shape-coded state mark instead of colour alone (chrome style guide's
// "state never leans on hue"), a note can be shared straight into the player Journal, and a
// quick-actions strip covers the DM's on-the-fly moves without leaving the sidebar.
//
// Prep (`TriggerDef[]`/`RoomNote[]`) still lives server-side, authored in the map editor — this
// is the one place in session/client that reaches for it over REST rather than the WS snapshot
// (SessionControls's own DM-only scene library does the same).

import { useEffect, useMemo, useState } from 'react';
import type { RoomNote, ScenePrep, TriggerCondition, TriggerDef } from '@dnd/core/src/shared/prep';
import type { ZoneChild } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import {
  JOURNAL_KICKERS,
  sceneTriggersOf,
  shareReceiptsOf,
  type JournalKicker,
  type TriggersState,
} from '@dnd/mechanics/triggers';
import { Switch } from '../../components/controls';
import { frameWorldPoint } from '../../renderer/camera';
import { getScenePrep } from '../../session/auth';
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

function conditionLine(when: TriggerCondition, zoneName: string | undefined): string {
  const label = CONDITION_LABEL[when.kind];
  return zoneName ? `${label} · ${zoneName}` : label;
}

interface Group {
  zoneId: string;
  zoneName: string;
  zone: ZoneChild | null;
  triggers: TriggerDef[];
  notes: RoomNote[];
}

function groupByZone(prep: ScenePrep | null, zones: Map<string, ZoneChild>): Group[] {
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
        triggers: [],
        notes: [],
      };
      byZone.set(zoneId, g);
    }
    return g;
  };
  for (const t of prep?.triggers ?? []) groupFor(t.when.zoneId).triggers.push(t);
  for (const n of prep?.notes ?? []) groupFor(n.zoneId).notes.push(n);
  // Zone-name order keeps the list stable while prep is being edited; unanchored
  // (deleted-zone) groups sink to the bottom, same as the canvas editor's own list.
  return [...byZone.values()].sort((a, b) => {
    if (!a.zone !== !b.zone) return a.zone ? -1 : 1;
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
        setFetched({ sceneId, prep: res.prep, inertById, inertNoteById });
      })
      .catch((e) => setFetched({ sceneId, error: e instanceof Error ? e.message : String(e) }));
  }, [sceneId]);

  const current = fetched?.sceneId === sceneId ? fetched : null;
  const prep = current && 'prep' in current ? current.prep : null;
  const inertById = current && 'inertById' in current ? current.inertById : {};
  const inertNoteById = current && 'inertNoteById' in current ? current.inertNoteById : {};
  const error = current && 'error' in current ? current.error : null;

  const scene = sceneId && state ? sceneTriggersOf(state, sceneId) : undefined;
  const zones = useMemo(() => zonesOf(layers), [layers]);
  const groups = useMemo(() => groupByZone(prep, zones), [prep, zones]);
  const triggers = prep?.triggers ?? [];
  const notes = prep?.notes ?? [];
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
      {triggers.length === 0 && notes.length === 0 ? (
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
  const pannable = !!group.zone;
  const onPan = (): void => {
    if (group.zone) frameWorldPoint(zoneAnchor(group.zone).x, zoneAnchor(group.zone).y);
  };
  return (
    <section className="mt-1.5" data-testid="prep-zone-group" data-zone-id={group.zoneId}>
      <button
        type="button"
        disabled={!pannable}
        onClick={onPan}
        title={pannable ? 'Pan to zone' : undefined}
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

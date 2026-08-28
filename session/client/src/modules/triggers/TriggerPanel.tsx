// M4/M3 — the DM's trigger board: every trigger authored on the active scene, its runtime
// state (enabled/fired), and the Fire button that force-fires it. The trigger log moved out
// of this panel to the log drawer's own "Triggers" filter (M3 §Triggers) — this popover is
// prep and control only.
//
// Prep (`TriggerDef[]`) lives server-side, authored in the map editor — the table client has
// never held it before M4, so this panel is the one place in session/client that reaches for
// it over REST rather than the WS snapshot, the same shape SessionControls already used for
// its own DM-only scene library.

import { useEffect, useState } from 'react';
import type { RoomNote, ScenePrep, TriggerCondition } from '@dnd/core/src/shared/prep';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import type { TriggersState } from '@dnd/mechanics/triggers';
import { sceneTriggersOf } from '@dnd/mechanics/triggers';
import { Switch } from '../../components/controls';
import { getScenePrep } from '../../session/auth';
import { registerPanel } from '../../session/panels';
import { useModuleState, useSessionStore } from '../../session/store';

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('triggers', action, payload);

const CONDITION_LABEL: Record<TriggerCondition['kind'], string> = {
  'room-revealed': 'Room revealed',
  'enter-region': 'Enters region',
  'within-radius': 'Within radius',
};

/** The zone an authored condition anchors to, by id — the same "scan the loaded map's
 *  layers" shape `lightSync.ts` already uses to find a light child, reading a name instead
 *  of a visibility flag. Undefined for a deleted zone; the trigger's own `inert` tag already
 *  says so, so the condition line just drops the second half. */
function zoneName(layers: readonly Layer[], zoneId: string): string | undefined {
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const child of layer.children) {
      if (child.childType === 'zone' && child.id === zoneId) return child.name;
    }
  }
  return undefined;
}

function conditionLine(when: TriggerCondition, layers: readonly Layer[]): string {
  const label = CONDITION_LABEL[when.kind];
  const zone = zoneName(layers, when.zoneId);
  return zone ? `${label} · ${zone}` : label;
}

// No-scroll ledger (docs/2026-08-22-table-shell-plan.md): 10 rows at 40px fit. Past it the
// rows compact to 32px and the condition line moves off the row entirely, into its title.
const DENSE_AT = 10;

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

// `subtitle()` (session/panels.ts) is read by Popover outside React, the same way
// doorsSubtitle/initiativeSubtitle read a live store slice — but this module's count comes
// off a REST fetch with nowhere else to live, so it keeps its own last-known cache instead.
let subtitleCache: { sceneId: string; count: number } | null = null;

function triggersSubtitle(): string | null {
  const sceneId = useSessionStore.getState().session?.activeSceneId ?? null;
  if (!sceneId || subtitleCache?.sceneId !== sceneId || subtitleCache.count === 0) return null;
  return `${subtitleCache.count} on this scene`;
}

export function TriggerPanel() {
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
        subtitleCache = {
          sceneId,
          count: (res.prep?.triggers.length ?? 0) + (res.prep?.notes.length ?? 0),
        };
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
  const triggers = prep?.triggers ?? [];
  const notes = prep?.notes ?? [];
  const dense = triggers.length > DENSE_AT;

  if (error) {
    return (
      <p role="alert" className="text-xs text-danger">
        Couldn't load this scene's prep: {error}
      </p>
    );
  }

  if (triggers.length === 0 && notes.length === 0) {
    return (
      <div className="flex flex-col gap-0.5 text-sm">
        <p className="text-text-secondary">No prep authored for this scene.</p>
        <p className="text-text-muted">Author triggers and notes in the Editor.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-2 text-sm">
      {notes.length > 0 && triggers.length > 0 && (
        <p className="text-[10px] uppercase tracking-[.08em] text-text-muted">Triggers</p>
      )}
      {triggers.length > 0 && (
      <ul data-testid="trigger-list" className="flex min-h-0 flex-col overflow-hidden">
        {triggers.map((t) => {
          const fired = scene?.fired[t.id] !== undefined;
          const inert = inertById[t.id];
          // "Enabled" as the table is actually playing it: authored on, and not switched
          // off at the table this session. A trigger authored off has nothing for the
          // switch to turn on — `set-enabled` is a runtime override of prep, not a rewrite
          // of it — so the switch is inert too and its title says why.
          const runtimeEnabled = t.enabled && !scene?.disabled[t.id];
          const condition = conditionLine(t.when, layers);
          return (
            <li
              key={t.id}
              title={dense ? condition : undefined}
              className={`flex shrink-0 items-center gap-2 rounded border-b border-border-subtle px-2 last:border-b-0 ${
                dense ? 'h-8' : 'h-10'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate text-[13px] text-text-primary">{t.name}</span>
                  {inert && (
                    <span
                      title={inert}
                      className="shrink-0 rounded border border-border-default px-1 text-[10px] uppercase tracking-[.06em] text-text-secondary"
                    >
                      Inert
                    </span>
                  )}
                </div>
                {!dense && <p className="truncate text-[11.5px] text-text-muted">{condition}</p>}
              </div>
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                <Switch
                  testId={`trigger-enabled-${t.id}`}
                  checked={runtimeEnabled}
                  disabled={!t.enabled}
                  title={t.enabled ? 'Enabled' : 'Off in prep'}
                  onToggle={() => send('set-enabled', { triggerId: t.id, enabled: !runtimeEnabled })}
                >
                  <span className="sr-only">{`${t.name}: enabled`}</span>
                </Switch>
                {/*
                  Always live for an enabled trigger, even one this panel cannot prove is
                  inert (see the file header — `inert` is resolved server-side and not
                  exposed beyond the reason string). An inert fire is refused with a
                  sentence-shaped message (the triggers module's own `bad()`), same channel
                  as every other module's refusal (`lastError`) — a targeted toast for it is
                  a reasonable follow-up, not built here to keep this pass to what the row
                  asked for.
                */}
                <button
                  type="button"
                  disabled={fired}
                  aria-label={`Fire: ${t.name}`}
                  onClick={() => send('fire', { triggerId: t.id })}
                  className="h-6 shrink-0 rounded border border-border-default bg-surface-2 px-2 text-[11.5px] text-text-primary transition-colors duration-150 ease-settle hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface-2 motion-reduce:transition-none"
                >
                  {fired ? 'Fired' : 'Fire'}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      )}

      {notes.length > 0 && (
        <>
          <p className="text-[10px] uppercase tracking-[.08em] text-text-muted">Notes</p>
          <ul data-testid="note-list" className="flex min-h-0 flex-col overflow-y-auto">
            {notes.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                sceneId={sceneId!}
                inert={inertNoteById[n.id]}
                zone={zoneName(layers, n.zoneId)}
              />
            ))}
          </ul>
        </>
      )}
      {triggers.length > 0 && (
        <p className="text-xs text-text-muted">Fired triggers narrate into the log under "Triggers".</p>
      )}
    </div>
  );
}

/** One readable room note: title row, expand for the body and any handout images. Reveal
 *  notes surface on their own as DM toasts when the room uncovers; this list is the
 *  browse-any-time half. */
function NoteRow({
  note,
  sceneId,
  inert,
  zone,
}: {
  note: RoomNote;
  sceneId: string;
  inert?: string;
  zone?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex shrink-0 flex-col border-b border-border-subtle last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-8 items-center gap-1.5 rounded px-2 text-left transition-colors duration-150 ease-settle hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none"
      >
        <span className="min-w-0 truncate text-[13px] text-text-primary">
          {note.title || 'Untitled note'}
        </span>
        {note.showOnReveal && !inert && (
          <span className="shrink-0 rounded border border-border-default px-1 text-[10px] uppercase tracking-[.06em] text-text-secondary">
            On reveal
          </span>
        )}
        {inert && (
          <span
            title={inert}
            className="shrink-0 rounded border border-border-default px-1 text-[10px] uppercase tracking-[.06em] text-text-secondary"
          >
            Inert
          </span>
        )}
        {zone && <span className="ml-auto shrink-0 text-[11.5px] text-text-muted">{zone}</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-2 pb-2">
          {note.body && (
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-text-secondary">
              {note.body}
            </p>
          )}
          {note.imageKeys.map((key) => (
            <NoteImage key={key} sceneId={sceneId} imageKey={key} />
          ))}
        </div>
      )}
    </li>
  );
}

/** Map-embedded handout image, fetched with the seat's own token (the images route is
 *  bearer-authed like every map read). Object URL is per-mount and revoked with it. */
function NoteImage({ sceneId, imageKey }: { sceneId: string; imageKey: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const token = useSessionStore.getState().token;
    if (!token) return;
    let revoke: string | null = null;
    let cancelled = false;
    fetch(`/api/maps/${encodeURIComponent(sceneId)}/images/${encodeURIComponent(imageKey)}`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`image ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        revoke = URL.createObjectURL(blob);
        setUrl(revoke);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [sceneId, imageKey]);

  if (failed) return <p className="text-[11.5px] text-text-muted">Image unavailable.</p>;
  if (!url) return <div className="h-24 animate-pulse rounded bg-surface-2" />;
  return <img src={url} alt="" className="max-h-64 w-full rounded object-contain" />;
}

// Still panel id 'triggers' — hotkeys, tests and stored panel state key off the id, and a
// rename there buys nothing. The DM-facing name grew because the panel did: it now carries
// notes beside triggers.
registerPanel({
  id: 'triggers',
  title: 'Prep',
  icon: 'triggers',
  key: 'G',
  group: 'prep',
  roles: ['dm'],
  order: 70,
  component: TriggerPanel,
  subtitle: triggersSubtitle,
});

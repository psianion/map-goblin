import { useEffect, useRef, useState } from 'react';
import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import {
  AMBIENTS,
  TIMES,
  WEATHERS,
  vocabLabel,
  type AmbientLevel,
  type TimeOfDay,
  type Weather,
} from '@dnd/core/src/shared/prep';
import type { TriggersState } from '@dnd/mechanics/triggers';
import { sceneTriggersOf } from '@dnd/mechanics/triggers';
import {
  deleteScene,
  listScenes,
  patchScene,
  publishScene,
  reorderScenes,
  uploadMapFile,
  type SceneMeta,
} from '../session/auth';
import { readMapFile } from '../session/mapFile';
import { ALL_ROLES, registerPanel } from '../session/panels';
import { useModuleState, useSessionStore } from '../session/store';
import { InviteCodeChip } from './InviteCodeChip';
import { PlayerList } from './PlayerList';

const row = 'flex items-center gap-2 rounded px-2 py-1';
const iconButton =
  'shrink-0 rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-400';
const textInput =
  'w-full rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none';
const selectInput =
  'min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none';

// A pending environment pick the module state never confirms (dropped command,
// disconnect) must not show forever — each field's own timer falls it back to the
// env echo. Fixed window; key it to connection state instead if 4s proves tight.
const PENDING_TIMEOUT_MS = 4000;

/** The three dials the Environment section sets, and the vocabulary each one picks from. */
interface EnvFields {
  time: TimeOfDay;
  weather: Weather;
  ambient: AmbientLevel;
}
type EnvField = keyof EnvFields;
const ENV_FIELDS: EnvField[] = ['time', 'weather', 'ambient'];

/**
 * The selects, in the order a DM reads them. `ambient` is the one that means something
 * mechanically — in `darkness` a normal eye sees only what a light source covers (S3 P3 §1)
 * — so it is labelled for what it does to the table ("Light"), not for the field's name.
 */
const ENV_DIALS: {
  field: EnvField;
  label: string;
  aria: string;
  values: readonly EnvFields[EnvField][];
}[] = [
  { field: 'time', label: 'Time', aria: 'Time of day', values: TIMES },
  { field: 'weather', label: 'Weather', aria: 'Weather', values: WEATHERS },
  { field: 'ambient', label: 'Light', aria: 'Ambient light', values: AMBIENTS },
];

/**
 * §2.4.2 — the DM's corner of the table: invite code, scene library, and in-session
 * publish/re-publish.
 *
 * #47 — the wire snapshot's `scenes` (`session.scenes`) is deliberately thin (`{id, name}`,
 * filtered to what players may see — D5). The DM's own management view needs the full
 * library — sort order, visibility, which map backs each scene — so this panel keeps its
 * own copy fetched over REST (`listScenes`) and refetches after anything that changes it.
 * D6's activation itself is still the `scenes:activate` command over the wire, unchanged.
 */
export function SessionControls() {
  const activeSceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  // The wire's own thin scene list already resends live on any scene mutation in this
  // campaign (`refreshScenes`, server-side) — including a publish from the map editor in
  // another tab. Its identity only changes when that happens (or on the join snapshot), so
  // keying the refetch off it covers "library changed elsewhere" for free, no poll needed.
  const wireScenes = useSessionStore((s) => s.session?.scenes);
  const [scenes, setScenes] = useState<SceneMeta[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    const { session, token } = useSessionStore.getState();
    if (!session || !token) return;
    try {
      setScenes((await listScenes(session.campaignId, token)).scenes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // One fetch on mount, plus one whenever the wire's own scene list changes underneath —
  // every mutation *this panel* makes also refetches itself via `run`, so this only ever
  // fires again for a change nobody at this table clicked (see `wireScenes` above).
  useEffect(() => void refresh(), [wireScenes]);

  /** Every mutating call is the same three lines around the request that differs. */
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const activate = (sceneId: string) => {
    if (sceneId === activeSceneId) return;
    useSessionStore.getState().sendCommand('scenes', 'activate', { sceneId });
  };

  // The module keeps env per scene and only ever sets a field, never clears one (see the
  // module's own `set-environment` — "at least one of time/weather" isn't "either can go
  // back to unset"), so there is nothing here to reset when the active scene has none yet.
  const triggersState = useModuleState<TriggersState>('triggers');
  const env = activeSceneId && triggersState ? sceneTriggersOf(triggersState, activeSceneId).env : {};

  // Optimistic echo: a select shows its own pending pick the instant it's clicked rather
  // than snapping back to `env` until the server's broadcast round-trips. Cleared per-field
  // once `env` catches up, and wholesale on scene switch — a pending pick from the scene you
  // just left has no business showing on the one you switched to.
  const [pending, setPending] = useState<Partial<EnvFields>>({});
  const pendingTimeouts = useRef<Partial<Record<EnvField, ReturnType<typeof setTimeout>>>>({});
  const clearPendingTimeout = (field: EnvField) => {
    clearTimeout(pendingTimeouts.current[field]);
    pendingTimeouts.current[field] = undefined;
  };
  const clearAllPending = () => ENV_FIELDS.forEach(clearPendingTimeout);

  useEffect(() => {
    setPending({});
    clearAllPending();
    // The fields are a constant list; the effect is about the scene changing under them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSceneId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => clearAllPending, []);

  useEffect(() => {
    setPending((p) => {
      const done = ENV_FIELDS.filter((f) => p[f] !== undefined && p[f] === env[f]);
      if (done.length === 0) return p; // unchanged reference — no wasted render
      const next = { ...p };
      for (const field of done) {
        delete next[field];
        clearPendingTimeout(field);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env.time, env.weather, env.ambient]);

  /** One field, one command, one echo — the three selects differ only in their vocabulary. */
  const setEnv = <F extends EnvField>(field: F, value: EnvFields[F]) => {
    setPending((p) => ({ ...p, [field]: value }));
    clearPendingTimeout(field);
    pendingTimeouts.current[field] = setTimeout(() => {
      setPending((p) => {
        const next = { ...p };
        delete next[field];
        return next;
      });
    }, PENDING_TIMEOUT_MS);
    useSessionStore.getState().sendCommand('triggers', 'set-environment', { [field]: value });
  };

  const upload = (file: File) =>
    run(async () => {
      const { session, token, client } = useSessionStore.getState();
      if (!token || !session) return;
      // The editor's own save is gzipped (`readMapFile`); a testdata fixture is plain JSON.
      await uploadMapFile(session.campaignId, token, await readMapFile(file));
      // D6: the wire's own scene list only travels inside a snapshot, and `join` is what
      // asks for one — re-sending it is the refetch for the WS-driven parts of the table
      // (fog's map picker, the player-facing list). `refresh()` (below, via `run`) is the
      // matching refetch for this panel's own REST-backed copy.
      client?.send({ type: 'join', protocolVersion: PROTOCOL_VERSION });
    });

  const republish = (sceneId: string, file: File) =>
    run(async () => {
      const { token, client } = useSessionStore.getState();
      if (!token) return;
      await publishScene(sceneId, token, await readMapFile(file));
      client?.send({ type: 'join', protocolVersion: PROTOCOL_VERSION });
    });

  const startRename = (scene: SceneMeta) => {
    setRenamingId(scene.id);
    setRenameValue(scene.name);
  };

  const commitRename = (sceneId: string) =>
    run(async () => {
      const { token } = useSessionStore.getState();
      const name = renameValue.trim();
      if (!token || !name) return;
      await patchScene(sceneId, token, { name });
      setRenamingId(null);
    });

  const toggleVisible = (scene: SceneMeta) =>
    run(async () => {
      const { token } = useSessionStore.getState();
      if (!token) return;
      await patchScene(scene.id, token, { visibleToPlayers: !scene.visibleToPlayers });
    });

  const move = (index: number, by: -1 | 1) =>
    run(async () => {
      const { session, token } = useSessionStore.getState();
      if (!token || !session) return;
      const order = scenes.map((s) => s.id);
      const target = index + by;
      if (target < 0 || target >= order.length) return;
      [order[index], order[target]] = [order[target]!, order[index]!];
      await reorderScenes(session.campaignId, token, order);
    });

  const remove = (scene: SceneMeta) =>
    run(async () => {
      const { token } = useSessionStore.getState();
      // A published scene taken off the table is not undoable from here — the same
      // native confirm every browser already ships, rather than a bespoke dialog for
      // one destructive DM action.
      if (!token || !window.confirm(`Delete "${scene.name}"? This cannot be undone.`)) return;
      await deleteScene(scene.id, token);
    });

  return (
    <div className="flex flex-col gap-3">
      <InviteCodeChip />

      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Scenes</p>
        {scenes.length === 0 ? (
          <p className="text-sm text-neutral-500">No maps published yet.</p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="scene-list">
            {scenes.map((scene, index) => (
              <li key={scene.id} className="rounded bg-neutral-900/60">
                <div className={row}>
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={busy || index === 0}
                    onClick={() => void move(index, -1)}
                    className={iconButton}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={busy || index === scenes.length - 1}
                    onClick={() => void move(index, 1)}
                    className={iconButton}
                  >
                    ▼
                  </button>

                  {renamingId === scene.id ? (
                    <input
                      autoFocus
                      className={textInput}
                      value={renameValue}
                      disabled={busy}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitRename(scene.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onBlur={() => void commitRename(scene.id)}
                    />
                  ) : (
                    <button
                      type="button"
                      data-scene-id={scene.id}
                      aria-current={scene.id === activeSceneId}
                      onClick={() => activate(scene.id)}
                      className={`min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-sm ${
                        scene.id === activeSceneId
                          ? 'bg-neutral-800 text-neutral-100'
                          : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200'
                      }`}
                    >
                      {scene.name}
                    </button>
                  )}
                </div>

                <div className={`${row} flex-wrap text-xs text-neutral-500`}>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={scene.visibleToPlayers}
                      disabled={busy}
                      onChange={() => void toggleVisible(scene)}
                    />
                    Visible to players
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => startRename(scene)}
                    className={iconButton}
                  >
                    Rename
                  </button>
                  <label className={`${iconButton} cursor-pointer`}>
                    Replace map
                    <input
                      type="file"
                      accept=".mapbuilder,.json,application/json"
                      disabled={busy}
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) void republish(scene.id, file);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(scene)}
                    className={`${iconButton} ml-auto hover:text-red-400`}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-neutral-800 pt-2">
        <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Environment</p>
        {activeSceneId ? (
          // Two to a row: three of these across a panel this narrow would truncate every
          // label. `Light` lands under `Time`, which is the pair a DM reads together.
          <div className="grid grid-cols-2 gap-2">
            {ENV_DIALS.map(({ field, label, aria, values }) => (
              <div key={field} className="flex min-w-0 flex-col gap-0.5">
                {/* Sentence case, no tracking — a field under the ENVIRONMENT header, not a peer section. */}
                <label htmlFor={`env-${field}-select`} className="text-xs text-neutral-500">
                  {label}
                </label>
                <select
                  id={`env-${field}-select`}
                  value={pending[field] ?? env[field] ?? ''}
                  aria-label={aria}
                  data-testid={`env-${field}`}
                  onChange={(e) => {
                    const picked = e.target.value;
                    if (picked) setEnv(field, picked as EnvFields[typeof field]);
                  }}
                  className={selectInput}
                >
                  <option
                    value=""
                    disabled={pending[field] !== undefined || env[field] !== undefined}
                  >
                    Not set
                  </option>
                  {values.map((v) => (
                    <option key={v} value={v}>
                      {vocabLabel(v)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">Activate a scene to set its environment.</p>
        )}
      </div>

      {/*
        The map editor's own publish is the primary way a scene gets here now (M3) — this
        is the backup path for a file that never went through it, so it reads as one rather
        than the main "add a scene" affordance it used to be.
      */}
      <label className="border-t border-neutral-800 pt-2 text-xs text-neutral-500">
        {busy ? 'Working…' : 'Import a map file'}
        <input
          type="file"
          accept=".mapbuilder,.json,application/json"
          disabled={busy}
          aria-label="Import a map file"
          data-testid="scene-upload"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ''; // so re-picking the same file fires again
            if (file) void upload(file);
          }}
          className="mt-1 w-full text-xs text-neutral-400 file:mr-2 file:rounded file:border-0 file:bg-neutral-800 file:px-2 file:py-1 file:text-xs file:text-neutral-100 hover:file:bg-neutral-700"
        />
      </label>

      {error && (
        <p role="alert" className="rounded border border-red-900 bg-red-950/60 px-2 py-1 text-xs text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}

registerPanel({
  id: 'session-controls',
  title: 'Session',
  roles: ['dm'],
  order: 0,
  component: SessionControls,
});

// ponytail: the roster is the one piece of "session info" every role sees, so it
// registers as its own shared panel instead of being duplicated into a DM copy
// and a player copy. PlayerList itself needed no changes to become one.
registerPanel({
  id: 'players',
  title: 'Players',
  roles: ALL_ROLES,
  order: 10,
  component: PlayerList,
});

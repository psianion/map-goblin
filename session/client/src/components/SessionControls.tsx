import { useEffect, useMemo, useRef, useState } from 'react';
import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import { WEATHERS, vocabLabel, type Weather } from '@dnd/core/src/shared/prep';
import {
  CONDITIONS,
  HP_MAX,
  conditionLabel,
  type Condition,
  type InitiativeEntry,
  type InitiativeState,
} from '@dnd/mechanics/initiative';
import type { TokensState } from '@dnd/mechanics/tokens';
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
import { combatantCandidates } from '../session/initiativeView';
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
// Its own constant rather than `${textInput} w-16`: both are width utilities, so which one
// wins is down to their order in the generated stylesheet, not the order written here — and
// `w-full` was winning, letting the field eat the row and truncate its own label to nothing.
const numberInput =
  'w-16 shrink-0 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none';
const actionButton =
  'rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40';

// A pending environment pick the module state never confirms (dropped command,
// disconnect) must not show forever — each field's own timer falls it back to the
// env echo. Fixed window; key it to connection state instead if 4s proves tight.
const PENDING_TIMEOUT_MS = 4000;

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

  // P2 — weather is what is left of the environment triad here. The hour is the campaign's
  // world clock and the light level is the vision gate's override, and both of those live in
  // the World block now: one clock for the world beats a per-scene narration dial that said a
  // different time than the sky did.
  const triggersState = useModuleState<TriggersState>('triggers');
  const env = activeSceneId && triggersState ? sceneTriggersOf(triggersState, activeSceneId).env : {};

  // Optimistic echo: the select shows its own pending pick the instant it's clicked rather
  // than snapping back to `env` until the server's broadcast round-trips. Cleared once `env`
  // catches up, and on scene switch — a pending pick from the scene you just left has no
  // business showing on the one you switched to.
  const [pending, setPending] = useState<Weather | undefined>();
  const pendingTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const weather = pending ?? env.weather;

  useEffect(() => {
    setPending(undefined);
    clearTimeout(pendingTimeout.current);
  }, [activeSceneId]);

  useEffect(() => () => clearTimeout(pendingTimeout.current), []);

  useEffect(() => {
    setPending((p) => (p === env.weather ? undefined : p));
  }, [env.weather]);

  const setWeather = (value: Weather) => {
    setPending(value);
    clearTimeout(pendingTimeout.current);
    pendingTimeout.current = setTimeout(() => setPending(undefined), PENDING_TIMEOUT_MS);
    useSessionStore.getState().sendCommand('triggers', 'set-environment', { weather: value });
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
          <div className="flex min-w-0 flex-col gap-0.5">
            {/* Sentence case, no tracking — a field under the ENVIRONMENT header, not a peer section. */}
            <label htmlFor="env-weather-select" className="text-xs text-neutral-500">
              Weather
            </label>
            <select
              id="env-weather-select"
              value={weather ?? ''}
              aria-label="Weather"
              data-testid="env-weather"
              onChange={(e) => e.target.value && setWeather(e.target.value as Weather)}
              className={selectInput}
            >
              {/* Off the table once set: the module only ever sets weather, never clears it. */}
              <option value="" disabled={weather !== undefined}>
                Not set
              </option>
              {WEATHERS.map((v) => (
                <option key={v} value={v}>
                  {vocabLabel(v)}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">Activate a scene to set its environment.</p>
        )}
      </div>

      <div className="border-t border-neutral-800 pt-2">
        <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Initiative</p>
        <InitiativeControls activeSceneId={activeSceneId} />
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

const sendInitiative = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('initiative', action, payload);

/**
 * The DM's half of the tracker: pick the fight, take the numbers, walk the turns. The number
 * inputs are the *only* way an NPC gets an initiative — nothing here rolls dice (D7), so the
 * DM types what they rolled at the table.
 *
 * The party's own numbers arrive on their own: a player's roll is captured where it is sent
 * (the Beyond20 bridge, the roll box) and the prompt card catches whoever did not roll.
 */
function InitiativeControls({ activeSceneId }: { activeSceneId: string | null }) {
  const state = useModuleState<InitiativeState>('initiative');
  const tokens = useModuleState<TokensState>('tokens');
  const candidates = useMemo(
    () => combatantCandidates(tokens, activeSceneId),
    [tokens, activeSceneId],
  );
  // Overrides on top of "every claimed token is in, no unclaimed one is", rather than a
  // seeded selection — so the list needs no sync pass when a token is claimed mid-pick.
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [newName, setNewName] = useState('');

  if (!state || state.status === 'idle') {
    if (!activeSceneId) {
      return <p className="text-sm text-neutral-500">Activate a scene to start an encounter.</p>;
    }
    if (candidates.length === 0) {
      return <p className="text-sm text-neutral-500">No tokens on this scene yet.</p>;
    }
    const chosen = candidates.filter((c) => picked[c.tokenId] ?? c.kind === 'pc');
    return (
      <div className="flex flex-col gap-1">
        <ul className="flex flex-col gap-0.5" data-testid="initiative-candidates">
          {candidates.map((c) => (
            <li key={c.tokenId}>
              <label className="flex items-center gap-1 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={picked[c.tokenId] ?? c.kind === 'pc'}
                  onChange={(e) =>
                    setPicked((p) => ({ ...p, [c.tokenId]: e.target.checked }))
                  }
                />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="text-xs text-neutral-500">
                  {c.kind === 'pc' ? 'Player' : 'NPC'}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={chosen.length === 0}
          // `tokenId` rides on every entry: the turn ring on the map has nothing else to
          // find the combatant's token by.
          onClick={() =>
            sendInitiative('start', {
              sceneId: activeSceneId,
              entries: chosen.map(({ tokenId, name, kind, identityId }) => ({
                tokenId,
                name,
                kind,
                ...(identityId ? { identityId } : {}),
              })),
            })
          }
          className={actionButton}
        >
          Start encounter
        </button>
      </div>
    );
  }

  const gathering = state.status === 'gathering';
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-0.5" data-testid="initiative-entries">
        {state.entries.map((entry) => (
          <li key={entry.key} className="flex flex-wrap items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-sm text-neutral-300">{entry.name}</span>
            <input
              // Uncontrolled, re-keyed on the value the server holds: while the DM types, the
              // DOM owns the text; when anyone else's number lands, the row remounts showing
              // it. No draft state, and no round-trip flicker on the way back.
              key={`${entry.key}:${entry.initiative}`}
              type="number"
              defaultValue={entry.initiative ?? ''}
              aria-label={`Initiative for ${entry.name}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              // Only on an actual change: re-sending the same number would put a second
              // "rolls initiative" line in the log for a blur nobody edited.
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (e.target.value.trim() && Number.isFinite(value) && value !== entry.initiative) {
                  sendInitiative('set', { key: entry.key, value });
                }
              }}
              className={numberInput}
            />
            <button
              type="button"
              aria-label={`Remove ${entry.name}`}
              onClick={() => sendInitiative('remove', { key: entry.key })}
              className={iconButton}
            >
              ✕
            </button>
            <Bookkeeping entry={entry} />
          </li>
        ))}
      </ul>

      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          const name = newName.trim();
          if (!name) return;
          // No token: a reinforcement the DM names mid-fight is off-board until they place
          // one, and `add` takes it either way.
          sendInitiative('add', { name, kind: 'npc' });
          setNewName('');
        }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          aria-label="Add a combatant"
          placeholder="Add a combatant"
          maxLength={60}
          className={textInput}
        />
        <button type="submit" disabled={!newName.trim()} className={actionButton}>
          Add
        </button>
      </form>

      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => sendInitiative(gathering ? 'begin' : 'next', {})}
          className={actionButton}
        >
          {gathering ? 'Begin' : 'Next turn'}
        </button>
        <button
          type="button"
          onClick={() => sendInitiative('end', {})}
          className={`${actionButton} ml-auto`}
        >
          End encounter
        </button>
      </div>
    </div>
  );
}

/**
 * The second line of a combatant's row: the pool, a damage box, a condition toggle. The
 * numbers and chips themselves are read off the tracker panel above, which both seats share
 * — so this line is inputs only, and stays the same width whether or not anything is set.
 */
function Bookkeeping({ entry }: { entry: InitiativeEntry }) {
  const has = entry.conditions ?? [];
  return (
    <div className="flex basis-full items-center gap-1 pl-2">
      <input
        key={`${entry.key}:${entry.hp?.max ?? ''}`}
        type="number"
        min={1}
        max={HP_MAX}
        defaultValue={entry.hp?.max ?? ''}
        placeholder="max"
        aria-label={`Max HP for ${entry.name}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={(e) => {
          const max = Number(e.target.value);
          if (e.target.value.trim() && Number.isInteger(max) && max > 0 && max !== entry.hp?.max) {
            // A corrected max keeps the damage already taken; the module clamps the rest.
            sendInitiative('hp', { key: entry.key, max, ...(entry.hp ? { current: entry.hp.current } : {}) });
          }
        }}
        className={numberInput}
      />
      <input
        type="number"
        placeholder="dmg"
        title="Damage taken — a negative number heals"
        aria-label={`Damage to ${entry.name}`}
        disabled={!entry.hp}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          const amount = Number(e.currentTarget.value);
          if (Number.isInteger(amount) && amount !== 0) {
            sendInitiative('damage', { key: entry.key, amount });
            e.currentTarget.value = '';
          }
        }}
        className={`${numberInput} disabled:opacity-40`}
      />
      <select
        value=""
        aria-label={`Conditions for ${entry.name}`}
        onChange={(e) => {
          const name = e.target.value;
          if (name) sendInitiative('condition', { key: entry.key, name, on: !has.includes(name as Condition) });
        }}
        className={selectInput}
      >
        <option value="">{has.length ? has.map(conditionLabel).join(', ') : 'Condition…'}</option>
        {CONDITIONS.map((c) => (
          <option key={c} value={c}>
            {has.includes(c) ? '✓ ' : ''}
            {conditionLabel(c)}
          </option>
        ))}
      </select>
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

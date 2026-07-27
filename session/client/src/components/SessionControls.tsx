import { useState } from 'react';
import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import type { SessionState } from '@dnd/core/src/shared/protocol';
import { uploadMapFile } from '../session/auth';
import { ALL_ROLES, registerPanel } from '../session/panels';
import { useSessionStore } from '../session/store';
import { InviteCodeChip } from './InviteCodeChip';
import { PlayerList } from './PlayerList';

// Stable empty array: a `[]` literal inside the selector would be a new
// reference every render and re-render this panel forever (zustand v5).
const NO_SCENES: SessionState['scenes'] = [];

/**
 * §2.4.2 — the DM's corner of the table: invite code, scene switcher, and
 * in-session map import.
 *
 * D6: switching a scene is an ordinary module command (`scenes:activate`), not a
 * bespoke message. Importing a map is the existing upload endpoint plus a
 * snapshot refetch — no new server surface either way.
 */
export function SessionControls() {
  const scenes = useSessionStore((s) => s.session?.scenes) ?? NO_SCENES;
  const activeSceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activate = (sceneId: string) => {
    if (sceneId === activeSceneId) return;
    useSessionStore.getState().sendCommand('scenes', 'activate', { sceneId });
  };

  const upload = async (file: File) => {
    const { token, session, client } = useSessionStore.getState();
    if (!token || !session) return;
    setBusy(true);
    setError(null);
    try {
      await uploadMapFile(session.campaignId, token, await file.text());
      // D6: the scene list only travels inside a snapshot, and `join` is what asks
      // for one. Re-sending it *is* the refetch — the server reads scenes fresh per
      // snapshot, so the new map shows up in the list below. Everyone else sees a
      // `player-joined` for a player already on the roster, which replaces in place.
      client?.send({ type: 'join', protocolVersion: PROTOCOL_VERSION });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <InviteCodeChip />

      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Scenes</p>
        {scenes.length === 0 ? (
          <p className="text-sm text-neutral-500">No maps uploaded yet.</p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="scene-list">
            {scenes.map((scene) => (
              <li key={scene.id}>
                <button
                  type="button"
                  data-scene-id={scene.id}
                  aria-current={scene.id === activeSceneId}
                  onClick={() => activate(scene.id)}
                  className={`w-full truncate rounded px-2 py-1 text-left text-sm ${
                    scene.id === activeSceneId
                      ? 'bg-neutral-800 text-neutral-100'
                      : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200'
                  }`}
                >
                  {scene.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="text-xs text-neutral-500">
        {busy ? 'Uploading…' : 'Add a map'}
        <input
          type="file"
          accept=".mapbuilder,.json,application/json"
          disabled={busy}
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

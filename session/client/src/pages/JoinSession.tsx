import { useEffect, useState } from 'react';
import { navigate } from '../router';
import { joinAsPlayer, resolveInviteCode } from '../session/auth';
import { prefetchSceneMap } from '../session/loadSceneMap';
import { useSessionStore, waitForSessionSnapshot } from '../session/store';

const SNAPSHOT_TIMEOUT_MS = 5000;
const PREFETCH_CAP_MS = 10000;

/**
 * Warm the table's active scene before `/table` ever mounts `GameRenderer` — the WS
 * `session-state` snapshot (`activeSceneId` + `scenes[].mapId`) only exists once
 * `connect()`'s socket has round-tripped, so this is the earliest point a prefetch can
 * start. An optimization only: no active scene, a snapshot that never arrives, or a
 * prefetch that fails or overruns the cap all fall through to the same place — nothing
 * to await, `join()` navigates regardless. Timeouts are parameters so tests don't pay
 * the production ones.
 */
export async function prepareTableForJoin(
  token: string,
  { snapshotTimeoutMs = SNAPSHOT_TIMEOUT_MS, capMs = PREFETCH_CAP_MS } = {},
): Promise<void> {
  const attempt = async () => {
    try {
      const session = await waitForSessionSnapshot(snapshotTimeoutMs);
      const sceneId = session?.activeSceneId;
      if (!sceneId) return;
      const mapId = session.scenes.find((s) => s.id === sceneId)?.mapId;
      if (!mapId) return;
      await prefetchSceneMap(sceneId, mapId, token);
    } catch (err) {
      console.warn('[JoinSession] table prefetch failed:', err);
    }
  };
  await Promise.race([attempt(), new Promise<void>((resolve) => setTimeout(resolve, capMs))]);
}

const field =
  'w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500';

/**
 * §2.6 — code + name in, a seat at the table out.
 *
 * ponytail: one form, not a two-step wizard. A code arriving on `/join/:code` is
 * checked against `/api/resolve` on mount and the cursor lands in the name field —
 * that is the "auto-advance", and it keeps the code visible so a wrong one is fixable.
 */
export default function JoinSession({ code: linkCode }: { code?: string }) {
  const [code, setCode] = useState((linkCode ?? '').toUpperCase());
  const [name, setName] = useState('');
  const [found, setFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!linkCode) return;
    let live = true;
    resolveInviteCode(linkCode.toUpperCase()).then(
      () => live && setFound(true),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    // The page outlives the request when someone edits the code mid-flight.
    return () => {
      live = false;
    };
  }, [linkCode]);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const player = await joinAsPlayer(code.trim(), name.trim());
      useSessionStore.getState().connect(player.token);
      setPreparing(true);
      await prepareTableForJoin(player.token);
      navigate('/table');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setPreparing(false);
    }
  };

  return (
    <div
      data-page="join"
      className="flex h-full items-center justify-center bg-neutral-950 p-6 text-neutral-100"
    >
      <form
        className="flex w-full max-w-sm flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void join();
        }}
      >
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Join a game</h1>
          {found && (
            <p className="mt-1 text-sm text-emerald-400">Table found — who are you?</p>
          )}
        </header>

        <div>
          <label className={label} htmlFor="invite-code">
            Invite code
          </label>
          <input
            id="invite-code"
            className={`${field} font-mono tracking-[0.3em]`}
            value={code}
            maxLength={6}
            autoFocus={!found}
            autoComplete="off"
            placeholder="ABC234"
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setFound(false);
            }}
          />
        </div>

        <div>
          <label className={label} htmlFor="player-name">
            Your name
          </label>
          <input
            id="player-name"
            className={field}
            value={name}
            maxLength={64}
            autoFocus={found}
            onChange={(e) => setName(e.target.value)}
            placeholder="Borin"
          />
        </div>

        <button
          type="submit"
          disabled={busy || code.trim().length === 0 || name.trim().length === 0}
          className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {preparing ? 'Preparing map…' : busy ? 'Joining…' : 'Join'}
        </button>

        {error && (
          <p role="alert" className="rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

import { useState } from 'react';
import { InviteCodeChip } from '../components/InviteCodeChip';
import { PlayerList } from '../components/PlayerList';
import { navigate } from '../router';
import { endSession } from '../session/auth';
import { ALL_ROLES, registerPanel } from '../session/panels';
import { useSessionStore } from '../session/store';

/** The scene name currently playing, or 'Session' — the popover's own title (M1 §6). Not a
 *  hook: `PanelDef.title` is a plain function, called at render time by `Popover`. */
function sessionTitle(): string {
  const session = useSessionStore.getState().session;
  const scene = session?.scenes.find((s) => s.id === session.activeSceneId);
  return scene?.name ?? 'Session';
}

/** Invite code (DM), roster, and — for a player — what's on the table right now. */
export function SessionPopover() {
  const isDm = useSessionStore((s) => s.you?.role) === 'dm';
  const sceneName = useSessionStore((s) => {
    const session = s.session;
    return session?.scenes.find((sc) => sc.id === session.activeSceneId)?.name;
  });

  return (
    <div className="flex flex-col gap-2">
      <InviteCodeChip />
      <PlayerList />
      {!isDm && (
        <p className="text-sm text-text-secondary">
          Now playing: <span className="text-text-primary">{sceneName ?? 'nothing yet'}</span>
        </p>
      )}
    </div>
  );
}

const dangerGhost =
  'rounded px-2 py-1 text-xs font-medium text-danger transition-colors duration-150 ease-settle hover:bg-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:opacity-40 motion-reduce:transition-none';
const ghost =
  'ml-auto rounded px-2 py-1 text-xs text-text-secondary transition-colors duration-150 ease-settle hover:bg-surface-2 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none';

/**
 * DM: "End session", flipping in place to a confirm — the in-popover replacement for
 * `window.confirm` the plan calls for. Player: "Leave table". Its own local state, not
 * shared with the body above: the confirm flip never touches anything the roster reads.
 */
function SessionFooter() {
  const role = useSessionStore((s) => s.you?.role);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!role) return null;

  if (role !== 'dm') {
    return (
      <button
        type="button"
        data-testid="leave-table"
        onClick={() => {
          useSessionStore.getState().disconnect();
          navigate('/');
        }}
        className={ghost}
      >
        Leave table
      </button>
    );
  }

  if (!confirming) {
    return (
      <button type="button" data-testid="end-session" onClick={() => setConfirming(true)} className={dangerGhost}>
        End session
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        data-testid="end-session-confirm"
        disabled={busy}
        onClick={async () => {
          const { session, token } = useSessionStore.getState();
          if (!session || !token) return;
          setBusy(true);
          setError(null);
          try {
            // The server's own `session-ended` broadcast (including back to this seat) is
            // what actually tears things down — `applyServerMessage` already handles it.
            await endSession(session.sessionId, token);
          } catch (e) {
            setBusy(false);
            setConfirming(false);
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
        className={dangerGhost}
      >
        End for everyone?
      </button>
      <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={ghost}>
        Cancel
      </button>
      {error && <p role="alert" className="basis-full text-xs text-danger">{error}</p>}
    </>
  );
}

registerPanel({
  id: 'session',
  title: sessionTitle,
  icon: 'session',
  key: '',
  group: 'prep',
  rail: false,
  roles: ALL_ROLES,
  order: 55,
  component: SessionPopover,
  footer: SessionFooter,
});

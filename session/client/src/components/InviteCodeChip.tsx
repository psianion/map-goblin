import { useEffect, useState } from 'react';
import { fetchActiveSession } from '../session/auth';
import { useSessionStore } from '../session/store';
import { Icon } from '../shell/icons';

/**
 * DM-only invite row — the first thing in the Session popover's body (M3 review finding 3).
 *
 * The code normally arrives from HostSetup (C2) via `store.inviteCode`; until that flow
 * exists, `?code=` on the URL is accepted so the page is reachable. A DM seat that resumed,
 * or was minted fresh via `dm-token`, never went through HostSetup at all — `store.inviteCode`
 * is `null` for it — so this asks the server once for whatever table is already open.
 */
export function InviteCodeChip() {
  const role = useSessionStore((s) => s.you?.role);
  const stored = useSessionStore((s) => s.inviteCode);
  const code = stored ?? new URLSearchParams(window.location.search).get('code');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    if (role !== 'dm' || stored) return;
    const { session, token } = useSessionStore.getState();
    if (!session || !token) return;
    let cancelled = false;
    fetchActiveSession(session.campaignId, token)
      .then((res) => {
        if (!cancelled) useSessionStore.getState().setInviteCode(res.inviteCode);
      })
      .catch(() => {
        // Nothing running for this campaign, or the call failed — the row just stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, [role, stored]);

  if (role !== 'dm' || !code) return null;

  const copy = () => {
    navigator.clipboard?.writeText(`${location.origin}/join/${code}`).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <div
      data-testid="invite-code-chip"
      className="flex items-center gap-2 rounded border border-border-default px-2 py-1.5"
    >
      <span className="text-xs uppercase tracking-wide text-text-muted">Invite</span>
      <code data-testid="invite-code" className="font-mono text-[15px] tracking-[.18em] text-text-primary">
        {code}
      </code>
      <span className="flex-1" />
      <button
        type="button"
        onClick={copy}
        aria-label="Copy invite link"
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-border-default bg-surface-2 px-2.5 text-xs text-text-secondary transition-colors duration-150 ease-settle hover:bg-surface-3 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none"
      >
        <Icon name="copy" size={12} />
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}

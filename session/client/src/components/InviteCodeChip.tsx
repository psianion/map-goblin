import { useEffect, useState } from 'react';
import { useSessionStore } from '../session/store';

/**
 * DM-only invite code + copy button.
 *
 * The code normally arrives from HostSetup (C2) via `store.inviteCode`; until
 * that flow exists, `?code=` on the URL is accepted so the page is reachable.
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

  if (role !== 'dm' || !code) return null;

  const copy = () => {
    navigator.clipboard?.writeText(code).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <div
      data-testid="invite-code-chip"
      className="flex items-center gap-2 rounded-md border border-border-default bg-surface-2/60 px-2 py-1.5"
    >
      <span className="text-xs uppercase tracking-wide text-text-muted">Invite</span>
      <code className="font-mono text-sm tracking-widest text-text-primary">{code}</code>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy invite code"
        className="ml-auto rounded px-1.5 py-0.5 text-xs text-text-secondary hover:bg-surface-3 hover:text-text-primary"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

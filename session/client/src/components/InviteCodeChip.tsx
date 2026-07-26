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
      className="flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-800/60 px-2 py-1.5"
    >
      <span className="text-xs uppercase tracking-wide text-neutral-500">Invite</span>
      <code className="font-mono text-sm tracking-widest text-neutral-100">{code}</code>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy invite code"
        className="ml-auto rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

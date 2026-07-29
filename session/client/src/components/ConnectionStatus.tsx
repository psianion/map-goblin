import { useSessionStore } from '../session/store';

const LABELS = {
  connecting: 'Connecting',
  open: 'Connected',
  reconnecting: 'Reconnecting',
  closed: 'Disconnected',
} as const;

const DOTS = {
  connecting: 'bg-amber-400',
  open: 'bg-emerald-400',
  reconnecting: 'bg-amber-400 animate-pulse',
  closed: 'bg-red-500',
} as const;

/** Dot + label + round-trip time. */
export function ConnectionStatus() {
  const connection = useSessionStore((s) => s.connection);
  const latencyMs = useSessionStore((s) => s.latencyMs);
  const sessionEnded = useSessionStore((s) => s.sessionEnded);

  return (
    <div className="flex items-center gap-2 text-sm text-text-primary" data-testid="connection-status">
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOTS[connection]}`} aria-hidden />
      <span>{sessionEnded ? 'Session ended' : LABELS[connection]}</span>
      {connection === 'open' && latencyMs !== null && (
        <span className="text-text-secondary">{Math.round(latencyMs)} ms</span>
      )}
    </div>
  );
}

/**
 * Non-blocking reconnect banner — an overlay strip, never a modal: the last
 * rendered frame of the map stays visible and interactive underneath.
 */
export function ReconnectingBanner() {
  const connection = useSessionStore((s) => s.connection);
  if (connection !== 'reconnecting') return null;

  return (
    <div
      role="status"
      data-testid="reconnecting-banner"
      className="pointer-events-none absolute inset-x-0 top-0 z-banner bg-amber-500/90 px-3 py-1.5 text-center text-sm font-medium text-amber-950"
    >
      Connection lost — reconnecting…
    </div>
  );
}

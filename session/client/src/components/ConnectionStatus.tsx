import { useSessionStore } from '../session/store';

// The dot + label + round-trip display moved into the table's status bar
// (TableStatusBar) when the sidebar block was retired — only the banner lives here now.

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

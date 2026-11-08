import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Button, FloatBox, StatusChip } from '@dnd/ui';
import { WifiOff } from '@dnd/ui/icons';
import { navigate } from '../router';
import { useSessionStore } from '../session/store';

/** After this long without the server, the chip becomes the banner. */
export const BANNER_AFTER_S = 8;

/** When the connection last dropped, kept until it is back (or the seat is closed). */
const useDownSince = create<{ since: number | null }>()(() => ({ since: null }));
useSessionStore.subscribe((s, prev) => {
  if (s.connection === prev.connection) return;
  if (s.connection === 'reconnecting') {
    if (useDownSince.getState().since === null) useDownSince.setState({ since: Date.now() });
  } else if (s.connection === 'open' || s.connection === 'closed') {
    useDownSince.setState({ since: null });
  }
});

/** Whole seconds since the connection dropped; null while it is healthy. */
function useSecondsDown(): number | null {
  const since = useDownSince((s) => s.since);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since === null ? null : Math.max(0, Math.floor((now - since) / 1000));
}

/**
 * Nothing while the connection is healthy; a chip with a count while it reconnects, a banner
 * once it has been gone a while (board 5); and the end of the table once the DM ends it.
 */
export function ConnectionNotice() {
  const seconds = useSecondsDown();
  const ended = useSessionStore((s) => s.sessionEnded);
  if (ended) {
    return (
      <FloatBox
        role="status"
        data-testid="session-ended"
        className="absolute top-16 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 px-3 py-2 text-sm text-text"
      >
        The session has ended.
        <Button variant="outline" size="sm" onClick={() => navigate('/')}>
          Leave
        </Button>
      </FloatBox>
    );
  }
  if (seconds === null) return null;
  if (seconds >= BANNER_AFTER_S) {
    return (
      <FloatBox
        role="status"
        data-testid="connection-banner"
        className="absolute top-16 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 border-danger px-3 py-2 text-sm text-danger"
      >
        <WifiOff aria-hidden strokeWidth={1.75} className="size-4" />
        Connection lost. Trying again…
      </FloatBox>
    );
  }
  return (
    <StatusChip
      role="status"
      data-testid="connection-chip"
      className="absolute top-16 right-16 z-40 h-8 rounded-pill border border-line bg-panel px-3 text-danger shadow-e"
    >
      Reconnecting… {seconds}s
    </StatusChip>
  );
}

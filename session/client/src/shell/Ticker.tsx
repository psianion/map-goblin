// M1 — the log's collapsed form: the newest line, above the status bar, click to open the
// drawer. Sits where `ActiveToolIndicator` used to.

import { LogLine } from './LogDrawer';
import { useLogEntries } from './logFeed';
import { useOverlayMode, useShell } from './shellStore';

export function Ticker() {
  const drawerOpen = useShell((s) => s.drawerOpen);
  const setDrawer = useShell((s) => s.setDrawer);
  const sidebarOpen = useShell((s) => s.sidebarOpen);
  const overlay = useOverlayMode();
  const entries = useLogEntries();
  const newest = entries[entries.length - 1];

  if (drawerOpen || !newest) return null;

  // table-shell-redesign D1: clears the inset-mode sidebar the same 10px the mockup does.
  const leftInset = sidebarOpen && !overlay;

  return (
    <button
      type="button"
      data-testid="ticker"
      aria-label="Open the log"
      onClick={() => setDrawer(true)}
      className={`absolute bottom-9 flex h-[26px] max-w-[480px] items-center gap-2 truncate rounded-md border border-border-default bg-surface-1/90 px-2.5 text-xs text-text-secondary transition-[left,background-color,color] duration-200 ease-settle hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none ${
        leftInset ? 'left-[310px]' : 'left-2.5'
      }`}
    >
      {/* Keyed on the entry so a new line remounts the span and crossfades in — opacity
          only, no transform (motion-safe honours reduced-motion by simply not applying it). */}
      <span key={newest.key} className="min-w-0 truncate motion-safe:animate-fade-in">
        <LogLine e={newest} />
      </span>
    </button>
  );
}

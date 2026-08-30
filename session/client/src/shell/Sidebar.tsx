// table-shell-redesign — the left sidebar frame: header + scrollable body, persistent and
// toggleable for both roles. Content is a black box to this file — the DM's Prep board and
// the player's Journal register their own body through `session/sidebars.ts`'s
// `registerSidebar`, the same D8 seam `panels.ts` gives the rail, so a content module never
// edits this file.
//
// Geometry follows the approved mockup (docs/mockups/table-shell-redesign-mockup.html):
// 300px, insets the map/status bar/ticker while open, overlays with a scrim under 900px.

import { sidebarForRole } from '../session/sidebars';
import { useRole, useSessionStore } from '../session/store';
import { Icon } from './icons';
import { useOverlayMode, useShell } from './shellStore';

export function Sidebar() {
  const role = useRole();
  // `badge()` is a plain function read off the store, not a hook, so nothing re-renders this
  // frame when the state behind it moves — the edge badge would sit stale until some other
  // prop happened to change. This is that subscription, and it is the module snapshot rather
  // than `triggers` so the shell still knows nothing about which module owns the sidebar
  // (same trick, same reason, as `Rail`'s own `useSessionStore((s) => s.session)`).
  useSessionStore((s) => s.session?.modules);
  const open = useShell((s) => s.sidebarOpen);
  const setSidebar = useShell((s) => s.setSidebar);
  const toggleSidebar = useShell((s) => s.toggleSidebar);
  const overlay = useOverlayMode();
  const def = sidebarForRole(role);

  if (!role) return null;

  const title = def?.title ?? (role === 'dm' ? 'Prep' : 'Journal');
  const Body = def?.component;
  // Badge only means anything while the sidebar is closed — the mockup's `edgeBadge` pulse.
  const badge = !open ? (def?.badge?.() ?? null) : null;

  return (
    <>
      {overlay && (
        <div
          data-testid="sidebar-scrim"
          aria-hidden
          onClick={() => setSidebar(false)}
          className={`absolute inset-0 z-banner bg-black/45 transition-opacity duration-200 ease-settle motion-reduce:transition-none ${
            open ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        />
      )}

      <aside
        data-testid="sidebar"
        aria-label={title}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        className={`absolute inset-y-0 left-0 z-toolbar flex w-[300px] flex-col border-r border-border-default bg-surface-1 transition-transform duration-200 ease-settle motion-reduce:transition-none ${
          open ? 'translate-x-0' : '-translate-x-full'
        } ${overlay ? 'z-sidebar-overlay shadow-panel' : ''}`}
      >
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle pl-3.5 pr-2">
          {/* Sans, not `font-serif`: the table ships no webfonts (chrome-style-guide.md's own
              open item), so `font-serif` renders as Georgia here — and the approved mockup's
              `.sb-title` sets no family at all, i.e. the one sans at 13px/600. */}
          <span className="truncate text-[13px] font-semibold text-text-primary">{title}</span>
          <button
            type="button"
            data-testid="sidebar-collapse"
            aria-label="Collapse the sidebar (G)"
            onClick={() => setSidebar(false)}
            className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted transition-colors duration-150 ease-settle hover:bg-surface-2 hover:text-text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none"
          >
            <Icon name="chevron" size={14} className="rotate-90" />
          </button>
        </div>
        <div data-testid="sidebar-body" className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1.5">
          {Body ? <Body /> : <p className="px-3.5 py-4 text-xs text-text-muted">Nothing here yet.</p>}
        </div>
      </aside>

      <button
        type="button"
        data-testid="sidebar-edge-toggle"
        aria-label="Open the sidebar (G)"
        onClick={() => toggleSidebar()}
        // Faded out, not unmounted, so it can cross-fade — which leaves it in the tab order
        // and reachable by a screen reader unless it is taken out explicitly.
        tabIndex={open ? -1 : 0}
        aria-hidden={open || undefined}
        className={`absolute left-2 top-2 z-toolbar flex h-[34px] w-[34px] items-center justify-center rounded-md border border-border-default bg-surface-1/95 text-text-muted transition-opacity duration-150 hover:bg-surface-2 hover:text-text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus ${
          open ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
      >
        <Icon name="sidebar" size={16} />
        {badge !== null && (
          <span
            data-testid="sidebar-edge-badge"
            className="absolute -right-1.5 -top-1.5 min-w-[15px] rounded-full bg-accent-active px-1 text-center font-mono text-[9.5px] font-bold leading-[15px] text-on-accent shadow-[0_0_0_2px_rgb(var(--surface-1))]"
          >
            {badge}
          </span>
        )}
      </button>
    </>
  );
}

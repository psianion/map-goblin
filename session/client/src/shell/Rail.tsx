import { useState, type KeyboardEvent } from 'react';
import { resolvePanelTitle, useRailPanels, type PanelDef } from '../session/panels';
import { useRole, useSessionStore } from '../session/store';
import { useShell } from './shellStore';
import { Icon } from './icons';
import { railRefs } from './railRefs';

const itemClass =
  'group relative flex h-[46px] w-12 flex-col items-center justify-center gap-0.5 rounded-md text-text-secondary outline-none transition-colors duration-150 ease-settle hover:bg-[image:var(--hover-glow)] hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none';

function RailItem({
  def,
  active,
  tabIndex,
  onActivate,
  onFocus,
  onKeyDown,
}: {
  def: PanelDef;
  active: boolean;
  tabIndex: 0 | -1;
  onActivate: () => void;
  onFocus: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const title = resolvePanelTitle(def);
  const label = def.key ? `${title} (${def.key})` : title;
  const badge = def.badge?.() ?? null;

  return (
    <button
      ref={(el) => {
        if (el) railRefs.set(def.id, el);
        else railRefs.delete(def.id);
      }}
      type="button"
      data-testid={`rail-${def.id}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      tabIndex={tabIndex}
      onClick={onActivate}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className={`${itemClass} ${active ? 'bg-surface-3 text-accent-active' : ''}`}
    >
      <Icon name={def.icon} size={20} />
      <span className="text-[9.5px] leading-none tracking-[0.01em]">{title}</span>
      {badge && (
        <span
          data-badge
          className="absolute right-0.5 top-0.5 min-w-[13px] rounded-full bg-accent-active px-1 text-center font-mono text-[9px] leading-[13px] text-on-accent shadow-[0_0_0_2px_rgb(var(--surface-1))]"
        >
          {badge}
        </span>
      )}
    </button>
  );
}

/** 56px labelled icon rail, right edge of the table (M1 plan §Rail). */
export function Rail() {
  const role = useRole();
  const panels = useRailPanels(role);
  // Broad on purpose: a badge (`R1` while an encounter runs) is a plain function read off
  // the store, not a hook, so nothing re-renders Rail when it changes unless something
  // subscribes to the state it reads — this is that subscription.
  useSessionStore((s) => s.session);
  const openPanel = useShell((s) => s.openPanel);
  const drawerOpen = useShell((s) => s.drawerOpen);
  const togglePanel = useShell((s) => s.togglePanel);
  const toggleDrawer = useShell((s) => s.toggleDrawer);
  // Roving tabindex: real state (an event, focus, sets it), not a ref — the item it points at
  // has to affect what renders (`tabIndex`), and reading a ref during render is illegal.
  const [focusedId, setFocusedId] = useState<string | null>(null);

  if (!role || panels.length === 0) return null;

  const play = panels.filter((p) => p.group === 'play');
  const prep = panels.filter((p) => p.group === 'prep');
  const log = panels.filter((p) => p.group === 'log');
  const ordered = [...play, ...prep, ...log];
  // Derived, not stored: falls back to the first item whenever the tracked one is stale
  // (role switch, panel unregistered) without a render-time write anywhere.
  const roving = focusedId && ordered.some((p) => p.id === focusedId) ? focusedId : (ordered[0]?.id ?? null);

  const activate = (def: PanelDef) => (def.group === 'log' ? toggleDrawer() : togglePanel(def.id));

  const move = (fromId: string, dir: 1 | -1) => {
    const i = ordered.findIndex((p) => p.id === fromId);
    const next = ordered[(i + dir + ordered.length) % ordered.length];
    if (next) railRefs.get(next.id)?.focus();
  };

  const item = (def: PanelDef) => (
    <RailItem
      key={def.id}
      def={def}
      active={def.group === 'log' ? drawerOpen : openPanel === def.id}
      tabIndex={roving === def.id ? 0 : -1}
      onActivate={() => activate(def)}
      onFocus={() => setFocusedId(def.id)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          move(def.id, 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          move(def.id, -1);
        }
      }}
    />
  );

  return (
    <div
      data-testid="rail"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="absolute inset-y-0 right-0 z-toolbar flex w-14 flex-col items-center gap-0.5 border-l border-border-structure bg-surface-1 py-2.5"
    >
      {play.map(item)}
      {play.length > 0 && prep.length > 0 && (
        <div className="my-2 h-px w-7 bg-border-structure" aria-hidden />
      )}
      {prep.map(item)}
      <div className="flex-1" />
      {log.map(item)}
    </div>
  );
}

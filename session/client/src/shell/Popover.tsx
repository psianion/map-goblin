import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { resolvePanelTitle, usePanel } from '../session/panels';
import { useRole, useSessionStore } from '../session/store';
import { useShell } from './shellStore';
import { railRefs } from './railRefs';
import { Icon } from './icons';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The one frame every panel renders into (M1 plan §Popover): header, body, optional footer,
 * anchored off the rail icon that opened it. `PanelDef.component` supplies the body;
 * `PanelDef.footer` / `headerActions` are optional slots a panel can register into instead of
 * this file knowing anything about a specific module.
 */
export function Popover() {
  const openPanel = useShell((s) => s.openPanel);
  const closePanel = useShell((s) => s.closePanel);
  const role = useRole();
  // Broad on purpose: keeps a live `title`/`subtitle` function fresh whenever anything
  // server-driven changes, without a bespoke subscription per panel (see Rail's own).
  useSessionStore((s) => s.session);
  // Unconditional call (rules-of-hooks): `''` never matches a registered id, so this is
  // `undefined` whenever nothing is open.
  const def = usePanel(openPanel ?? '');

  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(12);

  // Anchor to the rail icon's own position, clamped so the popover never runs off the bottom.
  useLayoutEffect(() => {
    if (!openPanel) return;
    const recalc = () => {
      const anchor = railRefs.get(openPanel);
      const raw = anchor ? anchor.getBoundingClientRect().top : 12;
      const height = rootRef.current?.offsetHeight ?? 0;
      setTop(Math.max(12, Math.min(raw, window.innerHeight - 12 - height)));
    };
    recalc();
    window.addEventListener('resize', recalc);
    return () => window.removeEventListener('resize', recalc);
  });

  // Focus the body's first control on open; hand focus back to the rail icon on close.
  useEffect(() => {
    if (!openPanel) return;
    bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const anchor = railRefs.get(openPanel);
    return () => anchor?.focus();
  }, [openPanel]);

  // Esc closes — a dialog's own guarantee, independent of the global hotkey listener (which
  // additionally decides *not* to disarm a tool on the same press when a popover was open).
  useEffect(() => {
    if (!openPanel) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closePanel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openPanel, closePanel]);

  // A press that lands anywhere off the popover — the map included — closes it.
  useEffect(() => {
    if (!openPanel) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closePanel();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openPanel, closePanel]);

  // Dev-only: the no-scroll ledger is a promise, not a CSS accident — warn instead of a
  // scrollbar quietly reappearing on a panel that outgrew its ceiling.
  useLayoutEffect(() => {
    if (!import.meta.env.DEV || !openPanel) return;
    const body = bodyRef.current;
    if (!body) return;
    const overflow = body.scrollHeight - body.clientHeight;
    if (overflow > 0) {
      console.warn(`[shell] panel "${openPanel}" overflows its popover by ${overflow}px`);
    }
  });

  if (!openPanel || !def || !role || !def.roles.includes(role)) return null;

  const Panel = def.component;
  const Footer = def.footer;
  const HeaderActions = def.headerActions;
  const width = def.width ?? 320;
  const subtitle = def.subtitle?.() ?? null;
  const titleId = `popover-title-${def.id}`;

  return (
    <div
      ref={rootRef}
      data-testid="popover"
      data-panel={def.id}
      role="dialog"
      aria-labelledby={titleId}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="absolute right-[66px] z-toolbar flex flex-col overflow-hidden rounded-lg border border-border-structure bg-surface-1 shadow-panel motion-safe:animate-panel-in"
      style={{ width, top, maxHeight: `calc(100vh - ${top + 12}px)` }}
    >
      <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-border-default py-0 pl-3.5 pr-2">
        <span id={titleId} className="truncate font-serif text-[16px] text-text-primary">
          {resolvePanelTitle(def)}
        </span>
        {subtitle && <span className="truncate text-xs text-text-muted">{subtitle}</span>}
        {HeaderActions && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <HeaderActions />
          </div>
        )}
        <button
          type="button"
          aria-label="Close"
          onClick={closePanel}
          className={`${HeaderActions ? '' : 'ml-auto'} flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded text-text-muted transition-colors duration-150 ease-settle hover:bg-surface-2 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none`}
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      <div
        ref={bodyRef}
        data-testid="popover-body"
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3"
      >
        <Panel />
      </div>

      {Footer && (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-border-default px-3 py-2">
          <Footer />
        </div>
      )}
    </div>
  );
}

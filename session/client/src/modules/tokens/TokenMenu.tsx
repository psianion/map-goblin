// §2.4.9 — the on-map token menu: the fast path for the token this seat has selected,
// without opening the Tokens popover for it. Anchored off the token's own world position
// through the camera (M3 plan §Risks — "on-map menus need world→screen projection"), same
// notch-left chrome as the door menu.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SIZE_CELLS, type TokensState } from '@dnd/mechanics/tokens';
import { frameWorldPoint, worldToScreen } from '../../renderer/camera';
import { useModuleState, useSessionStore } from '../../session/store';
import { Icon } from '../../shell/icons';
import { useShell } from '../../shell/shellStore';
import { useTokenInteraction } from './drag';
import { tokensOf } from './TokenRenderer';

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('tokens', action, payload);

/** CSS px clear of the token's right edge — `DoorMenu`'s own gap. */
const GAP = 12;
const FALLBACK_W = 180;
const FALLBACK_H = 76;

const actionButtonClass =
  'flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] text-text-secondary transition-colors duration-150 ease-settle hover:bg-surface-2 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none';

/**
 * The `⋯` button and its one-item dropdown, self-contained so its open/closed state needs
 * no effect to reset: mounted with `key={token.id}` by the caller, a fresh instance (state
 * back to closed) is what a different — or a newly hidden then reshown — token gets, rather
 * than this component reaching for `setState` inside an effect to force the same thing.
 */
function MoreMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative ml-auto">
      <button
        type="button"
        aria-label="More"
        aria-expanded={open}
        data-testid="token-menu-more"
        onClick={() => setOpen((v) => !v)}
        className={actionButtonClass}
      >
        <Icon name="more" size={13} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-toolbar mt-1 rounded-md border border-border-structure bg-surface-1 p-1 shadow-panel">
          <button type="button" data-testid="token-menu-delete" onClick={onDelete} className={`${actionButtonClass} text-danger`}>
            <Icon name="close" size={13} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function TokenMenu() {
  const selectedId = useTokenInteraction((s) => s.selectedId);
  const select = useTokenInteraction((s) => s.select);
  const draggingId = useTokenInteraction((s) => s.draggingId);
  const openPanel = useShell((s) => s.openPanel);
  const you = useSessionStore((s) => s.you);
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const state = useModuleState<TokensState>('tokens');
  const rootRef = useRef<HTMLDivElement>(null);

  const tokens = tokensOf(state, sceneId);
  const token = tokens.find((t) => t.id === selectedId) ?? null;
  // Hidden mid-drag (the actions would float over a token actively being repositioned) and
  // while the Tokens popover itself is open (its own detail block is the same controls).
  const visible = !!token && draggingId === null && openPanel !== 'tokens';

  // Esc clears the selection — this menu's own answer to the key, independent of the
  // shell's popover/tool order (`hotkeys.ts`), which has no idea a token is selected. A
  // pointerdown that lands on the map but hits nothing also clears it, same as `DoorMenu`;
  // a press that *does* hit a token never reaches here — `drag.ts`'s own handler stops
  // propagation first.
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') select(null);
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (rootRef.current?.contains(target)) return;
      if (target?.closest('[data-testid="game-canvas"]')) select(null);
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [visible, select]);

  // rAF-refreshed while mounted: the camera can pan or zoom on any frame this is open, and
  // `worldToScreen` is a cheap read off the stage — nothing in the store fires for it, so a
  // subscription would miss every camera move. Position is written straight to the DOM node
  // rather than through React state so following the camera never re-renders this tree at
  // 60fps; only the ids/flags above (selection, drag, role) go through hooks.
  useLayoutEffect(() => {
    if (!visible || !token) return;
    let raf = 0;
    const r = (SIZE_CELLS[token.size] ?? 1) / 2;
    const step = () => {
      const el = rootRef.current;
      const mapEl = document.querySelector<HTMLElement>('[data-testid="game-canvas"]');
      const anchor = worldToScreen(token.x + r, token.y);
      if (el && mapEl && anchor) {
        const map = mapEl.getBoundingClientRect();
        const w = el.offsetWidth || FALLBACK_W;
        const h = el.offsetHeight || FALLBACK_H;
        el.style.left = `${Math.min(Math.max(anchor.x + GAP, 0), Math.max(0, map.width - w))}px`;
        el.style.top = `${Math.min(Math.max(anchor.y - h / 2, 0), Math.max(0, map.height - h))}px`;
        el.style.visibility = 'visible';
      } else if (el) {
        // No engine yet (§4) — nothing to anchor to.
        el.style.visibility = 'hidden';
      }
      raf = requestAnimationFrame(step);
    };
    // Called directly, not just scheduled: the first position is set synchronously on
    // mount (and on every selection change), so the card never has one visible frame at
    // the wrong spot before the loop catches up.
    step();
    return () => cancelAnimationFrame(raf);
  }, [visible, token]);

  if (!visible || !token) return null;

  const isDm = you?.role === 'dm';
  const meta = `${token.size} · ${token.disposition}`;

  return (
    <div
      ref={rootRef}
      data-testid="token-menu"
      role="menu"
      aria-label={`${token.name} actions`}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="absolute z-toolbar flex min-w-[180px] flex-col gap-1.5 rounded-md border border-border-structure bg-surface-1 px-2.5 py-2 shadow-panel motion-safe:animate-panel-in"
      style={{ visibility: 'hidden' }}
    >
      <span
        aria-hidden
        className="absolute -left-[6px] top-[14px] h-[10px] w-[10px] rotate-45 border-b border-l border-border-structure bg-surface-1"
      />

      <div className="flex items-center gap-2 text-xs text-text-primary">
        <span className="min-w-0 flex-1 truncate">{token.name}</span>
        <span className="shrink-0 text-[11px] text-text-muted">{meta}</span>
      </div>

      <div className="flex items-center gap-1">
        {isDm ? (
          <>
            <button
              type="button"
              data-testid="token-menu-hide"
              onClick={() => send('hide', { id: token.id, hidden: !token.hidden })}
              className={actionButtonClass}
            >
              <Icon name={token.hidden ? 'reveal' : 'hide'} size={13} />
              {token.hidden ? 'Reveal' : 'Hide'}
            </button>
            <button
              type="button"
              data-testid="token-menu-frame"
              onClick={() => frameWorldPoint(token.x, token.y)}
              className={actionButtonClass}
            >
              <Icon name="frame" size={13} />
              Frame
            </button>
            <MoreMenu
              key={token.id}
              onDelete={() => {
                send('delete', { id: token.id });
                select(null);
              }}
            />
          </>
        ) : (
          token.ownerId === null && (
            <button
              type="button"
              data-testid="token-menu-claim"
              onClick={() => send('claim', { id: token.id })}
              className={actionButtonClass}
            >
              Claim
            </button>
          )
        )}
      </div>
    </div>
  );
}

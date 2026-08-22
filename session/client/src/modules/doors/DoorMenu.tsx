// The on-map fast path (M3 plan §3, "on-map menu"): the same actions the popover's footer
// offers, drawn where the door actually is, so a DM or player never has to open the Doors
// popover to work the one door they just clicked. Same selection `DoorRenderer`'s own
// pointerdown handler already sets — this only ever reads it.

import { useEffect, useLayoutEffect, useRef } from 'react';
import { worldToScreen } from '../../renderer/camera';
import { useShell } from '../../shell/shellStore';
import { doorLabel, visibleDoorChips } from './doors';
import { DoorActions, useLiveDoors } from './DoorPanel';
import { useDoorSelection } from './selection';

/** Screen px between the door's own point and the menu's left edge. */
const GAP = 12;
const FALLBACK_W = 180;
const FALLBACK_H = 76;

export function DoorMenu() {
  const doors = useLiveDoors();
  const selectedId = useDoorSelection((s) => s.selectedId);
  const select = useDoorSelection((s) => s.select);
  const filter = useDoorSelection((s) => s.filter);
  const openPanel = useShell((s) => s.openPanel);

  const index = doors.findIndex((d) => d.door.id === selectedId);
  const selected = index >= 0 ? doors[index] : undefined;
  const rootRef = useRef<HTMLDivElement>(null);

  // Esc, and a click that lands on the map but hits nothing. A click that *does* hit a door
  // never reaches here at all: `DoorRenderer`'s own pointerdown handler stops propagation
  // before it bubbles this far, so the only clicks a document-level listener ever sees are
  // ones that missed every door (or landed on chrome, which the id check below excludes).
  useEffect(() => {
    if (!selected) return;
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
  }, [selected, select]);

  // Re-read the camera every frame the menu is open, written straight to the DOM rather than
  // through `setState` so a moving camera does not cost a React render 60 times a second.
  // ponytail: a plain rAF poll, not a camera-change subscription — there is no such signal
  // to subscribe to yet (the runner's camera is just `stage.position`/`stage.scale`), and a
  // menu is open for a few seconds at most.
  useLayoutEffect(() => {
    if (!selected) return;
    let raf = 0;
    const tick = () => {
      const el = rootRef.current;
      const mapEl = document.querySelector<HTMLElement>('[data-testid="game-canvas"]');
      const screen = worldToScreen(selected.door.position[0], selected.door.position[1]);
      if (el && mapEl && screen) {
        const map = mapEl.getBoundingClientRect();
        const w = el.offsetWidth || FALLBACK_W;
        const h = el.offsetHeight || FALLBACK_H;
        el.style.left = `${Math.min(Math.max(screen.x + GAP, 0), Math.max(0, map.width - w))}px`;
        el.style.top = `${Math.min(Math.max(screen.y - h / 2, 0), Math.max(0, map.height - h))}px`;
        el.style.visibility = 'visible';
      } else if (el) {
        el.style.visibility = 'hidden';
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
    // Keyed on the door's id, not `selected` itself: `selected` is a fresh object every
    // render (it comes off a `.find()` over `useLiveDoors()`), and restarting the rAF loop
    // on every one of those would mean it never gets more than a frame to run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.door.id]);

  if (!selected) return null;

  // The popover already shows the same actions once its own chip for this door is on
  // screen — showing both would be two controls saying the same thing (M3 §Doors).
  const popoverShowsIt =
    openPanel === 'doors' && visibleDoorChips(doors, filter).some((d) => d.door.id === selectedId);
  if (popoverShowsIt) return null;

  return (
    <div
      ref={rootRef}
      data-testid="door-menu"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{ visibility: 'hidden' }}
      className="absolute z-toolbar flex min-w-[180px] flex-col gap-1.5 rounded-md border border-border-structure bg-surface-1 px-2.5 py-2 shadow-panel motion-safe:animate-panel-in"
    >
      <span
        aria-hidden
        className="absolute -left-[6px] top-[14px] h-[10px] w-[10px] rotate-45 border-b border-l border-border-structure bg-surface-1"
      />
      <div className="flex items-baseline gap-2 text-xs">
        <span className="min-w-0 flex-1 truncate text-text-primary">{doorLabel(selected.door, index)}</span>
        <span className="shrink-0 text-text-muted">{selected.live.open ? 'Open' : 'Closed'}</span>
      </div>
      <DoorActions entry={selected} />
    </div>
  );
}

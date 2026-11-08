import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { FloatBox, IconKeyButton, cn } from '@dnd/ui';
import { X } from '@dnd/ui/icons';
import { worldToScreen } from '../renderer/camera';

/** Space between the thing a card is about and the card. */
const GAP = 16;
/** Keep a card this far inside the map's edges. */
const MARGIN = 12;

/**
 * An on-map card (door, light, token): a floating box beside a world point, following the
 * camera every frame. `at` is read each frame, so a point that moves (a light mid-drag)
 * carries its card with it. Esc closes it through the shell's ladder (it is a selection).
 */
export function MapCard({
  at,
  title,
  onClose,
  children,
  testId,
  className,
}: {
  at: () => { x: number; y: number } | null;
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const read = useRef(at);
  useLayoutEffect(() => {
    read.current = at;
  });

  // A press on the map away from the card puts it down; a press on another door or light
  // selects that one straight after (their own handlers run later than this capture).
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });
  useLayoutEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-testid="game-canvas"]')) close.current();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  useLayoutEffect(() => {
    let raf = 0;
    const tick = (): void => {
      const el = ref.current;
      const mapEl = document.querySelector<HTMLElement>('[data-testid="game-canvas"]');
      const world = read.current();
      const screen = world ? worldToScreen(world.x, world.y) : null;
      if (el && mapEl && screen) {
        const map = mapEl.getBoundingClientRect();
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        let left = map.left + screen.x + GAP;
        if (left + w > map.right - MARGIN) left = map.left + screen.x - GAP - w;
        const top = Math.min(Math.max(map.top + screen.y - h / 2, map.top + MARGIN), map.bottom - MARGIN - h);
        el.style.left = `${Math.max(map.left + MARGIN, left)}px`;
        el.style.top = `${top}px`;
        el.style.visibility = 'visible';
      } else if (el) {
        el.style.visibility = 'hidden';
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <FloatBox
      ref={ref}
      data-testid={testId}
      data-chrome
      role="dialog"
      aria-label={title}
      style={{ visibility: 'hidden' }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className={cn('fixed z-30 flex w-60 flex-col gap-2 p-2.5', className)}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text">{title}</span>
        <IconKeyButton size={26} icon={X} label={`Close ${title}`} onClick={onClose} />
      </div>
      {children}
    </FloatBox>
  );
}

// The crossing chips over the map (plan §7): where a token went over a cliff or a slope, the
// kind the table plays it as and the DM's note, for four seconds. Placed on the
// world point each frame, written straight to the DOM like `DoorMenu`, so a panning camera
// does not cost a React render a frame.

import { useLayoutEffect, useRef } from 'react';
import { worldToScreen } from '../../renderer/camera';
import { useCrossingChips } from './chips';

export function CrossingChips() {
  const chips = useCrossingChips((s) => s.chips);
  const refs = useRef(new Map<number, HTMLDivElement>());

  useLayoutEffect(() => {
    if (chips.length === 0) return;
    let raf = 0;
    const tick = () => {
      const map = document.querySelector<HTMLElement>('[data-testid="game-canvas"]')?.getBoundingClientRect();
      for (const chip of chips) {
        const el = refs.current.get(chip.id);
        const at = worldToScreen(chip.x, chip.y);
        if (!el) continue;
        if (!at || !map) {
          el.style.visibility = 'hidden';
          continue;
        }
        el.style.left = `${map.left + at.x}px`;
        el.style.top = `${map.top + at.y}px`;
        el.style.visibility = 'visible';
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [chips]);

  if (chips.length === 0) return null;
  return (
    <>
      {chips.map((chip) => (
        <div
          key={chip.id}
          ref={(el) => {
            if (el) refs.current.set(chip.id, el);
            else refs.current.delete(chip.id);
          }}
          role="status"
          data-testid="crossing-chip"
          data-refused={chip.refused || undefined}
          style={{ visibility: 'hidden', transform: 'translate(-50%, calc(-100% - 10px))' }}
          className={`pointer-events-none fixed z-toolbar max-w-[220px] rounded-md border px-2 py-1 text-xs shadow-panel motion-safe:animate-panel-in ${
            chip.refused ? 'border-danger bg-surface-1 text-text-primary' : 'border-border-structure bg-surface-1 text-text-primary'
          }`}
        >
          <div className="font-medium">{chip.title}</div>
          {chip.note && <div className="text-text-secondary">{chip.note}</div>}
        </div>
      ))}
    </>
  );
}

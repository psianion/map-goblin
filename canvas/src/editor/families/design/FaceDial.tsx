// The slope's direction dial: a ring with a pointer at the way the slope faces point (0 right,
// 90 down), turned by dragging round it in 15-degree steps or by the arrow keys, its angle
// written beside it. A drag lands as one change when it lets go. Read-only, it only shows the
// direction (a plateau following the map's).

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@dnd/ui';
import { FACE_DIRECTION_STEP, wrapDirection } from '@dnd/core/src/shared/plateauShade';
import { directionAt, directionWords } from './plateauModel';

/** The dial, px: its box, the ring's radius, and the pointer's tip. */
const SIZE = 36;
const RING = 15;
const TIP = 3;

interface FaceDialProps {
  /** What the dial sets, for a reader that sees no caption. */
  label: string;
  value: number;
  onChange?: (deg: number) => void;
  readOnly?: boolean;
}

export function FaceDial({ label, value, onChange, readOnly = false }: FaceDialProps) {
  /** Where a drag has the pointer now; null while none is under way. */
  const [live, setLive] = useState<number | null>(null);
  const drag = useRef<number | null>(null);
  const shown = live ?? value;

  const aim = (e: PointerEvent<HTMLDivElement>): number => {
    const box = e.currentTarget.getBoundingClientRect();
    return directionAt(e.clientX - box.left - box.width / 2, e.clientY - box.top - box.height / 2);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (readOnly || e.button !== 0) return;
    e.preventDefault();
    drag.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.focus();
    setLive(aim(e));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current === e.pointerId) setLive(aim(e));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current !== e.pointerId) return;
    const next = aim(e);
    drag.current = null;
    setLive(null);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (next !== value) onChange?.(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    onChange?.(wrapDirection(value + step * FACE_DIRECTION_STEP));
  };

  const a = (shown * Math.PI) / 180;
  const c = SIZE / 2;
  const tip = [c + Math.cos(a) * (RING - TIP - 1), c + Math.sin(a) * (RING - TIP - 1)];
  const words = directionWords(shown);
  return (
    <span className="flex items-center gap-2">
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={360 - FACE_DIRECTION_STEP}
        aria-valuenow={shown}
        aria-valuetext={`${shown} degrees, ${words}`}
        aria-readonly={readOnly || undefined}
        title={readOnly ? `${label}: ${words}` : `${label}: drag to turn, arrow keys step ${FACE_DIRECTION_STEP}°`}
        data-composite="face-dial"
        data-value={shown}
        className={cn(
          'relative shrink-0 rounded-full outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
          readOnly ? 'cursor-default opacity-60' : 'cursor-grab touch-none active:cursor-grabbing',
        )}
        style={{ width: SIZE, height: SIZE }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <svg aria-hidden width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="block">
          <circle cx={c} cy={c} r={RING} className="fill-panel stroke-line-strong" strokeWidth={1} />
          {[0, 90, 180, 270].map((d) => {
            const t = (d * Math.PI) / 180;
            return (
              <line
                key={d}
                x1={c + Math.cos(t) * (RING - 2.5)}
                y1={c + Math.sin(t) * (RING - 2.5)}
                x2={c + Math.cos(t) * RING}
                y2={c + Math.sin(t) * RING}
                className="stroke-line-strong"
                strokeWidth={1}
              />
            );
          })}
          <line x1={c} y1={c} x2={tip[0]} y2={tip[1]} className="stroke-text" strokeWidth={1.5} strokeLinecap="round" />
          <circle cx={tip[0]} cy={tip[1]} r={TIP} className="fill-text" />
          <circle cx={c} cy={c} r={1.5} className="fill-text-3" />
        </svg>
      </div>
      <span className="w-9 font-mono text-[11px] tabular-nums text-text-3">{shown}°</span>
    </span>
  );
}

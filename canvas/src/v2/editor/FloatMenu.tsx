import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/* A small menu for the rooms UI: the level picker's, an area header's, a sheet row's
 * right-click. Portalled to the page and placed against its anchor (or the pointer), so no
 * sheet or dock clips it. Closes on Escape, a press outside it, or a pick. */

export type FloatMenuEntry =
  | {
      label: string;
      onSelect: () => void;
      /** A radio row: the mark column shows a check when true. */
      checked?: boolean;
      /** An icon in the mark column (the Align menu's edges). */
      icon?: ReactNode;
      /** Quiet text at the row's end ("2 layers"). */
      meta?: string;
      disabled?: boolean;
      testId?: string;
    }
  | 'divider';

const MARGIN = 8;

export function FloatMenu({
  open,
  onClose,
  label,
  entries,
  anchor,
  at,
  placement = 'below',
  width = 232,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  entries: FloatMenuEntry[];
  /** The element the menu opens against. */
  anchor?: RefObject<HTMLElement | null>;
  /** A viewport point to open at instead (a right-click). */
  at?: { x: number; y: number } | null;
  placement?: 'above' | 'below';
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const radios = entries.some((e) => e !== 'divider' && e.checked !== undefined);
  const icons = entries.some((e) => e !== 'divider' && e.icon !== undefined);

  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = at?.x ?? 0;
    let top = at?.y ?? 0;
    const box = anchor?.current?.getBoundingClientRect();
    if (box && !at) {
      left = box.left;
      top = placement === 'above' ? box.top - h - MARGIN : box.bottom + 4;
    }
    left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN));
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [open, anchor, at, placement, width, entries.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className="v2-fmenu v2-float"
      role="menu"
      aria-label={label}
      style={{ width }}
      data-chrome
      data-anchored-pop
    >
      {entries.map((entry, i) =>
        entry === 'divider' ? (
          <div key={`d${i}`} className="v2-fmenu__sep" role="separator" />
        ) : (
          <button
            key={`${entry.label}${i}`}
            type="button"
            className="v2-fmenu__item"
            role={entry.checked !== undefined ? 'menuitemradio' : 'menuitem'}
            aria-checked={entry.checked}
            disabled={entry.disabled}
            data-testid={entry.testId}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
          >
            {radios && (
              <span className="v2-fmenu__mark">{entry.checked && <Check size={12} strokeWidth={2.5} />}</span>
            )}
            {icons && !radios && <span className="v2-fmenu__mark">{entry.icon}</span>}
            <span className={cn('v2-fmenu__label')}>{entry.label}</span>
            {entry.meta && <span className="v2-fmenu__meta">{entry.meta}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

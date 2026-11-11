import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button, FloatBox } from '@dnd/ui';
import { useFrozen } from './pause';
import { leaveTable } from './top/sessionActions';

/**
 * A player's seat while the DM has paused the table: one layer over the whole page that greys
 * what is under it (menus and sheets open in their own portals included) and takes every
 * pointer, wheel and touch, with the one way out, Leave table. Everything else on the page is
 * `inert` until the DM resumes, so neither a click nor a Tab reaches it. Lifts on its own the
 * moment the slice says unpaused.
 */
export function PauseOverlay() {
  const frozen = useFrozen();
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const own = layer.current;
    if (!frozen || !own) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    const held = Array.from(document.body.children).filter((el) => el !== own && !el.hasAttribute('inert'));
    for (const el of held) el.setAttribute('inert', '');
    return () => {
      for (const el of held) el.removeAttribute('inert');
    };
  }, [frozen]);

  if (!frozen) return null;
  return createPortal(
    <div
      ref={layer}
      className="fixed inset-0 z-[2147483000] grid place-items-center p-4 backdrop-grayscale"
      data-testid="pause-overlay"
    >
      <FloatBox className="flex w-80 max-w-full flex-col items-start gap-3 p-5" role="status" aria-live="assertive" data-testid="pause-card">
        <h2 className="text-base font-medium text-text">The DM has paused the table</h2>
        <Button variant="outline" size="sm" autoFocus onClick={leaveTable} data-testid="pause-leave">
          Leave table
        </Button>
      </FloatBox>
    </div>,
    document.body,
  );
}

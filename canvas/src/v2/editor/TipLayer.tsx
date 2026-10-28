import { useEffect, useState } from 'react';

interface TipState {
  label: string;
  keys?: string;
  x: number;
  y: number;
  side: 'top' | 'right' | 'bottom';
}

const DELAY_MS = 350;
/** Moving between neighbours shows the next label at once, like a toolbar should. */
const WARM_MS = 600;

/**
 * One tooltip for the whole shell. Anything inside the shell with `data-tip` gets one
 * (`data-tip-key` adds a shortcut, `data-tip-side` picks right or bottom over top). It
 * floats in its own fixed layer, so a scrolling strip can never clip it.
 */
export function TipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);

  useEffect(() => {
    let timer = 0;
    let current: HTMLElement | null = null;
    let lastHidden = 0;

    const place = (el: HTMLElement) => {
      const label = el.dataset.tip;
      if (!label) return;
      const r = el.getBoundingClientRect();
      const side = (el.dataset.tipSide as TipState['side'] | undefined) ?? 'top';
      const x = side === 'right' ? r.right + 8 : r.left + r.width / 2;
      const y = side === 'right' ? r.top + r.height / 2 : side === 'bottom' ? r.bottom + 8 : r.top - 8;
      setTip({ label, keys: el.dataset.tipKey, x, y, side });
    };

    const hide = () => {
      window.clearTimeout(timer);
      if (current) lastHidden = performance.now();
      current = null;
      setTip(null);
    };

    const enter = (target: EventTarget | null) => {
      const el = (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-tip]') ?? null;
      if (el === current) return;
      window.clearTimeout(timer);
      if (!el || !el.closest('.v2-editor')) {
        hide();
        return;
      }
      const warm = current !== null || performance.now() - lastHidden < WARM_MS;
      current = el;
      setTip(null);
      timer = window.setTimeout(() => place(el), warm ? 0 : DELAY_MS);
    };

    const onOver = (e: PointerEvent) => enter(e.target);
    const onFocus = (e: FocusEvent) => {
      if ((e.target as HTMLElement).matches?.(':focus-visible')) enter(e.target);
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  if (!tip) return null;
  const transform =
    tip.side === 'right' ? 'translateY(-50%)' : tip.side === 'bottom' ? 'translateX(-50%)' : 'translate(-50%, -100%)';
  return (
    <div className="v2-tipbox" role="tooltip" style={{ left: tip.x, top: tip.y, transform }}>
      {tip.label}
      {tip.keys && <kbd>{tip.keys}</kbd>}
    </div>
  );
}

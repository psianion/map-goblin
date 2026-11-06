import { useEffect, useRef, useState } from 'react';
import { FloatBox } from '@/editor/components';
import { useStore } from '@/store/store';
import { selectChildById } from '@/store/selectors';
import type { AnyChild } from '@/store/types';
import { unionChildBounds } from '@dnd/core/src/engine/hitTest';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { VerbButton } from './Card';
import { liveVerbs } from './model';
import { useCardTarget } from './hooks';
import { useRegistry } from '@/editor/shell/registryContext';

/** Space between the bar and the top of what is picked. */
const GAP = 8;
const EDGE = 12;

/** Where the selection's top centre is on screen, or null while there is nothing to place by. */
function selectionAnchor(): { x: number; y: number } | null {
  const s = useStore.getState();
  const children = s.selection.selectedIds.map((id) => selectChildById(s, id)).filter((c): c is AnyChild => c !== undefined);
  const engine = getEngineSingleton()?.engine;
  if (children.length === 0 || !engine) return null;
  const b = unionChildBounds(children);
  if (!b) return null;
  const tl = engine.worldToScreen(b.x, b.y);
  const br = engine.worldToScreen(b.x + b.width, b.y + b.height);
  return { x: (tl.x + br.x) / 2, y: Math.min(tl.y, br.y) };
}

/**
 * The card's verbs again, on a small bar just above what is picked, for the quick ones.
 * Shown while the card is; verbs marked `bar: false` stay on the card only.
 */
export function FloatingActions() {
  const target = useCardTarget();
  const { registry } = useRegistry();
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const railTool = useStore((s) => !registry.familyOfTool(registry.tools.find((t) => t.engine.includes(s.tools.activeTool))?.id ?? ''));

  useEffect(() => {
    if (!target) return;
    let raf = 0;
    const tick = () => {
      const a = selectionAnchor();
      const el = ref.current;
      if (a && el) {
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const left = Math.round(Math.max(EDGE, Math.min(a.x - w / 2, window.innerWidth - w - EDGE)));
        const top = Math.round(Math.max(EDGE, a.y - GAP - h));
        setAt((p) => (p && p.left === left && p.top === top ? p : { left, top }));
      } else setAt((p) => (p === null ? p : null));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  if (!target || !railTool) return null;
  const verbs = liveVerbs(target.card.verbs).filter((v) => v.bar !== false);
  if (verbs.length === 0) return null;
  return (
    <FloatBox
      ref={ref}
      className="absolute flex gap-[2px] p-1"
      style={at ? { left: at.left, top: at.top } : { visibility: 'hidden', left: 0, top: 0 }}
      data-testid="shell-floating-actions"
      data-chrome
      role="toolbar"
      aria-label="Selection actions"
    >
      {verbs.map((v) => (
        <VerbButton key={v.id} verb={v} />
      ))}
    </FloatBox>
  );
}

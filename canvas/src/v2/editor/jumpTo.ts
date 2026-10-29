import { getEngineSingleton } from '@/engine/engineSingleton';
import { cancelZoomAnimationRef, viewportInsetsRef } from '@/components/toolbar/zoomToFitRef';
import { centreStageOn } from './prepModel';

/** Air between the jump target and the sheet beside it. */
const SHEET_GAP = 16;
const DURATION_MS = 150;

let jumpRaf = 0;

/**
 * Centre the camera on a world point, zoom kept, in what the shell leaves free: the
 * measured v2 insets, plus the sheet the list sits in when it covers more of the right.
 * Eased over a few frames unless the DM asked for reduced motion.
 */
export function jumpToPoint(point: { x: number; y: number }, sheet: Element | null): void {
  const singleton = getEngineSingleton();
  if (!singleton) return;
  const stage = singleton.engine.stage();
  const vp = singleton.engine.viewport();
  const insets = viewportInsetsRef.current;
  const sheetCover = sheet ? Math.max(0, window.innerWidth - sheet.getBoundingClientRect().left + SHEET_GAP) : 0;
  const target = centreStageOn(point, stage.scale.x, {
    left: insets.left,
    top: insets.top ?? 0,
    right: vp.width - Math.max(insets.right, sheetCover),
    bottom: vp.height - insets.bottom,
  });

  cancelZoomAnimationRef.current?.();
  cancelAnimationFrame(jumpRaf);
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    stage.position.set(target.x, target.y);
    return;
  }
  const startX = stage.position.x;
  const startY = stage.position.y;
  const startTime = performance.now();
  const tick = () => {
    const t = Math.min((performance.now() - startTime) / DURATION_MS, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    stage.position.x = startX + (target.x - startX) * ease;
    stage.position.y = startY + (target.y - startY) * ease;
    jumpRaf = t < 1 ? requestAnimationFrame(tick) : 0;
  };
  jumpRaf = requestAnimationFrame(tick);
}

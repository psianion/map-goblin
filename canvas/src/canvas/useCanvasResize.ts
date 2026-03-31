import { useEffect, type RefObject } from 'react';
import type { RenderEngine } from '../engine/RenderEngine';

export function useCanvasResize(
  containerRef: RefObject<HTMLDivElement | null>,
  engine: RenderEngine | null,
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !engine) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        engine.resize(width, height);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, engine]);
}

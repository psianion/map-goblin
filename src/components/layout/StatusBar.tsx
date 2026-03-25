import { useEffect, useRef, useState } from 'react';
import { cursorWorldPosition } from '@/canvas/cursorPosition';
import { fpsMetrics } from '@/engine/fpsMetrics';
import { ZoomSlider } from '@/components/toolbar/ZoomSlider';

interface StatusBarProps {
  leftPanelOpen?: boolean;
  rightPanelOpen: boolean;
  faded: boolean;
}

/** Color class for FPS value based on threshold (achromatic brightness). */
function fpsColorClass(fps: number): string {
  if (fps >= 50) return 'text-text-primary';
  if (fps >= 30) return 'text-text-secondary';
  return 'text-text-muted';
}

export function StatusBar({ leftPanelOpen, rightPanelOpen, faded }: StatusBarProps) {
  const [cursorX, setCursorX] = useState<string>('—');
  const [cursorY, setCursorY] = useState<string>('—');
  const [fpsStr, setFpsStr] = useState<string>('—');
  const [ftStr, setFtStr] = useState<string>('—');
  const [fpsColor, setFpsColor] = useState<string>('text-text-muted');
  const rafRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);

  useEffect(() => {
    const tick = () => {
      // --- Cursor position (every frame) ---
      const pos = cursorWorldPosition.current;
      if (pos) {
        const xStr = pos.x.toFixed(1);
        const yStr = pos.y.toFixed(1);
        setCursorX((prev) => (prev !== xStr ? xStr : prev));
        setCursorY((prev) => (prev !== yStr ? yStr : prev));
      } else {
        setCursorX((prev) => (prev !== '—' ? '—' : prev));
        setCursorY((prev) => (prev !== '—' ? '—' : prev));
      }

      // --- FPS metrics (throttled: every 15th frame ≈ 250ms at 60fps) ---
      frameCountRef.current++;
      if (frameCountRef.current % 15 === 0) {
        const metrics = fpsMetrics.current;
        if (metrics) {
          const nextFps = Math.round(metrics.fps).toString();
          const nextFt = metrics.frameTime.toFixed(1);
          const nextColor = fpsColorClass(metrics.fps);
          setFpsStr((prev) => (prev !== nextFps ? nextFps : prev));
          setFtStr((prev) => (prev !== nextFt ? nextFt : prev));
          setFpsColor((prev) => (prev !== nextColor ? nextColor : prev));
        } else {
          setFpsStr((prev) => (prev !== '—' ? '—' : prev));
          setFtStr((prev) => (prev !== '—' ? '—' : prev));
          setFpsColor((prev) => (prev !== 'text-text-muted' ? 'text-text-muted' : prev));
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div
      data-chrome
      className="absolute bottom-0 z-20 h-7 flex items-center justify-between px-3 bg-surface-1/80 backdrop-blur-sm border-t border-border-subtle font-mono text-xs text-text-muted"
      style={{
        left: leftPanelOpen ? '308px' : '48px',
        right: rightPanelOpen ? '300px' : '48px',
        opacity: faded ? 0.4 : 1,
        transition: 'left 200ms ease-out, right 200ms ease-out, opacity 200ms ease',
      }}
    >
      {/* Left: Cursor position + FPS metrics */}
      <div className="flex items-center gap-3 tabular-nums">
        <span>X: {cursorX}</span>
        <span>Y: {cursorY}</span>
        <span className="text-text-muted">&middot;</span>
        <span className={fpsColor}>{fpsStr} FPS</span>
        <span className="text-text-muted">&middot;</span>
        <span className="text-text-muted">{ftStr}ms</span>
      </div>

      {/* Middle: Reserved for future metadata */}
      <div className="flex-1" />

      {/* Right: Zoom controls */}
      <ZoomSlider />
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { cursorWorldPosition } from '@/canvas/cursorPosition';
import { ZoomSlider } from '@/components/toolbar/ZoomSlider';

interface StatusBarProps {
  rightPanelOpen: boolean;
  faded: boolean;
}

export function StatusBar({ rightPanelOpen, faded }: StatusBarProps) {
  const [cursorX, setCursorX] = useState<string>('—');
  const [cursorY, setCursorY] = useState<string>('—');
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const tick = () => {
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
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div
      data-chrome
      className="absolute bottom-0 left-[48px] z-20 h-7 flex items-center justify-between px-3 bg-surface-1/80 backdrop-blur-sm border-t border-border-subtle font-mono text-xs text-text-muted"
      style={{
        right: rightPanelOpen ? '300px' : '48px',
        opacity: faded ? 0.4 : 1,
        transition: 'right 200ms ease-out, opacity 200ms ease',
      }}
    >
      {/* Left: Cursor position */}
      <div className="flex items-center gap-3 tabular-nums">
        <span>X: {cursorX}</span>
        <span>Y: {cursorY}</span>
      </div>

      {/* Middle: Reserved for future metadata */}
      <div className="flex-1" />

      {/* Right: Zoom controls */}
      <ZoomSlider />
    </div>
  );
}

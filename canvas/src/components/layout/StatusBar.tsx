import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cursorWorldPosition } from '@/canvas/cursorPosition';
import { fpsMetrics } from '@/engine/fpsMetrics';
import { rulerMeasurement } from '@/engine/rulerMeasurement';
import { useStore } from '@/store/store';
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
  const [rulerStr, setRulerStr] = useState<string>('');
  const cellScale = useStore((s) => s.mapSettings.cellScale);
  const nodeEditWallId = useStore((s) => s.tools.nodeEditWallId);
  const shapeNodeEditId = useStore((s) => s.tools.shapeNodeEditId);
  const wallNodeSelected = useStore((s) => s.tools.selectedNodeT !== null || s.tools.selectedNodeTs.length > 0);
  const soloLayerId = useStore((s) => s.ui.solo?.layerId ?? null);
  // Falls back to a placeholder rather than the raw (possibly empty) name:
  // an empty-named soloed layer must still render the chip, or solo has no
  // exit affordance in the status bar.
  const soloLayerName = useStore((s) => {
    const layer = s.layers.find((l) => l.id === s.ui.solo?.layerId);
    return layer ? layer.name || 'Unnamed layer' : null;
  });
  const rafRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  // Read inside the frame loop without making it a dependency, so the loop is
  // installed once rather than restarting whenever the map scale changes.
  const cellScaleRef = useRef(cellScale);
  useEffect(() => {
    cellScaleRef.current = cellScale;
  }, [cellScale]);

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

      // --- Ruler reading (every frame; empty unless a measurement is live) ---
      {
        const m = rulerMeasurement.current;
        const { value, unit } = cellScaleRef.current;
        const next = m
          ? `${(m.cells * value).toFixed(1)}${unit} · ${m.cells.toFixed(1)} sq`
          : '';
        setRulerStr((prev) => (prev !== next ? next : prev));
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
        // 0.65, not 0.4: the faded bar composited below 2.1:1, unreadable in
        // exactly the dim rooms the product is built for.
        opacity: faded ? 0.65 : 1,
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

      {/* Middle: one shared slot, most transient first — a live ruler
          reading, then node-edit mode + its key map, then the solo chip.
          The key map is why node editing stopped being a secret: the
          keyboard was always the fast path and nothing said so. */}
      <div className="flex-1 flex justify-center">
        {rulerStr ? (
          <span className="text-text-primary tabular-nums">{rulerStr}</span>
        ) : nodeEditWallId ? (
          <span className="truncate">
            <span className="text-text-primary">Editing wall</span>
            <span className="text-text-muted">
              {wallNodeSelected
                ? ' · [ ] rotate · - + size · , . gap · Tab piece · { } insert · Del remove · Esc done'
                : ' · click a stone · Shift+click groups · double-click elsewhere exits'}
            </span>
          </span>
        ) : shapeNodeEditId ? (
          <span className="truncate">
            <span className="text-text-primary">Editing outline</span>
            <span className="text-text-muted">
              {' · drag corners · alt-drag bends · dbl-click smooths · + adds · Del removes · Esc done'}
            </span>
          </span>
        ) : soloLayerId && soloLayerName ? (
          <button
            type="button"
            onClick={() => useStore.getState().clearSolo()}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-2 border border-border-default text-text-secondary hover:text-text-primary hover:border-border-focus transition-colors"
            title="Exit solo (Esc)"
            aria-label={`Soloing ${soloLayerName} — click to exit solo`}
          >
            <span>
              Soloing <span className="text-accent-active">{soloLayerName}</span>
            </span>
            <X size={10} />
          </button>
        ) : null}
      </div>

      {/* Right: Zoom controls */}
      <ZoomSlider />
    </div>
  );
}

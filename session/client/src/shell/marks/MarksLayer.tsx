import { useEffect, useRef } from 'react';
import { getEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import { useStore } from '@dnd/core/src/store/store';
import { seatColour } from '../seatColour';
import { distanceLabel, useMarks, type LiveMark } from './marks';
import { usePins } from './pins';

function Mark({ mark }: { mark: LiveMark }) {
  const colour = mark.by === 'me' ? 'var(--ink)' : seatColour(mark.by);
  const scale = useStore((s) => s.mapSettings.cellScale);
  const { msg } = mark;
  const line = { stroke: colour, strokeWidth: 2, vectorEffect: 'non-scaling-stroke' as const, fill: 'none' };
  switch (msg.kind) {
    case 'ping':
      return (
        <g data-mark="ping">
          <circle cx={msg.x} cy={msg.y} r={0.5} style={line} />
          <circle cx={msg.x} cy={msg.y} r={0.15} style={{ fill: colour }} />
        </g>
      );
    case 'ruler': {
      const cells = Math.hypot(msg.to.x - msg.from.x, msg.to.y - msg.from.y);
      return (
        <g data-mark="ruler">
          <line x1={msg.from.x} y1={msg.from.y} x2={msg.to.x} y2={msg.to.y} style={{ ...line, strokeDasharray: '6 4' }} />
          <text x={msg.to.x + 0.3} y={msg.to.y - 0.3} fontSize={0.6} style={{ fill: colour }} className="font-mono">
            {distanceLabel(cells, scale)}
          </text>
        </g>
      );
    }
    case 'template':
      return (
        <g data-mark="template">
          <circle cx={msg.origin.x} cy={msg.origin.y} r={msg.size} style={{ ...line, fill: colour, fillOpacity: 0.12 }} />
          <text x={msg.origin.x} y={msg.origin.y} fontSize={0.6} textAnchor="middle" style={{ fill: colour }} className="font-mono">
            {distanceLabel(msg.size, scale)}
          </text>
        </g>
      );
    case 'draw':
      return <polyline data-mark="draw" points={msg.points.map((p) => p.join(',')).join(' ')} style={line} />;
  }
}

/**
 * Pings, rulers, templates, drawings and pins over the map, in world space: one SVG group
 * whose transform follows the camera every frame, so the marks need no re-render to pan.
 */
export function MarksLayer() {
  const group = useRef<SVGGElement>(null);
  const marks = useMarks((s) => s.marks);
  const pins = usePins();

  useEffect(() => {
    let frame = 0;
    let pruned = 0;
    const tick = (now: number): void => {
      const engine = getEngineSingleton()?.engine;
      if (engine && group.current) {
        const stage = engine.stage();
        group.current.setAttribute(
          'transform',
          `translate(${stage.position.x} ${stage.position.y}) scale(${stage.scale.x})`,
        );
      }
      if (now - pruned > 250) {
        pruned = now;
        useMarks.getState().prune(Date.now());
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" data-testid="marks-layer" aria-hidden>
      <g ref={group}>
        {marks.map((m) => (
          <Mark key={m.id} mark={m} />
        ))}
        {pins.map((p) => (
          <g key={p.id} data-mark="pin" data-testid="map-pin" data-dm-only={p.dmOnly || undefined}>
            <circle cx={p.x} cy={p.y} r={0.3} style={{ fill: 'var(--ink)', stroke: 'var(--panel)', strokeWidth: 2, vectorEffect: 'non-scaling-stroke' }} />
            {p.text && (
              <text x={p.x + 0.45} y={p.y + 0.2} fontSize={0.5} style={{ fill: 'var(--ink)' }}>
                {p.text}
              </text>
            )}
          </g>
        ))}
      </g>
    </svg>
  );
}

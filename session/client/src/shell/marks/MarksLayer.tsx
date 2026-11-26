import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { EyeOff, MapPin, Navigation2 } from '@dnd/ui/icons';
import { getEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import { useStore } from '@dnd/core/src/store/store';
import { useSessionStore } from '../../session/store';
import { seatColour } from '../seatColour';
import { rulerCells, shapeWord, smoothPath, templateLabelAt, templateOutline } from './geometry';
import { distanceLabel, leaveMs, useMarks, type LiveMark, type MarkMsg } from './marks';
import { usePins, type Pin } from './pins';
import './marks.css';

type Scale = { value: number; unit: string };

/** Under every coloured line: a soft band of the panel colour, so a line reads on pale floor, dark rock and black fog. */
const casing = (width: number) =>
  ({
    stroke: 'var(--panel)',
    strokeOpacity: 0.85,
    strokeWidth: width,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    vectorEffect: 'non-scaling-stroke',
    fill: 'none',
  }) as const;
const inked = (colour: string, width: number) => ({ ...casing(width), stroke: colour, strokeOpacity: 1 });

/** A pin's text is shown up to this long on the map; the card holds the rest. */
const PIN_TEXT_SHOWN = 40;

/** Children drawn in screen pixels at a world point: the layer's --mk-k undoes the zoom. */
function Fixed({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="mk-fix">{children}</g>
    </g>
  );
}

/**
 * A label on a pill, in screen pixels: --panel fill, --line edge, 20 tall. Its width is set
 * from the text's own measure after it renders, written onto the rect rather than kept in state.
 */
function Pill({ text, x = 0, y = 0, mono, swatch, anchor = 'start' }: { text: string; x?: number; y?: number; mono?: boolean; swatch?: string; anchor?: 'start' | 'middle' }) {
  const rect = useRef<SVGRectElement>(null);
  const label = useRef<SVGTextElement>(null);
  const inset = swatch ? 20 : 8;
  useLayoutEffect(() => {
    let w = 0;
    try {
      w = label.current?.getComputedTextLength() ?? 0;
    } catch {
      /* no layout (tests): the estimate below stands in */
    }
    if (!w) w = text.length * 6.6;
    const width = w + inset + 8;
    const left = anchor === 'middle' ? -width / 2 : 0;
    rect.current?.setAttribute('width', String(width));
    rect.current?.setAttribute('x', String(left));
    label.current?.setAttribute('x', String(left + inset));
    if (swatch) label.current?.previousElementSibling?.setAttribute('cx', String(left + 11));
  }, [text, anchor, inset, swatch]);
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect ref={rect} y={-10} height={20} rx={10} style={{ fill: 'var(--panel)', stroke: 'var(--line)', strokeWidth: 1 }} />
      {swatch && <circle cy={0} r={4} style={{ fill: swatch }} />}
      <text
        ref={label}
        y={0.5}
        dominantBaseline="central"
        fontSize={11}
        fontWeight={500}
        className={mono ? 'font-mono' : 'font-sans'}
        style={{ fill: 'var(--text)' }}
      >
        {text}
      </text>
    </g>
  );
}

/**
 * The fade a mark leaves with: null while it stays, else how long the fade runs. It starts
 * `leaveMs` before the store drops the mark, or straight away (over what is left) when that is past.
 */
function useLeave(expiresAt: number, kind: MarkMsg['kind']): number | null {
  // Keyed on the expiry it was started for: a ruler that moves again gets a later expiry, and
  // with it no fade until its new time comes.
  const [leave, setLeave] = useState<{ at: number; ms: number } | null>(null);
  useEffect(() => {
    if (!Number.isFinite(expiresAt)) return;
    const fade = leaveMs(kind);
    const timer = setTimeout(
      () => setLeave({ at: expiresAt, ms: Math.max(0, Math.min(fade, expiresAt - Date.now())) }),
      Math.max(0, expiresAt - fade - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt, kind]);
  return leave?.at === expiresAt ? leave.ms : null;
}

const Mark = memo(function Mark({ mark, colour, name, scale }: { mark: LiveMark; colour: string; name: string | null; scale: Scale }) {
  const leave = useLeave(mark.expiresAt, mark.msg.kind);
  const { msg } = mark;
  let body: ReactNode;
  switch (msg.kind) {
    case 'ping':
      body = (
        <Fixed x={msg.x} y={msg.y}>
          <circle className="mk-ring" r={10} style={inked(colour, 2)} />
          <circle className="mk-ring mk-ring-late" r={10} style={inked(colour, 2)} />
          <circle className="mk-pop" r={5.5} style={{ fill: colour, stroke: 'var(--panel)', strokeWidth: 2 }} />
          {name && <Pill text={name} x={14} y={-16} swatch={colour} />}
        </Fixed>
      );
      break;
    case 'ruler': {
      const { from, to } = msg;
      body = (
        <>
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} style={casing(6)} />
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} style={inked(colour, 2)} />
          <Fixed x={from.x} y={from.y}>
            <circle r={4} style={{ fill: colour, stroke: 'var(--panel)', strokeWidth: 2 }} />
          </Fixed>
          <Fixed x={to.x} y={to.y}>
            <circle className="mk-pop" r={4.5} style={{ fill: colour, stroke: 'var(--panel)', strokeWidth: 2 }} />
            <Pill text={distanceLabel(rulerCells(from, to), scale)} x={12} y={-16} mono />
          </Fixed>
        </>
      );
      break;
    }
    case 'template': {
      const outline = templateOutline(msg);
      const at = templateLabelAt(msg);
      const shape = (style: object) =>
        outline ? (
          <polygon points={outline.map((p) => `${p.x},${p.y}`).join(' ')} style={style} />
        ) : (
          <circle cx={msg.origin.x} cy={msg.origin.y} r={msg.size} style={style} />
        );
      body = (
        <>
          {shape({ ...casing(4), strokeOpacity: 0.7 })}
          {shape({ ...inked(colour, 1.75), fill: colour, fillOpacity: 0.14 })}
          <Fixed x={msg.origin.x} y={msg.origin.y}>
            <circle r={3} style={{ fill: colour, stroke: 'var(--panel)', strokeWidth: 1.5 }} />
          </Fixed>
          <Fixed x={at.x} y={at.y}>
            <Pill text={`${distanceLabel(msg.size, scale)} ${shapeWord(msg.shape)}`} mono anchor="middle" />
          </Fixed>
        </>
      );
      break;
    }
    case 'draw': {
      const d = smoothPath(msg.points);
      body = (
        <>
          <path d={d} style={casing(6)} />
          <path d={d} style={inked(colour, 3)} />
        </>
      );
      break;
    }
  }
  return (
    <g
      className="mk-mark"
      data-mark={msg.kind}
      data-leaving={leave !== null || undefined}
      style={leave !== null ? ({ '--mk-leave': `${leave}ms` } as CSSProperties) : undefined}
    >
      {body}
    </g>
  );
});

/** A pin: a marker standing on its point, its text on a pill, a small badge when only the DM sees it. */
function PinMark({ pin }: { pin: Pin }) {
  const text = pin.text.length > PIN_TEXT_SHOWN ? `${pin.text.slice(0, PIN_TEXT_SHOWN - 1).trimEnd()}…` : pin.text;
  return (
    <g data-mark="pin" data-testid="map-pin" data-dm-only={pin.dmOnly || undefined} className="mk-mark">
      <Fixed x={pin.x} y={pin.y}>
        <g className="mk-drop">
          <MapPin x={-14} y={-27} width={28} height={28} strokeWidth={2} style={{ fill: 'var(--ink)', stroke: 'var(--panel)' }} />
          {pin.dmOnly && (
            <g transform="translate(10 -25)" data-testid="map-pin-hidden">
              <circle r={7.5} style={{ fill: 'var(--panel)', stroke: 'var(--line-strong)', strokeWidth: 1 }} />
              <EyeOff x={-4.5} y={-4.5} width={9} height={9} strokeWidth={2.5} style={{ stroke: 'var(--text-2)', fill: 'none' }} />
            </g>
          )}
          {text && <Pill text={text} x={16} y={-16} />}
        </g>
      </Fixed>
    </g>
  );
}

/** Screen-edge arrows, one per ping; the frame loop shows and aims the ones whose ping is off screen. */
function EdgeArrow({ mark, colour }: { mark: LiveMark; colour: string }) {
  if (mark.msg.kind !== 'ping') return null;
  return (
    <g className="mk-edge" data-edge={mark.id} data-x={mark.msg.x} data-y={mark.msg.y} style={{ opacity: 0 }}>
      <circle r={13} style={{ fill: 'var(--panel)', stroke: 'var(--line-strong)', strokeWidth: 1 }} />
      <g>
        <Navigation2 x={-7} y={-7.5} width={14} height={14} strokeWidth={2} style={{ fill: colour, stroke: colour }} />
      </g>
    </g>
  );
}

/** How far in from the screen's edge an off-screen ping's arrow sits. */
const EDGE_INSET = 28;

/** Show, place and aim each edge arrow for the camera as it is this frame. DOM only. */
function placeEdges(arrows: HTMLCollection, w: number, h: number, s: number, px: number, py: number): void {
  const cx = w / 2;
  const cy = h / 2;
  for (const el of Array.from(arrows) as SVGGElement[]) {
    const x = Number(el.dataset.x) * s + px;
    const y = Number(el.dataset.y) * s + py;
    if (x >= 0 && x <= w && y >= 0 && y <= h) {
      el.style.opacity = '0';
      continue;
    }
    const dx = x - cx;
    const dy = y - cy;
    const t = Math.min((cx - EDGE_INSET) / Math.max(Math.abs(dx), 1e-6), (cy - EDGE_INSET) / Math.max(Math.abs(dy), 1e-6));
    el.setAttribute('transform', `translate(${cx + dx * t} ${cy + dy * t})`);
    el.lastElementChild?.setAttribute('transform', `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI + 90})`);
    el.style.opacity = '1';
  }
}

/**
 * Pings, rulers, templates, drawings and pins over the map. Geometry is in world space, in one
 * SVG group whose transform follows the camera every frame; glyphs and labels are counter-scaled
 * by a CSS variable the same loop writes. A camera move touches the DOM only, never React.
 */
export function MarksLayer() {
  const svg = useRef<SVGSVGElement>(null);
  const group = useRef<SVGGElement>(null);
  const edges = useRef<SVGGElement>(null);
  const all = useMarks((s) => s.marks);
  const pins = usePins();
  const scene = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const players = useSessionStore((s) => s.session?.players);
  const me = useSessionStore((s) => s.you?.identityId);
  const scale = useStore((s) => s.mapSettings.cellScale);
  const marks = all.filter((m) => m.sceneId === null || scene === null || m.sceneId === scene);

  useEffect(() => {
    let frame = 0;
    let pruned = 0;
    let zoom = NaN;
    const tick = (now: number): void => {
      const engine = getEngineSingleton()?.engine;
      if (engine && svg.current && group.current) {
        const arrows = edges.current?.children;
        // Reads before writes, so the size costs no forced layout.
        const w = arrows?.length ? svg.current.clientWidth : 0;
        const h = arrows?.length ? svg.current.clientHeight : 0;
        const stage = engine.stage();
        const s = stage.scale.x;
        group.current.setAttribute('transform', `translate(${stage.position.x} ${stage.position.y}) scale(${s})`);
        if (s !== zoom) {
          zoom = s;
          svg.current.style.setProperty('--mk-k', String(1 / s));
        }
        if (arrows && w > 0 && h > 0) placeEdges(arrows, w, h, s, stage.position.x, stage.position.y);
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

  const colourOf = (m: LiveMark): string => (m.by === 'me' || m.by === me ? 'var(--ink)' : seatColour(m.by));
  const nameOf = (m: LiveMark): string | null =>
    m.by === 'me' || m.by === me ? null : (players?.find((p) => p.identityId === m.by)?.name ?? null);

  return (
    <svg ref={svg} className="pointer-events-none absolute inset-0 h-full w-full overflow-hidden" data-testid="marks-layer" aria-hidden>
      <g ref={group}>
        {marks.map((m) => (
          <Mark key={m.id} mark={m} colour={colourOf(m)} name={m.msg.kind === 'ping' ? nameOf(m) : null} scale={scale} />
        ))}
        {pins.map((p) => (
          <PinMark key={p.id} pin={p} />
        ))}
      </g>
      <g ref={edges}>
        {marks.map((m) => (
          <EdgeArrow key={m.id} mark={m} colour={colourOf(m)} />
        ))}
      </g>
    </svg>
  );
}

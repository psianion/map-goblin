import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import { getEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import { mountWhenEngineReady } from '../../renderer/overlayLayer';
import { useSessionStore } from '../../session/store';
import { useActiveTool, type ToolId } from '../../session/tools';
import { addStrokePoint, cellCentre, cornerOrCentre, templateFromDrag } from './geometry';
import {
  MARK_TTL_MS,
  clearTemplate,
  holdMark,
  placeMark,
  sendMark,
  templateAt,
  useMarks,
  useTemplateShape,
  type MarkMsg,
  type Pt,
} from './marks';
import { useTableShell } from '../tableShell';
import { addPin, pinAt, pinsNow } from './pins';

/** The rail's mark tools. Any other tool (fog, the party start) is not this file's. */
const MARK_TOOLS = ['ping', 'measure', 'template', 'draw', 'pin'] as const satisfies readonly ToolId[];
type MarkTool = (typeof MARK_TOOLS)[number];

/** Least gap between two sends of a mark still being dragged, so a ruler is not a firehose. */
const SEND_EVERY_MS = 80;
/** A held ruler is sent again this often, so it does not fade at other seats while it stands still. */
const KEEP_ALIVE_MS = 1000;
/** How far, in screen pixels, the pointer moves before a stroke takes another point. */
const STROKE_GAP_PX = 3;
/** How long a touch has to stay down to ping, and how far it may wander. */
export const LONG_PRESS_MS = 500;
const PRESS_SLOP_PX = 8;

const armedMarkTool = (): MarkTool | null => {
  const tool = useActiveTool.getState().activeTool;
  return MARK_TOOLS.find((t) => t === tool) ?? null;
};

function worldAt(engine: RenderEngine, e: PointerEvent): Pt {
  const rect = engine.canvas().getBoundingClientRect();
  return engine.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
}

interface Drag {
  tool: MarkTool;
  /** Where the press landed, unsnapped: a ruler re-snaps it as Alt comes and goes. */
  start: Pt;
  id: string;
  msg: MarkMsg;
  sent: MarkMsg | null;
  sentAt: number;
  trail?: ReturnType<typeof setTimeout>;
  alive?: ReturnType<typeof setInterval>;
  stroke?: { points: [number, number][]; gap: number };
}

/**
 * The rail's mark tools on the map: Ping (click; Shift+Alt+click by the DM pulls every
 * camera), Measure (drag between cell centres, Alt for a free line, fades after release),
 * Template (drag the picked shape), Draw (freehand), Pin (click). Esc or a right-click
 * calls a drag off. Document capture, like the fog tool, so an armed tool's press is never a
 * pan or a token grab.
 */
export function attachMarkInput(engine: RenderEngine): () => void {
  let drag: Drag | null = null;
  // A right-click that called a drag off must not also open the browser's menu.
  let swallowMenu = false;
  // A long press on a touch screen pings, with no tool in hand (board 8): held still for
  // LONG_PRESS_MS. A drag on the way is a pan, and calls it off.
  let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
  const cancelPress = (): void => {
    if (press) clearTimeout(press.timer);
    press = null;
  };

  const worldPx = (px: number): number => {
    const a = engine.screenToWorld(0, 0);
    const b = engine.screenToWorld(px, 0);
    return Math.hypot(b.x - a.x, b.y - a.y);
  };

  const send = (d: Drag): void => {
    clearTimeout(d.trail);
    d.trail = undefined;
    d.sentAt = Date.now();
    d.sent = d.msg;
    sendMark(d.msg);
  };

  const end = (d: Drag): void => {
    clearTimeout(d.trail);
    clearInterval(d.alive);
    drag = null;
  };

  /** Esc or right-click mid-drag: the mark leaves and nothing more is sent. */
  const cancel = (): void => {
    if (!drag) return;
    const { id } = drag;
    end(drag);
    useMarks.getState().drop(id);
  };

  const msgFor = (d: Drag, at: Pt, free: boolean): MarkMsg => {
    if (d.tool === 'measure') {
      return free ? { kind: 'ruler', from: d.start, to: at } : { kind: 'ruler', from: cellCentre(d.start), to: cellCentre(at) };
    }
    if (d.tool === 'template' && d.msg.kind === 'template') return templateFromDrag(d.msg.shape, d.msg.origin, at);
    return { kind: 'draw', points: [...d.stroke!.points], ttl: MARK_TTL_MS.draw };
  };

  const onDown = (e: PointerEvent): void => {
    if (drag && e.button !== 0) {
      e.stopPropagation();
      e.preventDefault();
      swallowMenu = true;
      cancel();
      return;
    }
    if (e.button !== 0 || e.target !== engine.canvas()) return;
    const tool = armedMarkTool();
    if (!tool) {
      if (e.pointerType !== 'touch' || useActiveTool.getState().activeTool !== null) return;
      cancelPress();
      const at = worldAt(engine, e);
      press = { x: e.clientX, y: e.clientY, timer: setTimeout(() => { press = null; placeMark({ kind: 'ping', x: at.x, y: at.y }); }, LONG_PRESS_MS) };
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    const at = worldAt(engine, e);
    const role = useSessionStore.getState().you?.role;
    if (tool === 'ping') {
      placeMark({ kind: 'ping', x: at.x, y: at.y, ...(role === 'dm' && e.shiftKey && e.altKey ? { pull: true } : {}) });
      return;
    }
    if (tool === 'pin') {
      const hit = pinAt(pinsNow(), at.x, at.y);
      if (hit) useTableShell.getState().openCard(`pin:${hit.id}`);
      else addPin(at.x, at.y, role === 'dm');
      return;
    }
    // Table fix pass, decision d: templates stand, and the DM clears one by clicking it with the
    // template tool in hand. Only a relayed template (server id) can be cleared.
    if (tool === 'template' && role === 'dm') {
      const hit = templateAt(useMarks.getState().marks, at.x, at.y);
      if (hit && !hit.id.startsWith('template:')) {
        clearTemplate(hit.id);
        return;
      }
    }
    if (tool === 'measure') {
      const msg: MarkMsg = e.altKey ? { kind: 'ruler', from: at, to: at } : { kind: 'ruler', from: cellCentre(at), to: cellCentre(at) };
      const d: Drag = { tool, start: at, id: placeMark(msg, { hold: true }), msg, sent: msg, sentAt: Date.now() };
      d.alive = setInterval(() => send(d), KEEP_ALIVE_MS);
      drag = d;
      return;
    }
    // A template and a drawing are sent once, whole, on release: each send of a template is
    // another standing template, and a one-point stroke is not a drawing.
    const msg: MarkMsg =
      tool === 'template'
        ? templateFromDrag(useTemplateShape.getState().shape, cornerOrCentre(at), cornerOrCentre(at))
        : { kind: 'draw', points: [[at.x, at.y]], ttl: MARK_TTL_MS.draw };
    drag = { tool, start: at, id: holdMark(msg), msg, sent: null, sentAt: 0 };
    if (tool === 'draw') drag.stroke = { points: [[at.x, at.y]], gap: worldPx(STROKE_GAP_PX) };
  };

  const onMove = (e: PointerEvent): void => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > PRESS_SLOP_PX) cancelPress();
    const d = drag;
    if (!d) return;
    e.stopPropagation();
    e.preventDefault();
    // A second button pressed mid-drag arrives as a move (pointer events chord): right calls it off.
    if (e.button === 2) {
      swallowMenu = true;
      cancel();
      return;
    }
    const at = worldAt(engine, e);
    if (d.tool === 'draw' && !addStrokePoint(d.stroke!, at)) return;
    d.msg = msgFor(d, at, e.altKey);
    const mark = useMarks.getState().marks.find((m) => m.id === d.id);
    if (mark) useMarks.getState().put({ ...mark, msg: d.msg });
    if (d.tool !== 'measure') return;
    // A ruler follows the drag, at most every SEND_EVERY_MS, and the last move always goes.
    const since = Date.now() - d.sentAt;
    if (since >= SEND_EVERY_MS) send(d);
    else d.trail ??= setTimeout(() => drag === d && send(d), SEND_EVERY_MS - since);
  };

  const onUp = (e: PointerEvent): void => {
    cancelPress();
    const d = drag;
    if (!d) return;
    e.stopPropagation();
    end(d);
    const mark = useMarks.getState().marks.find((m) => m.id === d.id);
    if (!mark) return;
    if (d.tool === 'measure') {
      if (d.sent !== d.msg) sendMark(d.msg);
      // Plan section 6: the ruler stays where it was let go, then fades.
      useMarks.getState().put({ ...mark, msg: d.msg, expiresAt: Date.now() + MARK_TTL_MS.ruler });
      return;
    }
    if (d.msg.kind === 'draw' && d.msg.points.length < 2) {
      useMarks.getState().drop(d.id);
      return;
    }
    placeMark(d.msg, { id: d.id });
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !drag) return;
    // Esc mid-drag calls the drag off and keeps the tool in hand: the shell's Esc never hears it.
    e.preventDefault();
    e.stopPropagation();
    cancel();
  };

  const onMenu = (e: MouseEvent): void => {
    if (!drag && !swallowMenu) return;
    swallowMenu = false;
    e.preventDefault();
    cancel();
  };

  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onUp, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('contextmenu', onMenu, true);
  return () => {
    cancelPress();
    if (drag) end(drag);
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('contextmenu', onMenu, true);
  };
}

export const mountMarkInputWhenReady = (pollMs?: number): (() => void) =>
  mountWhenEngineReady((engine) => attachMarkInput(engine), pollMs);

/** The DM's "pull everyone's view": a ping in the middle of the DM's own view, that recentres every player. */
export function pullEveryoneHere(): void {
  const engine = getEngineSingleton()?.engine;
  if (!engine) return;
  const rect = engine.canvas().getBoundingClientRect();
  const at = engine.screenToWorld(rect.width / 2, rect.height / 2);
  placeMark({ kind: 'ping', x: at.x, y: at.y, pull: true });
}

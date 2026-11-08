import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import { mountWhenEngineReady } from '../../renderer/overlayLayer';
import { useSessionStore } from '../../session/store';
import { useActiveTool, type ToolId } from '../../session/tools';
import { MARK_TTL_MS, placeMark, sendMark, useMarks, type MarkMsg, type Pt } from './marks';
import { useLocalPins } from './pins';

type MarkTool = Exclude<ToolId, 'fog'>;

/** Least gap between two sends of a mark still being dragged, so a ruler is not a firehose. */
const SEND_EVERY_MS = 80;

const armedMarkTool = (): MarkTool | null => {
  const tool = useActiveTool.getState().activeTool;
  return tool && tool !== 'fog' ? tool : null;
};

function worldAt(engine: RenderEngine, e: PointerEvent): Pt {
  const rect = engine.canvas().getBoundingClientRect();
  return engine.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
}

let pinCounter = 0;

/**
 * The rail's mark tools on the map: Ping (click; Shift+Alt+click by the DM pulls every
 * camera), Measure (drag, gone on release), Template (drag a circle), Draw (freehand), Pin
 * (click). Document capture, like the fog tool, so an armed tool's press is never a pan or
 * a token grab.
 */
export function attachMarkInput(engine: RenderEngine): () => void {
  let drag: { tool: MarkTool; start: Pt; points: [number, number][]; id: string; sentAt: number } | null = null;

  const msgFor = (tool: MarkTool, start: Pt, at: Pt, points: [number, number][]): MarkMsg | null => {
    if (tool === 'measure') return { kind: 'ruler', from: start, to: at };
    if (tool === 'template')
      return { kind: 'template', shape: 'circle', origin: start, size: Math.hypot(at.x - start.x, at.y - start.y) };
    if (tool === 'draw') return { kind: 'draw', points, ttl: MARK_TTL_MS.draw };
    return null;
  };

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || e.target !== engine.canvas()) return;
    const tool = armedMarkTool();
    if (!tool) return;
    e.stopPropagation();
    e.preventDefault();
    const at = worldAt(engine, e);
    const role = useSessionStore.getState().you?.role;
    if (tool === 'ping') {
      placeMark({ kind: 'ping', x: at.x, y: at.y, ...(role === 'dm' && e.shiftKey && e.altKey ? { pull: true } : {}) });
      return;
    }
    if (tool === 'pin') {
      useLocalPins.getState().add({ id: `pin-${Date.now()}-${++pinCounter}`, x: at.x, y: at.y, text: '', dmOnly: role === 'dm' });
      return;
    }
    const points: [number, number][] = [[at.x, at.y]];
    const msg = msgFor(tool, at, at, points)!;
    drag = { tool, start: at, points, id: placeMark(msg, { hold: true }), sentAt: Date.now() };
  };

  const onMove = (e: PointerEvent): void => {
    if (!drag) return;
    e.stopPropagation();
    e.preventDefault();
    const at = worldAt(engine, e);
    if (drag.tool === 'draw') drag.points = [...drag.points, [at.x, at.y]];
    const msg = msgFor(drag.tool, drag.start, at, drag.points)!;
    const mark = useMarks.getState().marks.find((m) => m.id === drag!.id);
    if (mark) useMarks.getState().put({ ...mark, msg });
    // A drawing is sent once, whole, when the stroke ends; a ruler and a template follow the drag.
    if (drag.tool !== 'draw' && Date.now() - drag.sentAt >= SEND_EVERY_MS) {
      drag.sentAt = Date.now();
      sendMark(msg);
    }
  };

  const onUp = (e: PointerEvent): void => {
    if (!drag) return;
    e.stopPropagation();
    const { tool, id } = drag;
    const mark = useMarks.getState().marks.find((m) => m.id === id);
    drag = null;
    if (!mark) return;
    if (tool === 'measure') useMarks.getState().drop(id);
    else placeMark(mark.msg, { id });
  };

  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onUp, true);
  return () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
  };
}

export const mountMarkInputWhenReady = (pollMs?: number): (() => void) =>
  mountWhenEngineReady((engine) => attachMarkInput(engine), pollMs);

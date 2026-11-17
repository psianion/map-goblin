import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { PlayerInfo } from '@dnd/core/src/shared/protocol';
import { useSessionStore } from '../../session/store';
import { useActiveTool } from '../../session/tools';
import { attachMarkInput } from './markInput';
import { adoptOwnTemplate, distanceLabel, receiveMark, sendMark, useMarks } from './marks';
import { useLocalPins } from './pins';

const dm: PlayerInfo = { identityId: 'd', name: 'DM', role: 'dm', connected: true };

let canvas: HTMLCanvasElement;
let detach: () => void;

beforeEach(() => {
  useSessionStore.setState({ you: dm });
  useMarks.setState({ marks: [] });
  useLocalPins.setState({ pins: [] });
  canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  // One world unit per ten screen pixels, no offset.
  const engine = { canvas: () => canvas, screenToWorld: (x: number, y: number) => ({ x: x / 10, y: y / 10 }) };
  detach = attachMarkInput(engine as unknown as RenderEngine);
});

afterEach(() => {
  detach();
  canvas.remove();
  useActiveTool.getState().setActiveTool(null);
});

describe('mark tools', () => {
  it('drops a ping where the DM clicks, and Shift+Alt asks to pull cameras', () => {
    useActiveTool.getState().setActiveTool('ping');
    fireEvent.pointerDown(canvas, { button: 0, clientX: 50, clientY: 20 });
    fireEvent.pointerDown(canvas, { button: 0, clientX: 10, clientY: 10, shiftKey: true, altKey: true });
    expect(useMarks.getState().marks.map((m) => m.msg)).toEqual([
      { kind: 'ping', x: 5, y: 2 },
      { kind: 'ping', x: 1, y: 1, pull: true },
    ]);
  });

  it('holds a ruler while dragging and drops it on release', () => {
    useActiveTool.getState().setActiveTool('measure');
    fireEvent.pointerDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas, { clientX: 30, clientY: 40 });
    expect(useMarks.getState().marks[0]?.msg).toEqual({ kind: 'ruler', from: { x: 0, y: 0 }, to: { x: 3, y: 4 } });
    fireEvent.pointerUp(canvas, {});
    expect(useMarks.getState().marks).toEqual([]);
  });

  // Table fix pass, decision d: a template stands until the DM clears it; a drawing keeps 10 s.
  it('keeps a template standing and a drawing for its TTL after release', () => {
    const sent: unknown[] = [];
    const real = useSessionStore.getState().sendMark;
    useSessionStore.setState({ sendMark: (m) => sent.push(m) });
    useActiveTool.getState().setActiveTool('template');
    fireEvent.pointerDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas, { clientX: 30, clientY: 40 });
    fireEvent.pointerUp(canvas, {});
    // Sent once, on release: every send of a standing template is another template.
    expect(sent).toEqual([{ kind: 'template', shape: 'circle', origin: { x: 0, y: 0 }, size: 5 }]);
    useActiveTool.getState().setActiveTool('draw');
    fireEvent.pointerDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas, { clientX: 10, clientY: 0 });
    fireEvent.pointerUp(canvas, {});
    useSessionStore.setState({ sendMark: real });
    const [template, drawing] = useMarks.getState().marks;
    expect(template?.msg).toMatchObject({ kind: 'template', shape: 'circle', size: 5 });
    expect(drawing?.msg).toMatchObject({ kind: 'draw', points: [[0, 0], [1, 0]] });
    expect(template!.expiresAt).toBe(Infinity);
    useMarks.getState().prune(Date.now() + 60_000);
    expect(useMarks.getState().marks.map((m) => m.msg.kind)).toEqual(['template']);
  });

  it('lets the DM clear a relayed template by clicking it with the template tool', () => {
    const sent: unknown[] = [];
    const real = useSessionStore.getState().sendMark;
    useSessionStore.setState({ sendMark: (m) => sent.push(m) });
    receiveMark({ kind: 'template', shape: 'circle', origin: { x: 5, y: 5 }, size: 2 }, 'p1', 0, { id: 'mabc', ttlMs: 0 });
    useActiveTool.getState().setActiveTool('template');
    fireEvent.pointerDown(canvas, { button: 0, clientX: 55, clientY: 50 });
    fireEvent.pointerUp(canvas, {});
    useSessionStore.setState({ sendMark: real });
    expect(sent).toEqual([{ kind: 'clear', id: 'mabc' }]);
    expect(useMarks.getState().marks).toEqual([]);
  });

  it('places a local pin', () => {
    useActiveTool.getState().setActiveTool('pin');
    fireEvent.pointerDown(canvas, { button: 0, clientX: 20, clientY: 30 });
    expect(useLocalPins.getState().pins[0]).toMatchObject({ x: 2, y: 3, text: '', dmOnly: true });
  });

  it('leaves the pointer alone with Select in hand', () => {
    fireEvent.pointerDown(canvas, { button: 0, clientX: 20, clientY: 30 });
    expect(useMarks.getState().marks).toEqual([]);
  });
});

describe('mark channel adapter', () => {
  it('hands marks to the store’s sendMark', () => {
    const real = useSessionStore.getState().sendMark;
    const send = vi.fn();
    useSessionStore.setState({ sendMark: send });
    sendMark({ kind: 'ping', x: 1, y: 2 });
    expect(send).toHaveBeenCalledWith({ kind: 'ping', x: 1, y: 2 });
    useSessionStore.setState({ sendMark: real });
  });

  it('shows a remote ruler once per seat, replacing it as it moves', () => {
    receiveMark({ kind: 'ruler', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }, 'p1');
    receiveMark({ kind: 'ruler', from: { x: 0, y: 0 }, to: { x: 2, y: 0 } }, 'p1');
    expect(useMarks.getState().marks).toHaveLength(1);
    expect(useMarks.getState().marks[0]?.msg).toMatchObject({ to: { x: 2, y: 0 } });
  });

  it('keeps a relayed template under its server id, until a clear names it', () => {
    const template = { kind: 'template' as const, shape: 'circle' as const, origin: { x: 1, y: 1 }, size: 3 };
    receiveMark(template, 'p1', 0, { id: 'm1', ttlMs: 0 });
    useMarks.getState().prune(Date.now() + 120_000);
    expect(useMarks.getState().marks.map((m) => m.id)).toEqual(['m1']);
    useSessionStore.getState().applyServerMessage({ type: 'mark', event: { id: 'm2', from: 'd', at: 0, sceneId: null, ttlMs: 0, mark: { kind: 'clear', id: 'm1' } } } as never);
    expect(useMarks.getState().marks).toEqual([]);
  });

  it("re-keys this seat's own template to the id the server relayed it with", () => {
    const template = { kind: 'template' as const, shape: 'circle' as const, origin: { x: 1, y: 1 }, size: 3 };
    useMarks.getState().put({ id: 'template:d:1', by: 'd', msg: template, expiresAt: Infinity });
    adoptOwnTemplate(template, 'd', 'm7');
    expect(useMarks.getState().marks.map((m) => m.id)).toEqual(['m7']);
    // A rejoin replays it with no local copy: it is drawn all the same.
    useMarks.setState({ marks: [] });
    adoptOwnTemplate(template, 'd', 'm7');
    expect(useMarks.getState().marks.map((m) => m.id)).toEqual(['m7']);
  });

  it('reads distances on the map cell scale', () => {
    expect(distanceLabel(3, { value: 5, unit: 'ft' })).toBe('15 ft');
    expect(distanceLabel(2, { value: 1.5, unit: 'm' })).toBe('3 m');
  });
});

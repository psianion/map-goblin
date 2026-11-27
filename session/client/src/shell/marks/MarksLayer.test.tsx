import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { clearEngineSingleton, setEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import { useSessionStore } from '../../session/store';
import { MarksLayer } from './MarksLayer';
import { LEAVE_MS, useMarks, type LiveMark } from './marks';
import { useLocalPins } from './pins';

beforeEach(() => {
  cleanup();
  useMarks.setState({
    marks: [
      { id: 'a', by: 'p1', sceneId: null, msg: { kind: 'ping', x: 1, y: 1 }, expiresAt: Infinity },
      { id: 'b', by: 'p1', sceneId: null, msg: { kind: 'ruler', from: { x: 0.5, y: 0.5 }, to: { x: 3.5, y: 4.5 } }, expiresAt: Infinity },
      { id: 'c', by: 'p2', sceneId: null, msg: { kind: 'draw', points: [[0, 0], [1, 1]], ttl: 1000 }, expiresAt: Infinity },
    ],
  });
  useLocalPins.setState({ pins: [{ id: 'pin1', x: 2, y: 2, text: '', dmOnly: true }] });
});

describe('MarksLayer', () => {
  it('draws each mark and pin, the ruler with its distance', () => {
    const { container } = render(<MarksLayer />);
    expect(container.querySelector('[data-mark="ping"]')).toBeTruthy();
    expect(container.querySelector('[data-mark="draw"]')).toBeTruthy();
    // Snapped ends, a diagonal as one cell: four cells down, three across, is four cells.
    expect(container.querySelector('[data-mark="ruler"]')?.textContent).toBe('20 ft');
    expect(screen.getAllByTestId('map-pin')).toHaveLength(1);
    // A DM-only pin carries its hidden badge.
    expect(screen.getByTestId('map-pin-hidden')).toBeTruthy();
  });

  it('shows a mark only on its own scene', () => {
    useSessionStore.setState({ session: { activeSceneId: 's1', players: [], modules: {} } as never });
    useMarks.setState({
      marks: [
        { id: 'here', by: 'p1', sceneId: 's1', msg: { kind: 'ping', x: 1, y: 1 }, expiresAt: Infinity },
        { id: 'there', by: 'p1', sceneId: 's2', msg: { kind: 'draw', points: [[0, 0], [1, 1]], ttl: 1000 }, expiresAt: Infinity },
      ],
    });
    const { container } = render(<MarksLayer />);
    expect(container.querySelector('[data-mark="ping"]')).toBeTruthy();
    expect(container.querySelector('[data-mark="draw"]')).toBeNull();
    useSessionStore.setState({ session: null });
  });

  it('puts the sender’s name on a ping and starts the fade before the mark is dropped', () => {
    vi.useFakeTimers();
    useSessionStore.setState({ session: { activeSceneId: null, modules: {}, players: [{ identityId: 'p1', name: 'Bram', role: 'player', connected: true }] } as never });
    useMarks.setState({ marks: [{ id: 'a', by: 'p1', sceneId: null, msg: { kind: 'ping', x: 1, y: 1 }, expiresAt: Date.now() + 3000 }] });
    const { container } = render(<MarksLayer />);
    const ping = container.querySelector('[data-mark="ping"]')!;
    expect(ping.textContent).toBe('Bram');
    expect(ping.hasAttribute('data-leaving')).toBe(false);
    act(() => void vi.advanceTimersByTime(3000 - LEAVE_MS));
    expect(ping.hasAttribute('data-leaving')).toBe(true);
    vi.useRealTimers();
    useSessionStore.setState({ session: null });
  });
});

// Plan section 8: a camera move re-renders no mark. The layer's transform and the fixed-size
// factor are written by the frame loop straight onto the DOM, never through React.
describe('MarksLayer camera guard', () => {
  let frames: FrameRequestCallback[] = [];
  const stage = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 } };

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    setEngineSingleton({ stage: () => stage } as unknown as RenderEngine, {} as SceneGraph);
    const twenty: LiveMark[] = Array.from({ length: 20 }, (_, i) => {
      const kinds: LiveMark['msg'][] = [
        { kind: 'ping', x: i, y: i },
        { kind: 'ruler', from: { x: 0.5, y: 0.5 }, to: { x: i + 0.5, y: 2.5 } },
        { kind: 'template', shape: 'cone', origin: { x: i, y: 0 }, size: 3, toward: { x: i + 3, y: 3 } },
        { kind: 'draw', points: [[0, 0], [i, 1], [i + 1, 2]], ttl: 10_000 },
      ];
      return { id: `m${i}`, by: `p${i % 3}`, sceneId: null, msg: kinds[i % 4]!, expiresAt: Infinity };
    });
    useMarks.setState({ marks: twenty });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearEngineSingleton();
  });

  it('pans and zooms with 20 marks up and commits nothing', () => {
    let commits = 0;
    render(
      <Profiler id="marks" onRender={() => commits++}>
        <MarksLayer />
      </Profiler>,
    );
    const mounted = commits;
    const t0 = performance.now();
    act(() => {
      for (let i = 0; i < 600; i++) {
        stage.position.x = i * 3;
        stage.position.y = -i;
        stage.scale.x = stage.scale.y = 0.5 + (i % 120) / 60;
        const run = frames;
        frames = [];
        for (const cb of run) cb(i * 16);
      }
    });
    const perFrame = (performance.now() - t0) / 600;
    expect(commits).toBe(mounted);
    const group = screen.getByTestId('marks-layer').querySelector('g');
    expect(group?.getAttribute('transform')).toContain('scale(');
    expect(screen.getByTestId('marks-layer').style.getPropertyValue('--mk-k')).not.toBe('');
    // Not a budget (jsdom is no browser): printed for the before and after comparison.
    console.info(`marks camera frame: ${perFrame.toFixed(4)} ms with 20 marks, ${commits - mounted} commits`);
  });

  it('points an arrow at the screen edge toward a ping off screen', () => {
    useMarks.setState({ marks: [{ id: 'far', by: 'p1', sceneId: null, msg: { kind: 'ping', x: 1000, y: 300 }, expiresAt: Infinity }] });
    render(<MarksLayer />);
    const layer = screen.getByTestId('marks-layer');
    Object.defineProperty(layer, 'clientWidth', { value: 800 });
    Object.defineProperty(layer, 'clientHeight', { value: 600 });
    const arrow = layer.querySelector<SVGGElement>('[data-edge="far"]')!;
    const frame = () => {
      const run = frames;
      frames = [];
      for (const cb of run) cb(0);
    };
    stage.scale.x = 1;
    stage.position.y = 0;
    stage.position.x = 0;
    frame();
    expect(arrow.style.opacity).toBe('1');
    // Off to the right: the arrow sits on the right edge.
    expect(arrow.getAttribute('transform')).toMatch(/^translate\(772 /);
    stage.position.x = -300;
    frame();
    expect(arrow.style.opacity).toBe('0');
  });
});

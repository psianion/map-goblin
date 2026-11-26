import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Clock } from '@dnd/ui/icons';
import { useSessionStore } from '../../session/store';
import { useTokenInteraction } from '../../modules/tokens/drag';
import { useActiveTool } from '../../session/tools';
import { armedLabel } from './armedTool';
import { useTableShell } from '../tableShell';
import { Dock } from './Dock';
import { dockTabs, registerDockTab } from './registry';
import './tabs';

const Stub = () => <p>stub body</p>;

beforeEach(() => {
  cleanup();
  useTableShell.setState({ dockTab: null, lastDockTab: 'fog', card: null });
  registerDockTab({ id: 'fog', title: 'Fog', icon: Clock, key: '1', Body: Stub });
});

describe('Dock', () => {
  it('lists the eight tabs in order, folded to the tab row', () => {
    render(<Dock />);
    expect(dockTabs().map((t) => t.id)).toEqual(['fog', 'map', 'tokens', 'encounter', 'story', 'world', 'scenes', 'dice']);
    expect(screen.getAllByRole('tab')).toHaveLength(8);
    expect(screen.queryByTestId('dock-body-fog')).toBeNull();
  });

  it('opens a tab body on pick and folds it on the same pick', () => {
    render(<Dock />);
    fireEvent.click(screen.getByTestId('dock-tab-map'));
    expect(screen.getByTestId('dock-body-map')).toBeTruthy();
    expect(screen.getByTestId('dock-tab-map').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByTestId('dock-tab-map'));
    expect(screen.queryByTestId('dock-body-map')).toBeNull();
  });

  it('shows the open tab context text and its strip, and the chevron folds', () => {
    const Strip = () => <span>rooms strip</span>;
    registerDockTab({ id: 'fog', title: 'Fog', icon: Clock, key: '1', Body: Stub, Strip, context: () => 'on Web Gallery' });
    render(<Dock />);
    fireEvent.click(screen.getByTestId('dock-tab-fog'));
    expect(screen.getByTestId('dock-context').textContent).toBe('on Web Gallery');
    expect(screen.getByText('rooms strip')).toBeTruthy();
    fireEvent.click(screen.getByTestId('dock-collapse'));
    expect(useTableShell.getState().dockTab).toBeNull();
  });

  // F23: the Encounter row kept "Rolling initiative" after the DM locked the order, because the
  // context was read once per Dock render and nothing re-rendered the Dock on module state.
  it('reads "Round N" once the order is locked, without another click', () => {
    const initiative = (status: 'gathering' | 'running') => ({
      status,
      sceneId: 'a',
      round: 1,
      turn: 0,
      entries: [{ key: 'e1', name: 'Bram', kind: 'pc', identityId: 'p', initiative: 12 }],
      log: [],
    });
    useSessionStore.setState({ session: { activeSceneId: 'a', modules: { initiative: initiative('gathering') } } as never });
    useTableShell.setState({ dockTab: 'encounter' });
    render(<Dock />);
    expect(screen.getByTestId('dock-context').textContent).toBe('Rolling initiative');
    act(() => useSessionStore.setState({ session: { activeSceneId: 'a', modules: { initiative: initiative('running') } } as never }));
    expect(screen.getByTestId('dock-context').textContent).toBe("Round 1 · Bram's turn");
    act(() => useSessionStore.setState({ session: null }));
  });

  // F21: arming placement gave no cue and the next click dropped a second Bram.
  it('folds the dock and names the armed placement, Esc and all', () => {
    useSessionStore.setState({
      session: { activeSceneId: 'a', modules: { tokens: { library: { bram: { id: 'bram', name: 'Bram' } }, byScene: {} } } } as never,
    });
    useTableShell.setState({ dockTab: 'tokens', lastDockTab: 'tokens' });
    render(<Dock />);
    act(() => useTokenInteraction.getState().setPlacing('bram'));
    expect(useTableShell.getState().dockTab).toBeNull();
    expect(screen.getByTestId('armed-chip').textContent).toBe('Placing Bram, click the map, Esc cancels');
    act(() => useTokenInteraction.getState().setPlacing(null));
    expect(screen.queryByTestId('armed-chip')).toBeNull();
    act(() => useSessionStore.setState({ session: null }));
  });

  it('names an armed fog brush and the template tool', () => {
    expect(armedLabel(null, 'fog', 'Clear')).toBe('Clearing fog');
    expect(armedLabel(null, 'fog', 'Fog')).toBe('Painting fog');
    expect(armedLabel(null, 'template', null)).toBe('Template');
    expect(armedLabel(null, 'ping', null)).toBeNull();
  });

  // Fog rework default d: the size slider and the other brush stay in reach.
  it('stays open while a fog brush is armed, and names it beside the scene', () => {
    registerDockTab({ id: 'fog', title: 'Fog', icon: Clock, key: '1', layout: 'full', Body: Stub, context: () => 'on Testing' });
    useTableShell.setState({ dockTab: 'fog', lastDockTab: 'fog' });
    render(<Dock />);
    act(() => {
      useActiveTool.getState().setActiveTool('fog');
      useActiveTool.getState().setToolDetail('Clear');
    });
    expect(useTableShell.getState().dockTab).toBe('fog');
    expect(screen.getByTestId('dock-context').textContent).toBe('Clearing fog on Testing');
    expect(screen.queryByTestId('armed-chip')).toBeNull();
    // Folded by hand, the chip names it instead.
    act(() => useTableShell.getState().foldDock());
    expect(screen.getByTestId('armed-chip').textContent).toBe('Clearing fog');
    act(() => useActiveTool.getState().setActiveTool(null));
  });

  it('lays a full tab across the whole dock, with no column and no strip', () => {
    const Strip = () => <span>strip</span>;
    registerDockTab({ id: 'fog', title: 'Fog', icon: Clock, key: '1', height: 'sm', layout: 'full', Body: Stub, Strip });
    render(<Dock />);
    fireEvent.click(screen.getByTestId('dock-tab-fog'));
    expect(screen.getByTestId('dock-full').textContent).toBe('stub body');
    expect(screen.queryByTestId('dock-strip')).toBeNull();
    expect(screen.queryByText('strip')).toBeNull();
    expect(screen.getByTestId('dock-body-fog').className).toContain('h-36');
  });

  // F31: short tabs leave more of the map in view.
  it('opens Fog, Sky, Scenes, Story and Dice short, and Map, Tokens and Encounter tall', () => {
    // Fog is the stub `beforeEach` registers here; its real registration is in `tabs.ts`.
    const heights = Object.fromEntries(dockTabs().filter((t) => t.id !== 'fog').map((t) => [t.id, t.height ?? 'lg']));
    expect(heights).toEqual({ map: 'lg', tokens: 'lg', encounter: 'lg', story: 'sm', world: 'sm', scenes: 'sm', dice: 'sm' });
    render(<Dock />);
    fireEvent.click(screen.getByTestId('dock-tab-dice'));
    expect(screen.getByTestId('dock-body-dice').className).toContain('h-36');
  });

  it('swaps a stub for a real body registered under the same id', () => {
    render(<Dock />);
    act(() => registerDockTab({ id: 'fog', title: 'Fog', icon: Clock, key: '1', Body: () => <p>real fog body</p> }));
    fireEvent.click(screen.getByTestId('dock-tab-fog'));
    expect(screen.getByText('real fog body')).toBeTruthy();
  });
});

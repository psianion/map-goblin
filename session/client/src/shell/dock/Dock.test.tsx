import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Clock } from '@dnd/ui/icons';
import { useTableShell } from '../tableShell';
import { Dock } from './Dock';
import { dockTabs, registerDockTab } from './registry';
import { FogStub } from './stubs';
import './tabs';

beforeEach(() => {
  cleanup();
  useTableShell.setState({ dockTab: null, lastDockTab: 'fog', card: null });
  registerDockTab({ id: 'fog', title: 'Fog', icon: Clock, key: '1', Body: FogStub });
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
    registerDockTab({ id: 'fog', title: 'Fog', icon: Clock, key: '1', Body: FogStub, Strip, context: () => 'on Web Gallery' });
    render(<Dock />);
    fireEvent.click(screen.getByTestId('dock-tab-fog'));
    expect(screen.getByTestId('dock-context').textContent).toBe('on Web Gallery');
    expect(screen.getByText('rooms strip')).toBeTruthy();
    fireEvent.click(screen.getByTestId('dock-collapse'));
    expect(useTableShell.getState().dockTab).toBeNull();
  });

  it('swaps a stub for a real body registered under the same id', () => {
    render(<Dock />);
    act(() => registerDockTab({ id: 'fog', title: 'Fog', icon: Clock, key: '1', Body: () => <p>real fog body</p> }));
    fireEvent.click(screen.getByTestId('dock-tab-fog'));
    expect(screen.getByText('real fog body')).toBeTruthy();
  });
});

// The status bar's cave-band read-out.
//
// A band's node mode has a different key map from a stone wall's, and while a
// joint drag is live it carries the solver's answer instead: which stones the
// kit chose, and how far it pulled the handle off the cursor. That last number
// is the one that tells a DM whether the constraint is helping or fighting.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBar } from './StatusBar';
import { useStore } from '@/store/store';

const bar = () => render(<StatusBar rightPanelOpen={false} faded={false} />);

beforeEach(() => {
  useStore.getState().resetToDefault();
});

describe('StatusBar in band edit mode', () => {
  it('shows the band key map, not the stone one', () => {
    useStore.getState().setNodeEditWall('band:0');
    useStore.getState().selectNode(0.25);
    bar();
    expect(screen.getByText('Editing cave wall')).toBeTruthy();
    expect(screen.getByText(/Del straighten · Tab re-lay wall/)).toBeTruthy();
    expect(screen.queryByText(/rotate/)).toBeNull();
  });

  it('names the chosen pieces and the kit pull while a drag is live', () => {
    useStore.getState().setNodeEditWall('band:0');
    useStore.getState().selectNode(0.25);
    useStore
      .getState()
      .setBandDragStatus({ pieces: ['wall_short_2x4', 'inside_bend_2x2'], kitPull: 0.4213 });
    bar();
    expect(screen.getByText(/wall short 2x4, inside bend 2x2/)).toBeTruthy();
    expect(screen.getByText(/kit pull 0\.42 cells/)).toBeTruthy();
  });

  it('carries the refusal instead, in the words the solver used', () => {
    useStore.getState().setNodeEditWall('band:0');
    useStore.getState().setBandDragStatus({ refusal: 'the wall would have a hole in it' });
    bar();
    expect(screen.getByText(/the wall would have a hole in it/)).toBeTruthy();
  });

  it('leaves a stone wall reading exactly as it did', () => {
    useStore.getState().setNodeEditWall('wall-1');
    useStore.getState().selectNode(0.25);
    bar();
    expect(screen.getByText('Editing wall')).toBeTruthy();
    expect(screen.getByText(/\[ \] rotate/)).toBeTruthy();
  });
});

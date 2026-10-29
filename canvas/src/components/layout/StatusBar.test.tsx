// The status bar's node-edit read-out. The words come from statusHints, shared
// with the v2 bar; this holds the v1 bar to showing them.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBar } from './StatusBar';
import { useStore } from '@/store/store';

const bar = () => render(<StatusBar rightPanelOpen={false} faded={false} />);

beforeEach(() => {
  useStore.getState().resetToDefault();
});

describe('StatusBar in node edit mode', () => {
  it('leaves a stone wall reading exactly as it did', () => {
    useStore.getState().setNodeEditWall('wall-1');
    useStore.getState().selectNode(0.25);
    bar();
    expect(screen.getByText('Editing wall')).toBeTruthy();
    expect(screen.getByText(/\[ \] rotate/)).toBeTruthy();
  });
});

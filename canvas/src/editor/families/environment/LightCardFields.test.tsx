// The light card's angle rows take what a DM types: a sweep edge wraps through north, and a
// typed cone lands on a round angle the slider's steps might miss.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { z } from 'zod';
import { EdgeStepper, GroupRow } from './LightCardFields';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { LightChild } from '@/store/types';
import { FieldControl } from '@/editor/surfaces/SettingControl';
import type { SettingMeta } from '@/editor/registry/types';

afterEach(cleanup);

const edge = {
  id: 'card.light.sweep.from',
  label: 'From',
  schema: z.number(),
  default: 0,
  home: 'card',
  control: 'custom',
  range: { min: 0, max: 359, step: 5, unit: '°' },
} as SettingMeta<number>;

describe('EdgeStepper', () => {
  it('steps by 5 and wraps through north both ways', () => {
    const onChange = vi.fn();
    const { rerender } = render(<EdgeStepper def={edge} value={355} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Increase From'));
    expect(onChange).toHaveBeenLastCalledWith(0);
    rerender(<EdgeStepper def={edge} value={0} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Decrease From'));
    expect(onChange).toHaveBeenLastCalledWith(355);
  });

  it('lands a typed angle on Enter, wrapped, and leaves it on Escape', () => {
    const onChange = vi.fn();
    render(<EdgeStepper def={edge} value={10} onChange={onChange} />);
    const input = screen.getByLabelText('From in degrees');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '400' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(40);
    onChange.mockClear();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '90' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('a typed slider in a card', () => {
  it('takes 60° typed into the Cone readout', () => {
    const onChange = vi.fn();
    const cone = { ...edge, id: 'card.light.cone', label: 'Cone', control: 'slider', range: { min: 10, max: 360, step: 5, unit: '°' }, typed: true } as SettingMeta<unknown>;
    render(<FieldControl meta={cone} value={65} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Cone: type a value'));
    const input = screen.getByRole('textbox', { name: 'Cone' });
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(60);
  });
});

describe('GroupRow', () => {
  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    const layerId = useStore.getState().layers.find((l) => l.type === 'dungeon')!.id;
    for (const id of ['a', 'b']) {
      useStore.getState().addChild(layerId, {
        id,
        name: id,
        childType: 'light',
        visible: true,
        color: '#ffffff',
        radius: 4,
        featherRadius: 2,
        intensity: 1,
        falloff: 'quadratic',
        position: { x: 0, y: 0 },
        group: 'Hall',
      } as LightChild);
    }
  });
  const groupOf = (id: string) =>
    (useStore.getState().layers.flatMap((l) => (l.type === 'dungeon' ? l.children : [])).find((c) => c.id === id) as LightChild).group;

  it('renames every light in the group from the pencil, in one undo step', () => {
    const onChange = vi.fn();
    render(<GroupRow value="Hall" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'East hall' } });
    fireEvent.click(screen.getByLabelText('Rename group Hall to East hall, every light in it'));
    expect([groupOf('a'), groupOf('b')]).toEqual(['East hall', 'East hall']);
    expect(onChange).not.toHaveBeenCalled();
    undoManager.undo();
    expect([groupOf('a'), groupOf('b')]).toEqual(['Hall', 'Hall']);
  });

  it('says how many lights the group switches, and offers no rename until a new name is typed', () => {
    render(<GroupRow value="Hall" onChange={vi.fn()} />);
    expect(screen.getByText('Switches 2 lights together')).toBeTruthy();
    expect(screen.queryByLabelText(/Rename group/)).toBeNull();
  });
});

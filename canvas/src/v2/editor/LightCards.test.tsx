import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { AssetChild, DungeonLayer, LightChild } from '@/store/types';
import { SelectionCard } from './SelectionCard';

vi.mock('@/components/shared/PackThumbnailCanvas', () => ({ PackThumbnailCanvas: () => <i /> }));

function dungeon(): DungeonLayer {
  return useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon')!;
}

function light(over: Partial<LightChild> = {}): LightChild {
  return {
    id: 'l1',
    name: 'Torch 3',
    childType: 'light',
    visible: true,
    color: '#ffb561',
    radius: 8,
    featherRadius: 4,
    intensity: 0.9,
    falloff: 'quadratic',
    position: { x: 11, y: 8 },
    ...over,
  };
}

function brazier(): AssetChild {
  return {
    id: 'b2',
    name: 'brazier 2',
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'p:brazier',
    position: { x: 11, y: 8 },
    rotation: 0,
    scale: 1,
    width: 2,
    height: 2,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
  };
}

const live = () => dungeon().children.find((c) => c.id === 'l1') as LightChild;
const card = () => screen.getByTestId('v2-selection-card');
const box = (name: string) => within(card()).getByRole('textbox', { name }) as HTMLInputElement;
const track = (name: string) => within(card()).getByRole('slider', { name }) as HTMLInputElement;
function type(name: string, value: string) {
  const f = box(name);
  fireEvent.focus(f);
  fireEvent.change(f, { target: { value } });
  fireEvent.keyDown(f, { key: 'Enter' });
  fireEvent.blur(f);
}
function show(over: Partial<LightChild> = {}, withProp = false) {
  if (withProp) useStore.getState().addChild(dungeon().id, brazier());
  useStore.getState().addChild(dungeon().id, light(over));
  useStore.getState().setSelectedIds(['l1']);
  render(<SelectionCard />);
}
const undo = () => act(() => undoManager.undo());

beforeEach(() => {
  undoManager.clear();
  sessionStorage.clear();
  useStore.getState().resetToDefault();
});
afterEach(cleanup);

describe('Light card', () => {
  it('replaces the v1 panel: name, kind, and the five sections in board order', () => {
    show();
    expect(card().classList.contains('v2-lcard')).toBe(true);
    expect(within(card()).getByText('Torch 3')).toBeTruthy();
    const titles = within(card())
      .getAllByRole('button', { expanded: true })
      .map((b) => b.textContent);
    expect(titles).toEqual(['Light', 'Shape', 'Animation', 'Behaviour', 'Table']);
    expect(card().querySelector('.v2-legacy')).toBeNull();
  });

  it('reads Bright and Dim in feet, the unit after the number', () => {
    show();
    expect(box('Bright').value).toBe('20');
    expect(box('Dim').value).toBe('40');
    const units = [...card().querySelectorAll('.v2-pnum__unit')].map((u) => u.textContent);
    expect(units.slice(0, 2)).toEqual(['ft', 'ft']);
  });

  it('a typed Dim lands in cells as one undo step', () => {
    show();
    type('Dim', '60');
    expect(live().radius).toBe(12);
    undo();
    expect(live().radius).toBe(8);
  });

  it('a typed Bright past Dim carries Dim with it, one step for both', () => {
    show();
    type('Bright', '50');
    expect([live().featherRadius, live().radius]).toEqual([10, 10]);
    undo();
    expect([live().featherRadius, live().radius]).toEqual([4, 8]);
  });

  it('a Dim drag previews live and lands as one step from where it began', () => {
    show();
    const t = track('Dim');
    fireEvent.pointerDown(t);
    fireEvent.change(t, { target: { value: '45' } });
    fireEvent.change(t, { target: { value: '55' } });
    expect(live().radius).toBe(11);
    expect(undoManager.canUndo()).toBe(false);
    fireEvent.pointerUp(t, { target: { value: '55' } });
    expect(live().radius).toBe(11);
    undo();
    expect(live().radius).toBe(8);
  });

  it('keeps every distance on the 5..300 ft range', () => {
    show();
    expect([track('Bright').min, track('Bright').max, track('Bright').step]).toEqual(['5', '300', '5']);
    type('Dim', '900');
    expect(live().radius).toBe(60);
  });

  it('shows Colour as a hex and Intensity as a percent', () => {
    show();
    expect(within(card()).getByText('#FFB561')).toBeTruthy();
    expect(within(card()).getByText('90%')).toBeTruthy();
  });

  it('Falloff is a two-way choice, one step', () => {
    show();
    const falloff = within(card()).getByRole('group', { name: 'Falloff' });
    expect(within(falloff).getByRole('button', { name: 'Quadratic' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(falloff).getByRole('button', { name: 'Linear' }));
    expect(live().falloff).toBe('linear');
    undo();
    expect(live().falloff).toBe('quadratic');
  });

  it('a full circle reads "Full circle" with Direction greyed; a cone reads "Cone"', () => {
    show();
    const shape = within(card()).getByTestId('v2-light-shape');
    expect(shape.textContent).toContain('Full circle');
    expect(box('Cone').value).toBe('360');
    expect(box('Direction').disabled).toBe(true);
    type('Cone', '90');
    expect(live().cone).toEqual({ angle: 90, direction: 0 });
    expect(within(card()).getByTestId('v2-light-shape').textContent).toContain('Cone');
    expect(box('Direction').disabled).toBe(false);
    type('Direction', '400');
    expect(live().cone).toEqual({ angle: 90, direction: 40 });
  });

  it('the cone stays inside 10..360 degrees', () => {
    show();
    type('Cone', '2');
    expect(live().cone?.angle).toBe(10);
  });

  it('Effect None/Flicker/Pulse with Speed after it, greyed while None', () => {
    show();
    const effect = within(card()).getByRole('group', { name: 'Effect' });
    expect(within(effect).getByRole('button', { name: 'None' }).getAttribute('aria-pressed')).toBe('true');
    expect(box('Speed').disabled).toBe(true);
    fireEvent.click(within(effect).getByRole('button', { name: 'Flicker' }));
    expect(live().animation).toEqual({ kind: 'flicker', speed: 1 });
    expect(box('Speed').value).toBe('1.0');
    type('Speed', '9');
    expect(live().animation).toEqual({ kind: 'flicker', speed: 4 });
    fireEvent.click(within(within(card()).getByRole('group', { name: 'Effect' })).getByRole('button', { name: 'None' }));
    expect(live().animation).toBeUndefined();
  });

  it('Through walls and Night only switch one step each; Night only burns from half dark', () => {
    show();
    fireEvent.click(within(card()).getByRole('switch', { name: 'Through walls' }));
    expect(live().throughWalls).toBe(true);
    fireEvent.click(within(card()).getByRole('switch', { name: 'Night only' }));
    expect(live().nightOnly).toEqual({ min: 0.5, max: 1 });
    undo();
    expect(live().nightOnly).toBeUndefined();
    expect(live().throughWalls).toBe(true);
  });

  it('Darkness source drops the Colour row and adds "Darkvision sees through"', () => {
    show();
    expect(within(card()).queryByRole('switch', { name: 'Darkvision sees through' })).toBeNull();
    fireEvent.click(within(card()).getByRole('switch', { name: 'Darkness source' }));
    expect(live().darkness).toBe(true);
    expect(card().getAttribute('data-light-kind')).toBe('darkness');
    expect(within(card()).queryByText('#FFB561')).toBeNull();
    fireEvent.click(within(card()).getByRole('switch', { name: 'Darkvision sees through' }));
    expect(live().darkvisionSees).toBe(true);
    // Back to a light: the colour it had, and no darkvision flag left behind.
    fireEvent.click(within(card()).getByRole('switch', { name: 'Darkness source' }));
    expect(live().darkness).toBeUndefined();
    expect(live().darkvisionSees).toBeUndefined();
    expect(live().color).toBe('#ffb561');
  });

  it('On at the table defaults on; off writes tableOn false, on clears it', () => {
    show();
    const sw = () => within(card()).getByRole('switch', { name: 'On at the table' });
    expect(sw().getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw());
    expect(live().tableOn).toBe(false);
    fireEvent.click(sw());
    expect(live().tableOn).toBeUndefined();
  });

  it('an attached light says what it follows under the title, and Detach frees it in one step', () => {
    show({ attachedTo: 'b2' }, true);
    const line = within(card()).getByTestId('v2-light-attach');
    expect(line.textContent).toContain('Attached to brazier 2');
    fireEvent.click(within(line).getByRole('button', { name: 'Detach' }));
    expect(live().attachedTo).toBeUndefined();
    undo();
    expect(live().attachedTo).toBe('b2');
  });

  it('a free light next to a prop offers "Attach to nearest"; a lone one shows no line', () => {
    show({}, true);
    fireEvent.click(within(within(card()).getByTestId('v2-light-attach')).getByRole('button', { name: 'Attach to nearest' }));
    expect(live().attachedTo).toBe('b2');
    cleanup();
    useStore.getState().resetToDefault();
    show({ position: { x: 30, y: 30 } }, true);
    expect(within(card()).queryByTestId('v2-light-attach')).toBeNull();
  });

  it('several lights keep the generic card', () => {
    useStore.getState().addChild(dungeon().id, light());
    useStore.getState().addChild(dungeon().id, light({ id: 'l2' }));
    useStore.getState().setSelectedIds(['l1', 'l2']);
    render(<SelectionCard />);
    expect(card().classList.contains('v2-lcard')).toBe(false);
  });

  it('a locked light says so and every field is read-only', () => {
    show({ locked: true }, true);
    expect(within(card()).getByTestId('v2-sel-locked-note').textContent).toBe('Locked: unlock to edit');
    const fields = within(card()).getByTestId('v2-sel-lockset') as HTMLFieldSetElement;
    expect(fields.disabled).toBe(true);
    expect(fields.contains(box('Dim'))).toBe(true);
    expect(fields.contains(track('Intensity'))).toBe(true);
    // Attach and the switches are in it too; only the header's Unlock is not.
    expect(fields.contains(within(card()).getByTestId('v2-light-attach'))).toBe(true);
    expect(fields.contains(within(card()).getByTestId('v2-sel-act-unlock'))).toBe(false);
  });

  it('unlocking from the header gives the fields back', () => {
    show({ locked: true });
    fireEvent.click(within(card()).getByTestId('v2-sel-act-unlock'));
    expect(live().locked).toBeFalsy();
    expect(within(card()).queryByTestId('v2-sel-locked-note')).toBeNull();
    expect((within(card()).getByTestId('v2-sel-lockset') as HTMLFieldSetElement).disabled).toBe(false);
  });
});

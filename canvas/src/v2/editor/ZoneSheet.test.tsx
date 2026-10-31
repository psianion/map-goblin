import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { AnyChild, DungeonLayer, LightChild, TriggerAction, TriggerDef, ZoneChild } from '@/store/types';
import { ZoneSheet } from './ZoneSheet';

vi.mock('@/canvas/importImage', () => ({ importNoteImage: vi.fn(async () => 'img-new') }));

const CIRCLE: ZoneChild = {
  id: 'z', name: 'Ambush', childType: 'zone', visible: true, shape: { kind: 'circle', position: { x: 4, y: 5 }, radius: 2 },
};

function seed(zone: ZoneChild = CIRCLE, extra: AnyChild[] = [], locked = false) {
  const layer = {
    id: 'l1', type: 'dungeon', name: 'Dungeon', visible: true, locked, opacity: 1, children: [zone as AnyChild, ...extra],
    rooms: [], standaloneWalls: [], mergedFloor: null, style: {},
  } as unknown as DungeonLayer;
  useStore.setState({ layers: [layer] });
}

const zoneNow = () => (useStore.getState().layers[0] as DungeonLayer).children.find((c) => c.id === 'z') as ZoneChild;
const triggers = () => useStore.getState().prep?.triggers ?? [];
const notes = () => useStore.getState().prep?.notes ?? [];
const action = (i = 0) => triggers()[0].actions[i];

function type(el: HTMLElement, value: string) {
  fireEvent.focus(el);
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

/** One trigger on the zone, opened in the sheet. */
function openTrigger(t: Partial<TriggerDef> = {}, zone: ZoneChild = CIRCLE, extra: AnyChild[] = []) {
  seed(zone, extra);
  useStore.getState().upsertTrigger({
    id: 't1', name: 'Wolves wake', when: { kind: 'enter-region', zoneId: zone.id }, actions: [], once: true, enabled: true, ...t,
  } as TriggerDef);
  render(<ZoneSheet layerId="l1" zoneId={zone.id} />);
  fireEvent.click(screen.getByRole('button', { name: 'Wolves wake' }));
  return screen.getByRole('group', { name: 'Wolves wake' });
}

function withAction(a: TriggerAction, extra: AnyChild[] = []) {
  return openTrigger({ actions: [a] }, CIRCLE, extra);
}

describe('ZoneSheet', () => {
  beforeEach(() => {
    cleanup();
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('shows the name, the shape and the explore lock, with no legacy styling', () => {
    seed();
    const { container } = render(<ZoneSheet layerId="l1" zoneId="z" />);
    expect((screen.getByLabelText('Zone name') as HTMLInputElement).value).toBe('Ambush');
    expect(screen.getByTestId('v2-zone-shape').textContent).toContain('Circle · 4.0, 5.0 · radius 2.0 sq');
    expect(screen.getByRole('switch', { name: 'Blocks auto-explore' })).toBeTruthy();
    expect(container.querySelector('.v2-legacy')).toBeNull();
  });

  it('renames the zone on blur, one undo step', () => {
    seed();
    render(<ZoneSheet layerId="l1" zoneId="z" />);
    type(screen.getByLabelText('Zone name'), 'Kennels');
    expect(zoneNow().name).toBe('Kennels');
    undoManager.undo();
    expect(zoneNow().name).toBe('Ambush');
  });

  it('a point zone outside every room says so and has no explore lock', () => {
    seed({ ...CIRCLE, shape: { kind: 'point', position: { x: 1, y: 1 } } });
    render(<ZoneSheet layerId="l1" zoneId="z" />);
    expect(screen.getByText('Not inside a room')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Blocks auto-explore' })).toBeNull();
  });

  it('Blocks auto-explore writes the zone, undoable', () => {
    seed();
    render(<ZoneSheet layerId="l1" zoneId="z" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Blocks auto-explore' }));
    expect(zoneNow().blocksAutoExplore).toBe(true);
    undoManager.undo();
    expect(zoneNow().blocksAutoExplore).toBeUndefined();
  });

  it('Add trigger starts one on the shape’s first condition and opens it', () => {
    seed({ ...CIRCLE, shape: { kind: 'point', position: { x: 1, y: 1 } } });
    render(<ZoneSheet layerId="l1" zoneId="z" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add trigger' }));
    expect(triggers()).toHaveLength(1);
    expect(triggers()[0]).toMatchObject({ name: 'Trigger 1', when: { kind: 'room-revealed', zoneId: 'z' }, once: true, enabled: true });
    expect(screen.getByLabelText('Trigger name')).toBeTruthy();
  });

  it('adding a note leaves the open trigger open, and a prep write does not fold it', () => {
    seed();
    render(<ZoneSheet layerId="l1" zoneId="z" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add trigger' }));
    const disclose = () => screen.getAllByTestId('v2-zone-trigger')[0].querySelector('.v2-zsheet__disclose') as HTMLButtonElement;
    expect(disclose().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(notes()).toHaveLength(1);
    expect(disclose().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Trigger name')).toBeTruthy();
    // A write to prep (the trigger's Once) re-renders the list; the fold stays.
    act(() => useStore.getState().upsertTrigger({ ...triggers()[0], once: false }));
    expect(disclose().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(disclose());
    expect(disclose().getAttribute('aria-expanded')).toBe('false');
  });

  it('Enabled appears once per trigger, in its head, and writes', () => {
    const g = openTrigger();
    expect(within(g).getAllByRole('switch', { name: 'Enabled' })).toHaveLength(1);
    expect(within(g).queryAllByText('Enabled')).toHaveLength(0);
    fireEvent.click(within(g).getByRole('switch', { name: 'Enabled' }));
    expect(triggers()[0].enabled).toBe(false);
    expect(within(g).getByText('Off')).toBeTruthy();
  });

  it('offers the conditions the shape allows', () => {
    const g = openTrigger();
    const opts = [...(within(g).getByLabelText('Condition') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(opts).toEqual(['Enter region', 'Within radius']);
    cleanup();
    useStore.getState().resetToDefault();
    const rect: ZoneChild = { ...CIRCLE, shape: { kind: 'rect', x: 0, y: 0, width: 2, height: 2 } };
    const g2 = openTrigger({}, rect);
    expect([...(within(g2).getByLabelText('Condition') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['Enter region']);
  });

  it('Within radius shows a Radius field that sets the zone’s radius, one undo step', () => {
    const g = openTrigger();
    expect(within(g).queryByLabelText('Trigger radius')).toBeNull();
    fireEvent.change(within(g).getByLabelText('Condition'), { target: { value: 'within-radius' } });
    expect(triggers()[0].when).toEqual({ kind: 'within-radius', zoneId: 'z' });
    type(within(g).getByLabelText('Trigger radius'), '3.5');
    expect(zoneNow().shape).toEqual({ kind: 'circle', position: { x: 4, y: 5 }, radius: 3.5 });
    undoManager.undo();
    expect(zoneNow().shape).toEqual(CIRCLE.shape);
  });

  it('renames a trigger and sets Once', () => {
    const g = openTrigger();
    type(within(g).getByLabelText('Trigger name'), 'Horn sounds');
    expect(triggers()[0].name).toBe('Horn sounds');
    fireEvent.click(within(screen.getByRole('group', { name: 'Horn sounds' })).getByRole('switch', { name: 'Once' }));
    expect(triggers()[0].once).toBe(false);
  });

  it('Add action adds Show text; its text and Show to players write', () => {
    const g = openTrigger();
    fireEvent.click(within(g).getByRole('button', { name: 'Add action' }));
    expect(action()).toEqual({ kind: 'show-text', text: '', toPlayers: true });
    type(within(g).getByLabelText('Text'), 'A growl');
    fireEvent.click(within(g).getByRole('switch', { name: 'Show to players' }));
    expect(action()).toEqual({ kind: 'show-text', text: 'A growl', toPlayers: false });
  });

  it('a Light action lists the layer’s lights and flags a missing one', () => {
    const torch = { id: 'torch', name: 'Torch', childType: 'light', visible: true, position: { x: 0, y: 0 } } as unknown as LightChild;
    const g = withAction({ kind: 'light', lightId: 'gone', on: true }, [torch as AnyChild]);
    expect(within(g).getByText('Light not found: trigger is inert')).toBeTruthy();
    fireEvent.change(within(g).getByLabelText('Light'), { target: { value: 'torch' } });
    fireEvent.click(within(g).getByRole('switch', { name: 'Turn light on' }));
    expect(action()).toEqual({ kind: 'light', lightId: 'torch', on: false });
    expect(within(g).queryByText('Light not found: trigger is inert')).toBeNull();
  });

  it('a Trap action: Save shows Ability and DC; a bad damage formula is never written', () => {
    const g = withAction({ kind: 'trap', text: '' });
    expect(within(g).queryByLabelText('Save DC')).toBeNull();
    fireEvent.click(within(g).getByRole('switch', { name: 'Save' }));
    expect(action()).toMatchObject({ save: { ability: 'str', dc: 10 } });
    fireEvent.click(within(g).getByRole('button', { name: 'DEX' }));
    type(within(g).getByLabelText('Save DC'), '14');
    expect(action()).toMatchObject({ save: { ability: 'dex', dc: 14 } });
    type(within(g).getByLabelText('Damage'), '2d');
    expect((action() as { damage?: string }).damage).toBeUndefined();
    expect(within(g).getByText(/Format: NdM/)).toBeTruthy();
    type(within(g).getByLabelText('Damage'), '2d6+1');
    expect((action() as { damage?: string }).damage).toBe('2d6+1');
  });

  it('an Ability check action writes its ability, DC and text', () => {
    const g = withAction({ kind: 'ability-check', ability: 'str', dc: 10, text: '' });
    fireEvent.click(within(g).getByRole('button', { name: 'WIS' }));
    type(within(g).getByLabelText('Check DC'), '40');
    type(within(g).getByLabelText('Text'), 'Spot the tripwire');
    expect(action()).toEqual({ kind: 'ability-check', ability: 'wis', dc: 30, text: 'Spot the tripwire' });
  });

  it('a Prompt action picks its prompt and keeps an optional note', () => {
    const g = withAction({ kind: 'prompt', prompt: 'initiative' });
    fireEvent.click(within(g).getByRole('button', { name: 'Attack' }));
    type(within(g).getByLabelText('Prompt note'), 'Ambush!');
    expect(action()).toEqual({ kind: 'prompt', prompt: 'attack', text: 'Ambush!' });
    expect(within(g).getByText('DM log only, not shown at the table.')).toBeTruthy();
  });

  it('an Environment action sets a time and clears it back to unchanged', () => {
    const g = withAction({ kind: 'environment' });
    fireEvent.change(within(g).getByLabelText('Time'), { target: { value: 'night' } });
    fireEvent.change(within(g).getByLabelText('Weather'), { target: { value: 'fog' } });
    expect(action()).toEqual({ kind: 'environment', time: 'night', weather: 'fog' });
    fireEvent.change(within(g).getByLabelText('Time'), { target: { value: '' } });
    expect((action() as { time?: string }).time).toBeUndefined();
  });

  it('an Encounter action edits its monsters and its switches', () => {
    const g = withAction({ kind: 'encounter', name: 'Pack', monsters: [{ id: 'm1', name: 'Wolf', count: 2 }], spawn: true, seedInitiative: true });
    type(within(g).getByLabelText('Count'), '3');
    fireEvent.change(within(g).getByLabelText('Size'), { target: { value: 'large' } });
    type(within(g).getByLabelText('HP formula'), '2d8');
    fireEvent.click(within(g).getByRole('switch', { name: 'Spawn tokens at the zone' }));
    expect(action()).toMatchObject({ spawn: false, monsters: [{ id: 'm1', name: 'Wolf', count: 3, size: 'large', hp: '2d8' }] });
  });

  it('an Encounter action adds and removes monsters, and flags an empty one', () => {
    const g = withAction({ kind: 'encounter', name: 'Pack', monsters: [{ id: 'm1', name: 'Wolf', count: 2 }], spawn: true, seedInitiative: true });
    fireEvent.click(within(g).getByRole('button', { name: 'Add monster' }));
    expect((action() as { monsters: unknown[] }).monsters).toHaveLength(2);
    fireEvent.click(within(g).getByRole('button', { name: 'Remove Wolf' }));
    fireEvent.click(within(g).getByRole('button', { name: 'Remove Monster' }));
    expect(within(g).getByText('No monsters: trigger is inert')).toBeTruthy();
  });

  it('a kind change keeps the text; Remove action takes it off', () => {
    const g = withAction({ kind: 'show-text', text: 'Hi', toPlayers: true });
    fireEvent.change(within(g).getByLabelText('Kind'), { target: { value: 'ability-check' } });
    expect(action()).toEqual({ kind: 'ability-check', ability: 'str', dc: 10, text: 'Hi' });
    fireEvent.click(within(g).getByRole('button', { name: 'Remove action' }));
    expect(triggers()[0].actions).toEqual([]);
  });

  it('deletes a trigger on the second click only', () => {
    openTrigger();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Wolves wake' }));
    expect(triggers()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Wolves wake' }));
    expect(triggers()).toHaveLength(0);
    expect(screen.getByText('No triggers on this zone.')).toBeTruthy();
  });

  it('adds a note; its title, text and Show when room is revealed write', () => {
    seed({ ...CIRCLE, shape: { kind: 'point', position: { x: 1, y: 1 } } });
    render(<ZoneSheet layerId="l1" zoneId="z" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(notes()[0]).toMatchObject({ zoneId: 'z', title: 'Note 1', body: '', imageKeys: [], showOnReveal: false });
    type(screen.getByLabelText('Note title'), 'Growling');
    type(screen.getByLabelText('Note text'), 'Two goblins hide.');
    fireEvent.click(screen.getByRole('switch', { name: 'Show when room is revealed' }));
    expect(notes()[0]).toMatchObject({ title: 'Growling', body: 'Two goblins hide.', showOnReveal: true });
    expect(screen.getByText('Pops')).toBeTruthy();
    expect(screen.getByText('Pin is not inside a room: never pops')).toBeTruthy();
  });

  it('adds a note image and removes it, dropping it from the file', async () => {
    seed();
    useStore.getState().upsertNote({ id: 'n1', zoneId: 'z', title: 'Handout', body: '', imageKeys: [], showOnReveal: false });
    render(<ZoneSheet layerId="l1" zoneId="z" />);
    fireEvent.click(screen.getByRole('button', { name: 'Handout' }));
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(screen.getByTestId('v2-zone-note-file'), { target: { files: [file] } });
    });
    expect(notes()[0].imageKeys).toEqual(['img-new']);
    // The import itself stores the bitmap; the mock stands in for it here.
    act(() => useStore.getState().addCustomImage('img-new', 'data:image/png;base64,AA=='));
    expect(screen.getAllByTestId('v2-zone-note-image')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(notes()[0].imageKeys).toEqual([]);
    expect(useStore.getState().assets.customImages['img-new']).toBeUndefined();
  });

  it('deleting a note keeps an image a sibling note still holds', () => {
    seed();
    useStore.getState().addCustomImage('k1', 'data:a');
    useStore.getState().addCustomImage('k2', 'data:b');
    useStore.getState().upsertNote({ id: 'n1', zoneId: 'z', title: 'A', body: '', imageKeys: ['k1', 'k2'], showOnReveal: false });
    useStore.getState().upsertNote({ id: 'n2', zoneId: 'z', title: 'B', body: '', imageKeys: ['k2'], showOnReveal: false });
    render(<ZoneSheet layerId="l1" zoneId="z" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete A' }));
    expect(notes().map((n) => n.id)).toEqual(['n2']);
    const images = useStore.getState().assets.customImages;
    expect(images.k1).toBeUndefined();
    expect(images.k2).toBe('data:b');
  });

  it('a locked zone shows the lock line and disables every field', () => {
    seed({ ...CIRCLE, locked: true } as ZoneChild);
    const { container } = render(<ZoneSheet layerId="l1" zoneId="z" />);
    expect(screen.getByTestId('v2-sel-locked-note')).toBeTruthy();
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer, Room, TextChild } from '@/store/types';
import { TextTool } from '@dnd/core/src/engine/tools/TextTool';
import { installBoundLabelSync } from '@dnd/core/src/store/boundLabels';
import { measureLabel } from '@dnd/core/src/engine/labelMetrics';
import { SelectionCard } from './SelectionCard';

vi.mock('@/components/shared/PackThumbnailCanvas', () => ({ PackThumbnailCanvas: () => <i /> }));

const dungeon = () => useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon')!;
const labels = () => dungeon().children.filter((c): c is TextChild => c.childType === 'text');
const live = (id: string) => labels().find((c) => c.id === id)!;
const card = () => screen.getByTestId('v2-selection-card');
const field = () => screen.getByTestId('v2-label-text') as HTMLTextAreaElement;
const seg = (group: string, name: string) => within(within(card()).getByRole('group', { name: group })).getByRole('button', { name });
const undo = () => act(() => undoManager.undo());

const hall: Room = {
  id: 'hall',
  name: 'Warren Hall',
  number: 3,
  anchor: [5, 5],
  boundary: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
};

function text(id: string, over: Partial<TextChild> = {}): TextChild {
  return {
    id,
    name: id,
    childType: 'text',
    visible: true,
    text: id,
    position: { x: 20, y: 20 },
    rotation: 0,
    scale: 1,
    fontSize: 0.8,
    color: '#1b1b1b',
    width: 2,
    height: 1,
    ...over,
  };
}

/** One label selected, the card up. */
function show(c: TextChild) {
  useStore.getState().addChild(dungeon().id, c);
  useStore.getState().setSelectedIds([c.id]);
  render(<SelectionCard />);
}

/** A label placed by the tool, the way a click lands it, and the card it opens. */
function placeAndShow(x = 20, y = 20): TextChild {
  act(() => new TextTool().onPointerDown({ x, y }));
  render(<SelectionCard />);
  return labels().at(-1)!;
}

let stopSync: (() => void) | null = null;

beforeEach(() => {
  undoManager.clear();
  sessionStorage.clear();
  useStore.getState().resetToDefault();
  useStore.getState().setActiveLayerId(dungeon().id);
  useStore.getState().updateLayer(dungeon().id, { rooms: [hall] } as Partial<DungeonLayer>);
  stopSync = installBoundLabelSync();
});
afterEach(() => {
  cleanup();
  stopSync?.();
});

describe('Label card: place and type', () => {
  it('a placed label opens with its text field focused and the placeholder selected, once', async () => {
    placeAndShow();
    expect(card().classList.contains('v2-labelcard')).toBe(true);
    expect(document.activeElement).toBe(field());
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, 'Label'.length]);
    await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    act(() => field().blur());
    // A later render (any edit) never takes focus back.
    act(() => useStore.getState().updateChild(dungeon().id, labels()[0].id, { color: '#333333' }));
    expect(document.activeElement).not.toBe(field());
  });

  it('a Custom (unbound) label takes its field back when the placing press moves focus to the page', async () => {
    const c = placeAndShow();
    expect(c.bound).toBeUndefined();
    // The canvas press's mousedown, after the pointerdown that placed the label: focus to the page.
    act(() => field().blur());
    await act(() => Promise.resolve());
    expect(document.activeElement).toBe(field());
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, 'Label'.length]);
    // Typed at once, the keys reach the label; Esc on a fresh one still takes it back.
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(labels().find((x) => x.id === c.id)).toBeUndefined();
  });

  it('a Number pin placed in a room: one Enter is done, even after the press moved focus away', async () => {
    useStore.getState().updateToolSettings({ label: { ...useStore.getState().tools.settings.label, style: 'number-pin' } });
    const c = placeAndShow(5, 5);
    expect(c.bound).toEqual({ kind: 'room', id: 'hall' });
    act(() => field().blur());
    await act(() => Promise.resolve());
    expect(document.activeElement).toBe(field());
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(document.activeElement).not.toBe(field());
  });

  it('after the placing press, leaving the field for the page is not undone', async () => {
    placeAndShow();
    await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    act(() => field().blur());
    await act(() => Promise.resolve());
    expect(document.activeElement).not.toBe(field());
  });

  it('a label selected by hand does not take focus', () => {
    show(text('t'));
    expect(document.activeElement).not.toBe(field());
  });

  it('typing previews live and Enter lands it as one undo step, then leaves the field', () => {
    const c = placeAndShow();
    const steps = undoManager.size();
    fireEvent.change(field(), { target: { value: 'Beware' } });
    expect(live(c.id).text).toBe('Beware');
    expect(undoManager.size()).toBe(steps);
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(document.activeElement).not.toBe(field());
    expect(undoManager.size()).toBe(steps + 1);
    undo();
    expect(live(c.id).text).toBe('Label');
  });

  it('Shift+Enter is a new line, not done', () => {
    placeAndShow();
    const allowed = fireEvent.keyDown(field(), { key: 'Enter', shiftKey: true });
    expect(allowed).toBe(true);
    expect(document.activeElement).toBe(field());
  });

  it('Esc on the untouched placeholder takes the label back by undoing its place', () => {
    const c = placeAndShow();
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(labels().find((x) => x.id === c.id)).toBeUndefined();
    expect(undoManager.size()).toBe(0);
  });

  it('Esc once typed into only leaves the field', () => {
    const c = placeAndShow();
    fireEvent.change(field(), { target: { value: 'Beware' } });
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(live(c.id).text).toBe('Beware');
    expect(document.activeElement).not.toBe(field());
  });
});

describe('Label card: fields', () => {
  it('Size typed is one step, and the box follows it', () => {
    show(text('t'));
    const box = within(card()).getByRole('textbox', { name: 'Size' });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '2' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.blur(box);
    expect(live('t').fontSize).toBe(2);
    expect(live('t').width).toBeCloseTo(measureLabel('t', 2).width, 9);
    expect(undoManager.size()).toBe(1);
    undo();
    expect(live('t').fontSize).toBe(0.8);
  });

  it('Weight, Backdrop and Align each write one step, and absent means the default', () => {
    show(text('t'));
    fireEvent.click(seg('Weight', 'Bold'));
    expect(live('t').weight).toBe('bold');
    const w = live('t').width;
    fireEvent.click(seg('Backdrop', 'Pill'));
    expect(live('t').backdrop).toBe('pill');
    expect(live('t').width).toBeGreaterThan(w);
    fireEvent.click(seg('Align', 'Right'));
    expect(live('t').align).toBe('right');
    fireEvent.click(seg('Align', 'Centre'));
    expect(live('t').align).toBeUndefined();
    expect(undoManager.size()).toBe(4);
    undo();
    undo();
    undo();
    expect(live('t').backdrop).toBeUndefined();
  });

  it('Angle is typed in degrees and stored in radians', () => {
    show(text('t'));
    const box = within(card()).getByRole('textbox', { name: 'Angle' });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '15' } });
    fireEvent.blur(box);
    expect(live('t').rotation).toBeCloseTo((15 * Math.PI) / 180, 9);
  });

  it('Visible to players writes `players`, and off takes the key away', () => {
    show(text('t'));
    const sw = within(card()).getByRole('switch', { name: 'Visible to players' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(live('t').players).toBe(true);
    fireEvent.click(sw);
    expect(live('t').players).toBeUndefined();
  });

  it('changing the style over a room re-applies its look and binds it to the room', () => {
    show(text('t', { position: { x: 4, y: 4 } }));
    fireEvent.change(within(card()).getByRole('combobox', { name: 'Style' }), { target: { value: 'room-name' } });
    expect(live('t')).toMatchObject({ style: 'room-name', weight: 'bold', backdrop: 'halo', text: 'Warren Hall', bound: { kind: 'room', id: 'hall' } });
    expect(live('t').offset).toEqual([-1, -1]);
    expect(undoManager.size()).toBe(1);
  });
});

describe('Label card: bound and locked', () => {
  it('a bound label says what it follows, reads its text from there, and Unbind lets go', () => {
    show(text('t', { style: 'room-name', text: 'Warren Hall', bound: { kind: 'room', id: 'hall' }, offset: [0, 0], position: { x: 5, y: 5 } }));
    expect(within(card()).getByTestId('v2-label-bound').textContent).toContain('Follows Warren Hall');
    expect(field().readOnly).toBe(true);
    fireEvent.click(within(card()).getByRole('button', { name: 'Unbind' }));
    expect(live('t').bound).toBeUndefined();
    expect(live('t').offset).toBeUndefined();
    expect(field().readOnly).toBe(false);
    expect(screen.queryByTestId('v2-label-bound')).toBeNull();
  });

  it('a locked label shows the lock line and every field is disabled', () => {
    show(text('t', { locked: true }));
    expect(screen.getByTestId('v2-sel-kind').textContent).toBe('Label · locked');
    expect(within(card()).getByText(/Locked: unlock to edit/)).toBeTruthy();
    expect(card().querySelector('fieldset')?.disabled).toBe(true);
    expect(within(card()).getByRole('switch', { name: 'Visible to players' }).matches(':disabled')).toBe(true);
    expect(field().matches(':disabled')).toBe(true);
  });

  it('several labels share Size, Colour, Weight, Backdrop, Align and players, Mixed where they differ', () => {
    useStore.getState().addChild(dungeon().id, text('a', { fontSize: 1 }));
    useStore.getState().addChild(dungeon().id, text('b', { fontSize: 2, weight: 'bold' }));
    useStore.getState().setSelectedIds(['a', 'b']);
    render(<SelectionCard />);
    const group = screen.getByTestId('v2-label-group');
    expect((within(group).getByRole('textbox', { name: 'Size' }) as HTMLInputElement).placeholder).toBe('Mixed');
    const bold = within(within(group).getByRole('group', { name: 'Weight' })).getByRole('button', { name: 'Bold' });
    expect(bold.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(bold);
    expect([live('a').weight, live('b').weight]).toEqual(['bold', 'bold']);
    expect(undoManager.size()).toBe(1);
    expect(within(group).queryByRole('textbox', { name: 'Label text' })).toBeNull();
  });
});

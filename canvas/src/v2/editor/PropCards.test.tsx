import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { AssetChild, DungeonLayer } from '@/store/types';
import { SelectionCard } from './SelectionCard';

vi.mock('@/components/shared/PackThumbnailCanvas', () => ({
  PackThumbnailCanvas: ({ textureId }: { textureId: string }) => <i data-testid={`thumb-${textureId}`} />,
}));

const ENTRIES = ['barrel_1', 'barrel_2', 'barrel_3'].map((m) => ({
  id: `p:${m}`,
  packId: 'p',
  type: 'object',
  set: 'demo-storage',
  material: m,
  family: 'barrel',
  gridSize: '2x2',
  label: m.replace(/_/g, ' '),
  tags: [],
}));

vi.mock('@dnd/core/src/assets/packCatalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd/core/src/assets/packCatalog')>();
  const byId = (id: string) => ENTRIES.find((e) => e.id === id);
  return {
    ...actual,
    getCatalogEntry: byId,
    familyMembers: (id: string) => (byId(id) ? ENTRIES : []),
    familyPosition: (id: string) => (byId(id) ? { index: ENTRIES.findIndex((e) => e.id === id) + 1, count: 3 } : { index: 0, count: 0 }),
  };
});

/** Each prop edit factory, recorded; the command it hands back does nothing. */
const { calls, record } = vi.hoisted(() => {
  const calls: { fn: string; args: unknown[] }[] = [];
  const record =
    (fn: string) =>
    (...args: unknown[]) => {
      calls.push({ fn, args });
      return { label: fn, execute: () => {}, undo: () => {} };
    };
  return { calls, record };
});
vi.mock('@dnd/core/src/store/propEdits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd/core/src/store/propEdits')>();
  return {
    ...actual,
    createPropPatchCommand: record('patch'),
    createSetPropFieldsCommand: record('fields'),
    createPropBoxCommand: record('box'),
    createZOrderCommand: record('zorder'),
    createAlignCommand: record('align'),
    createDistributeCommand: record('distribute'),
    createSwapPropCommand: record('swap'),
  };
});

const grouped = vi.hoisted(() => vi.fn());
vi.mock('@/canvas/groupActions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/canvas/groupActions')>();
  return { ...actual, groupSelection: (...args: unknown[]) => grouped(...args) };
});

function dungeon(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('no dungeon layer');
  return l;
}

function prop(id: string, over: Partial<AssetChild> = {}): AssetChild {
  return {
    id,
    name: id,
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'p:barrel_2',
    position: { x: 12.5, y: 9.5 },
    rotation: 0,
    scale: 1,
    width: 2,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
    ...over,
  };
}

function place(...children: AssetChild[]) {
  for (const c of children) useStore.getState().addChild(dungeon().id, c);
}

const card = () => screen.getByTestId('v2-selection-card');
const field = (name: string) => within(card()).getByRole('textbox', { name }) as HTMLInputElement;
function type(name: string, value: string) {
  const f = field(name);
  fireEvent.focus(f);
  fireEvent.change(f, { target: { value } });
  fireEvent.keyDown(f, { key: 'Enter' });
  fireEvent.blur(f);
}
const last = () => calls[calls.length - 1];

beforeEach(() => {
  calls.length = 0;
  grouped.mockReset();
  undoManager.clear();
  sessionStorage.clear();
  useStore.getState().resetToDefault();
});

afterEach(cleanup);

describe('Prop card', () => {
  beforeEach(() => {
    place(prop('b'));
    useStore.getState().setSelectedIds(['b']);
    render(<SelectionCard />);
  });

  it('heads with the name, the family chip and the kind', () => {
    expect(card().getAttribute('data-prop-kind')).toBe('prop');
    expect(within(card()).getByTestId('v2-prop-family-chip').textContent).toBe('Barrel · 2/3');
    expect(within(card()).getByText('Prop')).toBeTruthy();
  });

  it('X, Y and Angle land as one box command each, the angle in radians', () => {
    type('X (centre, squares)', '5');
    expect(last()).toMatchObject({ fn: 'box', args: [['b'], { x: 12.5, y: 9.5, w: 2, h: 1, angle: 0 }, { x: 5, y: 9.5, w: 2, h: 1, angle: 0 }] });
    type('Angle (degrees)', '90');
    expect((last().args[2] as { angle: number }).angle).toBeCloseTo(Math.PI / 2);
  });

  it('W keeps the ratio while linked and goes alone once unlinked', () => {
    type('Width (squares)', '4');
    expect(last().args[2]).toMatchObject({ w: 4, h: 2 });
    fireEvent.click(within(card()).getByRole('button', { name: 'Keep W:H ratio' }));
    type('Width (squares)', '3');
    expect(last().args[2]).toMatchObject({ w: 3, h: 1 });
  });

  it('Escape in a field puts it back with nothing landed', () => {
    const f = field('Y (centre, squares)');
    fireEvent.focus(f);
    fireEvent.change(f, { target: { value: '99' } });
    fireEvent.keyDown(f, { key: 'Escape' });
    fireEvent.blur(f);
    expect(calls).toHaveLength(0);
    expect(f.value).toBe('9.50');
  });

  it('flips through the one patch path', () => {
    fireEvent.click(within(card()).getByRole('button', { name: 'Flip horizontal (Shift+H)' }));
    expect(last()).toMatchObject({
      fn: 'patch',
      args: ['Flip horizontal', [{ id: 'b', layerId: dungeon().id, before: { flipX: false }, after: { flipX: true } }]],
    });
  });

  it('a tint visit previews live and lands as one patch with the old tint before it', () => {
    fireEvent.click(within(card()).getByRole('button', { name: /^Tint colour/ }));
    const hex = screen.getByRole('textbox', { name: 'Hex colour' });
    fireEvent.change(hex, { target: { value: '#aa2222' } });
    fireEvent.keyDown(hex, { key: 'Enter' });
    expect((dungeon().children[0] as AssetChild).tint).toBe('#aa2222');
    fireEvent.click(within(card()).getByRole('button', { name: /^Tint colour/ }));
    expect(last()).toMatchObject({
      fn: 'patch',
      args: ['Prop tint', [{ id: 'b', before: { tint: '#ffffff' }, after: { tint: '#aa2222' } }]],
    });
  });

  it('an opacity drag lands as one patch', () => {
    const slider = within(card()).getByRole('slider', { name: 'Opacity' });
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '0.5' } });
    fireEvent.change(slider, { target: { value: '0.4' } });
    fireEvent.pointerUp(slider, { target: { value: '0.4' } });
    expect(calls.filter((c) => c.fn === 'patch')).toHaveLength(1);
    expect(last()).toMatchObject({ args: ['Prop opacity', [{ before: { opacity: undefined }, after: { opacity: 0.4 } }]] });
  });

  it('orders, overhead and lock go to their commands', () => {
    fireEvent.click(within(card()).getByRole('button', { name: 'Bring to front (Ctrl+Shift+])' }));
    expect(last()).toEqual({ fn: 'zorder', args: [['b'], 'front'] });
    fireEvent.click(within(card()).getByRole('button', { name: 'Send backward (Ctrl+[)' }));
    expect(last()).toEqual({ fn: 'zorder', args: [['b'], 'backward'] });
    fireEvent.click(within(card()).getByRole('switch', { name: 'Overhead' }));
    expect(last()).toEqual({ fn: 'fields', args: [['b'], { overhead: true }] });
    fireEvent.click(within(card()).getByRole('switch', { name: 'Lock' }));
    expect(last()).toEqual({ fn: 'fields', args: [['b'], { locked: true }] });
  });

  it('a sibling swaps keeping the footprint, and Replace… opens the library on this prop', () => {
    const variant = within(card()).getByTestId('v2-prop-variant');
    fireEvent.click(within(variant).getByRole('button', { name: 'barrel 3' }));
    expect(last()).toEqual({ fn: 'swap', args: [['b'], 'p:barrel_3', 'footprint'] });
    fireEvent.click(within(variant).getByTestId('v2-prop-replace'));
    expect(useStore.getState().ui.propReplaceIds).toEqual(['b']);
  });

  it('Behaviour is live: Casts shadow, Blocks light and sight and Glows write one command each; Blocks movement waits for the table', () => {
    const behaviour = within(card()).getByTestId('v2-prop-behaviour');
    expect(within(behaviour).queryByText('Lighting pass')).toBeNull();
    const switches = within(behaviour).getAllByRole('switch') as HTMLButtonElement[];
    expect(switches.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Casts shadow',
      'Blocks light and sight',
      'Blocks movement',
      'Glows',
    ]);
    expect(switches.map((s) => s.disabled)).toEqual([false, false, true, false]);
    expect(within(behaviour).getByText('Table pass')).toBeTruthy();
    expect(switches[0].getAttribute('aria-checked')).toBe('true');
    fireEvent.click(switches[0]);
    expect(last()).toEqual({ fn: 'fields', args: [['b'], { castsShadow: false }] });
    fireEvent.click(switches[1]);
    expect(last()).toEqual({ fn: 'fields', args: [['b'], { blocksLight: true }] });
    fireEvent.click(switches[3]);
    expect(last()).toEqual({ fn: 'fields', args: [['b'], { glows: true }] });
    fireEvent.click(switches[2]);
    expect(calls).toHaveLength(3);
  });

  it('shows no glow rows while the prop does not glow', () => {
    expect(within(card()).queryByRole('slider', { name: 'Glow strength' })).toBeNull();
    expect(within(card()).queryByRole('group', { name: 'Glow animation' })).toBeNull();
  });
});

describe('Prop card, glowing', () => {
  it('hangs Strength, Animation and Speed under Glows, starting at 0.9 and steady', () => {
    place(prop('b', { glows: true }));
    useStore.getState().setSelectedIds(['b']);
    render(<SelectionCard />);
    const behaviour = within(card()).getByTestId('v2-prop-behaviour');
    expect((within(behaviour).getByRole('slider', { name: 'Glow strength' }) as HTMLInputElement).value).toBe('0.9');
    expect(field('Glow strength').value).toBe('0.90');
    const anim = within(behaviour).getByRole('group', { name: 'Glow animation' });
    expect(within(anim).getByRole('button', { name: 'None' }).getAttribute('aria-pressed')).toBe('true');
    // Speed means nothing while steady.
    expect(field('Glow speed').disabled).toBe(true);
    fireEvent.click(within(anim).getByRole('button', { name: 'Pulse' }));
    expect(last()).toEqual({ fn: 'fields', args: [['b'], { glow: { strength: 0.9, animation: { kind: 'pulse', speed: 1 } } }] });
  });

  it('a typed strength is clamped to 0.1..1 and lands as one command', () => {
    place(prop('b', { glows: true, glow: { strength: 0.5, animation: { kind: 'flicker', speed: 0.8 } } }));
    useStore.getState().setSelectedIds(['b']);
    render(<SelectionCard />);
    type('Glow strength', '3');
    expect(last()).toEqual({ fn: 'fields', args: [['b'], { glow: { strength: 1, animation: { kind: 'flicker', speed: 0.8 } } }] });
    expect(field('Glow speed').value).toBe('0.8');
  });

  it('a strength drag previews live and lands as one prop patch', () => {
    place(prop('b', { glows: true }));
    useStore.getState().setSelectedIds(['b']);
    render(<SelectionCard />);
    const track = within(card()).getByRole('slider', { name: 'Glow strength' });
    fireEvent.pointerDown(track);
    fireEvent.change(track, { target: { value: '0.4' } });
    expect((dungeon().children[0] as AssetChild).glow?.strength).toBe(0.4);
    fireEvent.pointerUp(track, { target: { value: '0.4' } });
    expect(last().fn).toBe('patch');
    expect(last().args[0]).toBe('Glow strength');
  });
});

describe('Prop card, locked or imported', () => {
  it('a locked prop shows read-only fields and keeps only Lock', () => {
    place(prop('b', { locked: true }));
    useStore.getState().setSelectedIds(['b']);
    render(<SelectionCard />);
    expect(field('X (centre, squares)').disabled).toBe(true);
    expect((within(card()).getByRole('button', { name: 'Bring to front (Ctrl+Shift+])' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(card()).getByRole('switch', { name: 'Overhead' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(card()).getByRole('switch', { name: 'Lock' }));
    expect(last()).toEqual({ fn: 'fields', args: [['b'], { locked: false }] });
  });

  it('an imported image has no Variant row', () => {
    place(prop('img', { objectType: 'image', assetId: 'blob:x' }));
    useStore.getState().setSelectedIds(['img']);
    render(<SelectionCard />);
    expect(within(card()).queryByTestId('v2-prop-variant')).toBeNull();
  });
});

describe('Props card', () => {
  beforeEach(() => {
    place(prop('a', { position: { x: 1, y: 1 } }), prop('b', { position: { x: 5, y: 1 }, overhead: true }), prop('c', { position: { x: 9, y: 1 } }));
    useStore.getState().setSelectedIds(['a', 'b', 'c']);
    render(<SelectionCard />);
  });

  it('moves the three as one box and shows where they disagree', () => {
    expect(within(card()).getByText('3 props')).toBeTruthy();
    expect(field('X (centre, squares)').value).toBe('5.00');
    expect(within(card()).getByText('Mixed: 1 of 3')).toBeTruthy();
    expect(within(card()).getByText('None locked')).toBeTruthy();
    type('X (centre, squares)', '6');
    expect(last()).toMatchObject({ fn: 'box', args: [['a', 'b', 'c'], { x: 5 }, { x: 6 }] });
  });

  it('aligns and distributes from its menus', () => {
    fireEvent.click(within(card()).getByRole('button', { name: /^Align/ }));
    // Each row carries its icon, as on the Multi board.
    for (const edge of ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom']) {
      expect(screen.getByTestId(`v2-align-${edge}`).querySelector('svg')).not.toBeNull();
    }
    fireEvent.click(screen.getByTestId('v2-align-left'));
    expect(last()).toEqual({ fn: 'align', args: [['a', 'b', 'c'], 'left'] });
    fireEvent.click(within(card()).getByRole('button', { name: /^Distribute/ }));
    fireEvent.click(screen.getByTestId('v2-distribute-h'));
    expect(last()).toEqual({ fn: 'distribute', args: [['a', 'b', 'c'], 'h'] });
  });

  it('a mixed Overhead switch turns all on; Lock all locks all; Group groups', () => {
    const sw = within(card()).getByRole('switch', { name: 'Overhead' });
    expect(sw.getAttribute('aria-checked')).toBe('mixed');
    fireEvent.click(sw);
    expect(last()).toEqual({ fn: 'fields', args: [['a', 'b', 'c'], { overhead: true }] });
    fireEvent.click(within(card()).getByRole('switch', { name: 'Lock all' }));
    expect(last()).toEqual({ fn: 'fields', args: [['a', 'b', 'c'], { locked: true }] });
    fireEvent.click(within(card()).getByRole('button', { name: 'Group' }));
    // Merged, as the Group board shows a new group.
    expect(grouped).toHaveBeenCalledWith(true);
  });
});

describe('Group card', () => {
  beforeEach(() => {
    place(prop('a', { groupId: 'g' }), prop('b', { groupId: 'g', position: { x: 3, y: 1 } }));
    useStore.setState((s) => {
      (s.layers.find((l) => l.id === dungeon().id) as DungeonLayer).groups = [{ id: 'g', name: 'Supply corner' }];
    });
    useStore.getState().setSelectedIds(['a', 'b']);
  });

  it('renames, merges and ungroups, each one undo step', () => {
    const onOpenLayers = vi.fn();
    render(<SelectionCard onOpenLayers={onOpenLayers} />);
    expect(card().getAttribute('data-prop-kind')).toBe('prop-group');
    expect(within(card()).getByText('2 props')).toBeTruthy();

    const name = within(card()).getByRole('textbox', { name: 'Group name' });
    fireEvent.change(name, { target: { value: 'Stores' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    fireEvent.blur(name);
    expect(dungeon().groups?.[0].name).toBe('Stores');

    fireEvent.click(within(card()).getByRole('switch', { name: 'Merged' }));
    expect(dungeon().groups?.[0].merged).toBe(true);

    fireEvent.click(within(card()).getByRole('button', { name: 'Select members' }));
    expect(onOpenLayers).toHaveBeenCalled();
    expect(useStore.getState().ui.revealChildId).toBe('a');

    fireEvent.click(within(card()).getByRole('button', { name: 'Ungroup' }));
    expect(dungeon().children.every((c) => !c.groupId)).toBe(true);
    expect(undoManager.canUndo()).toBe(true);
    undoManager.undo();
    expect(dungeon().children.every((c) => c.groupId === 'g')).toBe(true);
  });

  it('locks and puts overhead every member, and orders the whole group', () => {
    render(<SelectionCard />);
    fireEvent.click(within(card()).getByRole('switch', { name: 'Lock all members' }));
    expect(last()).toEqual({ fn: 'fields', args: [['a', 'b'], { locked: true }] });
    fireEvent.click(within(card()).getByRole('switch', { name: 'Overhead, all members' }));
    expect(last()).toEqual({ fn: 'fields', args: [['a', 'b'], { overhead: true }] });
    fireEvent.click(within(card()).getByRole('button', { name: 'Send to back (Ctrl+Shift+[)' }));
    expect(last()).toEqual({ fn: 'zorder', args: [['a', 'b'], 'back'] });
  });
});

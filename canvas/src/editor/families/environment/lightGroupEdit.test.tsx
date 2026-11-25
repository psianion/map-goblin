// A group edited together: Select group picks its lights, the light card over several shows the
// shared value or "Mixed" and sets them all in one step named for the group, a mixed Direction or
// sweep edge turns every light by the same amount, a group spins in step from where each beam
// points, one member alone says it is part of the group, and the Light tool lists the groups.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { LightChild } from '@/store/types';
import type { CardFieldDef } from '@/editor/registry/types';
import { CardField } from '@/editor/surfaces/SettingItems';
import { sharedValue } from '@/editor/surfaces/model';
import { coneAt } from '@dnd/core/src/shared/lightMotion';
import { lightCard } from './lightCard';
import { lightsTitle, selectGroup } from './lightEdits';
import { groupRows } from './lightModel';
import { GroupField } from './LightCardFields';
import { LightGroupsPanel } from './LightGroupsPanel';
import { lightGroups } from '@dnd/core/src/shared/lightSwitches';
import { crowdText, selectHint } from '@/editor/families/select/hint';
import { MixedCard } from '@/editor/families/select/MixedCard';
import { dragPatch } from '@/canvas/lightOverlay';
import { PANEL_BODY } from '@/editor/surfaces/sections';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const WATCH = ['b0', 'b1', 'b2', 'b3'];
const layerId = () => useStore.getState().layers.find((l) => l.type === 'dungeon')!.id;
const lights = (): LightChild[] =>
  useStore
    .getState()
    .layers.flatMap((l) => (l.type === 'dungeon' ? l.children : []))
    .filter((c): c is LightChild => c.childType === 'light');
const byId = (id: string) => lights().find((l) => l.id === id)!;
const field = (id: string) => lightCard.fields.find((f) => f.id === id)! as CardFieldDef;
const lastLabel = (spy: { mock: { calls: unknown[][] } }) => (spy.mock.calls.at(-1)![0] as { label: string }).label;

function addLight(id: string, extra: Partial<LightChild> = {}): void {
  useStore.getState().addChild(layerId(), {
    id,
    name: id,
    childType: 'light',
    visible: true,
    color: '#ff0000',
    radius: 6,
    featherRadius: 2,
    intensity: 0.9,
    falloff: 'quadratic',
    position: { x: 13, y: 15 },
    ...extra,
  } as LightChild);
}

beforeEach(() => {
  undoManager.clear();
  useStore.getState().resetToDefault();
  // The user's "Watch": four 60° red cones stacked at (13,15), a quarter turn apart.
  WATCH.forEach((id, i) => addLight(id, { group: 'Watch', cone: { angle: 60, direction: i * 90 } }));
  addLight('free', { position: { x: 2, y: 2 } });
});

describe('Select group and the title', () => {
  it('picks every light of the group, and the card is titled for it', () => {
    selectGroup('Watch');
    expect(useStore.getState().selection.selectedIds).toEqual(WATCH);
    expect(lightsTitle(WATCH.map(byId))).toBe('Watch, 4 lights');
    expect(lightsTitle([...WATCH, 'free'].map(byId))).toBe('5 lights');
    expect(lightsTitle(['b0', 'b1'].map(byId))).toBe('2 lights');
    expect(lightCard.multi).toBeDefined();
  });
});

describe('the light card over several lights', () => {
  it('reads Mixed where they differ and sets them all in one step named for the group', () => {
    expect(sharedValue(field('card.light.colour'), WATCH.map(byId))).toEqual({ value: '#ff0000', mixed: false });
    expect(sharedValue(field('card.light.direction'), WATCH.map(byId)).mixed).toBe(true);
    const spy = vi.spyOn(undoManager, 'execute');
    field('card.light.colour').write(useStore, WATCH, '#00ff00');
    expect(WATCH.map((id) => byId(id).color)).toEqual(['#00ff00', '#00ff00', '#00ff00', '#00ff00']);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(lastLabel(spy)).toBe('Watch: colour');
    undoManager.undo();
    expect(WATCH.map((id) => byId(id).color)).toEqual(['#ff0000', '#ff0000', '#ff0000', '#ff0000']);
    // Bright, Dim, Cone, Through walls and On at the table land on all four too.
    field('card.light.cone').write(useStore, WATCH, 45);
    field('card.light.throughWalls').write(useStore, WATCH, true);
    field('card.light.tableOn').write(useStore, WATCH, false);
    expect(WATCH.map((id) => [byId(id).cone?.angle, byId(id).throughWalls, byId(id).tableOn])).toEqual(WATCH.map(() => [45, true, false]));
    // The cone keeps each light's own direction.
    expect(WATCH.map((id) => byId(id).cone?.direction)).toEqual([0, 90, 180, 270]);
    // Two lights that are not a whole group: the plain label.
    field('card.light.intensity').write(useStore, ['b0', 'free'], 0.5);
    expect(lastLabel(spy)).toBe('Intensity');
  });

  it('a mixed field draws "Mixed": a slider readout, a switch row, a colour', () => {
    useStore.getState().updateChild(layerId(), 'b1', { intensity: 0.4, throughWalls: true, color: '#0000ff' });
    const objects = WATCH.map(byId);
    for (const id of ['card.light.intensity', 'card.light.throughWalls', 'card.light.colour']) {
      const { container, unmount } = render(<CardField field={field(id)} object={objects[0]} ids={WATCH} objects={objects} />);
      expect(container.querySelector('[data-mixed]')).not.toBeNull();
      expect(screen.getByText('Mixed')).toBeTruthy();
      unmount();
    }
  });

  it('a mixed Direction turns every light by the same amount: buttons and a typed angle, one step each', () => {
    const objects = WATCH.map(byId);
    render(<CardField field={field('card.light.direction')} object={objects[0]} ids={WATCH} objects={objects} />);
    const rotate = screen.getByTestId('rotate-by');
    const spy = vi.spyOn(undoManager, 'execute');
    fireEvent.click(within(rotate).getByLabelText('Turn every direction on 15°'));
    expect(WATCH.map((id) => byId(id).cone?.direction)).toEqual([15, 105, 195, 285]);
    expect(lastLabel(spy)).toBe('Watch: direction');
    fireEvent.click(within(rotate).getByLabelText('Turn every direction back 15°'));
    expect(WATCH.map((id) => byId(id).cone?.direction)).toEqual([0, 90, 180, 270]);
    const input = within(rotate).getByLabelText('Rotate direction by, degrees');
    fireEvent.change(input, { target: { value: '-30' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(WATCH.map((id) => byId(id).cone?.direction)).toEqual([330, 60, 150, 240]);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('with every direction equal, Direction is the plain slider', () => {
    for (const id of WATCH) useStore.getState().updateChild(layerId(), id, { cone: { angle: 60, direction: 40 } });
    const objects = WATCH.map(byId);
    render(<CardField field={field('card.light.direction')} object={objects[0]} ids={WATCH} objects={objects} />);
    expect(screen.queryByTestId('rotate-by')).toBeNull();
    expect(screen.getByText('40°')).toBeTruthy();
  });

  it('Spin on the group: one pace, each beam from where it points, no jump, 90° apart later', () => {
    const now = 1_795_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    field('card.light.motion').write(useStore, WATCH, 'spin');
    const t0 = now / 1000;
    expect(WATCH.map((id) => coneAt(byId(id), t0)!.direction)).toEqual([0, 90, 180, 270].map((d) => expect.closeTo(d, 3)));
    expect(new Set(WATCH.map((id) => JSON.stringify(byId(id).motion)))).toHaveProperty('size', 1);
    for (const dt of [1, 4.5, 12]) {
      const a = WATCH.map((id) => coneAt(byId(id), t0 + dt)!.direction);
      a.forEach((d, i) => expect((((d - a[0]!) % 360) + 360) % 360).toBeCloseTo(i * 90, 3));
    }
    // Members at different paces read Mixed; setting the speed makes them one, still without a jump.
    useStore.getState().updateChild(layerId(), 'b2', { motion: { ...byId('b2').motion!, rpm: 12 } as LightChild['motion'] });
    expect(sharedValue(field('card.light.spinSpeed'), WATCH.map(byId)).mixed).toBe(true);
    const later = t0 + 3;
    vi.spyOn(Date, 'now').mockReturnValue(later * 1000);
    const before = WATCH.map((id) => coneAt(byId(id), later)!.direction);
    field('card.light.spinSpeed').write(useStore, WATCH, 20);
    expect(sharedValue(field('card.light.spinSpeed'), WATCH.map(byId))).toEqual({ value: 20, mixed: false });
    WATCH.forEach((id, i) => expect(coneAt(byId(id), later)!.direction).toBeCloseTo(before[i]!, 3));
  });

  it('Still stops each beam where it is drawn: no snap back, the spread kept, one step', () => {
    const now = 1_795_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    field('card.light.motion').write(useStore, WATCH, 'spin');
    const later = now + 2_500; // 6 rpm for 2.5 s: a quarter turn
    vi.spyOn(Date, 'now').mockReturnValue(later);
    const drawn = WATCH.map((id) => coneAt(byId(id), later / 1000)!.direction);
    const spy = vi.spyOn(undoManager, 'execute');
    field('card.light.motion').write(useStore, WATCH, 'still');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(lastLabel(spy)).toBe('Watch: stop moving');
    expect(WATCH.every((id) => byId(id).motion === undefined)).toBe(true);
    WATCH.forEach((id, i) => expect(Math.abs(byId(id).cone!.direction - drawn[i]!) % 360).toBeLessThanOrEqual(0.5));
    expect(WATCH.map((id) => byId(id).cone!.direction)).toEqual([90, 180, 270, 0]);
    undoManager.undo();
    expect(WATCH.map((id) => byId(id).cone!.direction)).toEqual([0, 90, 180, 270]);
    expect(WATCH.every((id) => byId(id).motion?.kind === 'spin')).toBe(true);
  });

  it('a card over spinning and sweeping lights: Motion reads Mixed, no row of either kind', () => {
    field('card.light.motion').write(useStore, ['b0', 'b1'], 'spin');
    field('card.light.motion').write(useStore, ['b2', 'b3'], 'sweep');
    useStore.getState().setSelectedIds(WATCH);
    const { container } = render(<MixedCard kindCard={lightCard as never} />);
    const shown = (id: string) => container.querySelector(`[data-setting="${id}"]`);
    expect(shown('card.light.motion')?.hasAttribute('data-mixed')).toBe(true);
    for (const id of ['card.light.spinWay', 'card.light.spinSpeed', 'card.light.sweepSpeed', 'card.light.sweep.from', 'card.light.sweep.to', 'card.light.direction']) {
      expect(shown(id)).toBeNull();
    }
    expect(shown('card.light.cone')).not.toBeNull();
    expect(screen.getByText('Watch, 4 lights')).toBeTruthy();
    // Picking a kind sets them all to it, each from where it points.
    field('card.light.motion').write(useStore, WATCH, 'spin');
    expect(new Set(WATCH.map((id) => byId(id).motion?.kind))).toEqual(new Set(['spin']));
  });

  it('the card over a group never runs wider than its panel: fieldsets and fixed-width rows are held to the body', () => {
    // jsdom lays nothing out, so this pins the two rules that keep every child inside the 272 px
    // panel's body (272 less 24 of padding less the scrollbar gutter, under 248): a fieldset, which a
    // browser will not shrink below its content, takes the body's min-w-0; and every fixed-width
    // row is a composite the body caps at its own width.
    field('card.light.motion').write(useStore, WATCH, 'spin');
    useStore.getState().setSelectedIds(WATCH);
    const { container } = render(<MixedCard kindCard={lightCard as never} />);
    const body = container.querySelector('[data-testid="shell-card"] > div:last-child') as HTMLElement;
    expect(body.className).toBe(PANEL_BODY);
    expect(PANEL_BODY).toContain('[&_fieldset]:min-w-0');
    expect(PANEL_BODY).toContain('[&_[data-composite]]:max-w-full');
    expect(PANEL_BODY).toContain('overflow-x-hidden');
    const fieldsets = body.querySelectorAll('fieldset');
    expect(fieldsets.length).toBeGreaterThan(3);
    fieldsets.forEach((f) => expect(body.contains(f)).toBe(true));
    // Every element with a width of its own over 200 px is a capped composite (or inside one).
    // (Filtered in code: jsdom's selectors do not match a "[" inside an attribute value.)
    const wide = [...body.querySelectorAll<HTMLElement>('*')].filter((el) => {
      const m = /(?:^|\s)w-\[(\d+)px\]/.exec(el.getAttribute('class') ?? '');
      return m && Number(m[1]) > 200;
    });
    expect(wide.length).toBeGreaterThan(0);
    for (const el of wide) expect(el.closest('[data-composite]')).not.toBeNull();
    // The rows the Chrome check saw clipped are all there, inside the body.
    for (const id of ['card.light.intensity', 'card.light.colour', 'card.light.cone', 'card.light.direction', 'card.light.motion', 'card.light.effect', 'card.light.spinSpeed']) {
      expect(body.querySelector(`[data-setting="${id}"]`)).not.toBeNull();
    }
  });

  it('dragging a sweep edge on the map keeps the beam where it is drawn', () => {
    const now = 1_795_000_000.25;
    const l: LightChild = { ...byId('b1'), motion: { kind: 'sweep', from: 0, to: 90, degPerSec: 45, since: now - 0.6 } };
    const before = coneAt(l, now)!.direction;
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(90);
    // East of the light, a little south: an edge at about 120°.
    const p = { x: l.position.x - 1, y: l.position.y + Math.sqrt(3) };
    const patch = dragPatch(l, 'to', p, 5, false, now);
    expect((patch.motion as { to: number }).to).toBe(120);
    expect(coneAt({ ...l, ...patch }, now)!.direction).toBeCloseTo(before, 3);
  });

  it('a mixed sweep edge turns every edge by the same amount', () => {
    field('card.light.motion').write(useStore, WATCH, 'sweep');
    const froms = WATCH.map((id) => (byId(id).motion as { from: number }).from);
    const objects = WATCH.map(byId);
    render(<CardField field={field('card.light.sweep.from')} object={objects[0]} ids={WATCH} objects={objects} />);
    fireEvent.click(within(screen.getByTestId('rotate-by')).getByLabelText('Turn every from on 15°'));
    expect(WATCH.map((id) => (byId(id).motion as { from: number }).from)).toEqual(froms.map((f) => (f + 15) % 360));
  });
});

describe('one member picked alone', () => {
  it('says it is part of the group, and Select group picks them all', () => {
    useStore.getState().setSelectedIds(['b1']);
    render(<GroupField def={field('card.light.group') as never} value="Watch" onChange={() => {}} />);
    expect(screen.getByTestId('light-group-note').textContent).toBe('Part of Watch. Select group to edit all 4');
    fireEvent.click(screen.getByText('Select group'));
    expect(useStore.getState().selection.selectedIds).toEqual(WATCH);
  });
});

describe('the Light tool\'s Groups list', () => {
  it('rows: the name, "4 lights" or "2 of 4 on" while mixed', () => {
    expect(groupRows(lightGroups(useStore.getState().layers))).toEqual([{ name: 'Watch', ids: WATCH, switchIds: WATCH, count: '4 lights', on: 'all' }]);
    useStore.getState().updateChild(layerId(), 'b0', { visible: false });
    useStore.getState().updateChild(layerId(), 'b3', { visible: false });
    expect(groupRows(lightGroups(useStore.getState().layers))[0]).toMatchObject({ count: '2 of 4 on', on: 'some' });
  });

  it('its switch leaves locked lights, and lights on a locked layer, as they are', () => {
    useStore.getState().updateChild(layerId(), 'b1', { locked: true, visible: false });
    const [row] = groupRows(lightGroups(useStore.getState().layers));
    expect(row!.switchIds).toEqual(['b0', 'b2', 'b3']);
    expect(row!.count).toBe('3 of 4 on');
    render(<LightGroupsPanel />);
    fireEvent.click(within(screen.getByTestId('light-group-row')).getByRole('switch', { name: 'Watch on' }));
    expect(byId('b1').visible).toBe(false);
    // A light on a locked layer is left out too.
    cleanup();
    useStore.getState().updateChild(layerId(), 'b1', { locked: false });
    useStore.setState((s) => {
      const l = s.layers.find((x) => x.id === layerId())!;
      l.locked = true;
    });
    render(<LightGroupsPanel />);
    fireEvent.click(within(screen.getByTestId('light-group-row')).getByRole('switch', { name: 'Watch on' }));
    expect(byId('b1').visible).toBe(false);
  });

  it('switches the group in one step (mixed reads off), selects it, renames it', () => {
    useStore.getState().updateChild(layerId(), 'b0', { visible: false });
    render(<LightGroupsPanel />);
    const row = screen.getByTestId('light-group-row');
    expect(within(row).getByText('3 of 4 on')).toBeTruthy();
    const sw = within(row).getByRole('switch', { name: 'Watch on' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    const spy = vi.spyOn(undoManager, 'execute');
    fireEvent.click(sw);
    expect(WATCH.every((id) => byId(id).visible)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    fireEvent.click(within(row).getByText('Select'));
    expect(useStore.getState().selection.selectedIds).toEqual(WATCH);
    fireEvent.click(within(row).getByLabelText('Rename Watch'));
    const input = within(screen.getByTestId('light-group-row')).getByLabelText('New name for Watch');
    fireEvent.change(input, { target: { value: 'Lighthouse' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(WATCH.every((id) => byId(id).group === 'Lighthouse')).toBe(true);
  });

  it('with no groups, says how to make one', () => {
    for (const id of WATCH) useStore.getState().updateChild(layerId(), id, { group: undefined });
    render(<LightGroupsPanel />);
    expect(screen.getByText("No groups yet. Name a group on a light's card.")).toBeTruthy();
  });
});

describe('the Select hint over a stack', () => {
  it('adds "4 here, right-click to pick" past one object', () => {
    expect(crowdText(1)).toBeNull();
    expect(crowdText(4)).toBe('4 here, right-click to pick');
    useStore.setState((s) => {
      s.selection.hoverCount = 4;
    });
    const line = selectHint(useStore.getState() as never);
    expect(line.segments.at(-1)!.text).toBe('· 4 here, right-click to pick');
  });
});

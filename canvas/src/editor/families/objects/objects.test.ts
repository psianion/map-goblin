import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { createDefaultState, createDungeonLayer } from '@/store/factories';
import type { AssetChild } from '@/store/types';
import type { CardFieldDef } from '@/editor/registry';
import { createRegistry } from '@/editor/registry';
import { RAIL_TOOLS } from '@/editor/registry/rail';
import { SHARED_SETTINGS } from '@/editor/registry/shared';
import { validateRegistry } from '@/editor/registry/validate';
import { createSettings } from '@/editor/registry/settings';
import { cards, families } from '@/editor/families';
import { toolForEngine, pickTool } from '@/editor/surfaces/hooks';
import { OBJECTS_CARDS, objects } from './index';
import { placeUnder } from './tools';

const input = () => ({ rail: RAIL_TOOLS, families: [...families], shared: SHARED_SETTINGS, cards: [...cards] });
const reg = createRegistry(input());
const settings = createSettings(reg, useStore);
const st = () => useStore.getState();
const brush = () => st().tools.settings.scatterBrush;

const prop = (over: Partial<AssetChild> = {}): AssetChild => ({
  id: 'p1',
  name: 'Crate',
  childType: 'asset',
  visible: true,
  objectType: 'asset',
  assetId: 'p:crate_1',
  position: { x: 3, y: 3 },
  rotation: 0,
  scale: 1,
  width: 1,
  height: 1,
  tint: '#ffffff',
  flipX: false,
  flipY: false,
  ...over,
});

function seed(children: AssetChild[]) {
  const layer = { ...createDungeonLayer('Props', st().ui.activeLevelId), id: 'l1', children };
  useStore.setState((s) => {
    s.layers = [layer];
    s.ui.activeLayerId = 'l1';
    s.selection.selectedIds = children.map((c) => c.id);
  });
}

const child = () => (st().layers[0] as { children: AssetChild[] }).children[0];
const field = (id: string) => OBJECTS_CARDS[0].fields.find((f) => f.id === id) as unknown as CardFieldDef<'asset'>;

beforeEach(() => {
  localStorage.clear();
  undoManager.clear();
  st().resetToDefault();
});

describe('the Objects family', () => {
  it('passes every registry rule beside the other families, bindings included', () => {
    expect(validateRegistry(input(), createDefaultState())).toEqual([]);
  });

  it('is two tools on one props brush, told apart by its stamp mode', () => {
    expect(objects.tools.map((t) => [t.id, t.engine])).toEqual([
      ['stamp', ['scatterBrush']],
      ['scatter', ['scatterBrush']],
    ]);
    pickTool(reg.toolById('scatter')!);
    expect(st().tools.activeTool).toBe('scatterBrush');
    expect(brush().stampMode).toBe(false);
    expect(toolForEngine(reg, 'scatterBrush', st())?.id).toBe('scatter');
    pickTool(reg.toolById('stamp')!);
    expect(brush().stampMode).toBe(true);
    expect(toolForEngine(reg, 'scatterBrush', st())?.id).toBe('stamp');
  });

  it('opens the asset library when Stamp is picked', () => {
    expect(reg.toolById('stamp')!.opensAssets).toBe('object');
  });

  it('defines Place under once and lists it in both panels', () => {
    for (const id of ['stamp', 'scatter']) expect(reg.settingsByHome(id, 'panel')).toContain(placeUnder);
    expect(reg.settingsByHome('stamp', 'panel').map((s) => s.id)).toEqual(['stamp.keepPlacing', 'objects.placeUnder']);
  });

  it('keeps the seed out of sight and See under overhead out of the dock', () => {
    const ids = [...reg.toolById('stamp')!.settings, ...reg.toolById('scatter')!.settings].map((s) => s.id);
    expect(ids.some((id) => /seed|overhead|vary/i.test(id))).toBe(false);
  });

  it('parses every default', () => {
    const defs = [...objects.tools.flatMap((t) => t.settings), ...OBJECTS_CARDS.flatMap((c) => c.fields)];
    for (const d of defs) expect(d.schema.safeParse(d.default).success, d.id).toBe(true);
  });
});

describe('Stamp settings', () => {
  it('writes the angle in degrees, the tint before placing and Random for the variant', () => {
    settings.setSetting('stamp.angle', 90);
    expect(brush().stampRotation).toBeCloseTo(Math.PI / 2);
    expect(settings.setSetting('stamp.angle', 400)).toBe(false);
    settings.setSetting('stamp.tint', '#aa3322');
    expect(brush().stampTint).toBe('#aa3322');
    settings.setSetting('stamp.variant', 'random');
    expect(brush().stampVary).toBe(true);
    settings.setSetting('stamp.variant', 'p:crate_2');
    expect(brush()).toMatchObject({ stampVary: false, assetIds: ['p:crate_2'] });
  });
});

describe('Scatter settings', () => {
  it('writes both ends of the rotation range, in degrees', () => {
    expect(settings.getSetting('scatter.rotationRange')).toEqual([0, 360]);
    settings.setSetting('scatter.rotationRange', [0, 30]);
    expect(brush().rotationRange[1]).toBeCloseTo(Math.PI / 6);
    expect(settings.setSetting('scatter.rotationRange', [90, 30])).toBe(false);
  });

  it('re-rolls a new seed without showing it, and caps the tints at four', () => {
    const before = brush().seed;
    let changed = false;
    for (let i = 0; i < 5 && !changed; i++) {
      settings.setSetting('scatter.reroll', before);
      changed = brush().seed !== before;
    }
    expect(changed).toBe(true);
    expect(settings.setSetting('scatter.tints', ['#111111', '#222222', '#333333', '#444444', '#555555'])).toBe(false);
  });
});

describe('the prop card', () => {
  it('has no Glows and no Blocks movement', () => {
    const ids = OBJECTS_CARDS[0].fields.map((f) => f.id);
    expect(ids.some((id) => /glow|movement/i.test(id))).toBe(false);
  });

  it('writes tint and opacity, a drag as one undo step', () => {
    seed([prop()]);
    field('card.prop.tint').write(useStore, ['p1'], '#336699');
    field('card.prop.tint').write(useStore, ['p1'], '#336600');
    expect(child().tint).toBe('#336600');
    expect(undoManager.size()).toBe(1);
    undoManager.undo();
    expect(child().tint).toBe('#ffffff');
    field('card.prop.opacity').write(useStore, ['p1'], 0.4);
    expect(child().opacity).toBe(0.4);
  });

  it('moves and sizes the prop through Transform, undoably', () => {
    seed([prop()]);
    expect(field('card.prop.transform').read(child())).toEqual({ x: 3, y: 3, w: 1, h: 1, angle: 0 });
    field('card.prop.transform').write(useStore, ['p1'], { x: 5, y: 4, w: 2, h: 2, angle: 90 });
    expect(child()).toMatchObject({ position: { x: 5, y: 4 }, width: 2, height: 2 });
    expect(child().rotation).toBeCloseTo(Math.PI / 2);
    undoManager.undo();
    expect(child().position).toEqual({ x: 3, y: 3 });
  });

  it('switches overhead, lock and the behaviour fields, each undoably', () => {
    seed([prop()]);
    for (const [id, key] of [
      ['card.prop.overhead', 'overhead'],
      ['card.prop.castsShadow', 'castsShadow'],
      ['card.prop.blocksLight', 'blocksLight'],
      ['card.prop.lock', 'locked'],
    ] as const) {
      const was = field(id).read(child());
      field(id).write(useStore, ['p1'], !was);
      expect(child()[key]).toBe(!was);
      undoManager.undo();
      expect(field(id).read(child())).toBe(was);
    }
  });
});

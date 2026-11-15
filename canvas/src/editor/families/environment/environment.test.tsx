import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { createDefaultState, createDungeonLayer } from '@/store/factories';
import type { LightChild } from '@/store/types';
import { createRegistry } from '@/editor/registry';
import type { CardFieldDef } from '@/editor/registry';
import { RAIL_TOOLS } from '@/editor/registry/rail';
import { SHARED_SETTINGS } from '@/editor/registry/shared';
import { validateRegistry } from '@/editor/registry/validate';
import { createSettings } from '@/editor/registry/settings';
import { cards, families } from '@/editor/families';
import { pickTool } from '@/editor/surfaces/hooks';
import { resetShell, useShell } from '@/editor/shell/shellStore';
import { getPreview, resetViewPrefsForTests, setPreview } from '@/editor/viewPrefs';
import { ENVIRONMENT_CARDS, SkyMoodSheet, environment, skyEntry } from './index';

const input = () => ({ rail: RAIL_TOOLS, families: [...families], shared: SHARED_SETTINGS, cards: [...cards] });
const reg = createRegistry(input());
const settings = createSettings(reg, useStore);
const st = () => useStore.getState();
const next = () => st().tools.settings.lightDefaults;

const light = (over: Partial<LightChild> = {}): LightChild => ({
  id: 'l1',
  name: 'Torch',
  childType: 'light',
  visible: true,
  color: '#ffaa55',
  radius: 8,
  featherRadius: 4,
  intensity: 0.9,
  falloff: 'quadratic',
  position: { x: 2, y: 2 },
  ...over,
});

function seed(children: LightChild[]) {
  const layer = { ...createDungeonLayer('Keep', st().ui.activeLevelId), id: 'd1', children };
  useStore.setState((s) => {
    s.layers = [layer];
    s.ui.activeLayerId = 'd1';
    s.selection.selectedIds = children.map((c) => c.id);
  });
}
const placed = () => (st().layers[0] as { children: LightChild[] }).children[0];
const field = (id: string) => ENVIRONMENT_CARDS[0].fields.find((f) => f.id === id) as unknown as CardFieldDef<'light'>;

beforeEach(() => {
  localStorage.clear();
  undoManager.clear();
  st().resetToDefault();
});
afterEach(cleanup);

describe('the Environment family', () => {
  it('passes every registry rule beside the other families, bindings included', () => {
    expect(validateRegistry(input(), createDefaultState())).toEqual([]);
  });

  it('holds the Light tool under E, key L, its dock and panel as plan 6.4 has them', () => {
    expect([environment.key, environment.tools.map((t) => [t.label, t.key])]).toEqual(['E', [['Light', 'L'], ['Sky', 'K']]]);
    const ids = (home: 'dock' | 'panel') => reg.settingsByHome('light', home).map((s) => s.id);
    expect(ids('dock')).toEqual(['light.bright', 'light.dim', 'light.intensity', 'light.colour']);
    expect(ids('panel')).toEqual(['light.cone', 'light.direction', 'light.effect', 'light.speed', 'light.throughWalls']);
  });

  it('carries no Flicker switch, Falloff, Night only, Darkvision or Darkness toggle', () => {
    const ids = [...reg.toolById('light')!.settings, ...ENVIRONMENT_CARDS[0].fields].map((s) => s.id);
    expect(ids.some((id) => /flicker|falloff|night|darkvision|darkness/i.test(id))).toBe(false);
  });

  it('starts Bright at the control minimum, 5 ft, not 0', () => {
    expect(settings.getSetting('light.bright')).toBe(5);
    expect(next().featherRadius).toBe(1);
  });
});

describe('the next light', () => {
  it('keeps bright inside dim from either side, in feet over cells', () => {
    settings.setSetting('light.bright', 40);
    expect(next()).toMatchObject({ featherRadius: 8, radius: 8 });
    settings.setSetting('light.dim', 20);
    expect(next()).toMatchObject({ featherRadius: 4, radius: 4 });
    expect(settings.setSetting('light.bright', 3)).toBe(false);
  });

  it('writes the effect and its speed as one animation, and a full cone as none', () => {
    settings.setSetting('light.effect', 'pulse');
    settings.setSetting('light.speed', 2);
    expect(next().animation).toEqual({ kind: 'pulse', speed: 2 });
    settings.setSetting('light.effect', 'none');
    expect(next().animation).toBeUndefined();
    settings.setSetting('light.cone', 90);
    settings.setSetting('light.direction', 180);
    expect(next().cone).toEqual({ angle: 90, direction: 180 });
    settings.setSetting('light.cone', 360);
    expect(next().cone).toBeUndefined();
  });

  it('lets go of the preset tile on a hand edit', () => {
    st().updateLightDefaults({ presetId: 'torch' });
    settings.setSetting('light.intensity', 0.5);
    expect(next().presetId).toBeUndefined();
  });
});

describe('the light card', () => {
  it('writes bright, intensity, effect and On at the table, each undoably', () => {
    seed([light()]);
    field('card.light.bright').write(useStore, ['l1'], 10);
    expect(placed().featherRadius).toBe(2);
    field('card.light.intensity').write(useStore, ['l1'], 0.5);
    field('card.light.intensity').write(useStore, ['l1'], 0.4);
    expect(placed().intensity).toBe(0.4);
    field('card.light.effect').write(useStore, ['l1'], 'flicker');
    expect(placed().animation).toEqual({ kind: 'flicker', speed: 1 });
    field('card.light.tableOn').write(useStore, ['l1'], false);
    expect(placed().tableOn).toBe(false);
    expect(undoManager.size()).toBe(4);
    for (let i = 0; i < 4; i++) undoManager.undo();
    expect(placed()).toMatchObject({ featherRadius: 4, intensity: 0.9 });
    expect(placed().animation).toBeUndefined();
    expect(placed().tableOn).toBeUndefined();
  });

  it('offers Attach near a prop and Detach once attached', () => {
    seed([light()]);
    const card = ENVIRONMENT_CARDS[0];
    const attach = card.verbs.find((v) => v.id === 'attachLight')!;
    const detach = card.verbs.find((v) => v.id === 'detachLight')!;
    expect(attach.when!(st())).toBe(false);
    useStore.setState((s) => {
      (s.layers[0] as { children: unknown[] }).children.push({
        id: 'p1', name: 'Sconce', childType: 'asset', visible: true, objectType: 'asset', assetId: 'p:sconce',
        position: { x: 2.2, y: 2 }, rotation: 0, scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false,
      });
    });
    expect(attach.when!(st())).toBe(true);
    attach.run(useStore);
    expect(placed().attachedTo).toBe('p1');
    expect(detach.when!(st())).toBe(true);
    detach.run(useStore);
    expect(placed().attachedTo).toBeUndefined();
  });

  it('hides the colour of a darkness source', () => {
    expect(field('card.light.colour').visibleWhen!(light({ darkness: true }))).toBe(false);
  });
});

describe('the Sky sheet', () => {
  it('has Place, Cast shadows and Tint, and no Lit preview, Climate, Weather, Night sky or Time', () => {
    render(<SkyMoodSheet />);
    expect(screen.getByRole('group', { name: 'Place' })).toBeTruthy();
    expect(screen.getByText('Cast shadows')).toBeTruthy();
    expect(screen.getByText('Tint')).toBeTruthy();
    for (const gone of [/lit preview/i, /climate/i, /weather/i, /night sky/i, /^time$/i, /fixed hour/i]) expect(screen.queryByText(gone)).toBeNull();
  });

  it('changes the place as one undo step', () => {
    render(<SkyMoodSheet />);
    fireEvent.click(screen.getByRole('button', { name: 'Outdoor' }));
    expect(st().mapSettings.environment).toBe('outdoor');
    undoManager.undo();
    expect(st().mapSettings.environment ?? 'indoor').toBe('indoor');
  });
});

describe('the Sky sheet controls', () => {
  it('shows the orientation slider whatever the map place', () => {
    for (const place of ['outdoor', 'indoor', 'underground'] as const) {
      cleanup();
      useStore.setState((s) => {
        s.mapSettings.environment = place;
      });
      render(<SkyMoodSheet />);
      expect(screen.getByText('Orientation'), place).toBeTruthy();
    }
  });

  it('switches Cast shadows on and off through the environment command', () => {
    useStore.setState((s) => {
      s.mapSettings.naturalLight = true;
    });
    render(<SkyMoodSheet />);
    fireEvent.click(screen.getByRole('switch', { name: 'Cast shadows' }));
    expect(st().mapSettings.naturalLight).toBe(false);
    undoManager.undo();
    expect(st().mapSettings.naturalLight).toBe(true);
  });

  it('says so while the map is shown unlit, and not once a time is picked', () => {
    render(<SkyMoodSheet />);
    expect(screen.getByText(/Shown unlit/)).toBeTruthy();
    cleanup();
    setPreview('dusk');
    render(<SkyMoodSheet />);
    expect(screen.queryByText(/Shown unlit/)).toBeNull();
  });
});

describe('the Sky entry', () => {
  beforeEach(() => {
    resetShell();
    resetViewPrefsForTests();
  });

  it('is a sheet entry on K with no engine tool of its own', () => {
    expect(skyEntry).toMatchObject({ id: 'sky', label: 'Sky', key: 'K', sheet: 'sky', engine: [] });
  });

  it('opens the Sky sheet without changing the tool in hand', () => {
    st().setActiveTool('light');
    pickTool(skyEntry);
    expect(useShell.getState().sheet).toBe('sky');
    expect(st().tools.activeTool).toBe('light');
    st().setActiveTool('select');
    pickTool(skyEntry);
    expect(st().tools.activeTool).toBe('select');
  });

  it('leaves the preview where it was', () => {
    pickTool(skyEntry);
    expect(getPreview()).toBe('unlit');
  });

  it('picking the Light tool still activates it and opens no sheet', () => {
    const light = environment.tools.find((t) => t.id === 'light')!;
    pickTool(light);
    expect(st().tools.activeTool).toBe(light.engine[0]);
    expect(useShell.getState().sheet).toBeNull();
  });
});

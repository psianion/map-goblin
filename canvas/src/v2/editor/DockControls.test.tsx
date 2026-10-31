import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer, ShapeChild, ToolType } from '@/store/types';
import { ToolSettings, ToolSwatches } from './DockControls';
import { WATER_BANK_TEXTURE } from './assetStrip';
import { SCATTER_TINT_PALETTE } from './PropsDock';
import { createDungeonLayer } from '@dnd/core/src/store/factories';

// jsdom has no 2D canvas; the thumbnails are not what these tests look at.
vi.mock('@/components/shared/PackThumbnailCanvas', () => ({
  PackThumbnailCanvas: ({ textureId }: { textureId: string }) => <i data-testid={`thumb-${textureId}`} />,
}));

vi.mock('@dnd/core/src/assets/packCatalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd/core/src/assets/packCatalog')>();
  const entries = [
    { id: 'p:moss', type: 'floor', packId: 'p', label: 'Moss' },
    { id: 'p:stone_straight', type: 'wall', set: 'GG_Stone', pieceType: 'straight', packId: 'p', label: 'Stone' },
    { id: 'p:ink_short', type: 'object', set: 'GG_Cave_Ink', material: 'wall_short', packId: 'p', label: 'Ink' },
    { id: 'p:crate_1', type: 'object', set: 'demo-storage', material: 'crate_1', packId: 'p', label: 'crate 1' },
    { id: 'p:crate_2', type: 'object', set: 'demo-storage', material: 'crate_2', packId: 'p', label: 'crate 2' },
    { id: 'p:crate_3', type: 'object', set: 'demo-storage', material: 'crate_3', packId: 'p', label: 'crate 3' },
    { id: 'p:anvil', type: 'object', set: 'demo-gear', material: 'anvil', packId: 'p', label: 'anvil' },
  ];
  const crates = ['p:crate_1', 'p:crate_2', 'p:crate_3'];
  return {
    ...actual,
    getCatalogEntry: (id: string) => entries.find((e) => e.id === id),
    getWallSetIds: () => ['GG_Stone'],
    getWallPieces: (set: string, piece: string) => entries.filter((e) => e.set === set && e.pieceType === piece),
    getBandSetIds: () => ['GG_Cave_Ink'],
    getBandSet: (set: string) => entries.filter((e) => e.set === set && e.type === 'object'),
    isBandSet: (set: string | undefined) => set === 'GG_Cave_Ink',
    getEntriesByType: (type: string) => entries.filter((e) => e.type === type),
    familyPosition: (id: string) =>
      crates.includes(id) ? { index: crates.indexOf(id) + 1, count: 3 } : { index: 1, count: 1 },
    siblingOf: (id: string, step: 1 | -1) => (crates.includes(id) ? crates[(crates.indexOf(id) + step + 3) % 3] : id),
  };
});

vi.mock('@/lib/toast', () => ({
  notify: { subtle: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn(), action: vi.fn() },
}));

function dungeon(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('no dungeon layer');
  return l;
}

function floor(id: string, textureId?: string): ShapeChild {
  return {
    id,
    name: id,
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[0, 0], [4, 0], [4, 4], [0, 4]]],
    textureId,
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
  };
}

function shapeOf(id: string): ShapeChild {
  const c = dungeon().children.find((x) => x.id === id);
  if (!c || c.childType !== 'shape') throw new Error('no shape ' + id);
  return c;
}

function settings(tool: ToolType) {
  useStore.getState().setActiveTool(tool);
  return render(<ToolSettings tool={tool} />);
}

/** Type a hex into an open colour card and close it, as a DM would. */
function pickColour(label: string, hex: string) {
  const swatch = screen.getByRole('button', { name: new RegExp(`^${label} colour`) });
  fireEvent.click(swatch);
  const input = screen.getByRole('textbox', { name: 'Hex colour' });
  fireEvent.change(input, { target: { value: hex } });
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label} colour`) }));
}

beforeEach(() => {
  undoManager.clear();
  useStore.getState().resetToDefault();
  useStore.getState().setActiveLayerId(dungeon().id);
  useStore.setState((s) => {
    s.mapSettings.terrain = undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('terrain quick settings', () => {
  it('sends tint and tint opacity to the terrain brush', () => {
    const real = useStore.getState().updateTerrainBrushSettings;
    const spy = vi.fn(real);
    useStore.setState({ updateTerrainBrushSettings: spy });
    settings('terrain');

    pickColour('Tint', '#336699');
    expect(spy).toHaveBeenCalledWith({ tintColor: '#336699' });
    expect(useStore.getState().tools.settings.terrainBrush.tintColor).toBe('#336699');

    fireEvent.change(screen.getByRole('slider', { name: 'Tint opacity' }), { target: { value: '0.4' } });
    expect(spy).toHaveBeenCalledWith({ tintOpacity: 0.4 });
    expect(useStore.getState().tools.settings.terrainBrush.tintOpacity).toBe(0.4);
  });

  it('shows six slots, an empty one as a plus tile with the note under the row', () => {
    useStore.getState().setTerrainData({ palette: ['p:moss', null, null, null, null, null] });
    useStore.getState().updateTerrainBrushSettings({ slot: 1 });
    useStore.getState().setActiveTool('terrain');
    const onOpenAssets = vi.fn();
    render(<ToolSwatches tool="terrain" tab="floors" onTab={vi.fn()} onOpenAssets={onOpenAssets} />);

    expect(screen.getAllByTestId(/^v2-tslot-\d$/)).toHaveLength(6);
    expect(screen.getByTestId('thumb-p:moss')).toBeTruthy();
    const empty = screen.getByTestId('v2-tslot-1');
    expect(empty.getAttribute('data-tip')).toBe('Assign a texture');
    expect(empty.querySelector('svg')).toBeTruthy();
    expect(screen.getByTestId('v2-tslot-note').textContent).toBe('Assign a texture to this slot to paint.');

    // A second click on the empty slot in hand opens the floor textures.
    fireEvent.click(empty);
    expect(onOpenAssets).toHaveBeenCalledWith('floor');
  });

  it('picks a filled slot, hides the note, and clears it on right-click', () => {
    useStore.getState().setTerrainData({ palette: ['p:moss', null, null, null, null, null] });
    useStore.getState().updateTerrainBrushSettings({ slot: 3 });
    render(<ToolSwatches tool="terrain" tab="floors" onTab={vi.fn()} onOpenAssets={vi.fn()} />);

    fireEvent.click(screen.getByTestId('v2-tslot-0'));
    expect(useStore.getState().tools.settings.terrainBrush.slot).toBe(0);
    expect(screen.queryByTestId('v2-tslot-note')).toBeNull();

    fireEvent.contextMenu(screen.getByTestId('v2-tslot-0'));
    expect(useStore.getState().mapSettings.terrain?.palette[0]).toBeNull();
    expect(screen.getByTestId('v2-tslot-note')).toBeTruthy();
  });

  it('opens the floor textures from "More"', () => {
    const onOpenAssets = vi.fn();
    render(<ToolSwatches tool="terrain" tab="floors" onTab={vi.fn()} onOpenAssets={onOpenAssets} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(onOpenAssets).toHaveBeenCalledWith('floor');
  });
});

describe('drawing quick settings', () => {
  it('Floor colours every floor on the layer as it looks, textured or not, in one undo step', () => {
    const id = dungeon().id;
    useStore.getState().addChild(id, floor('tex', 'p:moss'));
    useStore.getState().addChild(id, { ...floor('pinned', 'p:moss'), textureTint: '#ff0000' });
    useStore.getState().addChild(id, { ...floor('plain'), styleOverrides: { floorColor: '#00ff00' } });
    settings('rectangle');
    const chip = screen.getByRole('button', { name: /^Floor colour/ });
    expect(chip.getAttribute('data-tip')).toBe('Colour of every floor on this layer');
    expect(screen.getByText('Mixed')).not.toBeNull();

    pickColour('Floor', '#3060c0');
    expect(shapeOf('tex').textureTint).toBe('#3060c0');
    expect(shapeOf('pinned').textureTint).toBe('#3060c0');
    expect(shapeOf('plain').styleOverrides).toBeUndefined();
    expect(dungeon().style.floorColor).toBe('#3060c0');
    expect(dungeon().style.defaultTextureTint).toBe('#3060c0');
    expect(screen.queryByText('Mixed')).toBeNull();

    undoManager.undo();
    expect(undoManager.canUndo()).toBe(false);
    expect(shapeOf('tex').textureTint).toBe('#ffffff');
    expect(shapeOf('pinned').textureTint).toBe('#ff0000');
    expect(shapeOf('plain').styleOverrides).toEqual({ floorColor: '#00ff00' });
  });

  it('with an empty active layer, Floor and the strip change every floor on the map', () => {
    const keep = dungeon().id;
    useStore.getState().addChild(keep, floor('tex', 'p:old'));
    const empty = createDungeonLayer('Layer 1');
    useStore.getState().addLayer(empty);
    useStore.getState().setActiveLayerId(empty.id);
    useStore.setState((st) => {
      st.assets.recentlyUsed = ['p:moss'];
    });
    settings('rectangle');
    expect(screen.getByRole('button', { name: /^Floor colour/ }).getAttribute('data-tip')).toBe(
      'Colour of every floor on the map',
    );
    pickColour('Floor', '#3060c0');
    expect(shapeOf('tex').textureTint).toBe('#3060c0');
    cleanup();
    render(<ToolSwatches tool="rectangle" tab="floors" onTab={vi.fn()} onOpenAssets={vi.fn()} />);
    fireEvent.click(within(screen.getByTestId('v2-strip-floors')).getByRole('button', { name: 'Moss' }));
    expect(shapeOf('tex').textureId).toBe('p:moss');
    undoManager.undo();
    undoManager.undo();
    expect(shapeOf('tex').textureId).toBe('p:old');
    expect(shapeOf('tex').textureTint).toBe('#ffffff');
  });

  it('Floor colours only the selected floors when some are', () => {
    const id = dungeon().id;
    useStore.getState().addChild(id, floor('a', 'p:moss'));
    useStore.getState().addChild(id, floor('b', 'p:moss'));
    useStore.getState().setSelectedIds(['a']);
    settings('rectangle');
    expect(screen.getByRole('button', { name: /^Floor colour/ }).getAttribute('data-tip')).toBe(
      'Colour of the selected floors',
    );
    pickColour('Floor', '#3060c0');
    expect(shapeOf('a').textureTint).toBe('#3060c0');
    expect(shapeOf('b').textureTint).toBe('#ffffff');
  });

  it('a floor texture tile retextures every floor on the layer with nothing selected', () => {
    const id = dungeon().id;
    useStore.getState().addChild(id, floor('a', 'p:old'));
    useStore.getState().addChild(id, floor('b'));
    useStore.setState((st) => {
      st.assets.recentlyUsed = ['p:moss'];
    });
    render(<ToolSwatches tool="rectangle" tab="floors" onTab={vi.fn()} onOpenAssets={vi.fn()} />);
    fireEvent.click(within(screen.getByTestId('v2-strip-floors')).getByRole('button', { name: 'Moss' }));
    expect(shapeOf('a').textureId).toBe('p:moss');
    expect(shapeOf('b').textureId).toBe('p:moss');
    expect(dungeon().style.defaultTextureId).toBe('p:moss');
    undoManager.undo();
    expect(shapeOf('a').textureId).toBe('p:old');
    expect(shapeOf('b').textureId).toBeUndefined();
  });

  it('has no wall width on a cave kit layer', () => {
    useStore.getState().updateLayer(dungeon().id, { style: { ...dungeon().style, wallTextureSetId: 'GG_Stone' } });
    const { unmount } = settings('rectangle');
    expect(screen.getByRole('slider', { name: 'Wall' })).not.toBeNull();
    unmount();
    useStore.getState().updateLayer(dungeon().id, { style: { ...dungeon().style, wallTextureSetId: 'GG_Cave_Ink' } });
    settings('rectangle');
    expect(screen.queryByRole('slider', { name: 'Wall' })).toBeNull();
  });
});

describe('water quick settings', () => {
  it('turns banks on and off with the two bank ids', () => {
    useStore.getState().updateWaterSettings({ bankTextureId: '' });
    settings('water');
    const banks = screen.getByRole('switch', { name: 'Banks' });
    expect(banks.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(banks);
    expect(useStore.getState().tools.settings.water.bankTextureId).toBe(WATER_BANK_TEXTURE);
    expect(WATER_BANK_TEXTURE).toBe('gg-forge:bank-grassy-01-a1');

    fireEvent.click(screen.getByRole('switch', { name: 'Banks' }));
    expect(useStore.getState().tools.settings.water.bankTextureId).toBe('');
  });

  it('has no Flow slider: water is still', () => {
    settings('water');
    expect(screen.queryByLabelText('Flow')).toBeNull();
    expect(screen.queryByText('Flow')).toBeNull();
  });
});

describe('wall quick settings', () => {
  it('a cave kit layer keeps its wall tint but has no width: the rock is laid at its drawn size', () => {
    useStore.getState().updateLayer(dungeon().id, { style: { ...dungeon().style, wallTextureSetId: 'GG_Stone' } });
    const { unmount } = settings('wall');
    expect(screen.getByRole('slider', { name: 'Width' })).not.toBeNull();
    unmount();
    useStore.getState().updateLayer(dungeon().id, { style: { ...dungeon().style, wallTextureSetId: 'GG_Cave_Ink' } });
    settings('wall');
    expect(screen.queryByRole('slider', { name: 'Width' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Wall tint colour/ })).not.toBeNull();
  });

  it('the wall strip offers the cave kit beside the stone sets, shown by its short piece, and picks it', () => {
    useStore.getState().updateLayer(dungeon().id, { style: { ...dungeon().style, wallTextureSetId: 'GG_Stone' } });
    useStore.getState().setActiveTool('wall');
    render(<ToolSwatches tool="wall" tab="walls" onTab={() => {}} onOpenAssets={() => {}} />);
    const strip = screen.getByTestId('v2-strip-walls');
    const tiles = [...strip.querySelectorAll('button.v2-swatch')].map((b) => b.getAttribute('aria-label'));
    expect(tiles).toEqual(['Stone', 'Cave Ink']);
    expect(screen.getByTestId('thumb-p:ink_short')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Stone' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Cave Ink' }));
    expect(dungeon().style.wallTextureSetId).toBe('GG_Cave_Ink');
    expect(screen.getByRole('button', { name: 'Cave Ink' }).getAttribute('aria-pressed')).toBe('true');
    undoManager.undo();
    expect(dungeon().style.wallTextureSetId).toBe('GG_Stone');
  });

  it('the Cave / Natural style puts the layer on the cave kit and marks both the style and the kit', () => {
    useStore.getState().setActiveTool('wall');
    render(<ToolSwatches tool="wall" tab="walls" onTab={() => {}} onOpenAssets={() => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Cave / Natural' })[0]);
    expect(dungeon().style.wallTextureSetId).toBe('GG_Cave_Ink');
    expect(screen.getAllByRole('button', { name: 'Cave / Natural' })[0].getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Cave Ink' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows no wall tint for untextured walls', () => {
    useStore.getState().updateLayer(dungeon().id, { style: { ...dungeon().style, wallTextureSetId: undefined } });
    settings('wall');
    expect(screen.queryByRole('button', { name: /^Wall tint colour/ })).toBeNull();
  });

  it('commits a wall tint visit as one undo step', () => {
    useStore.getState().updateLayer(dungeon().id, {
      style: { ...dungeon().style, wallTextureSetId: 'GG_Stone', wallTextureTint: '#ffffff' },
    });
    const execute = vi.spyOn(undoManager, 'execute');
    settings('wall');

    pickColour('Wall tint', '#aa8844');
    expect(dungeon().style.wallTextureTint).toBe('#aa8844');
    expect(execute).toHaveBeenCalledTimes(1);

    undoManager.undo();
    expect(dungeon().style.wallTextureTint).toBe('#ffffff');
  });

  it('offers the three types the engine tells apart, each saying what it blocks', () => {
    settings('wall');
    const group = screen.getByRole('group', { name: 'Type' });
    const buttons = [...group.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Solid', 'Window', 'Open']);
    expect(buttons.map((b) => b.getAttribute('data-tip'))).toEqual([
      'Solid: blocks light and sight',
      'Window: lets light and sight through, still drawn as a wall',
      'Open: blocks nothing, drawn faint and dashed',
    ]);
  });

  it('writes normal, window and invisible for new walls', () => {
    settings('wall');
    fireEvent.click(screen.getByRole('button', { name: 'Window' }));
    expect(useStore.getState().tools.settings.wallType).toBe('window');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(useStore.getState().tools.settings.wallType).toBe('invisible');
    fireEvent.click(screen.getByRole('button', { name: 'Solid' }));
    expect(useStore.getState().tools.settings.wallType).toBe('normal');
  });

  it('shows a stored terrain or ethereal type as the group it acts like, and keeps it', () => {
    useStore.getState().updateToolSettings({ wallType: 'terrain' });
    const { unmount } = settings('wall');
    expect(screen.getByRole('button', { name: 'Open' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(useStore.getState().tools.settings.wallType).toBe('terrain');
    unmount();

    useStore.getState().updateToolSettings({ wallType: 'ethereal' });
    settings('wall');
    expect(screen.getByRole('button', { name: 'Solid' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('has no Faces control and no wall colour', () => {
    settings('wall');
    expect(screen.queryByText('Faces')).toBeNull();
    expect(screen.queryByLabelText('Faces')).toBeNull();
    expect(screen.queryByText(/wall colou?r/i)).toBeNull();
  });
});

describe('All settings', () => {
  it.each<ToolType>(['rectangle', 'polygon', 'regularPolygon', 'path', 'terrain', 'water', 'wall', 'door', 'scatterBrush'])(
    'is gone for %s, whose settings all sit in the row',
    (tool) => {
      settings(tool);
      expect(screen.queryByTestId('v2-settings-more')).toBeNull();
    },
  );

  it.each<ToolType>(['light'])('stays for %s', (tool) => {
    settings(tool);
    expect(screen.getByTestId('v2-settings-more')).toBeTruthy();
  });
});

describe('door quick settings', () => {
  it('carries style, secret and width, the width rising with a wider style', () => {
    useStore.getState().updateToolSettings({ doorStyle: 'single', doorWidth: 1, doorSecret: false });
    settings('door');
    fireEvent.change(screen.getByRole('combobox', { name: 'Style' }), { target: { value: 'double' } });
    expect(useStore.getState().tools.settings.doorStyle).toBe('double');
    expect(useStore.getState().tools.settings.doorWidth).toBe(2);
    fireEvent.click(screen.getByRole('switch', { name: 'Secret' }));
    expect(useStore.getState().tools.settings.doorSecret).toBe(true);
    expect(screen.getByRole('slider', { name: 'Width' })).toBeTruthy();
  });

  it('Angle takes a typed angle held to 0–180 in 15° steps, and Turn 90° adds a quarter and wraps', () => {
    useStore.getState().updateToolSettings({ doorAngle: 0 });
    settings('door');
    const angle = () => useStore.getState().tools.settings.doorAngle;
    const field = screen.getByRole('textbox', { name: 'Door angle' }) as HTMLInputElement;
    expect(field.value).toBe('0');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '47' } });
    fireEvent.blur(field);
    expect(angle()).toBe(45);
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '400' } });
    fireEvent.blur(field);
    expect(angle()).toBe(0);
    const turn = screen.getByRole('button', { name: 'Turn 90°' });
    fireEvent.click(turn);
    expect(angle()).toBe(90);
    fireEvent.click(turn);
    expect(angle()).toBe(0);
  });
});

describe('props quick settings', () => {
  const brush = () => useStore.getState().tools.settings.scatterBrush;
  const stamp = () => {
    useStore.getState().updateScatterBrushSettings({ stampMode: true, assetIds: ['p:crate_2'], stampRotation: Math.PI / 6 });
    return settings('scatterBrush');
  };

  it('Stamp: the Scale slider writes the stamp scale, the old scale range is gone', () => {
    stamp();
    fireEvent.change(screen.getByRole('slider', { name: 'Scale' }), { target: { value: '1.5' } });
    expect(brush().stampScale).toBe(1.5);
    expect(screen.queryByRole('slider', { name: /smallest/ })).toBeNull();
  });

  it('Stamp: the angle chip reads the wheel turn and resets it on a click', () => {
    stamp();
    fireEvent.click(screen.getByRole('button', { name: /^Angle 30°/ }));
    expect(brush().stampRotation).toBe(0);
    expect(screen.getByRole('button', { name: /^Angle 0°/ })).toBeTruthy();
  });

  it('Stamp: Mirror toggles the flip, and the variant stepper walks the family', () => {
    stamp();
    fireEvent.click(screen.getByRole('switch', { name: 'Mirror' }));
    expect(brush().stampFlipX).toBe(true);
    expect(screen.getByTestId('v2-props-variant').textContent).toContain('2/3');
    fireEvent.click(screen.getByRole('button', { name: /^Next variant/ }));
    expect(brush().assetIds).toEqual(['p:crate_3']);
    fireEvent.click(screen.getByRole('button', { name: /^Previous variant/ }));
    expect(brush().assetIds).toEqual(['p:crate_2']);
  });

  it('Stamp: a family of one has no variants to step', () => {
    useStore.getState().updateScatterBrushSettings({ stampMode: true, assetIds: ['p:anvil'] });
    settings('scatterBrush');
    expect((screen.getByRole('button', { name: /^Next variant/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Stamp: the more card holds Keep placing, Vary each stamp and Place under', () => {
    stamp();
    fireEvent.click(screen.getByTestId('v2-props-more'));
    const card = screen.getByRole('dialog', { name: 'Stamp settings' });
    fireEvent.click(within(card).getByRole('switch', { name: 'Keep placing' }));
    expect(useStore.getState().tools.settings.continuousPlacement).toBe(true);
    fireEvent.click(within(card).getByRole('switch', { name: 'Vary each stamp' }));
    expect(brush().stampVary).toBe(true);
    fireEvent.click(within(card).getByRole('switch', { name: 'Place under existing props' }));
    expect(brush().placeUnder).toBe(true);
  });

  it('Scatter: Radius and Density write the brush; no Count, no legacy settings', () => {
    useStore.getState().updateScatterBrushSettings({ stampMode: false });
    settings('scatterBrush');
    fireEvent.change(screen.getByRole('slider', { name: 'Radius' }), { target: { value: '4.5' } });
    fireEvent.change(screen.getByRole('slider', { name: 'Density' }), { target: { value: '0.5' } });
    expect(brush().brushRadius).toBe(4.5);
    expect(brush().density).toBe(0.5);
    expect(screen.queryByText('Count')).toBeNull();
    expect(screen.queryByTestId('v2-settings-more')).toBeNull();
  });

  it('Scatter: the more card sets ranges, spacing, the switches, tints and the seed', () => {
    useStore.getState().updateScatterBrushSettings({ stampMode: false, tints: [], seed: 7 });
    settings('scatterBrush');
    fireEvent.click(screen.getByTestId('v2-props-more'));
    const card = screen.getByRole('dialog', { name: 'Scatter settings' });
    fireEvent.change(within(card).getByRole('slider', { name: 'Scale range, largest' }), { target: { value: '1.6' } });
    expect(brush().scaleRange[1]).toBe(1.6);
    fireEvent.change(within(card).getByRole('slider', { name: 'Rotation, largest' }), { target: { value: '90' } });
    expect(brush().rotationRange[1]).toBeCloseTo(Math.PI / 2);
    fireEvent.change(within(card).getByRole('slider', { name: 'Spacing' }), { target: { value: '1.2' } });
    expect(brush().minSpacing).toBe(1.2);
    fireEvent.click(within(card).getByRole('switch', { name: 'Avoid overlaps' }));
    fireEvent.click(within(card).getByRole('switch', { name: 'Stay on floors' }));
    fireEvent.click(within(card).getByRole('switch', { name: 'Random variant' }));
    expect(brush()).toMatchObject({ avoidOverlap: false, stayOnFloor: false, randomVariant: false });
    fireEvent.click(within(card).getByRole('button', { name: 'Add a tint' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Add a tint' }));
    expect(brush().tints).toHaveLength(2);
    expect(within(card).getByText('2 of 4')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Clear' }));
    expect(brush().tints).toEqual([]);
    fireEvent.click(within(card).getByTestId('v2-props-reroll'));
    expect(brush().seed).not.toBe(7);
  });

  it('Scatter: the card opens on the board’s defaults, Random variant on and Spacing 0.5', () => {
    expect(brush()).toMatchObject({ randomVariant: true, minSpacing: 0.5, avoidOverlap: true, stayOnFloor: true, placeUnder: false });
    useStore.getState().updateScatterBrushSettings({ stampMode: false });
    settings('scatterBrush');
    fireEvent.click(screen.getByTestId('v2-props-more'));
    const card = screen.getByRole('dialog', { name: 'Scatter settings' });
    expect(within(card).getByRole('switch', { name: 'Random variant' }).getAttribute('aria-checked')).toBe('true');
    expect((within(card).getByRole('slider', { name: 'Spacing' }) as HTMLInputElement).value).toBe('0.5');
  });

  it('Scatter: each added tint takes the next free colour of the palette, so no two match', () => {
    useStore.getState().updateScatterBrushSettings({ stampMode: false, tints: [] });
    settings('scatterBrush');
    fireEvent.click(screen.getByTestId('v2-props-more'));
    const card = screen.getByRole('dialog', { name: 'Scatter settings' });
    const add = () => fireEvent.click(within(card).getByRole('button', { name: 'Add a tint' }));
    add();
    add();
    add();
    expect(brush().tints).toEqual(SCATTER_TINT_PALETTE.slice(0, 3));
    expect(new Set(SCATTER_TINT_PALETTE).size).toBe(6);
    // A colour already in the pool is skipped, wherever it sits.
    act(() => useStore.getState().updateScatterBrushSettings({ tints: [SCATTER_TINT_PALETTE[0], SCATTER_TINT_PALETTE[2]] }));
    add();
    expect(brush().tints).toEqual([SCATTER_TINT_PALETTE[0], SCATTER_TINT_PALETTE[2], SCATTER_TINT_PALETTE[1]]);
  });

  it('Stamp: Scale has a number box beside a slider at least 120 px wide', () => {
    stamp();
    const slider = screen.getByRole('slider', { name: 'Scale' });
    const ctl = slider.closest('.v2-ctl') as HTMLElement;
    // The column holds a 120 px track (props.css) and the box beside it.
    expect(parseFloat(ctl.style.width)).toBeGreaterThanOrEqual(120 + 40);
    const box = screen.getByRole('textbox', { name: /^Scale/ });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '2.4' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.blur(box);
    expect(brush().stampScale).toBe(2.4);
    expect((slider as HTMLInputElement).value).toBe('2.4');
  });

  it('the strip leads with starred props, marks them, and its Library link opens the props browser', () => {
    useStore.setState((s) => {
      s.assets.favourites = ['p:anvil'];
      s.assets.recentlyUsed = ['p:crate_1'];
    });
    useStore.getState().setActiveTool('scatterBrush');
    const onOpenAssets = vi.fn();
    render(<ToolSwatches tool="scatterBrush" tab="props" onTab={vi.fn()} onOpenAssets={onOpenAssets} />);
    const strip = screen.getByTestId('v2-strip-props');
    const first = strip.querySelector('.v2-swatch');
    expect(first?.getAttribute('aria-label')).toBe('anvil');
    expect(within(strip).getAllByRole('img', { name: 'Favourite' })).toHaveLength(1);
    fireEvent.click(within(strip).getByTestId('v2-props-library'));
    expect(onOpenAssets).toHaveBeenCalledWith('object');
  });
});

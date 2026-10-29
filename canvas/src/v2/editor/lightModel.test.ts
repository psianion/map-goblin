import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '@/store/store';
import type { DungeonLayer, LightChild } from '@/store/types';
import lightingCss from './lighting.css?raw';
import { hintText } from './roomModel';
import { LIGHT_TOOL_HINT, SKY_HINT, clampFt, coneOf, hhmm, lightHintFor, nearestProp } from './lightModel';

function dungeon(): DungeonLayer {
  return useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon')!;
}

const light = (over: Partial<LightChild> = {}): LightChild => ({
  id: 'l1',
  name: 'Torch 3',
  childType: 'light',
  visible: true,
  color: '#ffb561',
  radius: 8,
  featherRadius: 4,
  intensity: 0.9,
  falloff: 'quadratic',
  position: { x: 2, y: 2 },
  ...over,
});

beforeEach(() => useStore.getState().resetToDefault());

describe('status hints', () => {
  it('the Light tool: click to place, wheel for bright and dim, R for the cone, Esc', () => {
    useStore.getState().setActiveTool('light');
    expect(lightHintFor(useStore.getState())).toBe(LIGHT_TOOL_HINT);
    expect(hintText(LIGHT_TOOL_HINT)).toBe('click to place · Wheel bright · Shift + · Wheel dim · R rotate cone · Esc done');
  });

  it('a selected light: its name, Del delete, Ctrl+D duplicate', () => {
    useStore.getState().addChild(dungeon().id, light());
    useStore.getState().setSelectedIds(['l1']);
    const hint = lightHintFor(useStore.getState());
    expect(hint?.label).toBe('Torch 3');
    expect(hintText(hint!)).toBe('Del delete · Ctrl + · D duplicate');
  });

  it('the Sky & mood sheet open says saved changes and preview rows apart; nothing otherwise', () => {
    expect(lightHintFor(useStore.getState(), true)).toBe(SKY_HINT);
    expect(SKY_HINT.label).toBe('Sky & mood');
    expect(hintText(SKY_HINT)).toBe('changes save to the map; preview rows do not');
    expect(lightHintFor(useStore.getState())).toBeNull();
  });
});

describe('light model', () => {
  it('reads an absent cone as a full circle facing east, and clamps a narrow one', () => {
    expect(coneOf(light())).toEqual({ angle: 360, direction: 0 });
    expect(coneOf(light({ cone: { angle: 4, direction: -90 } }))).toEqual({ angle: 10, direction: 270 });
  });

  it('snaps distances to the 5 ft step inside 5..300', () => {
    expect([clampFt(0), clampFt(22), clampFt(999)]).toEqual([5, 20, 300]);
    expect(hhmm(1290)).toBe('21:30');
  });

  it('finds the prop a free light would attach to within half a cell', () => {
    useStore.getState().addChild(dungeon().id, {
      id: 'b', name: 'brazier', childType: 'asset', visible: true, objectType: 'asset', assetId: 'x',
      position: { x: 2.3, y: 2 }, rotation: 0, scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false,
    });
    expect(nearestProp(dungeon(), light())?.id).toBe('b');
    expect(nearestProp(dungeon(), light({ position: { x: 4, y: 4 } }))).toBeNull();
  });
});

describe('no accent colour in the lighting CSS', () => {
  // Every colour a new rule names is a grey (r = g = b) or a token; the one colour is the
  // preset's own light, set inline as `--glow` from data, never in the sheet.
  const sheets: string[] = [lightingCss];

  it('names only greys as hex', () => {
    for (const css of sheets) {
      for (const hex of css.match(/#[0-9a-f]{3,8}\b/gi) ?? []) {
        const h = hex.slice(1);
        const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
        const [r, g, b] = [0, 2, 4].map((i) => full.slice(i, i + 2).toLowerCase());
        expect(r === g && g === b, `${hex} is not a grey`).toBe(true);
      }
    }
  });

  it('names only greys as rgb()', () => {
    for (const css of sheets) {
      for (const m of css.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)) {
        expect(m[1] === m[2] && m[2] === m[3], `${m[0]} is not a grey`).toBe(true);
      }
      expect(css).not.toMatch(/hsla?\(|oklch\(/);
    }
  });
});

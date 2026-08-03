import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../assets/textureLoader', () => ({
  resolveTexture: (id: string) => ({ id, width: id === 'missing' ? 1 : 200, height: 200 }),
}));

import { initToolPreview, showToolPreview, hideToolPreview, renderToolPreview } from './toolPreview';
import { terrainSlotTexture } from './terrain/terrainBrushPreview';
import { useStore } from '../store/store';

/** Records what the preview asked for; the real Graphics needs a GL context. */
function fakeGraphics() {
  const circles: { r: number }[] = [];
  const fills: Record<string, unknown>[] = [];
  const g = {
    label: '',
    alpha: 1,
    clear: () => circles.splice(0, circles.length),
    circle: (_x: number, _y: number, r: number) => circles.push({ r }),
    fill: (style: Record<string, unknown>) => fills.push(style),
    stroke: () => {},
    setStrokeStyle: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    rect: () => {},
  };
  return { g, circles, fills };
}

describe('terrain brush preview', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    hideToolPreview();
  });

  it('draws a disc at the brush radius when the size slider moves', () => {
    const { g, circles } = fakeGraphics();
    initToolPreview(g as never);

    showToolPreview({ tool: 'terrain', terrainBrush: { radius: 3.5, slot: 0, erase: false } });
    renderToolPreview(0, 0, 1);

    expect(circles.map((c) => c.r)).toEqual([3.5, 3.5]);
  });

  it('fills the disc with the slot texture, so the ghost shows what will paint', () => {
    const { g, fills } = fakeGraphics();
    initToolPreview(g as never);
    // Slot 0 of the default palette is a real texture id.
    expect(terrainSlotTexture(0)).toBeTruthy();

    showToolPreview({ tool: 'terrain', terrainBrush: { radius: 2, slot: 0, erase: false } });
    renderToolPreview(0, 0, 1);

    expect(fills[0]).toHaveProperty('texture');
  });

  it('erase previews as a flat disc — there is no material to show', () => {
    const { g, fills } = fakeGraphics();
    initToolPreview(g as never);

    showToolPreview({ tool: 'terrain', terrainBrush: { radius: 2, slot: 0, erase: true } });
    renderToolPreview(0, 0, 1);

    expect(fills[0]).not.toHaveProperty('texture');
    expect(fills[0].color).toBe(0xff4444);
  });

  it('an empty palette slot falls back to a flat disc instead of throwing', () => {
    const { g, fills } = fakeGraphics();
    initToolPreview(g as never);
    useStore.getState().setTerrainData({ palette: [null, null, null, null, null, null] });
    expect(terrainSlotTexture(0)).toBeNull();

    showToolPreview({ tool: 'terrain', terrainBrush: { radius: 2, slot: 0, erase: false } });
    renderToolPreview(0, 0, 1);

    expect(fills[0]).not.toHaveProperty('texture');
  });
});

// The swatch picker: art choices as pictures, one tile each, the picked one ringed.

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('./PackThumbnailCanvas', () => ({
  PackThumbnailCanvas: ({ textureId }: { textureId: string }) => <canvas data-art={textureId} />,
}));

import { SwatchPicker } from './SwatchPicker';
import { swatchLabel } from './swatchLabel';

const swatches = [
  { value: 'auto', label: 'Auto' },
  { value: 'stone', label: 'Stone', art: 'p:stone-leaf', tint: '#8a8f98' },
  { value: 'wood', label: 'Wood', art: 'p:wood-leaf' },
];

describe('SwatchPicker', () => {
  it('draws one named tile per choice, pictured where the choice has art, and rings the picked one', () => {
    const { container } = render(<SwatchPicker name="Kit" swatches={swatches} value="stone" onPick={() => {}} />);
    const tiles = [...container.querySelectorAll<HTMLElement>('[data-swatch]')];
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(['Auto', 'Stone', 'Wood']);
    expect(tiles.map((t) => t.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    // Auto has no art of its own: a plain tile with its name.
    expect(tiles[0].querySelector('canvas')).toBeNull();
    expect(tiles[1].querySelector('canvas')?.getAttribute('data-art')).toBe('p:stone-leaf');
    // A tint lies over the picture only where the choice names one.
    expect(tiles[1].querySelector('span[aria-hidden]')).not.toBeNull();
    expect(tiles[2].querySelector('span[aria-hidden]')).toBeNull();
  });

  it('hands back the value of the tile clicked', () => {
    const onPick = vi.fn();
    const { container } = render(<SwatchPicker name="Kit" swatches={swatches} value="auto" onPick={onPick} />);
    container.querySelector<HTMLElement>('[data-swatch="wood"]')!.click();
    expect(onPick).toHaveBeenCalledWith('wood');
  });

  it('is named over its tiles in a card, and bare in the dock, where the column has the caption', () => {
    expect(swatchLabel({ label: 'Material', home: 'card' })).toBe('Material');
    expect(swatchLabel({ label: 'Cliff art', home: 'dock' })).toBeUndefined();
    const card = render(<SwatchPicker label="Material" name="Material" swatches={swatches} value="auto" onPick={() => {}} />);
    expect(card.container.querySelector('[data-composite="swatch-field"]')?.textContent).toContain('Material');
    const dock = render(<SwatchPicker name="Kit" swatches={swatches} value="auto" onPick={() => {}} />);
    expect(dock.container.querySelector('[data-composite="swatch-field"]')).toBeNull();
  });
});

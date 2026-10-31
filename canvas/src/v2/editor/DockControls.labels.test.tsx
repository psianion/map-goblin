import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';
import { useStore } from '@/store/store';
import { ToolSettings, ToolSwatches } from './DockControls';
import { hasSwatches } from './dockTabs';

const noop = () => {};
const tiles = () => screen.getByRole('radiogroup', { name: 'Label styles' });
const tile = (name: string) => within(tiles()).getByRole('radio', { name });
const label = () => useStore.getState().tools.settings.label;

beforeEach(() => useStore.getState().resetToDefault());
afterEach(cleanup);

describe('Labels tab: the style tiles', () => {
  it('are one radio group of the five styles and Custom, Custom picked by default', () => {
    render(<ToolSwatches tool="text" tab="labels" onTab={noop} onOpenAssets={noop} />);
    expect(within(tiles()).getAllByRole('radio').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Room name',
      'Door tag',
      'GM note',
      'Number pin',
      'Callout',
      'Custom',
    ]);
    expect(tile('Custom').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText(/soon/)).toBeNull();
  });

  it('a pick writes the style and puts Size and Colour back to the style’s', () => {
    useStore.getState().updateToolSettings({ label: { fontSize: 2.5, color: '#808080' } });
    render(<ToolSwatches tool="text" tab="labels" onTab={noop} onOpenAssets={noop} />);
    fireEvent.click(tile('Room name'));
    expect(label()).toEqual({ style: 'room-name', fontSize: 0.8, color: null });
    expect(tile('Room name').getAttribute('aria-checked')).toBe('true');
    expect(tile('Custom').getAttribute('aria-checked')).toBe('false');
  });

  it('a pick takes up the Label tool when another tool is in hand', () => {
    useStore.getState().setActiveTool('select');
    render(<ToolSwatches tool="text" tab="labels" onTab={noop} onOpenAssets={noop} />);
    fireEvent.click(tile('Door tag'));
    expect(useStore.getState().tools.activeTool).toBe('text');
    expect(label().style).toBe('door-tag');
  });

  it('GM note brings its grey; Custom goes back to the layer’s ink', () => {
    render(<ToolSwatches tool="text" tab="labels" onTab={noop} onOpenAssets={noop} />);
    fireEvent.click(tile('GM note'));
    expect(label()).toEqual({ style: 'gm-note', fontSize: 0.5, color: '#6b6b6b' });
    fireEvent.click(tile('Custom'));
    expect(label()).toMatchObject({ style: undefined, fontSize: 0.8, color: null });
  });

  it('are not shown for the Zone tool on the same tab', () => {
    const { container } = render(<ToolSwatches tool="zone" tab="labels" onTab={noop} onOpenAssets={noop} />);
    expect(container.innerHTML).toBe('');
    expect(hasSwatches('zone', 'labels')).toBe(false);
    expect(hasSwatches('text', 'labels')).toBe(true);
  });

  it('Size runs one range, 0.2 to 6, and a size picked after the tile sticks for the next labels', () => {
    render(<ToolSettings tool="text" />);
    const size = screen.getByRole('slider', { name: 'Size' }) as HTMLInputElement;
    expect([size.min, size.max, size.step]).toEqual(['0.2', '6', '0.1']);
    act(() => useStore.getState().updateToolSettings({ label: { style: 'callout', fontSize: 0.5, color: null } }));
    fireEvent.change(size, { target: { value: '4.2' } });
    expect(label()).toEqual({ style: 'callout', fontSize: 4.2, color: null });
  });

  it('each tile names its look in its tip', () => {
    render(<ToolSwatches tool="text" tab="labels" onTab={noop} onOpenAssets={noop} />);
    expect(tile('Room name').getAttribute('data-tip-key')).toBe('0.8 sq · bold · halo · follows a room');
    expect(tile('Door tag').getAttribute('data-tip-key')).toBe('0.4 sq · pill · follows a door');
  });
});

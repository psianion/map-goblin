import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { useStore } from '@/store/store';
import { ToolSettings, ToolSwatches } from './DockControls';
import { LightsDockTail } from './LightsDock';
import { hasSwatches } from './dockTabs';
import { getLitPreview, resetViewPrefsForTests } from '../viewPrefs';

vi.mock('@/lib/toast', () => ({ notify: { subtle: vi.fn(), success: vi.fn(), error: vi.fn(), action: vi.fn() } }));

const defaults = () => useStore.getState().tools.settings.lightDefaults;
const presets = () => screen.getByRole('group', { name: 'Light presets' });

beforeEach(() => useStore.getState().resetToDefault());
afterEach(cleanup);

describe('Lights tab of the dock', () => {
  it('shows the six presets as tiles, each glowing with its own colour; Darkness in ink', () => {
    expect(hasSwatches('light', 'lights')).toBe(true);
    render(<ToolSwatches tool="light" tab="lights" onTab={() => {}} onOpenAssets={() => {}} />);
    const tiles = within(presets()).getAllByRole('button');
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(['Torch', 'Lantern', 'Candle', 'Brazier', 'Magical', 'Darkness']);
    expect(tiles[0].style.getPropertyValue('--glow')).toBe('#ffb561');
    expect(tiles[5].className).toContain('v2-lswatch--dark');
    expect(tiles[5].style.getPropertyValue('--glow')).toBe('');
    expect(tiles[0].getAttribute('data-tip-key')).toBe('20 / 40 ft');
    expect(tiles[4].getAttribute('data-tip-key')).toBe('30 ft');
    expect(screen.queryByText(/soon/)).toBeNull();
  });

  it('a preset pick writes the next light (radii, colour, animation) and marks its tile', () => {
    render(<ToolSwatches tool="light" tab="lights" onTab={() => {}} onOpenAssets={() => {}} />);
    fireEvent.click(within(presets()).getByRole('button', { name: 'Torch' }));
    expect(defaults()).toMatchObject({ presetId: 'torch', featherRadius: 4, radius: 8, color: '#ffb561', animation: { kind: 'flicker', speed: 1 } });
    expect(within(presets()).getByRole('button', { name: 'Torch' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(presets()).getByRole('button', { name: 'Lantern' }));
    expect(defaults().animation).toBeUndefined();
  });

  it('the Darkness preset sets up a darkness source', () => {
    render(<ToolSwatches tool="light" tab="lights" onTab={() => {}} onOpenAssets={() => {}} />);
    fireEvent.click(within(presets()).getByRole('button', { name: 'Darkness' }));
    expect(defaults()).toMatchObject({ presetId: 'darkness', darkness: true, radius: 3, featherRadius: 3 });
  });

  it('quick settings read Bright, Dim, Colour, Flicker and the "⋯", in feet', () => {
    useStore.getState().updateLightDefaults({ featherRadius: 4, radius: 8 });
    render(<ToolSettings tool="light" />);
    const row = screen.getByTestId('v2-settings');
    expect(row.className).toContain('v2-settings--light');
    expect([...row.querySelectorAll('.v2-ctl__head > span:first-child')].map((s) => s.textContent)).toEqual(['Bright', 'Dim', 'Colour', 'Flicker']);
    expect(row.textContent).toContain('20 ft');
    expect(row.textContent).toContain('40 ft');
    expect(screen.getByRole('button', { name: 'All settings' })).toBeTruthy();
  });

  it('Dim pulled under Bright carries Bright with it; Flicker toggles the animation', () => {
    useStore.getState().updateLightDefaults({ featherRadius: 4, radius: 8 });
    render(<ToolSettings tool="light" />);
    fireEvent.change(screen.getByRole('slider', { name: 'Dim' }), { target: { value: '10' } });
    expect([defaults().featherRadius, defaults().radius]).toEqual([2, 2]);
    fireEvent.click(screen.getByRole('switch', { name: 'Flicker' }));
    expect(defaults().animation).toEqual({ kind: 'flicker', speed: 1 });
    fireEvent.click(screen.getByRole('switch', { name: 'Flicker' }));
    expect(defaults().animation).toBeUndefined();
  });

  it('"All settings" holds Cone, Direction, Effect, Speed, Through walls, Night only, Darkness source', () => {
    render(<ToolSettings tool="light" />);
    fireEvent.click(screen.getByRole('button', { name: 'All settings' }));
    const more = screen.getByTestId('v2-light-more');
    expect(within(more).getByRole('slider', { name: 'Cone' })).toBeTruthy();
    expect(within(more).getByRole('slider', { name: 'Direction' })).toBeTruthy();
    fireEvent.click(within(within(more).getByRole('group', { name: 'Effect' })).getByRole('button', { name: 'Pulse' }));
    expect(defaults().animation).toEqual({ kind: 'pulse', speed: 1 });
    fireEvent.change(within(more).getByRole('slider', { name: 'Cone' }), { target: { value: '90' } });
    expect(defaults().cone).toEqual({ angle: 90, direction: 0 });
    fireEvent.click(within(more).getByRole('switch', { name: 'Night only' }));
    expect(defaults().nightOnly).toEqual({ min: 0.5, max: 1 });
    fireEvent.click(within(more).getByRole('switch', { name: 'Darkness source' }));
    expect(defaults().darkness).toBe(true);
    fireEvent.click(within(more).getByRole('switch', { name: 'Through walls' }));
    expect(defaults().throughWalls).toBe(true);
  });

  it('ends with Sky & mood, which opens and closes the sheet', () => {
    const toggle = vi.fn();
    const { rerender } = render(<LightsDockTail skyOpen={false} onToggleSky={toggle} />);
    const btn = screen.getByRole('button', { name: 'Sky & mood' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(toggle).toHaveBeenCalledTimes(1);
    rerender(<LightsDockTail skyOpen onToggleSky={toggle} />);
    expect(screen.getByRole('button', { name: 'Sky & mood' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('while unlit the row ends with "Unlit · turn on", which turns the lit preview on and goes', () => {
    localStorage.clear();
    resetViewPrefsForTests();
    render(<LightsDockTail skyOpen={false} onToggleSky={() => {}} />);
    fireEvent.click(screen.getByTestId('v2-lights-unlit'));
    expect(getLitPreview()).toBe(true);
    expect(screen.queryByTestId('v2-lights-unlit')).toBeNull();
    resetViewPrefsForTests();
  });
});

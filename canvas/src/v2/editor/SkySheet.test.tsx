import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { SkySheet, SkySheetFoot } from './SkySheet';
import { getLitPreview, resetViewPrefsForTests, SKY_PREVIEW_KEY } from '../viewPrefs';

vi.mock('@/lib/toast', () => ({ notify: { subtle: vi.fn(), success: vi.fn(), error: vi.fn(), action: vi.fn() } }));

const map = () => useStore.getState().mapSettings;
const group = (name: string) => screen.getByRole('group', { name });
const pick = (g: string, b: string) => fireEvent.click(within(group(g)).getByRole('button', { name: b }));
const pressed = (g: string) =>
  within(group(g))
    .getAllByRole('button')
    .find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent;
const undo = () => act(() => undoManager.undo());

beforeEach(() => {
  undoManager.clear();
  localStorage.clear();
  resetViewPrefsForTests();
  useStore.getState().resetToDefault();
});
afterEach(cleanup);

describe('Sky & mood sheet', () => {
  it('lays out Place, Time, Defaults at the table, Mood tint and Preview, in board order', () => {
    render(<SkySheet />);
    const heads = screen.getAllByRole('button', { expanded: true }).map((b) => b.textContent);
    expect(heads).toEqual(['Place', 'Time', 'Defaults at the table', 'Mood tint']);
    expect(screen.getByRole('button', { name: 'Preview' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('v2-sky-preview').textContent).toContain('Preview only, not saved');
  });

  it('starts a map that never said as Indoor, Temperate, following the clock', () => {
    render(<SkySheet />);
    expect(pressed('Environment')).toBe('Indoor');
    expect((screen.getByRole('combobox', { name: 'Climate' }) as HTMLSelectElement).value).toBe('temperate');
    expect(pressed('Time')).toBe('Follow clock');
  });

  it('an Environment pick is one undo step', () => {
    render(<SkySheet />);
    pick('Environment', 'Underground');
    expect(map().environment).toBe('underground');
    undo();
    expect(map().environment).toBeUndefined();
  });

  it('Climate picks the palette preset', () => {
    render(<SkySheet />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Climate' }), { target: { value: 'desert' } });
    expect(map().timePalette?.preset).toBe('desert');
    undo();
    expect(map().timePalette).toBeUndefined();
  });

  it('Natural shadows switches the sun and moon pass', () => {
    render(<SkySheet />);
    fireEvent.click(screen.getByRole('switch', { name: 'Natural shadows' }));
    expect(map().naturalLight).toBe(true);
  });

  it('the Orientation dial steps 5° by key, one step each, reading 0° is east', () => {
    render(<SkySheet />);
    const dial = screen.getByRole('slider', { name: 'Orientation' });
    expect(screen.getByTestId('v2-sky-place').textContent).toContain('0° is east');
    fireEvent.keyDown(dial, { key: 'ArrowRight' });
    fireEvent.keyDown(dial, { key: 'ArrowRight' });
    expect(map().orientation).toBe(10);
    undo();
    expect(map().orientation).toBe(5);
    fireEvent.keyDown(dial, { key: 'ArrowLeft' });
    fireEvent.keyDown(dial, { key: 'ArrowLeft' });
    expect(map().orientation).toBe(355);
  });

  it('a dial drag turns live and lands as one step from where it began', () => {
    render(<SkySheet />);
    const dial = screen.getByRole('slider', { name: 'Orientation' });
    dial.getBoundingClientRect = () => ({ left: 0, top: 0, width: 44, height: 44, right: 44, bottom: 44, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(dial, { clientX: 22, clientY: 44 });
    fireEvent.pointerMove(dial, { clientX: 0, clientY: 22 });
    expect(map().orientation).toBe(180);
    fireEvent.pointerUp(dial);
    undo();
    expect(map().orientation).toBeUndefined();
  });

  it('Fixed hour is greyed while following the clock and live once fixed', () => {
    render(<SkySheet />);
    const row = () => screen.getByRole('slider', { name: 'Fixed hour' }).closest('.v2-rrow')!;
    expect(row().className).toContain('v2-prow--off');
    pick('Time', 'Fixed hour');
    expect(map().timeMode).toBe('fixed');
    expect(row().className).not.toContain('v2-prow--off');
    expect(screen.getByTestId('v2-sky-time').textContent).toContain('12:00');
  });

  it('a Fixed hour drag lands one step from where it began', () => {
    useStore.getState().setEnvironmentSettings({ timeMode: 'fixed' });
    render(<SkySheet />);
    const t = screen.getByRole('slider', { name: 'Fixed hour' });
    fireEvent.pointerDown(t);
    fireEvent.change(t, { target: { value: '1200' } });
    fireEvent.change(t, { target: { value: '1290' } });
    fireEvent.pointerUp(t, { target: { value: '1290' } });
    expect(map().fixedTime).toBe(1290);
    expect(screen.getByTestId('v2-sky-time').textContent).toContain('21:30');
    undo();
    expect(map().fixedTime).toBeUndefined();
  });

  it('Defaults at the table: Weather and Night sky save to the map', () => {
    render(<SkySheet />);
    const defaults = screen.getByTestId('v2-sky-defaults');
    fireEvent.change(within(defaults).getByRole('combobox', { name: 'Weather' }), { target: { value: 'overcast' } });
    fireEvent.click(within(within(defaults).getByRole('group', { name: 'Night sky' })).getByRole('button', { name: 'Moonless' }));
    expect(map().weather).toBe('overcast');
    expect(map().nightSky).toBe('moonless');
    undo();
    expect(map().nightSky).toBeUndefined();
  });

  it('shows the mood tint as its hex', () => {
    useStore.getState().setAmbientLight('#56607a');
    render(<SkySheet />);
    expect(screen.getByTestId('v2-sky-tint').textContent).toContain('#56607A');
    expect(within(screen.getByTestId('v2-sky-tint')).getByRole('button', { name: /Tint colour/ })).toBeTruthy();
  });

  it('opening Preview is remembered as a view preference', () => {
    const { unmount } = render(<SkySheet />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(localStorage.getItem(SKY_PREVIEW_KEY)).toBe('1');
    unmount();
    render(<SkySheet />);
    expect(screen.getByRole('button', { name: 'Preview' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('preview rows write the editor preview only: no undo, nothing on the map', () => {
    localStorage.setItem(SKY_PREVIEW_KEY, '1');
    render(<SkySheet />);
    const preview = screen.getByTestId('v2-sky-preview');
    fireEvent.change(within(preview).getByRole('slider', { name: 'Hour' }), { target: { value: '120' } });
    fireEvent.click(within(within(preview).getByRole('group', { name: 'Sky' })).getByRole('button', { name: 'Crescent' }));
    fireEvent.change(within(preview).getByRole('combobox', { name: 'Weather' }), { target: { value: 'storm' } });
    const ui = useStore.getState().ui;
    expect([ui.previewClock, ui.previewSky, ui.previewWeather]).toEqual([120, 'crescent', 'storm']);
    expect(undoManager.canUndo()).toBe(false);
    expect(map().weather).toBeUndefined();
  });

  it('mirrors the Lit preview switch, keyed I', () => {
    localStorage.setItem(SKY_PREVIEW_KEY, '1');
    render(<SkySheet />);
    const preview = screen.getByTestId('v2-sky-preview');
    fireEvent.click(within(preview).getByRole('switch', { name: 'Lit preview' }));
    expect(getLitPreview()).toBe(true);
    expect(within(preview).getByText('I').tagName).toBe('KBD');
  });

  it('closes with a line on what the table does with these', () => {
    render(<SkySheetFoot />);
    expect(screen.getByText(/The table starts from these/).className).toContain('v2-skysheet__foot');
  });
});

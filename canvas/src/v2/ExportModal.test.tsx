import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { setEditorDesk, type EditorDesk } from '@dnd/core/src/engine/editorDesk';
import { useStore } from '@/store/store';
import { ExportModal } from './ExportModal';

const { notify, pipeline, download, mapFile } = vi.hoisted(() => ({
  notify: { success: vi.fn(), error: vi.fn() },
  pipeline: vi.fn(async () => ({ blob: new Blob(), filename: 'map.png' })),
  download: vi.fn(),
  mapFile: vi.fn(async () => 'map.mapbuilder'),
}));
vi.mock('@/lib/toast', () => ({ notify }));
vi.mock('@/engine/engineSingleton', () => ({ getEngineSingleton: () => ({ engine: {}, sceneGraph: {} }) }));
vi.mock('@/engine/export/exportPipeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/engine/export/exportPipeline')>()),
  runExportPipeline: pipeline,
  triggerDownload: download,
}));
vi.mock('@/io/saveLoad', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/io/saveLoad')>()),
  downloadMapFile: mapFile,
}));

const desk: EditorDesk = { desk: '#f2f2f2', dot: '#c6c6c6', sheet: '#fbfbfb', ink: '#1b1b1b' };
const lighting = () => screen.getByRole('switch', { name: 'Apply lighting' });
const go = () => fireEvent.click(screen.getByTestId('v2-export-go'));
type Lit = { minutes: number; nightSky: string; weather: string };
type ExportOpts = { lighting?: Lit | false; format: string; pxPerCell: number; includeGrid: boolean };
const NOON_LIT: Lit = { minutes: 720, nightSky: 'full-moon', weather: 'clear' };
const allOpts = () => (pipeline.mock.calls as unknown as [unknown, unknown, unknown, ExportOpts][]).map((c) => c[3]);
// The preview renders through the same pipeline at a thumbnail's scale (48 px a square for the
// default 10×10 frame); the file never goes under 64.
const exports = () => allOpts().filter((o) => o.pxPerCell >= 64);
const previews = () => allOpts().filter((o) => o.pxPerCell < 64);
const lastOpts = () => exports().at(-1)!;

describe('ExportModal', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useStore.getState().resetToDefault();
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => setEditorDesk(null));

  it('starts unlit when the editor shows the map unlit', () => {
    setEditorDesk(desk);
    render(<ExportModal open onOpenChange={() => {}} />);
    expect(lighting().getAttribute('aria-checked')).toBe('false');
  });

  it('starts lit when the lit preview is on', () => {
    setEditorDesk({ ...desk, lit: true });
    render(<ExportModal open onOpenChange={() => {}} />);
    expect(lighting().getAttribute('aria-checked')).toBe('true');
  });

  it('re-reads the editor on every open', () => {
    setEditorDesk(desk);
    const { rerender } = render(<ExportModal open onOpenChange={() => {}} />);
    fireEvent.click(lighting());
    expect(lighting().getAttribute('aria-checked')).toBe('true');
    rerender(<ExportModal open={false} onOpenChange={() => {}} />);
    rerender(<ExportModal open onOpenChange={() => {}} />);
    expect(lighting().getAttribute('aria-checked')).toBe('false');
  });

  it('exports unlit by default on the unlit editor, and lit once switched on', async () => {
    setEditorDesk(desk);
    const onOpenChange = vi.fn();
    render(<ExportModal open onOpenChange={onOpenChange} />);
    go();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(lastOpts()).toMatchObject({ format: 'png', pxPerCell: 128, includeGrid: false, lighting: false });
    expect(download).toHaveBeenCalledWith(expect.any(Blob), 'map.png');

    fireEvent.click(lighting());
    fireEvent.click(screen.getByRole('radio', { name: 'JPEG' }));
    fireEvent.click(screen.getByRole('radio', { name: '256' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Grid lines' }));
    go();
    await waitFor(() => expect(exports()).toHaveLength(2));
    expect(lastOpts()).toMatchObject({ format: 'jpeg', pxPerCell: 256, includeGrid: true, lighting: NOON_LIT });
  });

  it('shows the file size, and drops the picture options for the map file', async () => {
    render(<ExportModal open onOpenChange={() => {}} />);
    // The default 10x10 frame at 128 px a square.
    expect(screen.getByTestId('v2-export-size').textContent).toContain('1280 × 1280 px');

    fireEvent.click(screen.getByRole('radio', { name: 'Map file' }));
    expect(screen.queryByRole('switch', { name: 'Apply lighting' })).toBeNull();
    go();
    await waitFor(() => expect(mapFile).toHaveBeenCalled());
    expect(exports()).toHaveLength(0);
  });

  it('shows a preview rendered by the export pipeline at thumbnail size, again on every option change', async () => {
    setEditorDesk(desk);
    render(<ExportModal open onOpenChange={() => {}} />);
    const box = screen.getByTestId('v2-export-preview');
    expect(box.textContent).toBe('Rendering preview…');
    await waitFor(() => expect(screen.getByRole('img', { name: 'Export preview' }).getAttribute('src')).toBe('blob:preview'));
    // Longest side 480 px: the default frame is 10 squares on its longest side.
    expect(previews().at(-1)).toMatchObject({ pxPerCell: 48, lighting: false, includeGrid: false });

    fireEvent.click(lighting());
    expect(screen.getByTestId('v2-export-preview').textContent).toBe('Rendering preview…');
    await waitFor(() => expect(previews().at(-1)).toMatchObject({ lighting: NOON_LIT }));
    fireEvent.click(screen.getByRole('switch', { name: 'Grid lines' }));
    await waitFor(() => expect(previews().at(-1)).toMatchObject({ lighting: NOON_LIT, includeGrid: true }));
    const before = previews().length;
    fireEvent.click(screen.getByRole('radio', { name: '256' }));
    await waitFor(() => expect(previews().length).toBe(before + 1));
    expect(previews().at(-1)?.pxPerCell).toBe(48);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Export preview' })).toBeTruthy());
    expect(exports()).toHaveLength(0);
  });

  it('shows Hour, Sky and Weather under Apply lighting only while it is on', () => {
    setEditorDesk(desk);
    render(<ExportModal open onOpenChange={() => {}} />);
    expect(screen.queryByTestId('v2-export-lighting')).toBeNull();
    fireEvent.click(lighting());
    const rows = screen.getByTestId('v2-export-lighting');
    expect(rows.textContent).toContain('Hour');
    expect(screen.getByRole('slider', { name: 'Hour' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Sky' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Weather' })).toBeTruthy();
  });

  it('seeds from the editor preview: its clock, sky and weather', () => {
    setEditorDesk({ ...desk, lit: true });
    const s = useStore.getState();
    s.setPreviewClock(120);
    s.setPreviewSky('crescent');
    s.setPreviewWeather('overcast');
    render(<ExportModal open onOpenChange={() => {}} />);
    expect(screen.getByTestId('v2-export-lighting').textContent).toContain('02:00');
    expect(screen.getByRole('radio', { name: 'Crescent' }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('combobox', { name: 'Weather' }) as HTMLSelectElement).value).toBe('overcast');
  });

  it('without a preview, seeds from the map: its fixed hour and table defaults', () => {
    setEditorDesk({ ...desk, lit: true });
    useStore.getState().setEnvironmentSettings({ timeMode: 'fixed', fixedTime: 1290, nightSky: 'moonless', weather: 'fog' });
    render(<ExportModal open onOpenChange={() => {}} />);
    expect(screen.getByTestId('v2-export-lighting').textContent).toContain('21:30');
    expect(screen.getByRole('radio', { name: 'Moonless' }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('combobox', { name: 'Weather' }) as HTMLSelectElement).value).toBe('fog');
  });

  it('a map following the clock, with no preview, starts at noon under a full moon in clear weather', () => {
    setEditorDesk({ ...desk, lit: true });
    render(<ExportModal open onOpenChange={() => {}} />);
    expect(screen.getByTestId('v2-export-lighting').textContent).toContain('12:00');
    expect(screen.getByRole('radio', { name: 'Full moon' }).getAttribute('aria-checked')).toBe('true');
  });

  it('exports at the picked hour, sky and weather', async () => {
    setEditorDesk({ ...desk, lit: true });
    const onOpenChange = vi.fn();
    render(<ExportModal open onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Hour' }), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Moonless' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Weather' }), { target: { value: 'storm' } });
    go();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(lastOpts().lighting).toEqual({ minutes: 120, nightSky: 'moonless', weather: 'storm' });
  });

  it('re-renders the preview when the hour moves, and sends false when lighting is off', async () => {
    setEditorDesk({ ...desk, lit: true });
    render(<ExportModal open onOpenChange={() => {}} />);
    await waitFor(() => expect(previews().at(-1)?.lighting).toEqual(NOON_LIT));
    fireEvent.change(screen.getByRole('slider', { name: 'Hour' }), { target: { value: '120' } });
    await waitFor(() => expect(previews().at(-1)?.lighting).toEqual({ ...NOON_LIT, minutes: 120 }));
    fireEvent.click(lighting());
    await waitFor(() => expect(previews().at(-1)?.lighting).toBe(false));
  });

  it('keeps the dialog open and says why when the export fails', async () => {
    pipeline.mockImplementation(async (...args: unknown[]) => {
      if ((args[3] as ExportOpts).pxPerCell >= 64) throw new Error('texture too big');
      return { blob: new Blob(), filename: 'map.png' };
    });
    const onOpenChange = vi.fn();
    render(<ExportModal open onOpenChange={onOpenChange} />);
    go();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('texture too big'));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalled();
    pipeline.mockImplementation(async () => ({ blob: new Blob(), filename: 'map.png' }));
  });

  const labelsOf = (o: ExportOpts) => (o as ExportOpts & { labels?: string }).labels;

  it('exports every label by default, and only the players’ ones once picked', async () => {
    const onOpenChange = vi.fn();
    render(<ExportModal open onOpenChange={onOpenChange} />);
    const group = screen.getByRole('radiogroup', { name: 'Labels' });
    expect(within(group).getAllByRole('radio').map((b) => b.textContent)).toEqual(['None', 'Players', 'All']);
    expect(within(group).getByRole('radio', { name: 'All' }).getAttribute('aria-checked')).toBe('true');
    go();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(labelsOf(lastOpts())).toBe('all');
    fireEvent.click(within(group).getByRole('radio', { name: 'Players' }));
    await waitFor(() => expect(labelsOf(previews().at(-1)!)).toBe('players'));
    go();
    await waitFor(() => expect(labelsOf(lastOpts())).toBe('players'));
  });

  it('remembers the Labels pick across opens, like the other options', () => {
    const { rerender } = render(<ExportModal open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: 'None' }));
    rerender(<ExportModal open={false} onOpenChange={() => {}} />);
    rerender(<ExportModal open onOpenChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'None' }).getAttribute('aria-checked')).toBe('true');
  });
});

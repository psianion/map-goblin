import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { unzipSync } from 'fflate';
import { setEditorDesk, type EditorDesk } from '@dnd/core/src/engine/editorDesk';
import { createDungeonLayer, createImageLayer } from '@dnd/core/src/store/factories';
import { useStore } from '@/store/store';
import { ExportModal } from './ExportModal';

const { notify, pipeline, download, mapFile, bytesDownload } = vi.hoisted(() => ({
  notify: { success: vi.fn(), error: vi.fn() },
  pipeline: vi.fn(async () => ({ blob: new Blob(), filename: 'map.png' })),
  download: vi.fn(),
  mapFile: vi.fn(async () => 'map.ggvtt'),
  bytesDownload: vi.fn(),
}));
vi.mock('@dnd/ui/toast', () => ({ notify }));
vi.mock('@/engine/engineSingleton', () => ({ getEngineSingleton: () => ({ engine: {}, sceneGraph: {} }) }));
vi.mock('@/engine/export/exportPipeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/engine/export/exportPipeline')>()),
  runExportPipeline: pipeline,
  triggerDownload: download,
}));
vi.mock('@/io/saveLoad', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/io/saveLoad')>()),
  downloadMapFile: mapFile,
  downloadBytes: bytesDownload,
}));

const desk: EditorDesk = { desk: '#f2f2f2', dot: '#c6c6c6', sheet: '#fbfbfb', ink: '#1b1b1b' };
const lighting = () => screen.getByRole('switch', { name: 'Apply lighting' });
// jsdom keeps the slider thumb hidden until layout, so reach its range input directly.
const hour = () => screen.getByTestId('v2-export-lighting').querySelector<HTMLInputElement>('input[type="range"]')!;
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
    fireEvent.click(screen.getByRole('button', { name: 'JPEG' }));
    fireEvent.click(screen.getByRole('button', { name: '256' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Grid lines' }));
    go();
    await waitFor(() => expect(exports()).toHaveLength(2));
    expect(lastOpts()).toMatchObject({ format: 'jpeg', pxPerCell: 256, includeGrid: true, lighting: NOON_LIT });
  });

  it('shows the file size, and drops the picture options for the map file', async () => {
    render(<ExportModal open onOpenChange={() => {}} />);
    // The default 10x10 frame at 128 px a square.
    expect(screen.getByTestId('v2-export-size').textContent).toContain('1280 × 1280 px');

    fireEvent.click(screen.getByRole('button', { name: 'Map file' }));
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
    fireEvent.click(screen.getByRole('button', { name: '256' }));
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
    expect(hour()).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Sky' })).toBeTruthy();
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
    expect(screen.getByRole('button', { name: 'Crescent' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('combobox', { name: 'Weather' }).textContent).toContain('Overcast');
  });

  it('without a preview, seeds from the map: its fixed hour and table defaults', () => {
    setEditorDesk({ ...desk, lit: true });
    useStore.getState().setEnvironmentSettings({ timeMode: 'fixed', fixedTime: 1290, nightSky: 'moonless', weather: 'fog' });
    render(<ExportModal open onOpenChange={() => {}} />);
    expect(screen.getByTestId('v2-export-lighting').textContent).toContain('21:30');
    expect(screen.getByRole('button', { name: 'Moonless' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('combobox', { name: 'Weather' }).textContent).toContain('Fog');
  });

  it('a map following the clock, with no preview, starts at noon under a full moon in clear weather', () => {
    setEditorDesk({ ...desk, lit: true });
    render(<ExportModal open onOpenChange={() => {}} />);
    expect(screen.getByTestId('v2-export-lighting').textContent).toContain('12:00');
    expect(screen.getByRole('button', { name: 'Full moon' }).getAttribute('aria-pressed')).toBe('true');
  });

  // The weather pick goes through the select list, which jsdom cannot drive; the export spec
  // picks it in the browser.
  it('exports at the picked hour and sky, in the weather the editor previews', async () => {
    setEditorDesk({ ...desk, lit: true });
    useStore.getState().setPreviewWeather('storm');
    const onOpenChange = vi.fn();
    render(<ExportModal open onOpenChange={onOpenChange} />);
    fireEvent.change(hour(), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Moonless' }));
    go();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(lastOpts().lighting).toEqual({ minutes: 120, nightSky: 'moonless', weather: 'storm' });
  });

  it('re-renders the preview when the hour moves, and sends false when lighting is off', async () => {
    setEditorDesk({ ...desk, lit: true });
    render(<ExportModal open onOpenChange={() => {}} />);
    await waitFor(() => expect(previews().at(-1)?.lighting).toEqual(NOON_LIT));
    fireEvent.change(hour(), { target: { value: '120' } });
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
    const group = screen.getByRole('group', { name: 'Labels' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['None', 'Players', 'All']);
    expect(within(group).getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    go();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(labelsOf(lastOpts())).toBe('all');
    fireEvent.click(within(group).getByRole('button', { name: 'Players' }));
    await waitFor(() => expect(labelsOf(previews().at(-1)!)).toBe('players'));
    go();
    await waitFor(() => expect(labelsOf(lastOpts())).toBe('players'));
  });

  it('remembers the Labels pick across opens, like the other options', () => {
    const { rerender } = render(<ExportModal open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    rerender(<ExportModal open={false} onOpenChange={() => {}} />);
    rerender(<ExportModal open onOpenChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'None' }).getAttribute('aria-pressed')).toBe('true');
  });

  describe('levels and layers', () => {
    type Only = { levelId: string; layerIds: string[] };
    const onlyOf = (o: ExportOpts) => (o as ExportOpts & { only: Only }).only;
    const openLevel = () => useStore.getState().levels[0]!.id;
    const ground = () => useStore.getState().layers.find((l) => l.type === 'dungeon')!;
    const tick = (name: string) => within(screen.getByRole('group', { name: 'Layers' })).getByRole('checkbox', { name });

    /** A second level with a layer of its own. */
    function addLevel(name = 'Lower caves') {
      const s = useStore.getState();
      s.addLevel({ id: 'down', name });
      useStore.getState().addLayer(createDungeonLayer('Caves', 'down'));
    }

    // jsdom cannot click the select list's options, but the keyboard drives it: open the list,
    // step down to the last option, Enter.
    const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    async function pickLastLevelOption() {
      const trigger = screen.getByRole('combobox', { name: 'Level' });
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      await settle();
      const count = screen.getAllByRole('option').length;
      for (let i = 0; i < count; i++) {
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
        await settle();
      }
      expect(document.activeElement?.textContent).toBe('Every level, one file each');
      fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
      await settle();
    }

    it('lists the open level’s own layers, every one ticked, and sends only the ticked ones', async () => {
      useStore.getState().addLayer(createDungeonLayer('Props', openLevel()));
      const props = useStore.getState().layers.find((l) => l.name === 'Props')!;
      const onOpenChange = vi.fn();
      render(<ExportModal open onOpenChange={onOpenChange} />);
      expect(tick(ground().name).getAttribute('aria-checked')).toBe('true');
      expect(tick('Props').getAttribute('aria-checked')).toBe('true');
      fireEvent.click(tick('Props'));
      expect(tick('Props').getAttribute('aria-checked')).toBe('false');
      go();
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      const only = onlyOf(lastOpts());
      expect(only.levelId).toBe(openLevel());
      expect(only.layerIds).toContain(ground().id);
      expect(only.layerIds).not.toContain(props.id);
      // The preview draws the same pick.
      expect(onlyOf(previews().at(-1)!).layerIds).not.toContain(props.id);
    });

    it('starts a background image layer unticked, and draws it once ticked', async () => {
      const trace = { ...createImageLayer(openLevel(), 'sketch', 'sketch.png'), name: 'Sketch' };
      useStore.getState().addLayer(trace);
      const onOpenChange = vi.fn();
      render(<ExportModal open onOpenChange={onOpenChange} />);
      expect(tick('Sketch').getAttribute('aria-checked')).toBe('false');
      expect(screen.getByTestId('v2-export-layers').textContent).toContain('background image');
      go();
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(onlyOf(lastOpts()).layerIds).not.toContain(trace.id);
      fireEvent.click(tick('Sketch'));
      go();
      await waitFor(() => expect(exports()).toHaveLength(2));
      expect(onlyOf(lastOpts()).layerIds).toContain(trace.id);
    });

    it('shows a hidden layer unticked and locked out, as export always left it out', async () => {
      const g = ground();
      useStore.setState({ layers: useStore.getState().layers.map((l) => (l.id === g.id ? { ...l, visible: false } : l)) });
      render(<ExportModal open onOpenChange={() => {}} />);
      expect(tick(g.name).getAttribute('aria-checked')).toBe('false');
      expect(tick(g.name).hasAttribute('data-disabled')).toBe(true);
    });

    it('has no Level row on a one-level map, and one marking the open level on a two-level map', () => {
      const { rerender } = render(<ExportModal open onOpenChange={() => {}} />);
      expect(screen.queryByTestId('v2-export-level')).toBeNull();
      rerender(<ExportModal open={false} onOpenChange={() => {}} />);
      addLevel();
      rerender(<ExportModal open onOpenChange={() => {}} />);
      expect(screen.getByRole('combobox', { name: 'Level' }).textContent).toContain('(open now)');
    });

    it('every level downloads one zip, an entry named for each level, rendered one after another', async () => {
      addLevel();
      pipeline.mockImplementation(async (...args: unknown[]) => {
        const only = (args[3] as ExportOpts & { only: Only }).only;
        const bytes = new Uint8Array([only.levelId === 'down' ? 2 : 1]);
        return { blob: { arrayBuffer: async () => bytes.buffer } as unknown as Blob, filename: 'x.png' };
      });
      useStore.getState().setMapName('Goblin Warren');
      const onOpenChange = vi.fn();
      render(<ExportModal open onOpenChange={onOpenChange} />);
      await pickLastLevelOption();
      await waitFor(() => expect(screen.getByTestId('v2-export-filename').textContent).toBe('Goblin-Warren.zip'));
      // The Enter that picked the option did not export.
      expect(exports()).toHaveLength(0);
      expect(screen.getByTestId('v2-export-layers').textContent).toContain('All layers of each level, without background images');
      expect(screen.getByTestId('v2-export-size').textContent).toContain('2 files');
      go();
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(exports().map((o) => onlyOf(o).levelId)).toEqual([openLevel(), 'down']);
      expect(download).not.toHaveBeenCalled();
      const [bytes, name] = bytesDownload.mock.calls[0] as [Uint8Array, string];
      expect(name).toBe('Goblin-Warren.zip');
      const entries = unzipSync(bytes);
      expect(Object.keys(entries)).toEqual(['Goblin-Warren-Level-1.png', 'Goblin-Warren-Lower-caves.png']);
      expect([...entries['Goblin-Warren-Lower-caves.png']!]).toEqual([2]);
      pipeline.mockImplementation(async () => ({ blob: new Blob(), filename: 'map.png' }));
    });

    it('names the file it will write in the foot', () => {
      useStore.getState().setMapName('Warren');
      render(<ExportModal open onOpenChange={() => {}} />);
      expect(screen.getByTestId('v2-export-filename').textContent).toBe('Warren-1280x1280-128ppc.png');
      fireEvent.click(screen.getByRole('button', { name: 'Map file' }));
      expect(screen.getByTestId('v2-export-filename').textContent).toBe('Warren.ggvtt');
    });

    it('caps its height at the window less 48 px and scrolls the body, the foot with Export outside it', () => {
      render(<ExportModal open onOpenChange={() => {}} />);
      const modal = screen.getByTestId('v2-export-modal');
      expect(modal.className).toContain('max-h-[calc(100dvh-48px)]');
      const body = screen.getByTestId('v2-export-body');
      expect(body.className).toContain('min-h-0');
      expect(body.className).toContain('overflow-y-auto');
      // Side by side, only the options scroll.
      expect(body.className).toContain('min-[672px]:grid-cols-[minmax(0,1fr)_300px]');
      expect(screen.getByTestId('v2-export-options').className).toContain('min-[672px]:overflow-y-auto');
      expect(body.contains(screen.getByTestId('v2-export-go'))).toBe(false);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MAGIC_HEADER } from '@/io/mapFormat';
import type { ScannedMap } from '@/io/importFolder';
import type { ImportResult } from '@/io/importMap';
import { NewMapModal } from './NewMapModal';

const { loadMap, notify, scanFiles, importMaps } = vi.hoisted(() => ({
  loadMap: vi.fn(async (_file?: File) => true),
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  scanFiles: vi.fn(async (_files: Map<string, File>): Promise<ScannedMap[]> => []),
  importMaps: vi.fn(
    async (
      _maps: ScannedMap[],
      _onProgress?: (index: number, name: string) => void,
      _stopRequested?: () => boolean,
    ): Promise<ImportResult[]> => [],
  ),
}));
vi.mock('@/io/saveLoad', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/io/saveLoad')>()),
  loadMap,
}));
vi.mock('@/lib/toast', () => ({ notify }));
// The file walk stays real; the scan and the import are what each test sets up.
vi.mock('@/io/importFolder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/io/importFolder')>()),
  scanFiles,
}));
vi.mock('@/io/importMap', () => ({ importMaps }));

/** A file that is one of the editor's own maps by its header, whatever it is called. */
function mapFile(name: string) {
  const head = new TextEncoder().encode(MAGIC_HEADER);
  return new File([head, new Uint8Array([31, 139, 8, 0])], name);
}

const submit = () => screen.getByTestId('v2-new-map-submit');
const sourceRadio = (name: string) => screen.getByRole('radio', { name });

describe('NewMapModal: map file source', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('offers a fourth source for the editor’s own map files, accepting both extensions', () => {
    render(<NewMapModal open onOpenChange={() => {}} onEnter={() => {}} />);
    fireEvent.click(sourceRadio('Map file'));

    expect(screen.getByText('Good Goblin map (.ggvtt)')).toBeTruthy();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe('.ggvtt,.mapbuilder');
    // Name and size come from the file.
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(submit().textContent).toBe('Open map');
    expect(submit().hasAttribute('disabled')).toBe(true);
  });

  it('routes a .ggvtt dropped on the VTT zone to Map file, and opens it through loadMap', async () => {
    const onOpenChange = vi.fn();
    const onEnter = vi.fn();
    render(<NewMapModal open onOpenChange={onOpenChange} onEnter={onEnter} />);
    fireEvent.click(sourceRadio('VTT files'));

    const file = mapFile('keep.ggvtt');
    fireEvent.drop(screen.getByTestId('v2-vtt-drop'), { dataTransfer: { files: [file] } });

    await waitFor(() => expect(sourceRadio('Map file').getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByText('keep.ggvtt')).toBeTruthy();

    fireEvent.click(submit());
    await waitFor(() => expect(loadMap).toHaveBeenCalledWith(file));
    await waitFor(() => expect(onEnter).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('takes an old .mapbuilder file the same way', async () => {
    render(<NewMapModal open onOpenChange={() => {}} onEnter={() => {}} />);
    fireEvent.click(sourceRadio('Map file'));
    fireEvent.drop(screen.getByTestId('v2-map-file-drop'), {
      dataTransfer: { files: [mapFile('warren.mapbuilder')] },
    });

    await screen.findByText('warren.mapbuilder');
    expect(submit().hasAttribute('disabled')).toBe(false);
  });

  it('goes by the header, not the name: a .ggvtt without it is refused', async () => {
    render(<NewMapModal open onOpenChange={() => {}} onEnter={() => {}} />);
    fireEvent.click(sourceRadio('Map file'));
    fireEvent.drop(screen.getByTestId('v2-map-file-drop'), {
      dataTransfer: { files: [new File(['{"not":"a map"}'], 'fake.ggvtt')] },
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('not a Good Goblin map file');
    expect(submit().hasAttribute('disabled')).toBe(true);
    expect(loadMap).not.toHaveBeenCalled();
  });

  it('stays on the map file source when loadMap could not read it', async () => {
    loadMap.mockResolvedValueOnce(false);
    const onEnter = vi.fn();
    render(<NewMapModal open onOpenChange={() => {}} onEnter={onEnter} />);
    fireEvent.click(sourceRadio('Map file'));
    fireEvent.drop(screen.getByTestId('v2-map-file-drop'), { dataTransfer: { files: [mapFile('old.ggvtt')] } });
    await screen.findByText('old.ggvtt');

    fireEvent.click(submit());
    await waitFor(() => expect(loadMap).toHaveBeenCalled());
    expect(onEnter).not.toHaveBeenCalled();
  });
});

function scanned(name: string, over: Partial<ScannedMap> = {}): ScannedMap {
  return {
    id: name,
    name,
    kind: 'foundry',
    sourcePath: `scenes/${name}.json`,
    composite: false,
    size: { width: 30, height: 20 },
    counts: { walls: 4, doors: 1, lights: 2 },
    imageStatus: 'found',
    thumb: null,
    warnings: [],
    load: async () => {
      throw new Error('not loaded in these tests');
    },
    ...over,
  };
}

const ok = (name: string, over: Partial<ImportResult> = {}): ImportResult => ({
  name,
  ok: true,
  warnings: [],
  bytes: 512 * 1024,
  ...over,
});

/** Open the modal on VTT files and drop a scene file; the scan hands back `rows`. */
async function scanInto(rows: ScannedMap[], props: Partial<Parameters<typeof NewMapModal>[0]> = {}) {
  scanFiles.mockResolvedValueOnce(rows);
  render(<NewMapModal open onOpenChange={() => {}} onEnter={() => {}} {...props} />);
  fireEvent.click(sourceRadio('VTT files'));
  fireEvent.drop(screen.getByTestId('v2-vtt-drop'), {
    dataTransfer: { files: [new File(['{}'], 'scene.json')] },
  });
  await screen.findByTestId('v2-vtt-count');
}

const count = () => screen.getByTestId('v2-vtt-count').textContent;

describe('NewMapModal: VTT import', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('offers a file picker and a folder picker next to the drop zone', () => {
    render(<NewMapModal open onOpenChange={() => {}} onEnter={() => {}} />);
    fireEvent.click(sourceRadio('VTT files'));

    expect(screen.getByRole('button', { name: 'Choose files' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose folder' })).toBeTruthy();
    expect(screen.getByTestId('v2-vtt-folder-input').hasAttribute('webkitdirectory')).toBe(true);
  });

  it('lists the scan with its flags, leaves a multi-floor composite off, and selects all or none', async () => {
    await scanInto([
      scanned('Cellar'),
      scanned('Keep', { kind: 'uvtt', imageStatus: 'missing', size: { width: 47, height: 42 } }),
      scanned('All floors', { composite: true }),
    ]);

    expect(count()).toBe('2 of 3 selected');
    expect((screen.getByLabelText('All floors') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('multi-floor')).toBeTruthy();
    expect(screen.getByText('no image')).toBeTruthy();
    expect(screen.getByText(/UVTT · 47×42 cells/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(count()).toBe('3 of 3 selected');
    expect(submit().textContent).toBe('Import 3');

    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    expect(count()).toBe('0 of 3 selected');
    expect(submit().hasAttribute('disabled')).toBe(true);
  });

  it('stops after the map in flight and reports the rest as not started', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let stopHook: (() => boolean) | undefined;
    // The same loop as importMaps: the stop hook is read before each map starts.
    importMaps.mockImplementationOnce(async (maps, onProgress, stopRequested) => {
      stopHook = stopRequested;
      const results: ImportResult[] = [];
      for (const [index, map] of maps.entries()) {
        if (stopRequested?.()) break;
        onProgress?.(index, map.name);
        await gate;
        results.push(ok(map.name));
      }
      return results;
    });
    await scanInto([scanned('Cellar'), scanned('Keep'), scanned('Tower')]);

    fireEvent.click(submit());
    const stop = await screen.findByTestId('v2-import-stop');
    expect(screen.getByText(/Importing 1 of 3: Cellar/)).toBeTruthy();
    expect(stopHook?.()).toBe(false);

    fireEvent.click(stop);
    expect(stopHook?.()).toBe(true);
    expect(stop.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Finishing this map, then stopping.')).toBeTruthy();

    release();
    const summary = await screen.findByTestId('v2-import-summary');
    expect(summary.textContent).toBe('Imported 1 map, 2 not started');
    expect(screen.getAllByText('not started')).toHaveLength(2);
    expect(importMaps).toHaveBeenCalledTimes(1);
  });

  it('reports a failed map with its error and folds warnings under their row', async () => {
    importMaps.mockResolvedValueOnce([
      ok('Cellar', { warnings: ['image downscaled from 9000×8000 to fit 4096px'], bytes: 3 * 1024 * 1024 }),
      { name: 'Keep', ok: false, error: 'Scene has no grid', warnings: [], bytes: 0 },
    ]);
    const onEnter = vi.fn();
    const onOpenChange = vi.fn();
    await scanInto([scanned('Cellar'), scanned('Keep')], { onEnter, onOpenChange });

    fireEvent.click(submit());
    const summary = await screen.findByTestId('v2-import-summary');
    expect(summary.textContent).toBe('Imported 1 map, 1 failed');
    expect(screen.getByText('3.0 MB of images stored with them.')).toBeTruthy();

    // Folded until asked for.
    expect(screen.queryByText('Scene has no grid')).toBeNull();
    expect(screen.queryByText(/image downscaled/)).toBeNull();

    const failed = screen.getByRole('button', { name: /Keep\s*failed/ });
    expect(failed.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(failed);
    expect(failed.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Scene has no grid')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Cellar\s*imported · 1 note/ }));
    expect(screen.getByText('image downscaled from 9000×8000 to fit 4096px')).toBeTruthy();

    // One map came in: it is the one on the canvas, so closing the report opens it.
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onEnter).toHaveBeenCalled();
  });

  it('closes back to the cards when several maps came in', async () => {
    importMaps.mockResolvedValueOnce([ok('Cellar'), ok('Keep')]);
    const onEnter = vi.fn();
    const onOpenChange = vi.fn();
    await scanInto([scanned('Cellar'), scanned('Keep')], { onEnter, onOpenChange });

    fireEvent.click(submit());
    await screen.findByTestId('v2-import-summary');
    expect(screen.queryByRole('button', { name: /Cellar/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onEnter).not.toHaveBeenCalled();
  });
});

describe('NewMapModal: Escape', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('closes from the name field, and the canvas never hears the key', async () => {
    const heard = vi.fn();
    document.addEventListener('keydown', heard);
    try {
      const onOpenChange = vi.fn();
      render(<NewMapModal open onOpenChange={onOpenChange} onEnter={() => {}} />);
      const input = screen.getByLabelText('Name');
      input.focus();
      fireEvent.change(input, { target: { value: 'Crypt' } });

      fireEvent.keyDown(input, { key: 'Escape' });
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(heard).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', heard);
    }
  });

  it('closes with focus on the dialog itself, outside the form', () => {
    const onOpenChange = vi.fn();
    render(<NewMapModal open onOpenChange={onOpenChange} onEnter={() => {}} />);
    const popup = screen.getByRole('dialog');

    fireEvent.keyDown(popup, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does nothing while an import is running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    importMaps.mockImplementationOnce(async (maps, onProgress) => {
      onProgress?.(0, maps[0].name);
      await gate;
      return maps.map((m) => ok(m.name));
    });
    const onOpenChange = vi.fn();
    await scanInto([scanned('Cellar'), scanned('Keep')], { onOpenChange });

    fireEvent.click(submit());
    const stop = await screen.findByTestId('v2-import-stop');
    fireEvent.keyDown(stop, { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('v2-import-stop')).toBeTruthy();

    release();
    await screen.findByTestId('v2-import-summary');
    fireEvent.keyDown(screen.getByTestId('v2-import-done'), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

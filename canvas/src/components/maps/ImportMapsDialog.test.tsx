import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ImportMapsDialog } from './ImportMapsDialog';
import type { ScannedMap } from '@/io/importFolder';

const rows: ScannedMap[] = [
  {
    id: 'a',
    name: 'Cellar',
    kind: 'foundry',
    sourcePath: 'p.db',
    composite: false,
    size: { width: 10, height: 8 },
    counts: { walls: 3, doors: 1, lights: 2 },
    imageStatus: 'found',
    thumb: 'data:image/png;base64,AAAA',
    warnings: [],
    load: async () => { throw new Error('unused'); },
  },
  {
    id: 'b',
    name: 'Cellar (levels)',
    kind: 'foundry',
    sourcePath: 'p.db',
    composite: true,
    size: { width: 10, height: 8 },
    counts: { walls: 6, doors: 2, lights: 0 },
    imageStatus: 'missing',
    thumb: null,
    warnings: [],
    load: async () => { throw new Error('unused'); },
  },
];

const { scanFiles, importMaps, notify } = vi.hoisted(() => ({
  scanFiles: vi.fn<() => Promise<ScannedMap[]>>(),
  importMaps: vi.fn(
    async (picked: ScannedMap[], onProgress?: (i: number, n: string) => void, stop?: () => boolean) => {
      const done = [];
      for (const [i, p] of picked.entries()) {
        if (stop?.()) break;
        onProgress?.(i, p.name);
        done.push({ name: p.name, ok: true, warnings: ['1 cone lights imported as full circles'], bytes: 2048 * 1024 });
      }
      return done;
    },
  ),
  notify: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/io/importFolder', () => ({
  scanFiles,
  filesFromList: (list: File[]) => new Map(list.map((f) => [f.name, f])),
  filesFromDataTransfer: async () => new Map(),
}));
vi.mock('@/io/importMap', () => ({ importMaps }));
vi.mock('@/lib/toast', () => ({ notify }));

function pickFiles() {
  const input = screen.getByTestId('import-maps-files-input') as HTMLInputElement;
  const file = new File(['{}'], 'maps.db');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('ImportMapsDialog', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    scanFiles.mockResolvedValue(rows);
  });

  it('opens on a clickable drop zone with folder and file pickers', () => {
    render(<ImportMapsDialog open onOpenChange={() => {}} />);
    expect(screen.getByText('Import maps')).toBeTruthy();
    expect(screen.getByTestId('import-maps-drop-zone').tagName).toBe('BUTTON');
    expect(screen.getByRole('button', { name: /Choose folder/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Choose files/ })).toBeTruthy();
  });

  it('lists scanned maps with composites unchecked and imports the checked ones', async () => {
    const onOpenChange = vi.fn();
    render(<ImportMapsDialog open onOpenChange={onOpenChange} />);
    pickFiles();

    await waitFor(() => expect(screen.getByText('Cellar')).toBeTruthy());
    expect(scanFiles).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('import-maps-count').textContent).toBe('1 of 2 selected');
    expect((screen.getByLabelText('Cellar') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Cellar (levels)') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('multi-floor')).toBeTruthy();
    expect(screen.getByText(/no image/)).toBeTruthy();
    expect(screen.getByText(/3 walls · 1 doors · 2 lights/)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('import-maps-submit')));

    fireEvent.click(screen.getByText('Select all'));
    expect(screen.getByTestId('import-maps-count').textContent).toBe('2 of 2 selected');
    fireEvent.click(screen.getByLabelText('Cellar (levels)'));
    expect(screen.getByTestId('import-maps-count').textContent).toBe('1 of 2 selected');

    fireEvent.click(screen.getByTestId('import-maps-submit'));
    await waitFor(() => expect(screen.getByTestId('import-maps-summary')).toBeTruthy());
    expect(importMaps.mock.calls[0][0].map((r) => r.id)).toEqual(['a']);
    expect(screen.getByTestId('import-maps-summary').textContent).toContain('Imported 1 map');
    expect(screen.getByTestId('import-maps-summary').textContent).toContain('2.0 MB');
    expect(screen.getByText('1 cone lights imported as full circles')).toBeTruthy();
    expect(notify.success).toHaveBeenCalledWith('Imported 1 map');

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('submits on Enter from the list and keeps the summary up after the modal state is dropped', async () => {
    const { rerender } = render(<ImportMapsDialog open onOpenChange={() => {}} />);
    pickFiles();
    await waitFor(() => expect(screen.getByText('Cellar')).toBeTruthy());

    fireEvent.keyDown(screen.getByLabelText('Cellar'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('import-maps-summary')).toBeTruthy());
    // The host closes the modal while maps are being created; the summary must survive that.
    rerender(<ImportMapsDialog open={false} onOpenChange={() => {}} />);
    expect(screen.getByTestId('import-maps-summary')).toBeTruthy();
  });

  it('stops after the current map when asked and says how many were not started', async () => {
    let release: () => void = () => {};
    importMaps.mockImplementationOnce(async (picked, onProgress, stop) => {
      onProgress?.(0, picked[0].name);
      await new Promise<void>((r) => (release = r));
      const done = [{ name: picked[0].name, ok: true, warnings: [], bytes: 0 }];
      return stop?.() ? done : picked.map((p) => ({ name: p.name, ok: true, warnings: [], bytes: 0 }));
    });
    render(<ImportMapsDialog open onOpenChange={() => {}} />);
    pickFiles();
    await waitFor(() => expect(screen.getByText('Cellar')).toBeTruthy());
    fireEvent.click(screen.getByText('Select all'));
    fireEvent.click(screen.getByTestId('import-maps-submit'));

    await waitFor(() => expect(screen.getByTestId('import-maps-stop')).toBeTruthy());
    fireEvent.click(screen.getByTestId('import-maps-stop'));
    expect(screen.getByText('Finishing this map, then stopping.')).toBeTruthy();
    release();

    await waitFor(() => expect(screen.getByTestId('import-maps-summary')).toBeTruthy());
    expect(screen.getByTestId('import-maps-summary').textContent).toContain('Imported 1 map, 1 not started');
  });

  it('says so when nothing importable was picked', async () => {
    scanFiles.mockResolvedValueOnce([]);
    render(<ImportMapsDialog open onOpenChange={() => {}} />);
    pickFiles();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/No maps found/));
  });
});

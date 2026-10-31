import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import { strToU8 as encode, zipSync, type Zippable } from 'fflate';
import type { PackManifest } from '@dnd/core/src/engine/assetPackManager';

/** The manager the sheet and the packs slice both talk to, as a stateful fake. */
const fake = vi.hoisted(() => {
  type Row = { packId: string; version: string; bundleSize: number; bundled: boolean; installedAt: number; entryCount: number; themes: string[] };
  const state = {
    installed: new Map<string, Row>(),
    manifests: new Map<string, unknown>(),
  };
  const manager = {
    catalogVersion: 0,
    getInstalledPacks: () => [...state.installed.values()],
    getPackManifests: () => [...state.manifests].map(([packId, manifest]) => ({ packId, manifest })),
    getCacheUsage: async () => ({
      used: [...state.installed.values()].filter((p) => !p.bundled).reduce((n, p) => n + p.bundleSize, 0),
      limit: 200 * 1024 * 1024,
    }),
    registerPack: vi.fn(async (packId: string, manifest: { version: string; entries: object; theme?: string[] }, blobs: Map<string, Uint8Array>, bundled = false) => {
      const bundleSize = [...blobs.values()].reduce((n, b) => n + b.length, 0);
      state.installed.set(packId, { packId, version: manifest.version, bundleSize, bundled, installedAt: 1, entryCount: Object.keys(manifest.entries).length, themes: manifest.theme ?? [] });
      state.manifests.set(packId, manifest);
    }),
    uninstallPack: vi.fn(async (packId: string) => {
      state.installed.delete(packId);
      state.manifests.delete(packId);
    }),
    checkForUpdates: vi.fn(async () => [] as unknown[]),
    checkForUpdatesReport: vi.fn(async (): Promise<{ status: 'ok' | 'unreachable'; updates: unknown[] }> => ({ status: 'ok', updates: [] })),
    updatePack: vi.fn(async () => ({ changedFiles: 6, unchangedFiles: 10, downloadedBytes: 420_000, totalFiles: 16 })),
    installPack: vi.fn(async () => {}),
  };
  return { state, manager };
});

vi.mock('@/engine/assetPackInstance', () => ({
  getAssetPackManager: () => fake.manager,
  resetAssetPackManager: () => {},
}));

import { useStore } from '@/store/store';
import { PacksSheet } from './PacksSheet';
import { EditorShell } from './EditorShell';

const MB = 1024 * 1024;
const strToU8 = (s: string) => new Uint8Array(encode(s));

function seed(rows: { packId: string; version: string; size: number; bundled: boolean; description?: string }[]) {
  fake.state.installed.clear();
  fake.state.manifests.clear();
  for (const r of rows) {
    fake.state.installed.set(r.packId, { packId: r.packId, version: r.version, bundleSize: r.size, bundled: r.bundled, installedAt: Date.UTC(2026, 9, 31), entryCount: 3, themes: ['fantasy'] });
    fake.state.manifests.set(r.packId, { name: r.packId, description: r.description ?? '', version: r.version, bundleSize: r.size, entries: {}, atlases: {}, files: {} });
  }
  // Boot marks every pack bundled; the sheet has to read the stored flags over it.
  useStore.getState().setInstalledPacks(rows.map((r) => ({ packId: r.packId, name: r.packId, version: r.version, sizeBytes: r.size, bundled: true, installedAt: 0 })));
}

const BUNDLED_AND_FILE = [
  { packId: 'gg-forge', version: '1.5.0', size: 1.2 * MB, bundled: true },
  { packId: 'crates', version: '1.0.0', size: 1.5 * MB, bundled: false, description: 'Two test props' },
  { packId: 'gg-demo', version: '0.1.2', size: 18 * MB, bundled: true },
];

function zipFile(name: string, files: Zippable): File {
  return new File([zipSync(files) as Uint8Array<ArrayBuffer>], name, { type: 'application/zip' });
}

function packZip(name: string, version: string): File {
  const manifest: PackManifest = {
    name,
    description: '',
    version,
    bundleSize: 4,
    entries: { crate_1x1_object_A: { type: 'object', material: 'crate', gridSize: '1x1', pieceType: 'object', variant: 'A', tags: [] } },
    atlases: {},
    files: { 'crate_1x1_A-0000.png': { checksum: '', size: 4 } },
  };
  return zipFile(`${name}.zip`, { 'manifest.json': strToU8(JSON.stringify(manifest)), 'crate_1x1_A-0000.png': new Uint8Array([1, 2, 3, 4]) });
}

const rowOf = (packId: string) => screen.getAllByTestId('v2-pack-row').find((r) => r.dataset.packId === packId)!;

function openMenu(packId: string) {
  fireEvent.click(within(rowOf(packId)).getByRole('button', { name: `${packId} options` }));
  return screen.getByRole('menu', { name: `${packId} options` });
}

/** Place `n` props from `packId` on the open map. */
function placeProps(packId: string, n: number) {
  useStore.setState((s) => {
    const layer = s.layers.find((l) => l.type === 'dungeon');
    if (!layer || layer.type !== 'dungeon') throw new Error('no dungeon layer');
    for (let i = 0; i < n; i++) {
      layer.children.push({ id: `p${i}`, childType: 'asset', objectType: 'asset', assetId: `${packId}:crate_1x1_object_A` } as never);
    }
  });
}

describe('PacksSheet', () => {
  beforeEach(() => {
    cleanup();
    useStore.getState().resetToDefault();
    useStore.getState().setAvailableUpdates([]);
    useStore.getState().dismissUpdateResult();
    fake.manager.registerPack.mockClear();
    fake.manager.uninstallPack.mockClear();
    fake.manager.updatePack.mockClear();
  });

  it('lists every pack, bundled first then by name, with version, entries and size', () => {
    seed(BUNDLED_AND_FILE);
    render(<PacksSheet open onClose={vi.fn()} />);
    const rows = screen.getAllByTestId('v2-pack-row');
    expect(rows.map((r) => r.dataset.packId)).toEqual(['gg-demo', 'gg-forge', 'crates']);
    expect(rowOf('gg-forge').textContent).toContain('1.5.0 · 3 entries · 1.2 MB');
  });

  it('tags each row from the stored flag, not the boot-time "all bundled"', () => {
    seed(BUNDLED_AND_FILE);
    render(<PacksSheet open onClose={vi.fn()} />);
    expect(within(rowOf('gg-demo')).getByText('Bundled')).toBeTruthy();
    expect(within(rowOf('crates')).getByText('From file')).toBeTruthy();
    expect(useStore.getState().packs.installedPacks.find((p) => p.packId === 'crates')?.bundled).toBe(false);
  });

  it('offers a known update and shows it running', async () => {
    seed(BUNDLED_AND_FILE);
    let release!: () => void;
    fake.manager.updatePack.mockImplementationOnce(
      () => new Promise((r) => (release = () => r({ changedFiles: 6, unchangedFiles: 10, downloadedBytes: 420_000, totalFiles: 16 }))),
    );
    useStore.getState().setAvailableUpdates([{ packId: 'gg-forge', currentVersion: '1.5.0', availableVersion: '1.6.0' }]);
    render(<PacksSheet open onClose={vi.fn()} />);

    fireEvent.click(within(rowOf('gg-forge')).getByRole('button', { name: 'Update to 1.6.0' }));
    const busy = await within(rowOf('gg-forge')).findByRole('button', { name: 'Updating…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    await act(async () => release());
    expect(within(rowOf('gg-forge')).getByRole('status').textContent).toContain('6 files, 0.4 MB downloaded');
  });

  it('shows a finished update and Dismiss clears it', async () => {
    seed(BUNDLED_AND_FILE);
    useStore.getState().setAvailableUpdates([{ packId: 'gg-forge', currentVersion: '1.5.0', availableVersion: '1.6.0' }]);
    render(<PacksSheet open onClose={vi.fn()} />);
    fireEvent.click(within(rowOf('gg-forge')).getByRole('button', { name: 'Update to 1.6.0' }));
    await within(rowOf('gg-forge')).findByText(/Updated to/);
    fireEvent.click(within(rowOf('gg-forge')).getByRole('button', { name: 'Dismiss' }));
    expect(useStore.getState().packs.activeUpdate).toBeNull();
  });

  it('shows a failed update inline with Retry and Dismiss', async () => {
    seed(BUNDLED_AND_FILE);
    fake.manager.updatePack.mockRejectedValueOnce(new Error('Checksum mismatch for a.webp'));
    useStore.getState().setAvailableUpdates([{ packId: 'gg-forge', currentVersion: '1.5.0', availableVersion: '1.6.0' }]);
    render(<PacksSheet open onClose={vi.fn()} />);
    fireEvent.click(within(rowOf('gg-forge')).getByRole('button', { name: 'Update to 1.6.0' }));
    const alert = await within(rowOf('gg-forge')).findByRole('alert');
    expect(alert.textContent).toContain('Update failed. Checksum mismatch for a.webp');
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(within(rowOf('gg-forge')).queryByRole('alert')).toBeNull();
  });

  it('the row menu: Details for every pack, Uninstall only for a file pack', () => {
    seed(BUNDLED_AND_FILE);
    render(<PacksSheet open onClose={vi.fn()} />);

    const bundledMenu = openMenu('gg-forge');
    const off = within(bundledMenu).getByRole('menuitem', { name: /Uninstall/ }) as HTMLButtonElement;
    expect(off.disabled).toBe(true);
    expect(off.textContent).toContain('ships with the app');
    fireEvent.click(within(bundledMenu).getByRole('menuitem', { name: 'Details' }));
    expect(within(rowOf('gg-forge')).getByTestId('v2-pack-details').textContent).toContain('Bundled packs ship with the app.');

    const fileMenu = openMenu('crates');
    expect((within(fileMenu).getByRole('menuitem', { name: 'Uninstall' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(fileMenu).getByRole('menuitem', { name: 'Details' }));
    const details = within(rowOf('crates')).getByTestId('v2-pack-details').textContent;
    expect(details).toContain('Two test props');
    expect(details).toContain('fantasy');
    expect(details).toContain('Not available at the table');
  });

  it('Install from file… opens the file picker for a .zip', () => {
    seed(BUNDLED_AND_FILE);
    render(<PacksSheet open onClose={vi.fn()} />);
    const input = screen.getByTestId('v2-packs-file') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Install from file…' }));
    expect(click).toHaveBeenCalled();
    expect(input.accept).toContain('.zip');
  });

  it('installs a pack picked in the file input as a "From file" row', async () => {
    seed(BUNDLED_AND_FILE);
    render(<PacksSheet open onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('v2-packs-file'), { target: { files: [packZip('Fixture Crates', '1.0.0')] } });
    await waitFor(() => expect(screen.getAllByTestId('v2-pack-row').map((r) => r.dataset.packId)).toContain('fixture-crates'));
    expect(fake.manager.registerPack).toHaveBeenCalledWith('fixture-crates', expect.objectContaining({ name: 'Fixture Crates' }), expect.any(Map), false);
    expect(within(rowOf('fixture-crates')).getByText('From file')).toBeTruthy();
  });

  it('the drop zone takes a .zip and turns anything else away', async () => {
    seed(BUNDLED_AND_FILE);
    render(<PacksSheet open onClose={vi.fn()} />);
    const zone = screen.getByTestId('v2-packs-drop');

    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [new File(['x'], 'map.png')] } });
    expect(screen.getByRole('alert').textContent).toContain('map.png is not a pack file (.zip)');
    expect(fake.manager.registerPack).not.toHaveBeenCalled();

    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [packZip('Dropped', '2.0.0')] } });
    await waitFor(() => expect(fake.manager.registerPack).toHaveBeenCalledWith('dropped', expect.anything(), expect.any(Map), false));
  });

  it('refuses a zip without a manifest, and one named like a bundled pack, with the reason', async () => {
    seed(BUNDLED_AND_FILE);
    render(<PacksSheet open onClose={vi.fn()} />);
    const input = screen.getByTestId('v2-packs-file');

    fireEvent.change(input, { target: { files: [zipFile('no-manifest.zip', { 'a.png': new Uint8Array([1]) })] } });
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't install no-manifest.zip: No manifest.json at the root of the zipDismiss");

    fireEvent.change(input, { target: { files: [packZip('gg-forge', '9.9.9')] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('gg-forge is bundled with the app; rename the pack to install it beside it'));
    expect(fake.manager.registerPack).not.toHaveBeenCalled();
  });

  it('asks before uninstalling a pack the map uses, and not otherwise', async () => {
    seed(BUNDLED_AND_FILE);
    placeProps('crates', 2);
    render(<PacksSheet open onClose={vi.fn()} />);

    fireEvent.click(within(openMenu('crates')).getByRole('menuitem', { name: 'Uninstall' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('2 props on this map use crates. They will show as missing until the pack is back.');
    expect(fake.manager.uninstallPack).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    await waitFor(() => expect(fake.manager.uninstallPack).toHaveBeenCalledWith('crates'));
    await waitFor(() => expect(screen.getAllByTestId('v2-pack-row').map((r) => r.dataset.packId)).not.toContain('crates'));

    // Nothing on the map from it: straight through.
    seed([...BUNDLED_AND_FILE, { packId: 'unused', version: '1.0.0', size: MB, bundled: false }]);
    await act(async () => {});
    fireEvent.click(within(openMenu('unused')).getByRole('menuitem', { name: 'Uninstall' }));
    await waitFor(() => expect(fake.manager.uninstallPack).toHaveBeenCalledWith('unused'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the footer reads what is installed and the cache, both from the manager, and moves with an uninstall', async () => {
    seed(BUNDLED_AND_FILE);
    render(<PacksSheet open onClose={vi.fn()} />);
    // Bundled packs count as installed, not as cache: 1.2 + 1.5 + 18 MB installed, 1.5 MB cache.
    await waitFor(() => expect(screen.getByTestId('v2-packs-usage').textContent).toBe('Installed: 20.7 MB · cache 1.5 MB of 200 MB'));
    fireEvent.click(within(openMenu('crates')).getByRole('menuitem', { name: 'Uninstall' }));
    await waitFor(() => expect(screen.getByTestId('v2-packs-usage').textContent).toBe('Installed: 19.2 MB · cache 0.0 MB of 200 MB'));
  });

  it('two bundled packs and nothing else: installed reads their size, the cache 0.0', async () => {
    seed(BUNDLED_AND_FILE.filter((p) => p.bundled));
    render(<PacksSheet open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('v2-packs-usage').textContent).toBe('Installed: 19.2 MB · cache 0.0 MB of 200 MB'));
  });

  it('the confirm reads "1 prop … uses … It will" for one prop', async () => {
    seed(BUNDLED_AND_FILE);
    placeProps('crates', 1);
    render(<PacksSheet open onClose={vi.fn()} />);
    fireEvent.click(within(openMenu('crates')).getByRole('menuitem', { name: 'Uninstall' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('1 prop on this map uses crates. It will show as missing until the pack is back.');
  });

  it('an update source that cannot be reached says so and keeps the updates already known', async () => {
    seed(BUNDLED_AND_FILE);
    const known = [{ packId: 'gg-forge', currentVersion: '1.5.0', availableVersion: '1.6.0' }];
    useStore.getState().setAvailableUpdates(known);
    fake.manager.checkForUpdatesReport.mockResolvedValueOnce({ status: 'unreachable', updates: [] });
    render(<PacksSheet open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check updates' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Could not reach the update source'));
    expect(useStore.getState().packs.availableUpdates).toEqual(known);
    expect(within(rowOf('gg-forge')).getByRole('button', { name: 'Update to 1.6.0' })).toBeTruthy();
    // A check that gets through clears it.
    fake.manager.checkForUpdatesReport.mockResolvedValueOnce({ status: 'ok', updates: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Check updates' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Up to date'));
    expect(useStore.getState().packs.updateCheckError).toBeNull();
  });

  it('an install from file clears the last check’s line', async () => {
    seed(BUNDLED_AND_FILE);
    render(<PacksSheet open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check updates' }));
    await waitFor(() => expect(screen.getByText('Up to date')).toBeTruthy());
    fireEvent.change(screen.getByTestId('v2-packs-file'), { target: { files: [packZip('Fixture Crates', '1.0.0')] } });
    await waitFor(() => expect(screen.getAllByTestId('v2-pack-row').map((r) => r.dataset.packId)).toContain('fixture-crates'));
    expect(screen.queryByText('Up to date')).toBeNull();
  });

  it('says so when no pack is installed', () => {
    seed([]);
    render(<PacksSheet open onClose={vi.fn()} />);
    expect(screen.getByText('No packs installed.')).toBeTruthy();
  });

  it('Check updates goes busy, then says what it found', async () => {
    seed(BUNDLED_AND_FILE);
    let release!: (v: { status: 'ok' | 'unreachable'; updates: unknown[] }) => void;
    fake.manager.checkForUpdatesReport.mockImplementationOnce(() => new Promise((r) => (release = r)));
    render(<PacksSheet open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check updates' }));
    expect((screen.getByRole('button', { name: 'Checking…' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => release({ status: 'ok', updates: [] }));
    expect(screen.getByRole('status').textContent).toBe('Up to date');
  });

  it('Escape closes an open confirm first, then the sheet', async () => {
    seed(BUNDLED_AND_FILE);
    placeProps('crates', 1);
    const onClose = vi.fn();
    render(<PacksSheet open onClose={onClose} />);
    fireEvent.click(within(openMenu('crates')).getByRole('menuitem', { name: 'Uninstall' }));
    await screen.findByRole('dialog');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('opening the Packs sheet', () => {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const actions = { openExport: vi.fn(), openPublish: vi.fn(), importImage: vi.fn() };

  beforeEach(() => {
    cleanup();
    vi.stubGlobal('ResizeObserver', NoopResizeObserver);
    Element.prototype.scrollIntoView ??= () => {};
    useStore.getState().resetToDefault();
    useStore.setState({
      activeMapId: 'm1',
      mapIndex: [{ id: 'm1', name: 'Sunken Chapel', createdAt: 1, updatedAt: 1, gridSize: { width: 0, height: 0 }, layerCount: 2 }],
    });
    seed(BUNDLED_AND_FILE);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('from the … menu, under Export', () => {
    render(<EditorShell actions={actions} onHome={vi.fn()} />);
    fireEvent.click(screen.getByTestId('v2-more'));
    const items = screen.getAllByRole('menuitem').map((m) => m.textContent);
    expect(items.indexOf('Packs…')).toBe(items.findIndex((t) => t?.startsWith('Export…')) + 1);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Packs…' }));
    expect(screen.getByTestId('v2-packs-sheet')).toBeTruthy();
  });

  it('from the Props browser header', () => {
    render(<EditorShell actions={actions} onHome={vi.fn()} />);
    fireEvent.click(screen.getByTestId('v2-dock-tab-assets'));
    fireEvent.click(within(screen.getByTestId('v2-props-sheet')).getByTestId('v2-props-packs'));
    expect(screen.getByTestId('v2-packs-sheet')).toBeTruthy();
    expect(screen.queryByTestId('v2-props-sheet')).toBeNull();
  });
});

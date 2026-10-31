import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Ellipsis, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import type { PackSummary, PackUpdateInfo, PackUpdateState } from '@/store/types';
import { getAssetPackManager } from '@/engine/assetPackInstance';
import { buildMergedManifest } from '@/engine/manifestBridge';
import { refreshAssetTextures } from '@/engine/subscribeToAssets';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { PackFileError, readPackFile } from '@/io/packFile';
import { SlideOver } from './SlideOver';
import { FloatMenu, type FloatMenuEntry } from './FloatMenu';
import { usedOnMap } from './propLibrary';
import './packs.css';

/*
 * The Packs sheet: every installed pack with its version, size and where it came from,
 * Check updates and Update, Uninstall for a pack installed from a file, and Install from
 * file (the picker, or a .zip dropped on the sheet). The v1 panel at / stays as it is.
 */

const MB = 1024 * 1024;
const formatMB =(bytes: number) => `${(bytes / MB).toFixed(1)} MB`;

const isZip = (file: File) => /\.zip$/i.test(file.name);

/** Bundled first, then by name. */
function sortRows(packs: readonly PackSummary[]): PackSummary[] {
  return [...packs].sort((a, b) => Number(b.bundled) - Number(a.bundled) || a.name.localeCompare(b.name));
}

/**
 * After packs move: placed props resolve their art again (a gone pack's show the missing
 * placeholder), and the asset browser's merged manifest follows the packs as boot does.
 * The manifest write is the store change that runs the sprite sync.
 */
function packsMoved(): void {
  refreshAssetTextures();
  useStore.getState().setManifest(buildMergedManifest(getAssetPackManager().getPackManifests()));
}

/** How many props on the open map come from `packId`. */
function propsFromPack(packId: string): number {
  let n = 0;
  for (const [id, count] of usedOnMap(useStore.getState().layers)) if (id.startsWith(`${packId}:`)) n += count;
  return n;
}

/** Update offer, progress or result for one row. */
function UpdateLine({
  pack,
  update,
  state,
}: {
  pack: PackSummary;
  update?: PackUpdateInfo;
  state?: PackUpdateState;
}) {
  const run = () => void useStore.getState().updatePack(pack.packId);
  const dismiss = () => useStore.getState().dismissUpdateResult();
  if (state?.status === 'running') {
    return (
      <div className="v2-packs__line" role="status">
        <span>Downloading changed files…</span>
        <button type="button" className="v2-packs__btn" disabled aria-busy="true">
          Updating…
        </button>
      </div>
    );
  }
  if (state?.status === 'done') {
    const files = state.changedFiles ?? 0;
    return (
      <div className="v2-packs__line" role="status">
        <span>
          Updated to {state.version}
          {state.changedFiles !== undefined && ` · ${files} file${files === 1 ? '' : 's'}, ${formatMB(state.downloadedBytes ?? 0)} downloaded`}
        </span>
        <button type="button" className="v2-link" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    );
  }
  if (state?.status === 'error') {
    return (
      <div className="v2-packs__line v2-packs__line--err" role="alert">
        <span>Update failed. {state.message ?? 'The pack source could not be reached.'}</span>
        <span className="v2-packs__acts">
          <button type="button" className="v2-link" onClick={run}>
            Retry
          </button>
          <button type="button" className="v2-link" onClick={dismiss}>
            Dismiss
          </button>
        </span>
      </div>
    );
  }
  if (!update) return null;
  return (
    <div className="v2-packs__line">
      <span>
        {update.currentVersion} → {update.availableVersion}
      </span>
      <button type="button" className="v2-packs__btn" onClick={run}>
        Update to {update.availableVersion}
      </button>
    </div>
  );
}

function Details({ pack }: { pack: PackSummary }) {
  const manager = getAssetPackManager();
  const info = manager.getInstalledPacks().find((p) => p.packId === pack.packId);
  const description = manager.getPackManifests().find((p) => p.packId === pack.packId)?.manifest.description;
  return (
    <div className="v2-packs__details" data-testid="v2-pack-details">
      {description && <p>{description}</p>}
      <dl>
        <dt>Themes</dt>
        <dd>{info?.themes.length ? info.themes.join(', ') : 'None'}</dd>
        <dt>Entries</dt>
        <dd className="v2-num">{info?.entryCount ?? 0}</dd>
        <dt>Installed</dt>
        <dd>{new Date(pack.installedAt).toLocaleDateString()}</dd>
      </dl>
      <p className="v2-packs__note">
        {pack.bundled
          ? 'Bundled packs ship with the app.'
          : 'Not available at the table: players see its props as missing until the pack is published.'}
      </p>
    </div>
  );
}

function PackRow({
  pack,
  update,
  state,
  onUninstall,
}: {
  pack: PackSummary;
  update?: PackUpdateInfo;
  state?: PackUpdateState;
  onUninstall: (pack: PackSummary) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const entries = getAssetPackManager().getInstalledPacks().find((p) => p.packId === pack.packId)?.entryCount ?? 0;
  const busy = state?.status === 'running';
  const menu: FloatMenuEntry[] = [
    { label: details ? 'Hide details' : 'Details', onSelect: () => setDetails((d) => !d) },
    'divider',
    {
      label: 'Uninstall',
      onSelect: () => onUninstall(pack),
      disabled: pack.bundled || busy,
      meta: pack.bundled ? 'ships with the app' : undefined,
      testId: 'v2-pack-uninstall',
    },
  ];
  return (
    <li className="v2-packs__item" data-testid="v2-pack-row" data-pack-id={pack.packId}>
      <div className="v2-packs__row">
        <span className="v2-packs__main">
          <span className="v2-packs__title">
            <span className="v2-packs__name">{pack.name}</span>
            <span className="v2-tag">{pack.bundled ? 'Bundled' : 'From file'}</span>
          </span>
          <span className="v2-packs__meta v2-num">
            {pack.version} · {entries} {entries === 1 ? 'entry' : 'entries'} · {formatMB(pack.sizeBytes)}
          </span>
        </span>
        <button
          ref={moreRef}
          type="button"
          className={cn('v2-ib', menuOpen && 'v2-ib--on')}
          aria-label={`${pack.name} options`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <Ellipsis size={15} strokeWidth={1.75} />
        </button>
      </div>
      <UpdateLine pack={pack} update={update} state={state} />
      {details && <Details pack={pack} />}
      <FloatMenu open={menuOpen} onClose={() => setMenuOpen(false)} label={`${pack.name} options`} entries={menu} anchor={moreRef} />
    </li>
  );
}

/** The sheet: header actions, the rows, and the cache line. */
export function PacksSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { installedPacks, availableUpdates, isChecking, updateCheckError, activeUpdate } = useStore(
    useShallow((s) => ({
      installedPacks: s.packs.installedPacks,
      availableUpdates: s.packs.availableUpdates,
      isChecking: s.packs.isChecking,
      updateCheckError: s.packs.updateCheckError,
      activeUpdate: s.packs.activeUpdate,
    })),
  );
  const [usage, setUsage] = useState<{ installed: number; used: number; limit: number } | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirm, setConfirm] = useState<{ pack: PackSummary; count: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The row flags come from what each pack was stored with, not the boot-time list.
  useEffect(() => {
    if (open) useStore.getState().refreshInstalledPacks();
  }, [open, installedPacks]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    // Both from the manager: what is installed, every pack's size, and the evictable cache
    // (which leaves out what a bundled pack shipped with, so it can read 0 beside 18 MB).
    const manager = getAssetPackManager();
    const installed = manager.getInstalledPacks().reduce((sum, p) => sum + p.bundleSize, 0);
    void manager.getCacheUsage().then((u) => live && setUsage({ installed, ...u }));
    return () => {
      live = false;
    };
  }, [open, installedPacks]);

  const rows = useMemo(() => sortRows(installedPacks), [installedPacks]);
  const updates = useMemo(() => new Map(availableUpdates.map((u) => [u.packId, u])), [availableUpdates]);

  const install = useCallback(async (file: File) => {
    setNotice(null);
    if (!isZip(file)) {
      setNotice(`${file.name} is not a pack file (.zip)`);
      return;
    }
    setInstalling(file.name);
    try {
      const pack = readPackFile(new Uint8Array(await file.arrayBuffer()));
      const result = await useStore.getState().installPackFromFile(pack);
      if (result.status === 'refused') {
        setNotice(`Couldn't install ${file.name}: ${result.reason}`);
        return;
      }
      packsMoved();
      // The list just changed: what the last check said no longer holds.
      setChecked(false);
      const { name, version } = pack.manifest;
      notify.success(result.status === 'replaced' ? `Replaced ${name} ${result.previousVersion} → ${version}` : `Installed ${name} ${version}`);
    } catch (err) {
      const why = err instanceof PackFileError ? err.message : `install failed (${err instanceof Error ? err.message : String(err)})`;
      setNotice(`Couldn't install ${file.name}: ${why}`);
    } finally {
      setInstalling(null);
    }
  }, []);

  const uninstall = useCallback(async (pack: PackSummary) => {
    setConfirm(null);
    try {
      await useStore.getState().uninstallPack(pack.packId);
    } catch (err) {
      setNotice(`Couldn't uninstall ${pack.name}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    packsMoved();
    notify.success(`Uninstalled ${pack.name} · ${formatMB(pack.sizeBytes)} freed`);
  }, []);

  const askUninstall = (pack: PackSummary) => {
    const count = propsFromPack(pack.packId);
    if (count > 0) setConfirm({ pack, count });
    else void uninstall(pack);
  };

  const check = async () => {
    await useStore.getState().checkForPackUpdates();
    setChecked(true);
  };

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void install(file);
  };

  // Escape takes an open confirm away first, then the sheet.
  const close = useCallback(() => (confirm ? setConfirm(null) : onClose()), [confirm, onClose]);

  return (
    <SlideOver
      title="Packs"
      open={open}
      onClose={close}
      testId="v2-packs-sheet"
      legacy={false}
      className={cn('v2-packs', dragging && 'v2-packs--drop')}
      header={
        <header className="v2-sheet__head">
          <h2>Packs</h2>
          <button type="button" className="v2-ib" aria-label="Close Packs" onClick={onClose}>
            <X size={15} strokeWidth={1.75} />
          </button>
        </header>
      }
      footer={
        <div className="v2-packs__foot" data-testid="v2-packs-usage">
          {usage
            ? `Installed: ${formatMB(usage.installed)} · cache ${formatMB(usage.used)} of ${(usage.limit / MB).toFixed(0)} MB`
            : 'Installed: …'}
        </div>
      }
    >
      <div
        className="v2-packs__body"
        data-testid="v2-packs-drop"
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
      >
        <div className="v2-packs__bar">
          <button type="button" className="v2-packs__btn" disabled={isChecking} aria-busy={isChecking || undefined} onClick={() => void check()}>
            {isChecking ? 'Checking…' : 'Check updates'}
          </button>
          <button type="button" className="v2-packs__btn" disabled={installing !== null} onClick={() => inputRef.current?.click()}>
            Install from file…
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            data-testid="v2-packs-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void install(file);
            }}
          />
          {checked && !isChecking && (
            <span className="v2-packs__status" role="status">
              {updateCheckError ??
                (availableUpdates.length === 0 ? 'Up to date' : `${availableUpdates.length} update${availableUpdates.length === 1 ? '' : 's'} available`)}
            </span>
          )}
        </div>
        {installing && (
          <p className="v2-packs__line" role="status">
            Installing {installing}…
          </p>
        )}
        {notice && (
          <p className="v2-packs__line v2-packs__line--err" role="alert">
            <span>{notice}</span>
            <button type="button" className="v2-link" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </p>
        )}
        {rows.length === 0 ? (
          <p className="v2-packs__empty">No packs installed.</p>
        ) : (
          <ul className="v2-packs__list" aria-label="Installed packs">
            {rows.map((pack) => (
              <PackRow
                key={pack.packId}
                pack={pack}
                update={updates.get(pack.packId)}
                state={activeUpdate?.packId === pack.packId ? activeUpdate : undefined}
                onUninstall={askUninstall}
              />
            ))}
          </ul>
        )}
        <p className="v2-packs__hint">Drop a pack .zip here to install it.</p>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        title={`Uninstall ${confirm?.pack.name ?? ''}?`}
        message={
          confirm
            ? confirm.count === 1
              ? `1 prop on this map uses ${confirm.pack.name}. It will show as missing until the pack is back.`
              : `${confirm.count} props on this map use ${confirm.pack.name}. They will show as missing until the pack is back.`
            : ''
        }
        confirmLabel="Uninstall"
        destructive
        onConfirm={() => {
          if (confirm) void uninstall(confirm.pack);
        }}
      />
    </SlideOver>
  );
}

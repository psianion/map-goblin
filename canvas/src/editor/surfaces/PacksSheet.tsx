import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Ellipsis } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { IconKeyButton, PrimaryButton, SecondaryButton } from '@/editor/components';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { Input } from '@/ui/input';
import { useStore } from '@/store/store';
import type { PackSummary, PackUpdateInfo, PackUpdateState } from '@/store/types';
import { getAssetPackManager } from '@/engine/assetPackInstance';
import { buildMergedManifest } from '@/engine/manifestBridge';
import { refreshAssetTextures } from '@/engine/subscribeToAssets';
import { propEntries } from '@dnd/core/src/assets/packCatalog';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { PackFileError, readPackFile } from '@/io/packFile';
import { usedOnMap } from '@/editor/models/propLibrary';
import { useShell } from '@/editor/shell/shellStore';
import { SheetFrame } from './SheetFrame';

const MB = 1024 * 1024;
const formatMB = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`;
const isZip = (file: File) => /\.zip$/i.test(file.name);
const line = 'flex items-center justify-between gap-2 text-[11px] text-text-2';
const link = 'h-auto p-0 text-[11px] font-normal text-text underline underline-offset-2 hover:bg-transparent';

/** Bundled first, then by name. */
function sortRows(packs: readonly PackSummary[]): PackSummary[] {
  return [...packs].sort((a, b) => Number(b.bundled) - Number(a.bundled) || a.name.localeCompare(b.name));
}

/**
 * After packs move: placed props resolve their art again (a gone pack's show the missing
 * placeholder), and the merged manifest follows the packs as boot does.
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
function UpdateLine({ pack, update, state }: { pack: PackSummary; update?: PackUpdateInfo; state?: PackUpdateState }) {
  const run = () => void useStore.getState().updatePack(pack.packId);
  const dismiss = () => useStore.getState().dismissUpdateResult();
  if (state?.status === 'running') {
    return (
      <div className={line} role="status">
        <span>Downloading changed files…</span>
        <SecondaryButton disabled aria-busy="true">
          Updating…
        </SecondaryButton>
      </div>
    );
  }
  if (state?.status === 'done') {
    const files = state.changedFiles ?? 0;
    return (
      <div className={line} role="status">
        <span>
          Updated to {state.version}
          {state.changedFiles !== undefined && ` · ${files} file${files === 1 ? '' : 's'}, ${formatMB(state.downloadedBytes ?? 0)} downloaded`}
        </span>
        <Button variant="ghost" className={link} onClick={dismiss}>
          Dismiss
        </Button>
      </div>
    );
  }
  if (state?.status === 'error') {
    return (
      <div className={cn(line, 'text-danger')} role="alert">
        <span>Update failed. {state.message ?? 'The pack source could not be reached.'}</span>
        <span className="flex gap-2">
          <Button variant="ghost" className={link} onClick={run}>
            Retry
          </Button>
          <Button variant="ghost" className={link} onClick={dismiss}>
            Dismiss
          </Button>
        </span>
      </div>
    );
  }
  if (!update) return null;
  return (
    <div className={line}>
      <span className="font-mono">
        {update.currentVersion} → {update.availableVersion}
      </span>
      <SecondaryButton onClick={run}>Update to {update.availableVersion}</SecondaryButton>
    </div>
  );
}

function Details({ pack }: { pack: PackSummary }) {
  const manager = getAssetPackManager();
  const info = manager.getInstalledPacks().find((p) => p.packId === pack.packId);
  const description = manager.getPackManifests().find((p) => p.packId === pack.packId)?.manifest.description;
  const term = 'text-text-3';
  return (
    <div className="flex flex-col gap-1.5 text-[11px] text-text-2" data-testid="shell-pack-details">
      {description && <p>{description}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className={term}>Themes</dt>
        <dd>{info?.themes.length ? info.themes.join(', ') : 'None'}</dd>
        <dt className={term}>Entries</dt>
        <dd className="font-mono tabular-nums">{info?.entryCount ?? 0}</dd>
        <dt className={term}>Installed</dt>
        <dd>{new Date(pack.installedAt).toLocaleDateString()}</dd>
      </dl>
      <p className="text-text-3">
        {pack.bundled ? 'Bundled packs ship with the app.' : 'Not available at the table: players see its props as missing until the pack is published.'}
      </p>
    </div>
  );
}

function PackRow({ pack, update, state, onUninstall }: { pack: PackSummary; update?: PackUpdateInfo; state?: PackUpdateState; onUninstall: (pack: PackSummary) => void }) {
  const [details, setDetails] = useState(false);
  const entries = getAssetPackManager().getInstalledPacks().find((p) => p.packId === pack.packId)?.entryCount ?? 0;
  const busy = state?.status === 'running';
  const hasProps = propEntries().some((e) => e.packId === pack.packId);
  return (
    <li className="flex flex-col gap-1.5 border-b border-line py-2 last:border-b-0" data-testid="shell-pack-row" data-pack-id={pack.packId}>
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-text">{pack.name}</span>
            <span className="inline-flex h-[18px] items-center rounded-pill border border-line px-2 text-[10px] text-text-2">{pack.bundled ? 'Bundled' : 'From file'}</span>
          </span>
          <span className="font-mono text-[10px] text-text-3 tabular-nums">
            {pack.version} · {entries} {entries === 1 ? 'entry' : 'entries'} · {formatMB(pack.sizeBytes)}
          </span>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger render={<IconKeyButton size={26} icon={Ellipsis} label={`${pack.name} options`} />} />
          <DropdownMenuContent align="end" className="w-[232px]">
            {hasProps && <DropdownMenuItem onClick={() => useShell.getState().openAssets('props')}>Browse props</DropdownMenuItem>}
            <DropdownMenuItem onClick={() => setDetails((d) => !d)}>{details ? 'Hide details' : 'Details'}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={pack.bundled || busy} onClick={() => onUninstall(pack)} data-testid="shell-pack-uninstall">
              Uninstall
              {pack.bundled && <DropdownMenuShortcut>ships with the app</DropdownMenuShortcut>}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <UpdateLine pack={pack} update={update} state={state} />
      {details && <Details pack={pack} />}
    </li>
  );
}

/**
 * The Packs sheet: every installed pack with its version, size and where it came from,
 * Check updates and Update, Uninstall for a pack installed from a file, Install from file
 * (the picker, or a .zip dropped on the sheet), and the cache line.
 */
export function PacksSheet({ onClose }: { onClose: () => void }) {
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
    useStore.getState().refreshInstalledPacks();
  }, [installedPacks]);

  useEffect(() => {
    let live = true;
    const manager = getAssetPackManager();
    const installed = manager.getInstalledPacks().reduce((sum, p) => sum + p.bundleSize, 0);
    void manager.getCacheUsage().then((u) => live && setUsage({ installed, ...u }));
    return () => {
      live = false;
    };
  }, [installedPacks]);

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
    <SheetFrame
      title="Packs"
      onClose={close}
      testId="shell-packs-sheet"
      footer={
        <div className="border-t border-line px-3 py-2 font-mono text-[10px] text-text-3 tabular-nums" data-testid="shell-packs-usage">
          {usage ? `Installed: ${formatMB(usage.installed)} · cache ${formatMB(usage.used)} of ${(usage.limit / MB).toFixed(0)} MB` : 'Installed: …'}
        </div>
      }
    >
      <div
        className={cn('flex min-h-full flex-col gap-2.5 px-3 pt-2.5 pb-3', dragging && 'outline-dashed outline-[1.5px] outline-offset-[-6px] outline-ink')}
        data-testid="shell-packs-drop"
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <SecondaryButton disabled={isChecking} aria-busy={isChecking || undefined} onClick={() => void check()}>
            {isChecking ? 'Checking…' : 'Check updates'}
          </SecondaryButton>
          <SecondaryButton disabled={installing !== null} onClick={() => inputRef.current?.click()}>
            Install from file…
          </SecondaryButton>
          <Input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            data-testid="shell-packs-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void install(file);
            }}
          />
          {checked && !isChecking && (
            <span className="text-[11px] text-text-2" role="status">
              {updateCheckError ?? (availableUpdates.length === 0 ? 'Up to date' : `${availableUpdates.length} update${availableUpdates.length === 1 ? '' : 's'} available`)}
            </span>
          )}
        </div>
        {installing && (
          <p className={line} role="status">
            Installing {installing}…
          </p>
        )}
        {notice && (
          <p className={cn(line, 'text-danger')} role="alert">
            <span>{notice}</span>
            <Button variant="ghost" className={link} onClick={() => setNotice(null)}>
              Dismiss
            </Button>
          </p>
        )}
        {rows.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-text-3">No packs installed.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0" aria-label="Installed packs">
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
        <p className="text-[11px] text-text-3">Drop a pack .zip here to install it.</p>
      </div>
      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogTitle>Uninstall {confirm?.pack.name ?? ''}?</DialogTitle>
          <DialogDescription>
            {confirm
              ? confirm.count === 1
                ? `1 prop on this map uses ${confirm.pack.name}. It will show as missing until the pack is back.`
                : `${confirm.count} props on this map use ${confirm.pack.name}. They will show as missing until the pack is back.`
              : ''}
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <PrimaryButton onClick={() => confirm && void uninstall(confirm.pack)}>Uninstall</PrimaryButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SheetFrame>
  );
}

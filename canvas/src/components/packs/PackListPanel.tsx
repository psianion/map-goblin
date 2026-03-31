import { useCallback } from 'react';
import { useStore } from '@/store/store';
import { useShallow } from 'zustand/react/shallow';
import { PackCard } from './PackCard';
import type { PackSummary, PackUpdateInfo } from '@/store/types';

const selectPacks = (s: {
  packs: { installedPacks: PackSummary[]; availableUpdates: PackUpdateInfo[]; isChecking: boolean };
}) => ({
  installedPacks: s.packs.installedPacks,
  availableUpdates: s.packs.availableUpdates,
  isChecking: s.packs.isChecking,
});

export function PackListPanel() {
  const { installedPacks, availableUpdates, isChecking } = useStore(useShallow(selectPacks));
  const uninstallPack = useStore((s) => s.uninstallPack);
  const checkForPackUpdates = useStore((s) => s.checkForPackUpdates);

  const updatesMap = new Map(availableUpdates.map((u) => [u.packId, u]));

  const handleUninstall = useCallback(
    (packId: string) => {
      uninstallPack(packId).catch((err: Error) => {
        console.warn('[PackListPanel] Uninstall failed:', err.message);
      });
    },
    [uninstallPack],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2 shrink-0">
        <span className="text-xs font-medium text-foreground uppercase tracking-wider font-[Cinzel,serif]">
          Installed Packs
        </span>
        <button
          onClick={() => { checkForPackUpdates(); }}
          disabled={isChecking}
          className="rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          {isChecking ? 'Checking…' : 'Check Updates'}
        </button>
      </div>

      {/* Pack list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {installedPacks.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No packs installed.
          </p>
        ) : (
          installedPacks.map((pack) => (
            <PackCard
              key={pack.packId}
              pack={pack}
              update={updatesMap.get(pack.packId)}
              onUninstall={handleUninstall}
            />
          ))
        )}
      </div>

      {/* Cache usage footer */}
      <CacheUsageBar packs={installedPacks} />
    </div>
  );
}

function CacheUsageBar({ packs }: { packs: PackSummary[] }) {
  const totalUsed = packs.reduce((sum, p) => sum + p.sizeBytes, 0);
  const limit = 200 * 1024 * 1024; // 200MB
  const pct = Math.min((totalUsed / limit) * 100, 100);
  const color = pct > 90 ? 'bg-destructive' : pct > 70 ? 'bg-yellow-500' : 'bg-accent';

  return (
    <div className="border-t border-border px-3 py-2 shrink-0">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
        <span>Cache Usage</span>
        <span>
          {(totalUsed / (1024 * 1024)).toFixed(1)} / {(limit / (1024 * 1024)).toFixed(0)} MB
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

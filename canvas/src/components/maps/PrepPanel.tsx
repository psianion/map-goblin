// The Prep tab (left panel): one read-and-navigate overview of every trigger and note on
// the open map, grouped by zone — the canvas-side answer to the table's DM Prep panel.
// Rows never edit; clicking one selects its zone, centres the camera on it, and the
// right-hand properties panel is where the editing happens, as everywhere else.
import { useMemo } from 'react';
import { Crosshair, FileText, Swords, Zap } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { viewportInsetsRef } from '@/components/toolbar/zoomToFitRef';
import { cn } from '@/lib/utils';
import { buildPrepGroups, zoneAnchor } from '@/v2/editor/prepModel';
import type { ZoneChild } from '@/store/types';

/** Select the zone and pan the camera to it (same 150ms ease as zoom-to-fit, zoom kept). */
function jumpToZone(zone: ZoneChild) {
  const store = useStore.getState();
  store.setSelectedIds([zone.id]);
  if (!store.ui.rightPanelOpen) store.togglePanel('right');

  const singleton = getEngineSingleton();
  if (!singleton) return;
  const stage = singleton.engine.stage();
  const vp = singleton.engine.viewport();
  const anchor = zoneAnchor(zone);
  const zoom = stage.scale.x;
  const insets = viewportInsetsRef.current;
  const cx = insets.left + (vp.width - insets.left - insets.right) / 2;
  const cy = (vp.height - insets.bottom) / 2;
  const targetX = cx - anchor.x * zoom;
  const targetY = cy - anchor.y * zoom;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    stage.position.set(targetX, targetY);
    return;
  }
  const startX = stage.position.x;
  const startY = stage.position.y;
  const startTime = performance.now();
  const duration = 150;
  function tick(): void {
    const t = Math.min((performance.now() - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    stage.position.x = startX + (targetX - startX) * ease;
    stage.position.y = startY + (targetY - startY) * ease;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

export function PrepPanel() {
  const prep = useStore((s) => s.prep);
  const layers = useStore((s) => s.layers);
  const selectedIds = useStore(useShallow((s) => s.selection.selectedIds));

  const groups = useMemo(() => buildPrepGroups(prep, layers), [prep, layers]);

  if (groups.length === 0) {
    return (
      <div data-testid="prep-panel-empty" className="flex flex-col items-center gap-2 px-5 py-9 text-center">
        <Crosshair size={28} className="text-text-muted" strokeWidth={1.5} />
        <p className="text-panel-body text-text-muted">No prep on this map yet.</p>
        <p className="text-panel-body text-text-muted">
          Place a zone with the Zone tool{' '}
          <kbd className="rounded border border-border-default px-1 font-mono text-panel-label text-text-secondary">
            Z
          </kbd>
          , then add triggers, notes and encounters in its properties.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="prep-panel" className="flex flex-col overflow-y-auto pb-2">
      {groups.map((g) => (
        <div key={g.zoneId} className="flex flex-col">
          <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 font-mono text-panel-label uppercase tracking-wider text-text-muted">
            <Crosshair size={11} />
            <span className="min-w-0 truncate">{g.zoneName}</span>
            <span className="ml-auto opacity-70">{g.rows.length}</span>
          </div>
          {g.rows.map((row) => (
            <button
              key={row.key}
              type="button"
              data-testid="prep-row"
              disabled={!g.zone}
              onClick={() => g.zone && jumpToZone(g.zone)}
              className={cn(
                'flex w-full gap-2 px-3 py-1.5 text-left',
                'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
                g.zone && 'hover:bg-surface-2',
                !g.zone && 'cursor-default',
                g.zone && selectedIds.includes(g.zoneId) && 'bg-accent-active/10',
              )}
            >
              <span
                className={cn(
                  'mt-px shrink-0',
                  g.zone && selectedIds.includes(g.zoneId) ? 'text-accent-active' : 'text-text-muted',
                )}
              >
                {row.kind === 'note' ? (
                  <FileText size={13} />
                ) : row.kind === 'encounter' ? (
                  <Swords size={13} />
                ) : (
                  <Zap size={13} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate text-panel-body text-text-primary">{row.name}</span>
                  {row.pops && (
                    <span className="shrink-0 rounded bg-accent-active/10 px-1 font-mono text-panel-label uppercase text-accent-active">
                      Pops
                    </span>
                  )}
                  {row.inert && (
                    <span className="shrink-0 rounded bg-warning/10 px-1 font-mono text-panel-label uppercase text-warning">
                      Inert
                    </span>
                  )}
                </span>
                <span className="block truncate font-mono text-panel-label text-text-muted">
                  {row.inert ?? row.summary}
                </span>
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

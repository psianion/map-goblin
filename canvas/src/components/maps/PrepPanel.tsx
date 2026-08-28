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
import { pointInPolygon } from '@/components/properties/ZoneProperties';
import { isValidFormula } from '@dnd/core/src/shared/dice-format';
import type {
  DungeonLayer,
  LightChild,
  RoomNote,
  TriggerAction,
  TriggerDef,
  ZoneChild,
} from '@/store/types';

const CONDITION_LABELS: Record<TriggerDef['when']['kind'], string> = {
  'room-revealed': 'Room revealed',
  'enter-region': 'Enter region',
  'within-radius': 'Within radius',
};

interface ZoneInfo {
  zone: ZoneChild;
  layer: DungeonLayer;
}

/** Mirrors the server resolver's inert reasons closely enough to warn while authoring —
 *  the server stays the authority at the table. */
function triggerInert(t: TriggerDef, zones: Map<string, ZoneInfo>): string | null {
  const info = zones.get(t.when.zoneId);
  if (!info) return 'zone deleted';
  const shape = info.zone.shape;
  if (t.when.kind === 'room-revealed') {
    if (shape.kind !== 'point') return 'needs a point zone';
    const rooms = info.layer.rooms ?? [];
    if (!rooms.some((r) => pointInPolygon([shape.position.x, shape.position.y], r.boundary))) {
      return 'pin not inside a room';
    }
  } else if (shape.kind === 'point') {
    return 'zone has no area';
  }
  const lights = new Set(
    info.layer.children.filter((c): c is LightChild => c.childType === 'light').map((c) => c.id),
  );
  for (const action of t.actions) {
    if (action.kind === 'light' && !lights.has(action.lightId)) return 'light missing';
    if (action.kind === 'trap' && action.damage && !isValidFormula(action.damage)) {
      return 'bad damage formula';
    }
    if (action.kind === 'encounter') {
      if (action.monsters.length === 0) return 'encounter has no monsters';
      if (action.monsters.some((m) => m.hp !== undefined && !isValidFormula(m.hp))) {
        return 'bad monster HP formula';
      }
    }
  }
  return null;
}

function noteInert(n: RoomNote, zones: Map<string, ZoneInfo>): string | null {
  const info = zones.get(n.zoneId);
  if (!info) return 'zone deleted';
  if (!n.showOnReveal) return null;
  const shape = info.zone.shape;
  if (shape.kind === 'point') {
    const rooms = info.layer.rooms ?? [];
    if (!rooms.some((r) => pointInPolygon([shape.position.x, shape.position.y], r.boundary))) {
      return 'pin not inside a room';
    }
  }
  return null;
}

function triggerSummary(t: TriggerDef): string {
  const what = t.actions.length === 0 ? 'no actions' : t.actions.map(actionSummary).join(', ');
  return `${CONDITION_LABELS[t.when.kind]} → ${what}`;
}

function actionSummary(a: TriggerAction): string {
  switch (a.kind) {
    case 'show-text':
      return a.toPlayers ? 'Text to players' : 'Text to DM';
    case 'light':
      return a.on ? 'Light on' : 'Light off';
    case 'trap':
      return `Trap${a.save ? ` · DC ${a.save.dc} ${a.save.ability.toUpperCase()}` : ''}${a.damage ? ` · ${a.damage}` : ''}`;
    case 'ability-check':
      return `Check · DC ${a.dc} ${a.ability.toUpperCase()}`;
    case 'prompt':
      return `${a.prompt === 'initiative' ? 'Initiative' : 'Attack'} prompt`;
    case 'environment':
      return 'Environment';
    case 'encounter':
      return a.monsters.map((m) => `${m.count}× ${m.name}`).join(', ');
  }
}

function zoneAnchor(zone: ZoneChild): { x: number; y: number } {
  const shape = zone.shape;
  if (shape.kind === 'rect') return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  return { x: shape.position.x, y: shape.position.y };
}

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

interface Row {
  key: string;
  kind: 'trigger' | 'note' | 'encounter';
  name: string;
  summary: string;
  inert: string | null;
  pops: boolean;
}

interface Group {
  zoneId: string;
  zoneName: string;
  zone: ZoneChild | null;
  rows: Row[];
}

export function PrepPanel() {
  const prep = useStore((s) => s.prep);
  const layers = useStore((s) => s.layers);
  const selectedIds = useStore(useShallow((s) => s.selection.selectedIds));

  const groups = useMemo(() => {
    const zones = new Map<string, ZoneInfo>();
    for (const layer of layers) {
      if (layer.type !== 'dungeon') continue;
      for (const child of (layer as DungeonLayer).children) {
        if (child.childType === 'zone') {
          zones.set(child.id, { zone: child as ZoneChild, layer: layer as DungeonLayer });
        }
      }
    }

    const byZone = new Map<string, Group>();
    const groupFor = (zoneId: string): Group => {
      let g = byZone.get(zoneId);
      if (!g) {
        const info = zones.get(zoneId);
        g = {
          zoneId,
          zoneName: info?.zone.name ?? 'Deleted zone',
          zone: info?.zone ?? null,
          rows: [],
        };
        byZone.set(zoneId, g);
      }
      return g;
    };

    for (const t of prep?.triggers ?? []) {
      groupFor(t.when.zoneId).rows.push({
        key: t.id,
        kind: t.actions.some((a) => a.kind === 'encounter') ? 'encounter' : 'trigger',
        name: t.name,
        summary: triggerSummary(t),
        inert: triggerInert(t, zones),
        pops: false,
      });
    }
    for (const n of prep?.notes ?? []) {
      const images = n.imageKeys.length;
      groupFor(n.zoneId).rows.push({
        key: n.id,
        kind: 'note',
        name: n.title || 'Untitled note',
        summary: `Note · DM only${images > 0 ? ` · ${images} image${images === 1 ? '' : 's'}` : ''}`,
        inert: noteInert(n, zones),
        pops: n.showOnReveal,
      });
    }

    // Zone-name order keeps the list stable while prep is being edited; unanchored
    // (deleted-zone) groups sink to the bottom where their warnings are visible together.
    return [...byZone.values()].sort((a, b) => {
      if (!a.zone !== !b.zone) return a.zone ? -1 : 1;
      return a.zoneName.localeCompare(b.zoneName);
    });
  }, [prep, layers]);

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

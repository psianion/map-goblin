import { useMemo, useRef } from 'react';
import { FileText, Swords, Zap } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { cn } from '@/lib/utils';
import type { ZoneChild } from '@/store/types';
import { buildPrepGroups, zoneAnchor, type PrepGroup, type PrepRow } from './prepModel';
import { jumpToPoint } from './jumpTo';
import { selectRoom } from './roomActions';

/**
 * Select the zone and centre the camera on it, zoom kept, in what the shell leaves free:
 * the measured v2 insets, plus the sheet the list sits in when it covers more of the right.
 */
function jumpToZone(zone: ZoneChild, sheet: Element | null): void {
  useStore.getState().setSelectedIds([zone.id]);
  jumpToPoint(zoneAnchor(zone), sheet);
}

const KIND_ICON = { trigger: Zap, encounter: Swords, note: FileText } as const;

/** Select a group's anchor, zone or room, and bring it into view beside the sheet. */
function jumpToGroup(g: PrepGroup, sheet: Element | null): void {
  if (g.zone) jumpToZone(g.zone, sheet);
  else if (g.room) selectRoom(g.room.room, g.room.layer.id, sheet);
}

/**
 * Every trigger and note on the map, by zone or room, marked where the table would never fire it.
 * Read and navigate only: a row selects its zone and brings it into view; editing stays
 * in the zone's own fields.
 */
export function PrepOverview() {
  const prep = useStore((s) => s.prep);
  const layers = useStore((s) => s.layers);
  const selectedIds = useStore(useShallow((s) => s.selection.selectedIds));
  const rootRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => buildPrepGroups(prep, layers), [prep, layers]);

  if (groups.length === 0) {
    return (
      <div className="v2-prep__empty" data-testid="v2-prep-empty">
        <p>No triggers or notes yet</p>
        <p className="v2-prep__hint">
          Place a zone with <kbd>Z</kbd>, select it, then More… to add one.
        </p>
      </div>
    );
  }

  return (
    <div className="v2-prep" data-testid="v2-prep" ref={rootRef}>
      {groups.map((g) => {
        const anchorId = g.zone?.id ?? g.room?.room.id;
        const on = !!anchorId && selectedIds.includes(anchorId);
        return (
          <section key={g.zoneId} className="v2-prep__group" aria-label={g.zoneName}>
            <h3 className="v2-prep__head">
              <span className="v2-prep__zone">{g.zoneName}</span>
              <span className="v2-num">{g.rows.length}</span>
            </h3>
            {g.rows.map((row) => (
              <Row
                key={row.key}
                row={row}
                on={on}
                disabled={!anchorId}
                onClick={() => jumpToGroup(g, rootRef.current?.closest('.v2-sheet') ?? null)}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function Row({ row, on, disabled, onClick }: { row: PrepRow; on: boolean; disabled: boolean; onClick: () => void }) {
  const Icon = KIND_ICON[row.kind];
  return (
    <button
      type="button"
      className={cn('v2-prep__row', on && 'v2-prep__row--on')}
      data-testid="v2-prep-row"
      aria-current={on || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={14} strokeWidth={1.75} className="v2-prep__icon" />
      <span className="v2-prep__main">
        <span className="v2-prep__line">
          <span className="v2-prep__name">{row.name}</span>
          {row.once && <span className="v2-prep__flag">Once</span>}
          {row.enabled === false && <span className="v2-prep__flag">Off</span>}
          {row.pops && <span className="v2-prep__chip v2-prep__chip--ink">Pops</span>}
          {row.inert && <span className="v2-prep__chip">Inert</span>}
        </span>
        <span className="v2-prep__meta">{row.inert ?? row.summary}</span>
      </span>
    </button>
  );
}

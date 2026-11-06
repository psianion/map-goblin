// The Prep overview sheet: every trigger, encounter and note on the map, by zone or room,
// marked where the table would never fire it. Read and navigate only: a row picks its zone
// or room and brings it into view; editing stays in the zone's sheet and the room's key.

import { useMemo, useRef } from 'react';
import { FileText, Swords, Zap } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import type { ZoneChild } from '@/store/types';
import { Caption, KeyHint } from '@/editor/components';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import { buildPrepGroups, zoneAnchor, type PrepGroup, type PrepRow } from '@/v2/editor/prepModel';
import { jumpToPoint } from '@/v2/editor/jumpTo';
import { selectRoom } from '@/v2/editor/roomActions';

const KIND_ICON = { trigger: Zap, encounter: Swords, note: FileText } as const;

function jumpToZone(zone: ZoneChild, sheet: Element | null): void {
  useStore.getState().setSelectedIds([zone.id]);
  jumpToPoint(zoneAnchor(zone), sheet);
}

function jumpToGroup(g: PrepGroup, sheet: Element | null): void {
  if (g.zone) jumpToZone(g.zone, sheet);
  else if (g.room) selectRoom(g.room.room, g.room.layer.id, sheet);
}

export function PrepSheet() {
  const prep = useStore((s) => s.prep);
  const layers = useStore((s) => s.layers);
  const selectedIds = useStore(useShallow((s) => s.selection.selectedIds));
  const root = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => buildPrepGroups(prep, layers), [prep, layers]);

  if (groups.length === 0) {
    return (
      <div className="flex flex-col gap-1.5 px-3 py-4 text-[12px] text-text-2" data-testid="prep-empty">
        <p>No triggers or notes yet.</p>
        <p className="text-[11px] text-text-3">
          Place a zone with <KeyHint keys="Z">in Text</KeyHint>, pick it, then More… to add one.
        </p>
      </div>
    );
  }

  return (
    <div ref={root} className="flex flex-col gap-2.5 px-3 pt-2.5 pb-3" data-testid="prep">
      {groups.map((g) => {
        const anchorId = g.zone?.id ?? g.room?.room.id;
        const on = !!anchorId && selectedIds.includes(anchorId);
        return (
          <section key={g.zoneId} className="flex flex-col gap-px" aria-label={g.zoneName}>
            <div className="mb-1 flex items-center gap-2">
              <Caption>{g.zoneName}</Caption>
              <span className="font-mono text-[10px] text-text-3">{g.rows.length}</span>
            </div>
            {g.rows.map((row) => (
              <Row key={row.key} row={row} on={on} disabled={!anchorId} onClick={() => jumpToGroup(g, root.current?.closest('[data-sheet]') ?? null)} />
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
    <Button
      variant="ghost"
      data-testid="prep-row"
      aria-current={on || undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn('h-auto w-full items-start justify-start gap-2 px-1.5 py-1.5 text-left', on && 'ring-[1.5px] ring-ink ring-inset')}
    >
      <Icon aria-hidden strokeWidth={1.75} className="mt-px size-3.5 shrink-0 text-text-3" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-1 text-[12px] text-text">
          {row.name}
          {row.once && <Tag>Once</Tag>}
          {row.enabled === false && <Tag>Off</Tag>}
          {row.pops && <Tag>Pops</Tag>}
          {row.inert && <Tag>Inert</Tag>}
        </span>
        <span className="truncate text-[11px] text-text-3">{row.inert ?? row.summary}</span>
      </span>
    </Button>
  );
}

/** A flag on a row: Once, Off, Pops, Inert. */
function Tag({ children }: { children: string }) {
  return <span className="inline-flex h-4 items-center rounded-pill border border-line px-1.5 text-[10px] text-text-2">{children}</span>;
}

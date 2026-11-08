import { useState } from 'react';
import { AlertCircle, Check, ChevronRight, Minus } from 'lucide-react';
import { Button, cn, formatBytes } from '@dnd/ui';
import type { ScannedMap } from '@/io/importFolder';
import type { ImportResult } from '@/io/importMap';
import { Hint } from './parts';

/**
 * What a VTT import did, map by map: one summary line, then every picked map with how it
 * went. Warnings and errors sit folded under their row, so a clean run reads as a list.
 */

export interface ImportOutcome {
  /** The maps the DM ticked, in import order. */
  picked: ScannedMap[];
  /** One per map that was started; a stop leaves the tail of `picked` without one. */
  results: ImportResult[];
}

function importCounts({ picked, results }: ImportOutcome) {
  const ok = results.filter((r) => r.ok);
  return {
    ok: ok.length,
    failed: results.length - ok.length,
    skipped: picked.length - results.length,
    bytes: ok.reduce((n, r) => n + r.bytes, 0),
  };
}

const STATUS = {
  ok: { label: 'imported', Icon: Check },
  failed: { label: 'failed', Icon: AlertCircle },
  skipped: { label: 'not started', Icon: Minus },
} as const;

const LINE = 'flex h-auto min-h-7 w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-text';

export function ImportReport({ outcome }: { outcome: ImportOutcome }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const counts = importCounts(outcome);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-1.5">
      <p className="m-0 text-[12px] text-text" data-testid="v2-import-summary">
        Imported {counts.ok} {counts.ok === 1 ? 'map' : 'maps'}
        {counts.failed ? `, ${counts.failed} failed` : ''}
        {counts.skipped ? `, ${counts.skipped} not started` : ''}
      </p>
      {counts.ok > 0 && <Hint>{formatBytes(counts.bytes)} of images stored with them.</Hint>}

      <ul className="m-0 mt-1.5 max-h-[40vh] list-none divide-y divide-line overflow-y-auto rounded-control border border-line bg-panel-2 p-0">
        {outcome.picked.map((row, i) => {
          const result = outcome.results[i];
          const status = !result ? 'skipped' : result.ok ? 'ok' : 'failed';
          const { label, Icon } = STATUS[status];
          const notes = result ? [...(result.error ? [result.error] : []), ...result.warnings] : [];
          const expanded = open.has(row.id);
          const failed = status === 'failed';
          const line = (
            <>
              <Icon aria-hidden strokeWidth={1.75} className={cn('size-3.5 shrink-0', failed ? 'text-danger' : 'text-text-3')} />
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              <span className={cn('shrink-0 text-[11px]', failed ? 'text-danger' : 'text-text-3')}>
                {label}
                {result?.ok && notes.length > 0 && ` · ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}
              </span>
              <span className="flex w-3.5 shrink-0 text-text-3">
                {notes.length > 0 && (
                  <ChevronRight aria-hidden strokeWidth={1.75} className={cn('size-3.5', expanded && 'rotate-90')} />
                )}
              </span>
            </>
          );
          return (
            <li key={row.id}>
              {notes.length ? (
                <Button
                  variant="ghost"
                  className={cn(LINE, 'rounded-none hover:bg-panel hover:text-text')}
                  aria-expanded={expanded}
                  onClick={() => toggle(row.id)}
                >
                  {line}
                </Button>
              ) : (
                <div className={LINE}>{line}</div>
              )}
              {expanded && (
                <ul className="m-0 flex list-none flex-col gap-1 px-2.5 pt-0 pb-2.5 pl-8 text-[11px] leading-[1.45] text-text-3">
                  {result?.error && <li className="text-danger">{result.error}</li>}
                  {result?.warnings.map((w, j) => <li key={j}>{w}</li>)}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

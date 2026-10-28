import { useState } from 'react';
import { AlertCircle, Check, ChevronRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScannedMap } from '@/io/importFolder';
import type { ImportResult } from '@/io/importMap';
import { formatBytes } from './format';

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
    <div>
      <p className="v2-summary" data-testid="v2-import-summary">
        Imported {counts.ok} {counts.ok === 1 ? 'map' : 'maps'}
        {counts.failed ? `, ${counts.failed} failed` : ''}
        {counts.skipped ? `, ${counts.skipped} not started` : ''}
      </p>
      {counts.ok > 0 && <p className="v2-hint">{formatBytes(counts.bytes)} of images stored with them.</p>}

      <ul className="v2-list v2-report" style={{ marginTop: 12 }}>
        {outcome.picked.map((row, i) => {
          const result = outcome.results[i];
          const status = !result ? 'skipped' : result.ok ? 'ok' : 'failed';
          const { label, Icon } = STATUS[status];
          const notes = result ? [...(result.error ? [result.error] : []), ...result.warnings] : [];
          const expanded = open.has(row.id);
          const line = (
            <>
              <span className="v2-report-row__icon">
                <Icon size={14} strokeWidth={1.75} />
              </span>
              <span className="v2-report-row__name">{row.name}</span>
              <span className="v2-report-row__status">
                {label}
                {result?.ok && notes.length > 0 && ` · ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}
              </span>
              <span className="v2-report-row__chev">
                {notes.length > 0 && <ChevronRight size={14} strokeWidth={1.75} />}
              </span>
            </>
          );
          return (
            <li key={row.id} className={cn('v2-report-row', status === 'failed' && 'v2-report-row--failed')}>
              {notes.length ? (
                <button
                  type="button"
                  className="v2-report-row__line"
                  aria-expanded={expanded}
                  onClick={() => toggle(row.id)}
                >
                  {line}
                </button>
              ) : (
                <div className="v2-report-row__line">{line}</div>
              )}
              {expanded && (
                <ul className="v2-report-notes">
                  {result?.error && <li className="v2-report-notes__error">{result.error}</li>}
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, FolderOpen, Image as ImageIcon, Layers, Upload, X } from 'lucide-react';
import {
  Dialog,
  DialogPortal,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/toast';
import { filesFromDataTransfer, filesFromList, scanFiles, type ScannedMap } from '@/io/importFolder';
import { importMaps, type ImportResult } from '@/io/importMap';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Phase =
  | { kind: 'pick'; scanning: boolean; empty: boolean }
  | { kind: 'list'; rows: ScannedMap[]; checked: Set<string> }
  | { kind: 'importing'; total: number; index: number; name: string; stopping: boolean }
  | { kind: 'done'; results: ImportResult[]; skipped: number };

const ACCEPT = '.db,.json,.uvtt,.dd2vtt,.df2vtt';
const PICK: Phase = { kind: 'pick', scanning: false, empty: false };

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImportMapsDialog({ open, onOpenChange }: Props) {
  const [phase, setPhase] = useState<Phase>(PICK);
  const [dragOver, setDragOver] = useState(false);
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);
  const primaryRef = useRef<HTMLButtonElement>(null);

  // Each phase swaps its whole body, so focus would fall to <body>; land it on the
  // phase's primary action instead (Import, then Done), after the trap has settled.
  useEffect(() => {
    if (phase.kind !== 'list' && phase.kind !== 'done') return;
    const id = requestAnimationFrame(() => primaryRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [phase.kind]);

  // Closing forgets the list, so the next open starts on the drop zone. An import in
  // flight keeps the dialog up — maps are being written; "Stop" is the way out.
  const close = useCallback(
    (next: boolean) => {
      if (next || phase.kind === 'importing') return;
      setPhase(PICK);
      onOpenChange(false);
    },
    [onOpenChange, phase.kind],
  );

  const receive = useCallback(async (files: Map<string, File>) => {
    setPhase({ kind: 'pick', scanning: true, empty: false });
    const rows = await scanFiles(files);
    if (!rows.length) {
      setPhase({ kind: 'pick', scanning: false, empty: true });
      return;
    }
    // Single floors start checked; a Levels composite is the same floors stacked, so it starts off.
    setPhase({ kind: 'list', rows, checked: new Set(rows.filter((r) => !r.composite).map((r) => r.id)) });
  }, []);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      await receive(await filesFromDataTransfer(e.dataTransfer));
    },
    [receive],
  );

  const onInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // Copy first: clearing the input's value empties the FileList it handed us.
      const list = Array.from(e.target.files ?? []);
      e.target.value = '';
      if (list.length) void receive(filesFromList(list));
    },
    [receive],
  );

  const toggle = (id: string) =>
    setPhase((p) => {
      if (p.kind !== 'list') return p;
      const checked = new Set(p.checked);
      if (checked.has(id)) checked.delete(id);
      else checked.add(id);
      return { ...p, checked };
    });

  const setAll = (on: boolean) =>
    setPhase((p) => (p.kind === 'list' ? { ...p, checked: new Set(on ? p.rows.map((r) => r.id) : []) } : p));

  const start = async () => {
    if (phase.kind !== 'list' || phase.checked.size === 0) return;
    const picked = phase.rows.filter((r) => phase.checked.has(r.id));
    stopRef.current = false;
    setPhase({ kind: 'importing', total: picked.length, index: 0, name: picked[0].name, stopping: false });
    const results = await importMaps(
      picked,
      (index, name) => setPhase({ kind: 'importing', total: picked.length, index, name, stopping: stopRef.current }),
      () => stopRef.current,
    );
    const ok = results.filter((r) => r.ok).length;
    const skipped = picked.length - results.length;
    setPhase({ kind: 'done', results, skipped });
    if (ok) notify.success(`Imported ${ok} ${ok === 1 ? 'map' : 'maps'}`);
    else notify.error('No maps were imported');
  };

  const requestStop = () => {
    stopRef.current = true;
    setPhase((p) => (p.kind === 'importing' ? { ...p, stopping: true } : p));
  };

  const summary = useMemo(() => {
    if (phase.kind !== 'done') return null;
    const ok = phase.results.filter((r) => r.ok);
    return {
      ok: ok.length,
      failed: phase.results.length - ok.length,
      skipped: phase.skipped,
      bytes: ok.reduce((n, r) => n + r.bytes, 0),
      noted: phase.results.filter((r) => r.warnings.length || r.error),
    };
  }, [phase]);

  return (
    // Creating each map resets the store's UI slice, which drops the modal that opened us;
    // the dialog holds itself up through the import so the summary is still there to read.
    <Dialog open={open || phase.kind === 'importing' || phase.kind === 'done'} onOpenChange={close}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogContent className="max-w-lg">
          {/* Not a <form>: base-ui's Button forces type="button", so Enter is handled here. */}
          <div
            data-testid="import-maps-dialog"
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || phase.kind !== 'list' || e.target instanceof HTMLButtonElement) return;
              e.preventDefault();
              void start();
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <DialogTitle>Import maps</DialogTitle>
              {phase.kind !== 'importing' && (
                <DialogClose
                  aria-label="Close"
                  className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50 transition-colors"
                >
                  <X size={14} />
                </DialogClose>
              )}
            </div>

            {phase.kind === 'pick' && (
              <div className="space-y-3">
                <button
                  type="button"
                  data-testid="import-maps-drop-zone"
                  disabled={phase.scanning}
                  onClick={() => filesRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  className={cn(
                    'w-full flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-center transition-colors',
                    'outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60',
                    dragOver
                      ? 'border-accent-active bg-accent-active/10'
                      : 'border-border bg-muted/30 hover:bg-muted/50 hover:border-muted-foreground/40',
                  )}
                >
                  <Upload size={20} className="text-muted-foreground" />
                  <span className="text-sm text-foreground">
                    {phase.scanning ? 'Reading files…' : 'Drop a Foundry module folder or map files here'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Foundry scenes (.db, .json) and Universal VTT (.dd2vtt, .uvtt, .df2vtt)
                  </span>
                </button>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => folderRef.current?.click()} disabled={phase.scanning}>
                    <FolderOpen size={14} />
                    Choose folder
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => filesRef.current?.click()} disabled={phase.scanning}>
                    Choose files
                  </Button>
                </div>
                {phase.empty && (
                  <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
                    <AlertCircle size={14} className="shrink-0" />
                    No maps found in what you picked.
                  </p>
                )}
                <input
                  ref={folderRef}
                  data-testid="import-maps-folder-input"
                  type="file"
                  className="hidden"
                  onChange={onInput}
                  // Directory picking is a non-standard attribute; React passes it through.
                  {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                  multiple
                />
                <input
                  ref={filesRef}
                  data-testid="import-maps-files-input"
                  type="file"
                  className="hidden"
                  accept={ACCEPT}
                  multiple
                  onChange={onInput}
                />
              </div>
            )}

            {phase.kind === 'list' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span data-testid="import-maps-count">
                    {phase.checked.size} of {phase.rows.length} selected
                  </span>
                  <span className="flex gap-3">
                    <button type="button" className="hover:text-foreground" onClick={() => setAll(true)}>
                      Select all
                    </button>
                    <button type="button" className="hover:text-foreground" onClick={() => setAll(false)}>
                      None
                    </button>
                  </span>
                </div>
                <ul className="max-h-[50vh] overflow-y-auto rounded-md border border-border divide-y divide-border">
                  {phase.rows.map((row) => (
                    <li key={row.id}>
                      <label className="flex items-center gap-3 px-2.5 py-2 cursor-pointer hover:bg-muted/50 has-checked:bg-muted/60">
                        <input
                          type="checkbox"
                          className="accent-accent-active"
                          checked={phase.checked.has(row.id)}
                          onChange={() => toggle(row.id)}
                          aria-label={row.name}
                        />
                        <div className="w-14 h-10 shrink-0 rounded bg-muted overflow-hidden flex items-center justify-center text-muted-foreground">
                          {row.thumb ? (
                            <img src={row.thumb} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <ImageIcon size={16} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-sm text-foreground">
                            <span className="truncate">{row.name}</span>
                            {row.composite && (
                              <span
                                title="Several floors stacked on one canvas — import the single floors instead"
                                className="shrink-0 inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1"
                              >
                                <Layers size={11} />
                                multi-floor
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {row.size.width}×{row.size.height} · {row.counts.walls} walls · {row.counts.doors} doors ·{' '}
                            {row.counts.lights} lights
                            {row.imageStatus === 'missing' && <span className="text-destructive"> · no image</span>}
                          </div>
                        </div>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Each map is saved to your list as it finishes. Delete any you don't want afterwards.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setPhase(PICK)}>
                    Back
                  </Button>
                  <Button
                    ref={primaryRef}
                    className="flex-1"
                    data-testid="import-maps-submit"
                    disabled={phase.checked.size === 0}
                    onClick={start}
                  >
                    Import {phase.checked.size || ''}
                  </Button>
                </div>
              </div>
            )}

            {phase.kind === 'importing' && (
              <div className="space-y-3" aria-live="polite">
                <p className="text-sm text-foreground truncate">
                  Importing {phase.index + 1} of {phase.total}: {phase.name}
                </p>
                <div className="h-1.5 rounded bg-muted overflow-hidden">
                  <div
                    className="h-full bg-accent-active transition-[width] duration-200 motion-reduce:transition-none"
                    style={{ width: `${((phase.index + 0.5) / phase.total) * 100}%` }}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {phase.stopping ? 'Finishing this map, then stopping.' : 'Large maps take a few seconds each.'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="import-maps-stop"
                    disabled={phase.stopping}
                    onClick={requestStop}
                  >
                    Stop after this map
                  </Button>
                </div>
              </div>
            )}

            {phase.kind === 'done' && summary && (
              <div className="space-y-3">
                <p className="text-sm text-foreground" data-testid="import-maps-summary">
                  Imported {summary.ok} {summary.ok === 1 ? 'map' : 'maps'}
                  {summary.failed ? `, ${summary.failed} failed` : ''}
                  {summary.skipped ? `, ${summary.skipped} not started` : ''} · {formatBytes(summary.bytes)} of images stored
                </p>
                {summary.noted.length > 0 && (
                  <ul className="max-h-[40vh] overflow-y-auto rounded-md border border-border divide-y divide-border text-xs">
                    {summary.noted.map((r) => (
                      <li key={r.name} className="px-2.5 py-2">
                        <div className={cn('font-medium', r.ok ? 'text-foreground' : 'text-destructive')}>{r.name}</div>
                        {r.error && <div className="text-destructive">{r.error}</div>}
                        {r.warnings.map((w) => (
                          <div key={w} className="text-muted-foreground">
                            {w}
                          </div>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex">
                  <Button ref={primaryRef} className="flex-1" onClick={() => close(false)}>
                    Done
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

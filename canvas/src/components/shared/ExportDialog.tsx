import { useState, useCallback } from 'react';
import { useStore } from '@/store/store';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { runExportPipeline, triggerDownload } from '@/engine/export/exportPipeline';
import { downloadMapFile } from '@/io/saveLoad';
import { computeExportDimensions, worldBoundsToCells } from '@/engine/export/exportMath';
import { computeMapWorldBounds } from '@/engine/export/exportPipeline';
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

const PX_PER_CELL_OPTIONS = [64, 128, 256] as const;
type PxPerCell = (typeof PX_PER_CELL_OPTIONS)[number];

// 'mapbuilder' is the editable map itself, not a picture of it — the resolution
// and grid controls below only mean anything for the two image formats.
const FORMATS = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'mapbuilder', label: 'Map file' },
] as const;
type ExportFormat = (typeof FORMATS)[number]['value'];

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExportDialog({ open, onOpenChange }: ExportDialogProps) {
  const layers = useStore((s) => s.layers);
  const mapName = useStore((s) => s.mapSettings.name);

  const [format, setFormat] = useState<ExportFormat>('png');
  const [pxPerCell, setPxPerCell] = useState<PxPerCell>(128);
  const [includeGrid, setIncludeGrid] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compute preview dimensions
  const bounds = computeMapWorldBounds(layers);
  const { cellWidth, cellHeight } = worldBoundsToCells(bounds);
  const { widthPx, heightPx, clampedToLimit } = computeExportDimensions(
    cellWidth,
    cellHeight,
    pxPerCell,
  );

  const handleExport = useCallback(async () => {
    if (format === 'mapbuilder') {
      setExporting(true);
      setError(null);
      try {
        await downloadMapFile();
        notify.success('Map file downloaded');
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Export failed. Check console for details.');
        console.error('[ExportDialog]', err);
        notify.error('Export failed');
      } finally {
        setExporting(false);
      }
      return;
    }

    const singleton = getEngineSingleton();
    if (!singleton) {
      setError('Renderer not ready. Please wait for the canvas to initialize.');
      return;
    }

    setExporting(true);
    setError(null);

    try {
      const { blob, filename } = await runExportPipeline(
        singleton.engine,
        singleton.sceneGraph,
        layers,
        { format, pxPerCell, includeGrid, mapName },
      );
      triggerDownload(blob, filename);
      const formatLabel = format.toUpperCase();
      notify.success(`Exported as ${formatLabel.toLowerCase()}`);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed. Check console for details.');
      console.error('[ExportDialog]', err);
      notify.error('Export failed');
    } finally {
      setExporting(false);
    }
  }, [layers, format, pxPerCell, includeGrid, mapName, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogContent className="max-w-sm">
          <div className="flex items-center justify-between mb-4">
            <DialogTitle>Export Map</DialogTitle>
            <DialogClose className="text-muted-foreground hover:text-foreground transition-colors">
              ✕
            </DialogClose>
          </div>

          <div className="space-y-4">
            {/* Format */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Format</label>
              <div className="flex gap-2">
                {FORMATS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setFormat(f.value)}
                    className={cn(
                      'flex-1 py-1.5 rounded text-sm font-medium transition-colors border',
                      format === f.value
                        ? 'bg-accent text-accent-foreground border-accent'
                        : 'bg-background text-muted-foreground border-border hover:bg-muted',
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {format === 'mapbuilder' ? (
              <div className="rounded bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                Downloads the editable map as a <span className="font-mono">.mapbuilder</span> file —
                the same thing <span className="font-mono">Ctrl+S</span> writes. Open it here again,
                or load it on the table.
              </div>
            ) : (
              <>
            {/* Resolution */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                Resolution (px/cell)
              </label>
              <div className="flex gap-2">
                {PX_PER_CELL_OPTIONS.map((px) => (
                  <button
                    key={px}
                    onClick={() => setPxPerCell(px)}
                    className={cn(
                      'flex-1 py-1.5 rounded text-sm font-medium transition-colors border',
                      pxPerCell === px
                        ? 'bg-accent text-accent-foreground border-accent'
                        : 'bg-background text-muted-foreground border-border hover:bg-muted',
                    )}
                  >
                    {px}
                  </button>
                ))}
              </div>
            </div>

            {/* Grid toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeGrid}
                onChange={(e) => setIncludeGrid(e.target.checked)}
                className="accent-accent"
              />
              <span className="text-sm text-foreground">Include grid lines</span>
            </label>

            {/* Preview dimensions */}
            <div className="rounded bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Output: {widthPx} × {heightPx} px ({cellWidth} × {cellHeight} cells)
              {clampedToLimit && (
                <span className="ml-1 text-yellow-400">⚠ clamped to 8192px max</span>
              )}
            </div>
              </>
            )}

            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                disabled={exporting}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? 'Exporting…' : 'Export'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

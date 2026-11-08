import { useCallback, useEffect, useMemo, useState } from 'react';
import { editorShowsLighting } from '@dnd/core/src/engine/editorDesk';
import {
  Button,
  Dialog,
  DialogContent,
  hhmm,
  PrimaryButton,
  Seg,
  SelectRow,
  SliderRow,
  SwitchRow,
} from '@dnd/ui';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { computeMapWorldBounds, runExportPipeline, triggerDownload } from '@/engine/export/exportPipeline';
import { MAX_EXPORT_PX, computeExportDimensions, worldBoundsToCells } from '@/engine/export/exportMath';
import { downloadMapFile } from '@/io/saveLoad';
import { notify } from '@dnd/ui/toast';
import { useStore } from '@/store/store';
import { NOON, type NightSky } from '@/store/types';
import { WEATHERS, vocabLabel, type Weather } from '@dnd/core/src/shared/prep';
import { useEscapeToClose } from '@/editor/useEscapeToClose';
import { Actions, DialogHead, ErrorLine, Field, Hint } from './parts';

const FORMATS = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'map', label: 'Map file' },
] as const;
type ExportFormat = (typeof FORMATS)[number]['value'];

/** Which labels go in the picture: none, the ones players see, or every one. */
const LABELS = [
  { value: 'none', label: 'None' },
  { value: 'players', label: 'Players' },
  { value: 'all', label: 'All' },
] as const;
type ExportLabels = (typeof LABELS)[number]['value'];

const PX_PER_CELL = [64, 128, 256] as const;
type PxPerCell = (typeof PX_PER_CELL)[number];

/** The preview's longest side, px: a thumbnail of the file, from the same export pipeline. */
const PREVIEW_PX = 480;

export interface ExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SKIES: readonly { value: NightSky; label: string }[] = [
  { value: 'full-moon', label: 'Full moon' },
  { value: 'crescent', label: 'Crescent' },
  { value: 'moonless', label: 'Moonless' },
];

/** The last hour the slider reaches: a quarter before midnight. */
const LAST_MINUTE = 1440 - 15;

/** The hour, sky and weather the file is lit at. */
interface LightingPick {
  minutes: number;
  nightSky: NightSky;
  weather: Weather;
}

/**
 * Where the pickers start on each open: the editor's preview (clock, sky, weather), else the
 * map's fixed hour and its table defaults, else noon under a full moon in clear weather.
 */
function seedLighting(): LightingPick {
  const s = useStore.getState();
  const map = s.mapSettings;
  const fixed = map.timeMode === 'fixed' ? (map.fixedTime ?? NOON) : NOON;
  return {
    minutes: s.ui.previewClock ?? fixed,
    nightSky: s.ui.previewSky ?? map.nightSky ?? 'full-moon',
    weather: s.ui.previewWeather ?? map.weather ?? 'clear',
  };
}

/** Hour, Sky and Weather under "Apply lighting". */
function LightingRows({ value, onChange }: { value: LightingPick; onChange: (v: LightingPick) => void }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-control bg-panel-2 px-3 py-2" data-testid="v2-export-lighting">
      <SliderRow
        className="w-full"
        label="Hour"
        min={0}
        max={LAST_MINUTE}
        step={15}
        value={value.minutes}
        format={hhmm}
        onValueChange={(minutes) => onChange({ ...value, minutes })}
      />
      <div className="flex items-center justify-between gap-2.5">
        <span className="text-[12px] text-text-2">Sky</span>
        <Seg
          aria-label="Sky"
          value={value.nightSky}
          onValueChange={(v) => onChange({ ...value, nightSky: v as NightSky })}
          options={SKIES.map((o) => ({ value: o.value, label: o.label }))}
        />
      </div>
      <SelectRow
        className="w-full"
        label="Weather"
        value={value.weather}
        options={WEATHERS.map((w) => ({ value: w, label: vocabLabel(w) }))}
        onValueChange={(w) => onChange({ ...value, weather: w as Weather })}
      />
    </div>
  );
}

/**
 * Export the open map: a picture of it (PNG or JPEG) or the editable map file. "Apply
 * lighting" starts at whatever the editor is showing on each open (the lit preview), so
 * the file looks like the canvas the DM was just looking at; the hour, sky and weather start
 * from the editor's preview too, and the file is lit at whatever they are set to.
 */
export function ExportModal({ open, onOpenChange }: ExportModalProps) {
  const layers = useStore((s) => s.layers);
  const mapName = useStore((s) => s.mapSettings.name);

  const [format, setFormat] = useState<ExportFormat>('png');
  const [pxPerCell, setPxPerCell] = useState<PxPerCell>(128);
  const [includeGrid, setIncludeGrid] = useState(false);
  // Kept across opens, like the format, size and grid.
  const [labels, setLabels] = useState<ExportLabels>('all');
  const [lighting, setLighting] = useState(true);
  const [pick, setPick] = useState<LightingPick>(seedLighting);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each open starts lit or unlit as the editor is showing the map right now.
  useEffect(() => {
    if (!open) return;
    setLighting(editorShowsLighting());
    setPick(seedLighting());
    setError(null);
    setBusy(false);
  }, [open]);

  const bounds = computeMapWorldBounds(layers);
  const { cellWidth, cellHeight } = worldBoundsToCells(bounds);
  const dims = computeExportDimensions(cellWidth, cellHeight, pxPerCell);
  const image = format !== 'map';
  // One value per pick, so the preview re-renders when the hour, sky or weather moves.
  const { minutes, nightSky, weather } = pick;
  const lit = useMemo(() => (lighting ? { minutes, nightSky, weather } : false), [lighting, minutes, nightSky, weather]);

  // The picture the file will be, drawn small: the export pipeline itself at a thumbnail's scale
  // (the pipeline renders at DPR 1), again whenever an option changes. A blob url until replaced.
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !image) return;
    const singleton = getEngineSingleton();
    if (!singleton) return;
    let stale = false;
    let url: string | null = null;
    const longest = Math.max(1, Math.ceil(cellWidth), Math.ceil(cellHeight));
    runExportPipeline(singleton.engine, singleton.sceneGraph, layers, {
      format: format === 'jpeg' ? 'jpeg' : 'png',
      pxPerCell: PREVIEW_PX / longest,
      includeGrid,
      mapName,
      lighting: lit,
      labels,
    })
      .then(({ blob }) => {
        if (stale) return;
        url = URL.createObjectURL(blob);
        setPreview(url);
      })
      .catch((err) => {
        if (!stale) console.error('[ExportModal] preview', err);
      });
    return () => {
      stale = true;
      setPreview(null);
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, image, format, pxPerCell, includeGrid, lit, labels, layers, cellWidth, cellHeight, mapName]);

  const submit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (format === 'map') {
        await downloadMapFile();
        notify.success('Map file downloaded');
      } else {
        const singleton = getEngineSingleton();
        if (!singleton) {
          setError('The canvas is still starting. Try again in a moment.');
          return;
        }
        const { blob, filename } = await runExportPipeline(singleton.engine, singleton.sceneGraph, layers, {
          format,
          pxPerCell,
          includeGrid,
          mapName,
          lighting: lit,
          labels,
        });
        triggerDownload(blob, filename);
        notify.success(`Exported as ${format === 'png' ? 'PNG' : 'JPEG'}`);
      }
      onOpenChange(false);
    } catch (err) {
      console.error('[ExportModal]', err);
      setError(err instanceof Error ? err.message : 'Export failed.');
      notify.error('Export failed');
    } finally {
      setBusy(false);
    }
  }, [busy, format, layers, pxPerCell, includeGrid, mapName, lit, labels, onOpenChange]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useEscapeToClose(open, close, busy);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-v2-home=""
        data-testid="v2-export-modal"
        onKeyDown={(e) => {
          // Keep the canvas shortcuts out of the form, and let Enter export.
          e.stopPropagation();
          if (e.key !== 'Enter' || e.target instanceof HTMLButtonElement) return;
          e.preventDefault();
          void submit();
        }}
      >
        <DialogHead title="Export" onClose={close} />

        <Field label="Format">
          <Seg aria-label="Format" value={format} onValueChange={(v) => setFormat(v as ExportFormat)} options={[...FORMATS]} />
        </Field>

        {image ? (
          <>
            <div
              className="flex h-40 items-center justify-center overflow-hidden rounded-control border border-line bg-panel-2"
              data-testid="v2-export-preview"
            >
              {preview ? (
                <img className="block max-h-full max-w-full object-contain" src={preview} alt="Export preview" />
              ) : (
                <Hint>Rendering preview…</Hint>
              )}
            </div>
            <Field label="Pixels per square">
              <Seg
                aria-label="Pixels per square"
                value={String(pxPerCell)}
                onValueChange={(v) => setPxPerCell(Number(v) as PxPerCell)}
                options={PX_PER_CELL.map((px) => ({ value: String(px), label: <span className="font-mono">{px}</span> }))}
              />
            </Field>
            <div className="flex flex-col gap-1">
              <SwitchRow className="w-full" label="Apply lighting" checked={lighting} onCheckedChange={setLighting} />
              <Hint>
                {lighting
                  ? "The map's mood and lights at the hour, sky and weather below."
                  : 'The map as the unlit editor shows it, on its plain background.'}
              </Hint>
              {lighting && <LightingRows value={pick} onChange={setPick} />}
              <SwitchRow className="w-full" label="Grid lines" checked={includeGrid} onCheckedChange={setIncludeGrid} />
            </div>
            <Field label="Labels">
              <Seg aria-label="Labels" value={labels} onValueChange={(v) => setLabels(v as ExportLabels)} options={[...LABELS]} />
            </Field>
            <Hint data-testid="v2-export-size">
              <span className="font-mono text-text-2 tabular-nums">
                {dims.widthPx} × {dims.heightPx} px
              </span>
              {' · '}
              {cellWidth} × {cellHeight} squares
              {dims.clampedToLimit && (
                <>
                  {' · '}
                  scaled to {Math.round(dims.pxPerCell)} px a square to stay under {MAX_EXPORT_PX} px
                </>
              )}
            </Hint>
          </>
        ) : (
          <Hint>The editable map, the same file Ctrl+S saves. Open it here again or load it on the table.</Hint>
        )}

        {error && <ErrorLine>{error}</ErrorLine>}

        <Actions>
          <Button variant="outline" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <PrimaryButton data-testid="v2-export-go" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Exporting…' : 'Export'}
          </PrimaryButton>
        </Actions>
      </DialogContent>
    </Dialog>
  );
}

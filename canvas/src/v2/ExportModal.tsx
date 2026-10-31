import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { editorShowsLighting } from '@dnd/core/src/engine/editorDesk';
import { Dialog, DialogPortal, DialogBackdrop, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { computeMapWorldBounds, runExportPipeline, triggerDownload } from '@/engine/export/exportPipeline';
import { MAX_EXPORT_PX, computeExportDimensions, worldBoundsToCells } from '@/engine/export/exportMath';
import { downloadMapFile } from '@/io/saveLoad';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/toast';
import { useStore } from '@/store/store';
import { NOON, type NightSky } from '@/store/types';
import { WEATHERS, vocabLabel, type Weather } from '@dnd/core/src/shared/prep';
import { hhmm } from './editor/lightModel';
import './editor/lighting.css';
import { useEscapeToClose } from './useEscapeToClose';

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

/** A segmented row of choices, in the modal's own vocabulary (see MapSettingsModal). */
function Segs<T extends string | number>({
  label,
  value,
  options,
  onChange,
  mono,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="v2-label">{label}</span>
      <div className="v2-segs" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={cn('v2-seg', value === o.value && 'v2-seg--on', mono && 'v2-seg--mono')}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One on/off line: the name on the left, the switch on the right, a hint under both. */
function Toggle({
  label,
  hint,
  checked,
  onChange,
  children,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="v2-toggle">
      <label className="v2-toggle__row">
        <span>{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          className={cn('v2-switch', checked && 'v2-switch--on')}
          onClick={() => onChange(!checked)}
        >
          <span />
        </button>
      </label>
      {hint && <p className="v2-hint v2-toggle__hint">{hint}</p>}
      {children}
    </div>
  );
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

/** Hour, Sky and Weather under "Apply lighting" (board 7). */
function LightingRows({ value, onChange }: { value: LightingPick; onChange: (v: LightingPick) => void }) {
  const pct = (value.minutes / LAST_MINUTE) * 100;
  return (
    <div className="v2-export-light" data-testid="v2-export-lighting">
      <div className="v2-export-light__row">
        <span className="v2-export-light__lbl">Hour</span>
        <input
          type="range"
          className="v2-range"
          min={0}
          max={LAST_MINUTE}
          step={15}
          value={value.minutes}
          aria-label="Hour"
          aria-valuetext={hhmm(value.minutes)}
          style={{ '--v2-fill': `${pct}%` } as CSSProperties}
          onChange={(e) => onChange({ ...value, minutes: Number(e.target.value) })}
        />
        <span className="v2-export-light__val">{hhmm(value.minutes)}</span>
      </div>
      <div className="v2-export-light__row">
        <span className="v2-export-light__lbl">Sky</span>
        <div className="v2-segs" role="radiogroup" aria-label="Sky">
          {SKIES.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={value.nightSky === o.value}
              className={cn('v2-seg', value.nightSky === o.value && 'v2-seg--on')}
              onClick={() => onChange({ ...value, nightSky: o.value })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="v2-export-light__row">
        <span className="v2-export-light__lbl">Weather</span>
        <select
          className="v2-input"
          aria-label="Weather"
          value={value.weather}
          onChange={(e) => onChange({ ...value, weather: e.target.value as Weather })}
        >
          {WEATHERS.map((w) => (
            <option key={w} value={w}>
              {vocabLabel(w)}
            </option>
          ))}
        </select>
      </div>
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
        if (!stale) console.error('[v2/ExportModal] preview', err);
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
      console.error('[v2/ExportModal]', err);
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
      <DialogPortal>
        <DialogBackdrop className="v2-backdrop" />
        <DialogContent className="v2-modal max-w-[420px] p-0">
          <div
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
            <div className="v2-modal__head">
              <DialogTitle className="v2-modal__title">Export</DialogTitle>
              <button type="button" className="v2-x" aria-label="Close" onClick={close}>
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>

            <div className="v2-modal__body">
              <Segs label="Format" value={format} options={FORMATS} onChange={setFormat} />

              {image ? (
                <>
                  <div className="v2-export-preview" data-testid="v2-export-preview">
                    {preview ? (
                      <img src={preview} alt="Export preview" />
                    ) : (
                      <span className="v2-hint">Rendering preview…</span>
                    )}
                  </div>
                  <Segs
                    label="Pixels per square"
                    value={pxPerCell}
                    options={PX_PER_CELL.map((px) => ({ value: px, label: String(px) }))}
                    onChange={setPxPerCell}
                    mono
                  />
                  <div className="v2-toggles">
                    <Toggle
                      label="Apply lighting"
                      hint={
                        lighting
                          ? "The map's mood and lights at the hour, sky and weather below."
                          : 'The map as the unlit editor shows it, on its plain background.'
                      }
                      checked={lighting}
                      onChange={setLighting}
                    >
                      {lighting && <LightingRows value={pick} onChange={setPick} />}
                    </Toggle>
                    <Toggle label="Grid lines" checked={includeGrid} onChange={setIncludeGrid} />
                  </div>
                  <Segs label="Labels" value={labels} options={LABELS} onChange={setLabels} />
                  <p className="v2-hint v2-export-size" data-testid="v2-export-size">
                    <span className="v2-export-size__px">
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
                  </p>
                </>
              ) : (
                <p className="v2-hint v2-export-size">
                  The editable map, the same file Ctrl+S saves. Open it here again or load it on the table.
                </p>
              )}

              {error && (
                <p role="alert" className="v2-error">
                  <AlertCircle size={14} className="mt-px shrink-0" />
                  {error}
                </p>
              )}
            </div>

            <div className="v2-modal__foot">
              <button type="button" className="v2-btn v2-btn--ghost" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="v2-btn v2-btn--primary"
                data-testid="v2-export-go"
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy ? 'Exporting…' : 'Export'}
              </button>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

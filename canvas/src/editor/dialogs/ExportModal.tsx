import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { editorShowsLighting } from '@dnd/core/src/engine/editorDesk';
import {
  Button,
  Checkbox,
  cn,
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
import {
  MAX_EXPORT_PX,
  buildExportFilename,
  computeExportDimensions,
  worldBoundsToCells,
} from '@/engine/export/exportMath';
import { downloadBytes, downloadMapFile, mapFilename } from '@/io/saveLoad';
import { buildLevelsZip, levelsZipName } from '@/io/levelZip';
import { notify } from '@dnd/ui/toast';
import { useStore } from '@/store/store';
import { shownLevelId } from '@/store/selectors';
import { NOON, TERRAIN_PANEL_ID, type Layer, type Level, type NightSky, type TerrainData } from '@/store/types';
import { WEATHERS, vocabLabel, type Weather } from '@dnd/core/src/shared/prep';
import { isTraceLayer } from '@dnd/core/src/shared/traceLayer';
import { layerOnLevel } from '@/editor/models/roomModel';
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

/** The Level pick that exports every level, one file each, in one zip. */
const EVERY_LEVEL = '*every';

/** One row of the Layers checklist. */
interface LayerRow {
  id: string;
  name: string;
  /** Hidden in the editor: it stays out of the file, as it always has. */
  hidden: boolean;
  /** A background image: a picture to trace over, out of the file unless ticked. */
  trace: boolean;
}

/**
 * The checklist for a level: the dock's layer strip, in its order — the background, the
 * terrain once painted, then the level's own layers, bottom first.
 */
function layerRows(layers: readonly Layer[], levels: readonly Level[], levelId: string, terrain: TerrainData | undefined): LayerRow[] {
  const rows: LayerRow[] = [];
  const background = layers.find((l) => l.type === 'background');
  if (background) rows.push({ id: background.id, name: background.name || 'Background', hidden: !background.visible, trace: false });
  if (terrain?.bounds) rows.push({ id: TERRAIN_PANEL_ID, name: 'Terrain', hidden: !(terrain.visible ?? true), trace: false });
  for (const l of layers) {
    if (l.type === 'background' || !layerOnLevel(l, levels, levelId)) continue;
    rows.push({ id: l.id, name: l.name || 'Unnamed layer', hidden: !l.visible, trace: isTraceLayer(l) });
  }
  return rows;
}

/** Whether a row goes in the file: never while hidden, else its tick, else on unless it is a background image. */
const drawsRow = (row: LayerRow, ticks: Record<string, boolean>): boolean => !row.hidden && (ticks[row.id] ?? !row.trace);

/** A level's own layers, the background with them: the frame its file is cut to. */
const levelLayers = (layers: readonly Layer[], levels: readonly Level[], levelId: string): Layer[] =>
  layers.filter((l) => l.type === 'background' || layerOnLevel(l, levels, levelId));

/** What one file draws: a level, its frame, and the layers in it. */
interface ExportTarget {
  levelId: string;
  levelName: string;
  layers: Layer[];
  layerIds: string[];
}

/** A target's size: its squares, and its pixels at `pxPerCell`. */
function sizeOf(target: ExportTarget, pxPerCell: number) {
  const { cellWidth, cellHeight } = worldBoundsToCells(computeMapWorldBounds(target.layers));
  return { cellWidth, cellHeight, dims: computeExportDimensions(cellWidth, cellHeight, pxPerCell) };
}

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

/** The Layers checklist: one tick per row, a hidden layer shown but not tickable. */
function LayerChecklist({ rows, ticks, onTick }: { rows: LayerRow[]; ticks: Record<string, boolean>; onTick: (id: string, on: boolean) => void }) {
  return (
    <div role="group" aria-label="Layers" className="flex flex-col rounded-control border border-line" data-testid="v2-export-layers">
      {rows.map((row) => (
        <div
          key={row.id}
          data-layer-id={row.id}
          className="flex items-center gap-2 border-b border-line px-2 py-1.5 text-[12px] last:border-b-0"
        >
          <label className={cn('flex min-w-0 flex-1 items-center gap-2', row.hidden ? 'text-text-3' : 'cursor-pointer text-text')}>
            <Checkbox checked={drawsRow(row, ticks)} disabled={row.hidden} onCheckedChange={(on) => onTick(row.id, on)} />
            <span className="min-w-0 truncate">{row.name}</span>
          </label>
          {(row.hidden || row.trace) && (
            <span className="shrink-0 text-[11px] text-text-3">{row.hidden ? 'hidden' : 'background image'}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** One block of options in the right column, a line between blocks. */
const Group = ({ children }: { children: React.ReactNode }) => <div className="flex flex-col gap-2 py-3">{children}</div>;

/**
 * Export the open map: a picture of a level (PNG or JPEG), every level in one zip, or the
 * editable map file. "Apply lighting" starts at whatever the editor is showing on each open
 * (the lit preview), so the file looks like the canvas the DM was just looking at; the hour,
 * sky and weather start from the editor's preview too, and the file is lit at whatever they
 * are set to. Another level is drawn without switching the editor to it.
 *
 * Never taller than the window less 48 px: the head and the foot stay, the body scrolls. A
 * window that leaves the dialog 640 px wide or more puts the preview left and the options
 * right, at any height; a narrower one stacks them, the preview a strip on top.
 */
export function ExportModal({ open, onOpenChange }: ExportModalProps) {
  const layers = useStore((s) => s.layers);
  const levels = useStore((s) => s.levels);
  const openLevelId = useStore((s) => shownLevelId(s));
  const terrain = useStore((s) => s.mapSettings.terrain);
  const mapName = useStore((s) => s.mapSettings.name);

  const [format, setFormat] = useState<ExportFormat>('png');
  const [pxPerCell, setPxPerCell] = useState<PxPerCell>(128);
  const [includeGrid, setIncludeGrid] = useState(false);
  // Kept across opens, like the format, size and grid.
  const [labels, setLabels] = useState<ExportLabels>('all');
  const [lighting, setLighting] = useState(true);
  const [pick, setPick] = useState<LightingPick>(seedLighting);
  // The level and the layer ticks start over on each open: the open level, the default ticks.
  const [levelPick, setLevelPick] = useState('');
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Each open starts lit or unlit as the editor is showing the map right now.
  useEffect(() => {
    if (!open) return;
    setLighting(editorShowsLighting());
    setPick(seedLighting());
    setLevelPick(shownLevelId(useStore.getState()));
    setTicks({});
    setError(null);
    setBusy(false);
    setProgress(null);
  }, [open]);

  const image = format !== 'map';
  const manyLevels = levels.length > 1;
  const every = manyLevels && levelPick === EVERY_LEVEL;
  // The level the checklist and the preview show: the one picked, else the open one.
  const levelId = levels.some((l) => l.id === levelPick) ? levelPick : openLevelId;

  const rows = useMemo(() => layerRows(layers, levels, levelId, terrain), [layers, levels, levelId, terrain]);
  // Every level takes each level's default ticks: no layer is shared between levels to carry a tick across.
  const targets = useMemo<ExportTarget[]>(() => {
    const target = (id: string, layerIds: string[]): ExportTarget => ({
      levelId: id,
      levelName: levels.find((l) => l.id === id)?.name ?? '',
      layers: levelLayers(layers, levels, id),
      layerIds,
    });
    if (every) {
      return levels.map((l) => target(l.id, layerRows(layers, levels, l.id, terrain).filter((r) => drawsRow(r, {})).map((r) => r.id)));
    }
    return [target(levelId, rows.filter((r) => drawsRow(r, ticks)).map((r) => r.id))];
  }, [every, levels, layers, levelId, rows, terrain, ticks]);
  const shown = targets.find((t) => t.levelId === levelId) ?? targets[0]!;

  // The size line: the largest file when there are several.
  const sizes = targets.map((t) => sizeOf(t, pxPerCell));
  const { cellWidth, cellHeight, dims } = sizes.reduce((a, b) =>
    b.dims.widthPx * b.dims.heightPx > a.dims.widthPx * a.dims.heightPx ? b : a,
  );
  const shownSize = sizeOf(shown, pxPerCell);
  const fileName = !image
    ? mapFilename(mapName)
    : every
      ? levelsZipName(mapName)
      : buildExportFilename(mapName, dims.widthPx, dims.heightPx, Math.round(dims.pxPerCell), format);

  // One value per pick, so the preview re-renders when the hour, sky or weather moves.
  const { minutes, nightSky, weather } = pick;
  const lit = useMemo(() => (lighting ? { minutes, nightSky, weather } : false), [lighting, minutes, nightSky, weather]);

  // The picture the file will be, drawn small: the export pipeline itself at a thumbnail's scale
  // (the pipeline renders at DPR 1), again whenever an option changes. A blob url until replaced.
  // With every level picked, the open level's picture.
  const [preview, setPreview] = useState<string | null>(null);
  const previewCells = Math.max(1, Math.ceil(shownSize.cellWidth), Math.ceil(shownSize.cellHeight));
  useEffect(() => {
    if (!open || !image) return;
    const singleton = getEngineSingleton();
    if (!singleton) return;
    let stale = false;
    let url: string | null = null;
    runExportPipeline(singleton.engine, singleton.sceneGraph, shown.layers, {
      format: format === 'jpeg' ? 'jpeg' : 'png',
      pxPerCell: PREVIEW_PX / previewCells,
      includeGrid,
      mapName,
      lighting: lit,
      labels,
      only: { levelId: shown.levelId, layerIds: shown.layerIds },
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
  }, [open, image, format, pxPerCell, includeGrid, lit, labels, shown, previewCells, mapName]);

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
        const render = (t: ExportTarget) =>
          runExportPipeline(singleton.engine, singleton.sceneGraph, t.layers, {
            format,
            pxPerCell,
            includeGrid,
            mapName,
            lighting: lit,
            labels,
            only: { levelId: t.levelId, layerIds: t.layerIds },
          });
        const kind = format === 'png' ? 'PNG' : 'JPEG';
        if (every) {
          // One level after another, the same options for each, into one zip.
          const files: { levelName: string; bytes: Uint8Array }[] = [];
          for (const [i, t] of targets.entries()) {
            setProgress({ done: i + 1, total: targets.length });
            const { blob } = await render(t);
            files.push({ levelName: t.levelName, bytes: new Uint8Array(await blob.arrayBuffer()) });
          }
          downloadBytes(buildLevelsZip(mapName, format, files), levelsZipName(mapName));
          notify.success(`Exported ${files.length} levels as ${kind}`);
        } else {
          const { blob, filename } = await render(targets[0]!);
          triggerDownload(blob, filename);
          notify.success(`Exported as ${kind}`);
        }
      }
      onOpenChange(false);
    } catch (err) {
      console.error('[ExportModal]', err);
      setError(err instanceof Error ? err.message : 'Export failed.');
      notify.error('Export failed');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [busy, format, every, targets, pxPerCell, includeGrid, mapName, lit, labels, onOpenChange]);

  const goRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useEscapeToClose(open, close, busy);

  const formatField = (
    <Field label="Format">
      <Seg aria-label="Format" value={format} onValueChange={(v) => setFormat(v as ExportFormat)} options={[...FORMATS]} />
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-v2-home=""
        data-testid="v2-export-modal"
        // Focus starts on Export, so Enter straight after opening exports rather than closing.
        initialFocus={goRef}
        className={cn('max-h-[calc(100dvh-48px)] gap-0 overflow-hidden p-0', image && 'w-[820px]')}
        onKeyDown={(e) => {
          // Keep the canvas shortcuts out of the form, and let Enter export — but not the Enter
          // that picks an option in an open list (Level, Weather).
          e.stopPropagation();
          if (e.key !== 'Enter' || e.target instanceof HTMLButtonElement) return;
          if (e.target instanceof Element && e.target.closest('[role="listbox"]')) return;
          e.preventDefault();
          void submit();
        }}
      >
        <div className="shrink-0 border-b border-line px-4 pt-3.5 pb-2.5">
          <DialogHead title="Export" onClose={close} />
        </div>

        {image ? (
          <div
            data-testid="v2-export-body"
            className="min-h-0 flex-1 overflow-y-auto min-[672px]:grid min-[672px]:grid-cols-[minmax(0,1fr)_300px] min-[672px]:grid-rows-[minmax(0,1fr)] min-[672px]:overflow-hidden"
          >
            <div className="flex flex-col gap-2 border-b border-line bg-panel-2 p-4 min-[672px]:min-h-0 min-[672px]:overflow-y-auto min-[672px]:border-r min-[672px]:border-b-0">
              <div
                className="flex h-[140px] shrink-0 items-center justify-center overflow-hidden rounded-control border border-line bg-panel min-[672px]:h-auto min-[672px]:min-h-[160px] min-[672px]:flex-1"
                data-testid="v2-export-preview"
              >
                {preview ? (
                  <img className="block max-h-full max-w-full object-contain" src={preview} alt="Export preview" />
                ) : (
                  <Hint>Rendering preview…</Hint>
                )}
              </div>
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
                {' · '}
                {targets.length === 1 ? '1 file' : `${targets.length} files, the largest shown`}
              </Hint>
            </div>

            <div data-testid="v2-export-options" className="flex flex-col divide-y divide-line px-4 min-[672px]:min-h-0 min-[672px]:overflow-y-auto">
              <Group>{formatField}</Group>
              <Group>
                {manyLevels && (
                  <div data-testid="v2-export-level">
                    <SelectRow
                      className="w-full"
                      label="Level"
                      value={every ? EVERY_LEVEL : levelId}
                      options={[
                        ...levels.map((l) => ({
                          value: l.id,
                          label: l.id === openLevelId ? `${l.name || 'Unnamed level'} (open now)` : l.name || 'Unnamed level',
                        })),
                        { value: EVERY_LEVEL, label: 'Every level, one file each' },
                      ]}
                      onValueChange={setLevelPick}
                    />
                  </div>
                )}
                <Field label="Layers">
                  {every ? (
                    <Hint data-testid="v2-export-layers">All layers of each level, without background images.</Hint>
                  ) : (
                    <LayerChecklist rows={rows} ticks={ticks} onTick={(id, on) => setTicks((t) => ({ ...t, [id]: on }))} />
                  )}
                </Field>
              </Group>
              <Group>
                <Field label="Pixels per square">
                  <Seg
                    aria-label="Pixels per square"
                    value={String(pxPerCell)}
                    onValueChange={(v) => setPxPerCell(Number(v) as PxPerCell)}
                    options={PX_PER_CELL.map((px) => ({ value: String(px), label: <span className="font-mono">{px}</span> }))}
                  />
                </Field>
              </Group>
              <Group>
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
              </Group>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3">
            {formatField}
            <Hint>The editable map as a .ggvtt, the same file Ctrl+S saves. Open it here again or load it on the table.</Hint>
          </div>
        )}

        {error && <ErrorLine className="shrink-0 px-4 pt-2">{error}</ErrorLine>}

        <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-3">
          <Hint className="min-w-0 flex-1 truncate font-mono" title={fileName} data-testid="v2-export-filename">
            {fileName}
          </Hint>
          <Actions className="shrink-0 pt-0">
            <Button variant="outline" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <PrimaryButton ref={goRef} data-testid="v2-export-go" disabled={busy} onClick={() => void submit()}>
              {busy ? (progress ? `Exporting ${progress.done} of ${progress.total}…` : 'Exporting…') : 'Export'}
            </PrimaryButton>
          </Actions>
        </div>
      </DialogContent>
    </Dialog>
  );
}

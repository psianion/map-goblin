import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, FolderOpen, Image as ImageIcon, Layers, Map as MapIcon, Square, Upload } from 'lucide-react';
import { normalizeFixedSize } from '@dnd/core/src/store/slices/mapSettings';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Dialog, DialogContent } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/toast';
import { useStore } from '@/store/store';
import { createDungeonLayer } from '@/store/factories';
import { handleImageImport, importTraceImage, normalizeImageFile } from '@/canvas/importImage';
import { battlemapCells, parseSizeHint, pickedImageLine, type CellFill } from '@/canvas/battlemapSize';
import { startGridCalibration } from '@/canvas/gridCalibration';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { filesFromDataTransfer, filesFromList, scanFiles, type ScannedMap } from '@/io/importFolder';
import { importMaps } from '@/io/importMap';
import { loadMap as openMapFile } from '@/io/saveLoad';
import { MAP_FILE_ACCEPT, isMapFile } from '@/io/mapFile';
import { PrimaryButton, Seg, SecondaryButton } from '@/editor/components';
import { useEscapeToClose } from '@/editor/useEscapeToClose';
import { Actions, DialogHead, ErrorLine, Field, Hint } from './parts';
import { SizeFields, type SizeMode } from './SizeFields';
import { ImportReport, type ImportOutcome } from './ImportReport';

/**
 * The home page's "+" dialog. One form founds a map four ways: blank at a chosen size, from
 * an image (a battlemap, then straight into the grid line-up, or a trace to draw over;
 * picking it fills the size from its name or its pixels), from Foundry and Universal VTT
 * files, which bring their own size, or from one of this editor's own map files, which
 * brings everything. Wider than the other dialogs: a VTT row carries a thumbnail, the name
 * with its tags and a line of counts.
 */

const SOURCES = [
  { value: 'blank', label: 'Blank', Icon: Square },
  { value: 'image', label: 'Image', Icon: ImageIcon },
  { value: 'vtt', label: 'VTT files', Icon: FileText },
  { value: 'file', label: 'Map file', Icon: MapIcon },
] as const;
type Source = (typeof SOURCES)[number]['value'];

type UseAs = 'battlemap' | 'trace';
const USE_AS_HINT: Record<UseAs, string> = {
  battlemap: "The map's own art, exported and published. You line up its grid next.",
  trace: 'A picture to draw over, at 40 percent. Never exported or published.',
};

/** A picked image's pixel size and the squares it implies. */
interface ImageInfo {
  px: { width: number; height: number };
  cells: CellFill;
}

// The editor's own files are listed too, so one picked here can be routed to "Map file".
const VTT_ACCEPT = `.db,.json,.uvtt,.dd2vtt,.df2vtt,${MAP_FILE_ACCEPT}`;
const FALLBACK_NAME = 'Untitled map';

type Progress = { total: number; index: number; name: string } | null;

const KIND_LABEL: Record<ScannedMap['kind'], string> = { foundry: 'Foundry', uvtt: 'UVTT' };

// Directory picking is a non-standard attribute; React passes it through.
const FOLDER_INPUT = { webkitdirectory: '', directory: '' } as Record<string, string>;

/** The 56 by 40 thumbnail slot beside a picked file or a VTT row. */
const THUMB = 'flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-key bg-panel-3 text-text-3 [&>img]:size-full [&>img]:object-cover';

/** A dashed drop target that also opens the picker on click. */
function DropZone({
  over,
  onOver,
  onDrop,
  onClick,
  disabled,
  title,
  sub,
  testId,
}: {
  over: boolean;
  onOver: (over: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  sub: string;
  testId?: string;
}) {
  return (
    <Button
      variant="outline"
      data-testid={testId}
      disabled={disabled}
      className={cn(
        'h-auto w-full flex-col gap-1 border-dashed border-line-strong bg-panel-2 px-4 py-5 text-center text-[12px] whitespace-normal text-text hover:border-ink hover:bg-panel disabled:cursor-progress',
        over && 'border-ink bg-panel',
      )}
      onClick={onClick}
      onDragOver={(e) => {
        e.preventDefault();
        onOver(true);
      }}
      onDragLeave={() => onOver(false)}
      onDrop={onDrop}
    >
      <span className="mb-1 flex size-8 items-center justify-center rounded-control border border-line bg-panel text-text-2">
        <Upload aria-hidden strokeWidth={1.75} className="size-4" />
      </span>
      <span>{title}</span>
      <span className="text-[11px] leading-[1.45] text-text-3">{sub}</span>
    </Button>
  );
}

/** The file that was picked: a thumbnail, its name and size, and Change. */
function Picked({ thumb, name, sub, onChange }: { thumb: React.ReactNode; name: string; sub: string; onChange: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-control border border-line bg-panel-2 py-1.5 pr-3 pl-1.5">
      <div className={THUMB}>{thumb}</div>
      <div className="min-w-0 flex-1 truncate text-[12px] text-text">
        {name}
        <div className="truncate font-mono text-[10px] text-text-3">{sub}</div>
      </div>
      <Button variant="link" size="xs" className="px-0 text-text-2 underline" onClick={onChange}>
        Change
      </Button>
    </div>
  );
}

/** A small hairline tag beside a VTT row's name. */
function Tag({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      className="inline-flex h-4 shrink-0 items-center gap-[3px] rounded-key border border-line-strong px-[5px] text-[10px] leading-none text-text-3"
    >
      {children}
    </span>
  );
}

export interface NewMapModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The map (or the one imported map) is open on the canvas: leave the home page. */
  onEnter: () => void;
}

export function NewMapModal({ open, onOpenChange, onEnter }: NewMapModalProps) {
  const [name, setName] = useState('');
  const [source, setSource] = useState<Source>('blank');
  const [sizeMode, setSizeMode] = useState<SizeMode>('expanding');
  const [widthText, setWidthText] = useState('30');
  const [heightText, setHeightText] = useState('20');
  const [image, setImage] = useState<File | null>(null);
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [useAs, setUseAs] = useState<UseAs>('battlemap');
  const [mapFile, setMapFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rows, setRows] = useState<ScannedMap[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress>(null);
  const [stopping, setStopping] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const vttRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  // Read by importMaps between maps; a ref so the running loop sees the click.
  const stopRef = useRef(false);
  const mapFileRef = useRef<HTMLInputElement>(null);

  // Every open starts clean. Reading the store imperatively keeps a running submit
  // from resetting the form underneath itself.
  useEffect(() => {
    if (!open) return;
    setName('');
    setSource('blank');
    setSizeMode('expanding');
    setWidthText('30');
    setHeightText('20');
    setImage(null);
    setImageInfo(null);
    setUseAs('battlemap');
    setMapFile(null);
    setRows([]);
    setChecked(new Set());
    setScanning(false);
    setError(null);
    setDragOver(false);
    setBusy(false);
    setProgress(null);
    setStopping(false);
    setOutcome(null);
    const id = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!image) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const fixedSize = useMemo(
    () => normalizeFixedSize({ width: Number(widthText), height: Number(heightText) }),
    [widthText, heightText],
  );
  // VTT and map files bring their own name and size.
  const ownFields = source === 'blank' || source === 'image';
  const sizeInvalid = ownFields && sizeMode === 'fixed' && fixedSize === null;

  const chooseSource = (next: Source) => {
    setSource(next);
    setError(null);
    setDragOver(false);
  };

  const acceptImage = useCallback(async (file: File) => {
    const normalized = await normalizeImageFile(file);
    if (!normalized) {
      setImage(null);
      setImageInfo(null);
      setError('That file is not an image this editor can read.');
      return;
    }
    setError(null);
    setImage(normalized);
    // The pixel size, so the squares can be filled in now rather than guessed at submit.
    // A picture the browser will not decode here (an SVG without a size) keeps the size
    // fields as they are.
    let px: ImageInfo['px'] | null = null;
    try {
      const bitmap = await createImageBitmap(normalized);
      px = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
    } catch {
      px = null;
    }
    if (!px) {
      setImageInfo(null);
      return;
    }
    const cells = battlemapCells(px, parseSizeHint(file.name));
    setImageInfo({ px, cells });
    setSizeMode('fixed');
    setWidthText(String(cells.width));
    setHeightText(String(cells.height));
  }, []);

  const acceptMapFile = useCallback(async (file: File) => {
    if (!(await isMapFile(file))) {
      setMapFile(null);
      setError('That is not a Good Goblin map file. Foundry and Universal VTT files go under VTT files.');
      return;
    }
    setError(null);
    setMapFile(file);
  }, []);

  /**
   * One of the editor's own map files picked or dropped under VTT files belongs under Map
   * file; the VTT scan would skip it without a word. Only a pick that is nothing but map
   * files moves over, so a mixed batch of VTT files is not thrown away for one stray.
   */
  const routeMapFile = useCallback(async (files: File[]) => {
    if (!files.length) return false;
    const checks = await Promise.all(files.map(isMapFile));
    if (!checks.every(Boolean)) return false;
    setSource('file');
    setError(null);
    setMapFile(files[0]);
    return true;
  }, []);

  const acceptVtt = useCallback(async (files: Map<string, File>) => {
    setScanning(true);
    setError(null);
    try {
      const found = await scanFiles(files);
      setRows(found);
      // Single floors start checked; a stacked composite is the same floors again.
      setChecked(new Set(found.filter((r) => !r.composite).map((r) => r.id)));
      if (!found.length) setError('No maps found in what you picked.');
    } finally {
      setScanning(false);
    }
  }, []);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (source === 'image') {
        const file = e.dataTransfer.files?.[0];
        if (file) await acceptImage(file);
      } else if (source === 'file') {
        const file = e.dataTransfer.files?.[0];
        if (file) await acceptMapFile(file);
      } else if (source === 'vtt') {
        // Both reads start before the first await: a DataTransfer is emptied once the
        // drop event has returned.
        const dropped = Array.from(e.dataTransfer.files ?? []);
        const walked = filesFromDataTransfer(e.dataTransfer);
        if (await routeMapFile(dropped)) {
          walked.catch(() => {});
          return;
        }
        await acceptVtt(await walked);
      }
    },
    [source, acceptImage, acceptMapFile, routeMapFile, acceptVtt],
  );

  const onVttInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Copy first: clearing the value of the input empties the FileList it handed over.
    const list = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!list.length) return;
    void routeMapFile(list).then((routed) => {
      if (!routed) void acceptVtt(filesFromList(list));
    });
  };

  const clearRows = () => {
    setRows([]);
    setChecked(new Set());
    setError(null);
  };

  const toggleRow = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canSubmit =
    !busy &&
    !sizeInvalid &&
    (source === 'blank' ||
      (source === 'image' && image !== null) ||
      (source === 'vtt' && checked.size > 0) ||
      (source === 'file' && mapFile !== null));

  const primaryLabel =
    source === 'image' && useAs === 'battlemap'
      ? 'Create & line up grid'
      : source === 'vtt'
        ? `Import ${checked.size || ''}`.trim()
        : source === 'file'
          ? 'Open map'
          : 'Create map';

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    const trimmed = name.trim() || FALLBACK_NAME;
    const wanted = sizeMode === 'fixed' ? fixedSize : null;
    setBusy(true);
    try {
      if (source === 'file') {
        // The one open path: makes the map entry, loads the document, saves it to the list.
        // A file it cannot read has already been reported by it.
        if (!(await openMapFile(mapFile!))) return;
        notify.success('Map opened');
        onOpenChange(false);
        onEnter();
        return;
      }

      if (source === 'vtt') {
        const picked = rows.filter((r) => checked.has(r.id));
        stopRef.current = false;
        setStopping(false);
        setProgress({ total: picked.length, index: 0, name: picked[0].name });
        const results = await importMaps(
          picked,
          (index, rowName) => setProgress({ total: picked.length, index, name: rowName }),
          () => stopRef.current,
        );
        // Each map went to the list as it finished; the report says how each one went.
        setProgress(null);
        setOutcome({ picked, results });
        return;
      }

      await useStore.getState().createNewMap(trimmed);
      if (wanted) useStore.getState().setFixedSize(wanted);

      // A trace is drawn over, not lined up: the map at the chosen size, the picture
      // stretched to it on the first level, no Battlemap layer.
      const trace = source === 'image' && useAs === 'trace';
      if (trace) await importTraceImage(image!);

      if (source === 'image' && !trace) {
        const singleton = getEngineSingleton();
        if (!singleton) {
          notify.error('The canvas is still starting. The map was created; add the image from the canvas.');
        } else {
          // Calibration locks the image's layer, so the battlemap gets a layer of its own
          // and a fresh, unlocked layer goes above it for drawing.
          const store = useStore.getState();
          const base = store.layers.find((l) => l.type === 'dungeon');
          if (!base) throw new Error('New map has no dungeon layer to place the image on');
          store.updateLayer(base.id, { name: 'Battlemap' });
          const tracing = createDungeonLayer('Layer 1');
          store.addLayer(tracing);
          store.setActiveLayerId(base.id);
          // The squares across the dialog settled on give the pixels per square.
          const across = wanted?.width ?? imageInfo?.cells.width;
          const pxPerCell = imageInfo && across ? imageInfo.px.width / across : undefined;
          const childId = await handleImageImport(image!, singleton.engine, { asBattlemap: true, pxPerCell });
          if (childId) startGridCalibration(childId);
          useStore.getState().setActiveLayerId(tracing.id);
        }
      }

      await useStore.getState().saveCurrentMap();
      // The trace import says its own toast, with the key that hides it.
      if (!trace) notify.success(source === 'image' ? 'Map created. Line up the grid.' : 'New map created');
      onOpenChange(false);
      onEnter();
    } catch (err) {
      console.error('[NewMapModal]', err);
      notify.error('Failed to create map');
    } finally {
      setBusy(false);
    }
  }, [canSubmit, name, sizeMode, fixedSize, source, mapFile, rows, checked, image, imageInfo, useAs, onOpenChange, onEnter]);

  const importing = progress !== null && busy;
  const imported = outcome ? outcome.results.filter((r) => r.ok).length : 0;

  // The report replaces the whole body, so focus would fall to <body>; land it on Done.
  useEffect(() => {
    if (!outcome) return;
    const id = requestAnimationFrame(() => doneRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [outcome]);

  // Escape closes from anywhere in the dialog, a focused field included, but never mid-import.
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useEscapeToClose(open, close, importing);

  const requestStop = () => {
    stopRef.current = true;
    setStopping(true);
  };

  const finish = () => {
    onOpenChange(false);
    // One map: it is open on the canvas already, go there. Several: pick from the cards.
    if (imported === 1) onEnter();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (importing) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="w-[440px]"
        data-v2-home=""
        data-testid="v2-new-map-modal"
        initialFocus={ownFields ? nameRef : undefined}
        onKeyDown={(e) => {
          // Keep the canvas shortcuts out of the form, and let Enter submit it.
          e.stopPropagation();
          if (e.key !== 'Enter' || e.target instanceof HTMLButtonElement || importing || outcome) return;
          e.preventDefault();
          void submit();
        }}
      >
        <DialogHead title="New map" onClose={close} closeDisabled={importing} />

        {importing ? (
          <div className="flex flex-col gap-2" aria-live="polite">
            <p className="m-0 truncate text-[12px] text-text">
              Importing {progress.index + 1} of {progress.total}: {progress.name}
            </p>
            <div className="h-1 overflow-hidden rounded-pill bg-panel-3">
              <div
                className="h-full bg-ink transition-[width] duration-200"
                style={{ width: `${((progress.index + 0.5) / progress.total) * 100}%` }}
              />
            </div>
            <Hint>{stopping ? 'Finishing this map, then stopping.' : 'Large maps take a few seconds each.'}</Hint>
          </div>
        ) : outcome ? (
          <div data-testid="v2-import-report">
            <ImportReport outcome={outcome} />
          </div>
        ) : (
          <>
            <Field label="Start from">
              <Seg
                aria-label="Start from"
                value={source}
                onValueChange={(v) => chooseSource(v as Source)}
                options={SOURCES.map(({ value, label, Icon }) => ({
                  value,
                  label: (
                    <>
                      <Icon aria-hidden strokeWidth={1.75} className="size-3.5" />
                      {label}
                    </>
                  ),
                }))}
              />
            </Field>

            {ownFields && (
              <Field label="Name" htmlFor="v2-new-map-name">
                <Input id="v2-new-map-name" ref={nameRef} value={name} placeholder={FALLBACK_NAME} onChange={(e) => setName(e.target.value)} />
              </Field>
            )}

            {ownFields && (
              <SizeFields
                mode={sizeMode}
                onModeChange={setSizeMode}
                widthText={widthText}
                heightText={heightText}
                onWidthChange={setWidthText}
                onHeightChange={setHeightText}
                invalid={sizeInvalid}
              />
            )}

            {source === 'image' && (
              <Field label="Battlemap image">
                <input
                  ref={imageRef}
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void acceptImage(file);
                    e.target.value = '';
                  }}
                />
                {image ? (
                  <Picked
                    thumb={previewUrl ? <img src={previewUrl} alt="" /> : <ImageIcon aria-hidden strokeWidth={1.75} className="size-4" />}
                    name={image.name}
                    sub={imageInfo ? pickedImageLine(imageInfo.px, imageInfo.cells) : `${Math.round(image.size / 1024)} KB`}
                    onChange={() => imageRef.current?.click()}
                  />
                ) : (
                  <DropZone
                    over={dragOver}
                    onOver={setDragOver}
                    onDrop={onDrop}
                    onClick={() => imageRef.current?.click()}
                    testId="v2-image-drop"
                    title="Drop an image here, or click to choose"
                    sub="PNG, JPEG, WebP. A size in the name, like 36x24, sets the squares."
                  />
                )}
              </Field>
            )}

            {source === 'image' && (
              <Field label="Use as">
                <Seg
                  aria-label="Use as"
                  value={useAs}
                  onValueChange={(v) => setUseAs(v as UseAs)}
                  options={[
                    { value: 'battlemap', label: 'Battlemap' },
                    { value: 'trace', label: 'Trace' },
                  ]}
                />
                <Hint>{USE_AS_HINT[useAs]}</Hint>
              </Field>
            )}

            {source === 'vtt' && (
              <Field label="VTT files">
                <input ref={vttRef} type="file" className="hidden" data-testid="v2-vtt-files-input" accept={VTT_ACCEPT} multiple onChange={onVttInput} />
                <input
                  ref={folderRef}
                  type="file"
                  className="hidden"
                  data-testid="v2-vtt-folder-input"
                  multiple
                  onChange={onVttInput}
                  {...FOLDER_INPUT}
                />
                {rows.length ? (
                  <>
                    <div className="flex items-center justify-between text-[11px] text-text-3">
                      <span data-testid="v2-vtt-count">
                        {checked.size} of {rows.length} selected
                      </span>
                      <span className="flex gap-3">
                        <Button variant="link" size="xs" className="h-auto px-0 text-text-2 underline" onClick={() => setChecked(new Set(rows.map((r) => r.id)))}>
                          Select all
                        </Button>
                        <Button variant="link" size="xs" className="h-auto px-0 text-text-2 underline" onClick={() => setChecked(new Set())}>
                          None
                        </Button>
                        <Button variant="link" size="xs" className="h-auto px-0 text-text-2 underline" onClick={clearRows}>
                          Change
                        </Button>
                      </span>
                    </div>
                    <div className="max-h-[40vh] divide-y divide-line overflow-y-auto rounded-control border border-line bg-panel-2">
                      {rows.map((row) => (
                        <label key={row.id} className="flex cursor-pointer items-center gap-2.5 px-2.5 py-2 transition-colors hover:bg-panel">
                          <Checkbox checked={checked.has(row.id)} onCheckedChange={() => toggleRow(row.id)} aria-label={row.name} />
                          <div className={THUMB}>
                            {row.thumb ? <img src={row.thumb} alt="" /> : <ImageIcon aria-hidden strokeWidth={1.75} className="size-3.5" />}
                          </div>
                          <div className="min-w-0 flex-1 text-[12px] text-text">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="min-w-0 truncate">{row.name}</span>
                              {row.composite && (
                                <Tag title="Several floors stacked on one canvas. Import the single floors instead.">
                                  <Layers aria-hidden strokeWidth={1.75} className="size-2.5" />
                                  multi-floor
                                </Tag>
                              )}
                              {row.imageStatus === 'missing' && (
                                <Tag title="No image was found for this map. It imports with walls, doors and lights only.">no image</Tag>
                              )}
                            </div>
                            <div className="truncate font-mono text-[10px] text-text-3">
                              {KIND_LABEL[row.kind]} · {row.size.width}×{row.size.height} cells · {row.counts.walls} walls, {row.counts.doors} doors,{' '}
                              {row.counts.lights} lights
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                    <Hint>Each map is saved to your list as it finishes. Name and size come from the file.</Hint>
                  </>
                ) : (
                  <>
                    <DropZone
                      over={dragOver}
                      onOver={setDragOver}
                      onDrop={onDrop}
                      onClick={() => vttRef.current?.click()}
                      disabled={scanning}
                      testId="v2-vtt-drop"
                      title={scanning ? 'Reading files…' : 'Drop VTT files or a module folder here'}
                      sub="Universal VTT (.dd2vtt, .uvtt, .df2vtt) and Foundry scenes (.db, .json)"
                    />
                    <div className="grid grid-cols-2 gap-1.5">
                      <SecondaryButton icon={FileText} disabled={scanning} onClick={() => vttRef.current?.click()}>
                        Choose files
                      </SecondaryButton>
                      <SecondaryButton icon={FolderOpen} disabled={scanning} onClick={() => folderRef.current?.click()}>
                        Choose folder
                      </SecondaryButton>
                    </div>
                  </>
                )}
              </Field>
            )}

            {source === 'file' && (
              <Field label="Good Goblin map (.ggvtt)">
                <input
                  ref={mapFileRef}
                  type="file"
                  className="hidden"
                  accept={MAP_FILE_ACCEPT}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void acceptMapFile(file);
                  }}
                />
                {mapFile ? (
                  <Picked
                    thumb={<MapIcon aria-hidden strokeWidth={1.75} className="size-4" />}
                    name={mapFile.name}
                    sub={`${Math.max(1, Math.round(mapFile.size / 1024))} KB`}
                    onChange={() => mapFileRef.current?.click()}
                  />
                ) : (
                  <DropZone
                    over={dragOver}
                    onOver={setDragOver}
                    onDrop={onDrop}
                    onClick={() => mapFileRef.current?.click()}
                    testId="v2-map-file-drop"
                    title="Drop a map file here, or click to choose"
                    sub=".ggvtt or .mapbuilder, saved from this editor"
                  />
                )}
                <Hint>Name, size and everything on the map come from the file.</Hint>
              </Field>
            )}

            {error && <ErrorLine>{error}</ErrorLine>}

            <Actions>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <PrimaryButton data-testid="v2-new-map-submit" disabled={!canSubmit} onClick={() => void submit()}>
                {primaryLabel}
              </PrimaryButton>
            </Actions>
          </>
        )}

        {importing && (
          <Actions>
            <Button variant="outline" data-testid="v2-import-stop" disabled={stopping} onClick={requestStop}>
              Stop
            </Button>
          </Actions>
        )}

        {outcome && !importing && (
          <Actions>
            <PrimaryButton ref={doneRef} data-testid="v2-import-done" onClick={finish}>
              {imported === 1 ? 'Open map' : 'Done'}
            </PrimaryButton>
          </Actions>
        )}
      </DialogContent>
    </Dialog>
  );
}

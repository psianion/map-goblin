import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, FileText, FolderOpen, Image as ImageIcon, Layers, Map as MapIcon, Square, Upload, X } from 'lucide-react';
import { normalizeFixedSize } from '@dnd/core/src/store/slices/mapSettings';
import { Dialog, DialogPortal, DialogBackdrop, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/toast';
import { useStore } from '@/store/store';
import { createDungeonLayer } from '@/store/factories';
import { handleImageImport, normalizeImageFile } from '@/canvas/importImage';
import { startGridCalibration } from '@/canvas/gridCalibration';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { filesFromDataTransfer, filesFromList, scanFiles, type ScannedMap } from '@/io/importFolder';
import { importMaps } from '@/io/importMap';
import { loadMap as openMapFile } from '@/io/saveLoad';
import { SizeFields, type SizeMode } from './SizeFields';
import { ImportReport, type ImportOutcome } from './ImportReport';
import { MAP_FILE_ACCEPT, isMapFile } from './mapFile';
import { useEscapeToClose } from './useEscapeToClose';

/**
 * The home page's "+" modal. One form founds a map four ways: blank at a chosen size,
 * from a battlemap image (then straight into grid calibration), from Foundry and
 * Universal VTT files, which bring their own size, or from one of this editor's own
 * map files, which brings everything.
 */

const SOURCES = [
  { value: 'blank', label: 'Blank', Icon: Square },
  { value: 'image', label: 'Image', Icon: ImageIcon },
  { value: 'vtt', label: 'VTT files', Icon: FileText },
  { value: 'file', label: 'Map file', Icon: MapIcon },
] as const;
type Source = (typeof SOURCES)[number]['value'];

// The editor's own files are listed too, so one picked here can be routed to "Map file".
const VTT_ACCEPT = `.db,.json,.uvtt,.dd2vtt,.df2vtt,${MAP_FILE_ACCEPT}`;
const FALLBACK_NAME = 'Untitled map';

type Progress = { total: number; index: number; name: string } | null;

const KIND_LABEL: Record<ScannedMap['kind'], string> = { foundry: 'Foundry', uvtt: 'UVTT' };

// Directory picking is a non-standard attribute; React passes it through.
const FOLDER_INPUT = { webkitdirectory: '', directory: '' } as Record<string, string>;

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
      setError('That file is not an image this editor can read.');
      return;
    }
    setError(null);
    setImage(normalized);
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
    source === 'image'
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

      if (source === 'image') {
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
          const childId = await handleImageImport(image!, singleton.engine, { asBattlemap: true });
          if (childId) startGridCalibration(childId);
          useStore.getState().setActiveLayerId(tracing.id);
        }
      }

      await useStore.getState().saveCurrentMap();
      notify.success(source === 'image' ? 'Map created. Line up the grid.' : 'New map created');
      onOpenChange(false);
      onEnter();
    } catch (err) {
      console.error('[v2/NewMapModal]', err);
      notify.error('Failed to create map');
    } finally {
      setBusy(false);
    }
  }, [canSubmit, name, sizeMode, fixedSize, source, mapFile, rows, checked, image, onOpenChange, onEnter]);

  const importing = progress !== null && busy;
  const imported = outcome ? outcome.results.filter((r) => r.ok).length : 0;

  // The report replaces the whole body, so focus would fall to <body>; land it on Done.
  useEffect(() => {
    if (!outcome) return;
    const id = requestAnimationFrame(() => doneRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [outcome]);

  // Escape closes from anywhere in the modal, a focused field included, but never mid-import.
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
      <DialogPortal>
        <DialogBackdrop className="v2-backdrop" />
        <DialogContent className="v2-modal max-w-[440px] p-0">
          <div
            data-v2-home=""
            data-testid="v2-new-map-modal"
            onKeyDown={(e) => {
              // Keep the canvas shortcuts out of the form, and let Enter submit it.
              e.stopPropagation();
              if (e.key !== 'Enter' || e.target instanceof HTMLButtonElement || importing || outcome) return;
              e.preventDefault();
              void submit();
            }}
          >
            <div className="v2-modal__head">
              <DialogTitle className="v2-modal__title">New map</DialogTitle>
              {!importing && (
                <button type="button" className="v2-x" aria-label="Close" onClick={() => onOpenChange(false)}>
                  <X size={15} strokeWidth={1.75} />
                </button>
              )}
            </div>

            {importing ? (
              <div className="v2-modal__body" aria-live="polite">
                <p className="v2-progress">
                  Importing {progress.index + 1} of {progress.total}: {progress.name}
                </p>
                <div className="v2-bar">
                  <div style={{ width: `${((progress.index + 0.5) / progress.total) * 100}%` }} />
                </div>
                <p className="v2-hint">
                  {stopping ? 'Finishing this map, then stopping.' : 'Large maps take a few seconds each.'}
                </p>
              </div>
            ) : outcome ? (
              <div className="v2-modal__body" data-testid="v2-import-report">
                <ImportReport outcome={outcome} />
              </div>
            ) : (
              <>
                <div className="v2-modal__body">
                  <div>
                    <span className="v2-label">Start from</span>
                    <div className="v2-segs" role="radiogroup" aria-label="Start from">
                      {SOURCES.map(({ value, label, Icon }) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={source === value}
                          className={cn('v2-seg', source === value && 'v2-seg--on')}
                          onClick={() => chooseSource(value)}
                        >
                          <Icon size={14} strokeWidth={1.75} />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {ownFields && (
                    <div>
                      <label htmlFor="v2-new-map-name" className="v2-label">
                        Name
                      </label>
                      <input
                        id="v2-new-map-name"
                        ref={nameRef}
                        className="v2-input"
                        value={name}
                        placeholder={FALLBACK_NAME}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
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
                    <div>
                      <span className="v2-label">Battlemap image</span>
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
                        <div className="v2-picked">
                          {previewUrl ? <img src={previewUrl} alt="" /> : <div className="v2-picked__ph"><ImageIcon size={16} strokeWidth={1.75} /></div>}
                          <div className="v2-picked__name">
                            {image.name}
                            <div className="v2-picked__sub">{Math.round(image.size / 1024)} KB</div>
                          </div>
                          <button type="button" className="v2-link" onClick={() => imageRef.current?.click()}>
                            Change
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={cn('v2-drop', dragOver && 'v2-drop--over')}
                          onClick={() => imageRef.current?.click()}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setDragOver(true);
                          }}
                          onDragLeave={() => setDragOver(false)}
                          onDrop={onDrop}
                        >
                          <span className="v2-drop__icon"><Upload size={16} strokeWidth={1.75} /></span>
                          <span>Drop an image here, or click to choose</span>
                          <small>PNG, JPEG, WebP. You line up the grid on the canvas next.</small>
                        </button>
                      )}
                    </div>
                  )}

                  {source === 'vtt' && (
                    <div>
                      <span className="v2-label">VTT files</span>
                      <input
                        ref={vttRef}
                        type="file"
                        className="hidden"
                        data-testid="v2-vtt-files-input"
                        accept={VTT_ACCEPT}
                        multiple
                        onChange={onVttInput}
                      />
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
                          <div className="v2-list-head">
                            <span data-testid="v2-vtt-count">
                              {checked.size} of {rows.length} selected
                            </span>
                            <span className="v2-list-head__links">
                              <button
                                type="button"
                                className="v2-link"
                                onClick={() => setChecked(new Set(rows.map((r) => r.id)))}
                              >
                                Select all
                              </button>
                              <button type="button" className="v2-link" onClick={() => setChecked(new Set())}>
                                None
                              </button>
                              <button type="button" className="v2-link" onClick={clearRows}>
                                Change
                              </button>
                            </span>
                          </div>
                          <div className="v2-list">
                            {rows.map((row) => (
                              <label key={row.id}>
                                <input
                                  type="checkbox"
                                  checked={checked.has(row.id)}
                                  onChange={() => toggleRow(row.id)}
                                  aria-label={row.name}
                                />
                                <div className="v2-picked__ph">
                                  {row.thumb ? <img src={row.thumb} alt="" /> : <ImageIcon size={14} strokeWidth={1.75} />}
                                </div>
                                <div className="v2-picked__name">
                                  <div className="v2-row-title">
                                    <span>{row.name}</span>
                                    {row.composite && (
                                      <span
                                        className="v2-tag"
                                        title="Several floors stacked on one canvas. Import the single floors instead."
                                      >
                                        <Layers size={10} strokeWidth={1.75} />
                                        multi-floor
                                      </span>
                                    )}
                                    {row.imageStatus === 'missing' && (
                                      <span
                                        className="v2-tag"
                                        title="No image was found for this map. It imports with walls, doors and lights only."
                                      >
                                        no image
                                      </span>
                                    )}
                                  </div>
                                  <div className="v2-picked__sub">
                                    {KIND_LABEL[row.kind]} · {row.size.width}×{row.size.height} cells · {row.counts.walls} walls,{' '}
                                    {row.counts.doors} doors, {row.counts.lights} lights
                                  </div>
                                </div>
                              </label>
                            ))}
                          </div>
                        </>
                      ) : (
                        <button
                          type="button"
                          className={cn('v2-drop', dragOver && 'v2-drop--over')}
                          data-testid="v2-vtt-drop"
                          disabled={scanning}
                          onClick={() => vttRef.current?.click()}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setDragOver(true);
                          }}
                          onDragLeave={() => setDragOver(false)}
                          onDrop={onDrop}
                        >
                          <span className="v2-drop__icon"><Upload size={16} strokeWidth={1.75} /></span>
                          <span>{scanning ? 'Reading files…' : 'Drop VTT files or a module folder here'}</span>
                          <small>Universal VTT (.dd2vtt, .uvtt, .df2vtt) and Foundry scenes (.db, .json)</small>
                        </button>
                      )}
                      {!rows.length && (
                        <div className="v2-pick-row">
                          <button
                            type="button"
                            className="v2-btn"
                            disabled={scanning}
                            onClick={() => vttRef.current?.click()}
                          >
                            <FileText size={14} strokeWidth={1.75} />
                            Choose files
                          </button>
                          <button
                            type="button"
                            className="v2-btn"
                            disabled={scanning}
                            onClick={() => folderRef.current?.click()}
                          >
                            <FolderOpen size={14} strokeWidth={1.75} />
                            Choose folder
                          </button>
                        </div>
                      )}
                      {rows.length > 0 && (
                        <p className="v2-hint">Each map is saved to your list as it finishes. Name and size come from the file.</p>
                      )}
                    </div>
                  )}

                  {source === 'file' && (
                    <div>
                      <span className="v2-label">Good Goblin map (.ggvtt)</span>
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
                        <div className="v2-picked">
                          <div className="v2-picked__ph">
                            <MapIcon size={16} strokeWidth={1.75} />
                          </div>
                          <div className="v2-picked__name">
                            {mapFile.name}
                            <div className="v2-picked__sub">{Math.max(1, Math.round(mapFile.size / 1024))} KB</div>
                          </div>
                          <button type="button" className="v2-link" onClick={() => mapFileRef.current?.click()}>
                            Change
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={cn('v2-drop', dragOver && 'v2-drop--over')}
                          data-testid="v2-map-file-drop"
                          onClick={() => mapFileRef.current?.click()}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setDragOver(true);
                          }}
                          onDragLeave={() => setDragOver(false)}
                          onDrop={onDrop}
                        >
                          <span className="v2-drop__icon"><Upload size={16} strokeWidth={1.75} /></span>
                          <span>Drop a map file here, or click to choose</span>
                          <small>.ggvtt or .mapbuilder, saved from this editor</small>
                        </button>
                      )}
                      <p className="v2-hint">Name, size and everything on the map come from the file.</p>
                    </div>
                  )}

                  {error && (
                    <p role="alert" className="v2-error" style={{ marginTop: -8 }}>
                      <AlertCircle size={14} className="mt-px shrink-0" />
                      {error}
                    </p>
                  )}
                </div>

                <div className="v2-modal__foot">
                  <button type="button" className="v2-btn v2-btn--ghost" onClick={() => onOpenChange(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="v2-btn v2-btn--primary"
                    data-testid="v2-new-map-submit"
                    disabled={!canSubmit}
                    onClick={() => void submit()}
                  >
                    {primaryLabel}
                  </button>
                </div>
              </>
            )}

            {importing && (
              <div className="v2-modal__foot">
                <button
                  type="button"
                  className="v2-btn"
                  data-testid="v2-import-stop"
                  disabled={stopping}
                  onClick={requestStop}
                >
                  Stop
                </button>
              </div>
            )}

            {outcome && !importing && (
              <div className="v2-modal__foot">
                <button
                  ref={doneRef}
                  type="button"
                  className="v2-btn v2-btn--primary"
                  data-testid="v2-import-done"
                  onClick={finish}
                >
                  {imported === 1 ? 'Open map' : 'Done'}
                </button>
              </div>
            )}
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

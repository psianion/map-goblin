import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, FileText, Image as ImageIcon, Square, Upload, X } from 'lucide-react';
import { measureGridSize } from '@dnd/core/src/store/slices/maps';
import { MAX_FIXED_CELLS, normalizeFixedSize } from '@dnd/core/src/store/slices/mapSettings';
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
import { useStore } from '@/store/store';
import { createDungeonLayer } from '@/store/factories';
import { loadMap as openMapFile } from '@/io/saveLoad';
import { handleImageImport, normalizeImageFile } from '@/canvas/importImage';
import { startGridCalibration } from '@/canvas/gridCalibration';
import { getEngineSingleton } from '@/engine/engineSingleton';

const SOURCES = [
  { value: 'blank', label: 'Blank', Icon: Square },
  { value: 'file', label: 'Map file', Icon: FileText },
  { value: 'image', label: 'Image', Icon: ImageIcon },
] as const;
type Source = (typeof SOURCES)[number]['value'];

const FALLBACK_NAME = 'Untitled map';

/** The dialog's own control vocabulary, matching ExportDialog's format/resolution rows. */
function Segment({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 h-8 px-2 rounded border text-sm font-medium transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        selected
          ? 'bg-accent text-accent-foreground border-accent'
          : 'bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-xs leading-snug text-muted-foreground">{children}</p>;
}

function Readout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2.5 rounded bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground tabular-nums">
      {children}
    </div>
  );
}

function InlineError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
      <AlertCircle size={14} className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export interface NewMapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * 'settings' edits the map that is already open — same form, no "Start from" section,
   * primary reads Save. Anything else founds a new map.
   */
  mode?: 'create' | 'settings';
}

export function NewMapDialog({ open, onOpenChange, mode = 'create' }: NewMapDialogProps) {
  const createNewMap = useStore((s) => s.createNewMap);
  const saveCurrentMap = useStore((s) => s.saveCurrentMap);
  const renameMap = useStore((s) => s.renameMap);
  const setFixedSize = useStore((s) => s.setFixedSize);
  const cellScale = useStore((s) => s.mapSettings.cellScale);
  const layers = useStore((s) => s.layers);
  const terrainBounds = useStore((s) => s.mapSettings.terrain?.bounds ?? null);

  const [name, setName] = useState('');
  const [source, setSource] = useState<Source>('blank');
  const [sizeMode, setSizeMode] = useState<'expanding' | 'fixed'>('expanding');
  const [widthText, setWidthText] = useState('30');
  const [heightText, setHeightText] = useState('20');
  const [picked, setPicked] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSettings = mode === 'settings';
  const measured = useMemo(
    () => (isSettings ? measureGridSize(layers, terrainBounds) : { width: 0, height: 0 }),
    [isSettings, layers, terrainBounds],
  );

  // Every open starts from the map's current truth, so a cancelled edit leaves nothing behind.
  // Deliberately keyed on `open` alone and reading the store imperatively: submitting changes
  // the very values a reactive version would depend on, and it would reset the form underneath
  // the submit that is still running.
  useEffect(() => {
    if (!open) return;
    setSource('blank');
    setPicked(null);
    setFileError(null);
    setDragOver(false);
    setBusy(false);
    const settings = useStore.getState().mapSettings;
    if (isSettings) {
      setName(settings.name);
      setSizeMode(settings.fixedSize ? 'fixed' : 'expanding');
      if (settings.fixedSize) {
        setWidthText(String(settings.fixedSize.width));
        setHeightText(String(settings.fixedSize.height));
      }
    } else {
      setName('');
      setSizeMode('expanding');
      setWidthText('30');
      setHeightText('20');
    }
  }, [open, isSettings]);

  // Thumbnail for a chosen image. The decode is the browser's own, not a second read of
  // the file — but the blob URL lives as long as the tab unless it is handed back, so the
  // cleanup runs on every change of pick and on unmount.
  useEffect(() => {
    if (source !== 'image' || !picked) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(picked);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [source, picked]);

  // base-ui focuses the popup itself on open; move it onto the field the DM came here to type in.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      nameRef.current?.focus();
      nameRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const fixedSize = useMemo(
    () => normalizeFixedSize({ width: Number(widthText), height: Number(heightText) }),
    [widthText, heightText],
  );
  const sizeInvalid = sizeMode === 'fixed' && fixedSize === null;

  const chooseSource = (next: Source) => {
    setSource(next);
    setPicked(null);
    setFileError(null);
    setDragOver(false);
  };

  // Switching to Fixed on an existing map pins what it already measures, so the safe move
  // is one click rather than "read the card, then retype the numbers".
  const chooseFixed = () => {
    if (sizeMode === 'expanding' && measured.width > 0 && measured.height > 0) {
      setWidthText(String(measured.width));
      setHeightText(String(measured.height));
    }
    setSizeMode('fixed');
  };

  const acceptFile = useCallback(
    async (file: File, forSource: Source) => {
      if (forSource === 'file' && !file.name.toLowerCase().endsWith('.mapbuilder')) {
        setPicked(null);
        setFileError('not-a-map');
        return;
      }
      if (forSource === 'image') {
        // Decided by the file's own bytes, not its extension — see normalizeImageFile.
        // Keep the normalized file: its corrected type is what makes the preview and the
        // embedded data URL render.
        const image = await normalizeImageFile(file);
        if (!image) {
          setPicked(null);
          setFileError('not-an-image');
          return;
        }
        setFileError(null);
        setPicked(image);
        return;
      }
      setFileError(null);
      setPicked(file);
    },
    [],
  );

  const primaryLabel = isSettings
    ? 'Save'
    : source === 'file'
      ? 'Open map'
      : source === 'image'
        ? 'Create & line up grid'
        : 'Create map';

  const canSubmit =
    !busy && !sizeInvalid && (isSettings || source === 'blank' || picked !== null);

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    const wanted = sizeMode === 'fixed' ? fixedSize : null;
    const trimmed = name.trim() || FALLBACK_NAME;
    setBusy(true);
    try {
      if (isSettings) {
        const id = useStore.getState().activeMapId;
        if (id) await renameMap(id, trimmed);
        setFixedSize(wanted);
        await saveCurrentMap();
        notify.success('Map settings saved');
        onOpenChange(false);
        return;
      }

      if (source === 'file') {
        // Reuses the one open path (picker skipped — the file is already validated here).
        const opened = await openMapFile(picked!);
        if (!opened) {
          setFileError('not-a-map');
          return;
        }
        onOpenChange(false);
        return;
      }

      await createNewMap(trimmed);
      if (wanted) setFixedSize(wanted);

      if (source === 'image') {
        const singleton = getEngineSingleton();
        if (!singleton) {
          notify.error('The canvas is still starting. The map was created — add the image from the canvas.');
        } else {
          // Confirming a calibration locks the image's *layer* — there is no per-child lock
          // in this codebase — so the battlemap gets a layer of its own and a fresh, unlocked
          // layer goes above it. Without that split the DM would be handed a map whose only
          // layer is locked the moment they line the grid up.
          const store = useStore.getState();
          const base = store.layers.find((l) => l.type === 'dungeon');
          if (!base) throw new Error('New map has no dungeon layer to place the image on');
          store.updateLayer(base.id, { name: 'Battlemap' });
          const tracing = createDungeonLayer('Layer 1');
          store.addLayer(tracing); // appended — layers render bottom-up, so this sits above
          store.setActiveLayerId(base.id);

          // The image is the map here, not a prop being dropped onto one — Ctrl+I,
          // drag-drop and paste keep their few-cells sizing.
          const childId = await handleImageImport(picked!, singleton.engine, {
            asBattlemap: true,
          });
          // handleImageImport reports its own refusals (locked layer, bad format).
          if (childId) startGridCalibration(childId);
          // Draw on the unlocked layer, not the one calibration is about to lock.
          useStore.getState().setActiveLayerId(tracing.id);
        }
      }

      await saveCurrentMap();
      notify.success(source === 'image' ? 'Map created — line up the grid' : 'New map created');
      onOpenChange(false);
    } catch (err) {
      console.error('[NewMapDialog]', err);
      notify.error(isSettings ? 'Failed to save map settings' : 'Failed to create map');
    } finally {
      setBusy(false);
    }
  }, [
    canSubmit,
    sizeMode,
    fixedSize,
    name,
    isSettings,
    source,
    picked,
    renameMap,
    setFixedSize,
    saveCurrentMap,
    createNewMap,
    onOpenChange,
  ]);

  // "Map file" takes both name and size from the file, so both fields collapse to the
  // explanation rather than sitting there disabled.
  const showNameAndSize = isSettings || source !== 'file';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogContent className="max-w-sm">
          {/* Not a <form>: base-ui's Button forces type="button", so implicit submission
              never fires and Enter has to be handled here. Buttons keep their own Enter. */}
          <div
            data-testid="new-map-dialog"
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.target instanceof HTMLButtonElement) return;
              e.preventDefault();
              void submit();
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <DialogTitle>{isSettings ? 'Map settings' : 'New map'}</DialogTitle>
              <DialogClose
                aria-label="Close"
                className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50 transition-colors"
              >
                <X size={14} />
              </DialogClose>
            </div>

            <div className="space-y-4">
              {showNameAndSize && (
                <div>
                  <label htmlFor="new-map-name" className="text-xs text-muted-foreground mb-1.5 block">
                    Name
                  </label>
                  <input
                    id="new-map-name"
                    ref={nameRef}
                    data-testid="new-map-name"
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={FALLBACK_NAME}
                    className="w-full h-8 px-2.5 rounded border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-ring focus:ring-3 focus:ring-ring/20 transition-colors"
                  />
                </div>
              )}

              {!isSettings && (
                <div>
                  <span className="text-xs text-muted-foreground mb-1.5 block">Start from</span>
                  <div className="flex gap-2">
                    {SOURCES.map(({ value, label, Icon }) => (
                      <Segment
                        key={value}
                        selected={source === value}
                        onClick={() => chooseSource(value)}
                      >
                        <Icon size={15} />
                        {label}
                      </Segment>
                    ))}
                  </div>

                  {source !== 'blank' && (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        // Deliberately wide: the picker should show the DM every image on
                        // disk, including the .jfif Chrome hands them. normalizeImageFile
                        // is the real gate, and it reads bytes rather than names.
                        accept={source === 'file' ? '.mapbuilder' : 'image/*'}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void acceptFile(file, source);
                          e.target.value = '';
                        }}
                      />
                      {picked ? (
                        <div className="mt-2.5 flex items-center gap-2.5 rounded border border-border bg-background px-2.5 py-2">
                          {previewUrl ? (
                            <img
                              src={previewUrl}
                              alt=""
                              data-testid="new-map-thumbnail"
                              className="w-9 h-9 shrink-0 rounded object-cover bg-muted"
                            />
                          ) : (
                            // A .mapbuilder file has nothing to preview; so does an image
                            // whose blob URL hasn't been handed out yet.
                            <div className="w-9 h-9 shrink-0 grid place-items-center rounded bg-muted text-muted-foreground">
                              {source === 'image' ? <ImageIcon size={16} /> : <FileText size={16} />}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-foreground">{picked.name}</div>
                            <div className="text-xs text-muted-foreground tabular-nums">
                              {(picked.size / 1_048_576).toFixed(1)} MB
                            </div>
                          </div>
                          <button
                            type="button"
                            aria-label={`Remove ${picked.name}`}
                            onClick={() => setPicked(null)}
                            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50 transition-colors"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          data-testid="new-map-dropzone"
                          onClick={() => fileInputRef.current?.click()}
                          // preventDefault on dragover is what actually makes this a drop
                          // target; without it the browser navigates to the file instead.
                          onDragOver={(e) => {
                            e.preventDefault();
                            setDragOver(true);
                          }}
                          onDragLeave={() => setDragOver(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragOver(false);
                            const file = e.dataTransfer.files[0];
                            if (file) void acceptFile(file, source);
                          }}
                          data-drag-over={dragOver || undefined}
                          className={cn(
                            'mt-2.5 w-full flex flex-col items-center gap-1.5 rounded border border-dashed bg-background px-4 py-5 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring/50 transition-colors',
                            dragOver
                              ? 'border-accent-active bg-muted/60 text-foreground'
                              : 'border-border text-muted-foreground hover:border-accent-active/60 hover:bg-muted/40',
                          )}
                        >
                          <Upload size={20} />
                          <span className="text-sm text-foreground/80">
                            {source === 'file'
                              ? 'Drop a .mapbuilder file, or click to choose'
                              : 'Drop an image, or click to choose'}
                          </span>
                          <span className="text-[11px]">
                            {source === 'file'
                              ? 'Same file Ctrl+S writes and Ctrl+O opens'
                              : 'PNG, JPEG, SVG or WebP'}
                          </span>
                        </button>
                      )}

                      {fileError === 'not-a-map' && (
                        <InlineError>
                          That&apos;s not a map file. Pick a{' '}
                          <span className="font-medium">.mapbuilder</span> file, or start from an
                          image instead.
                        </InlineError>
                      )}
                      {fileError === 'not-an-image' && (
                        <InlineError>
                          That image format isn&apos;t supported. Use a PNG, JPEG, SVG or WebP file.
                        </InlineError>
                      )}

                      {source === 'image' && picked && (
                        <Hint>
                          Lands as the <span className="text-foreground">locked base</span> of the
                          map. You&apos;ll line it up to the grid on the canvas next.
                        </Hint>
                      )}
                    </>
                  )}
                </div>
              )}

              {showNameAndSize ? (
                <div>
                  <span className="text-xs text-muted-foreground mb-1.5 block">Size</span>
                  <div className="flex gap-2">
                    <Segment
                      selected={sizeMode === 'expanding'}
                      onClick={() => setSizeMode('expanding')}
                    >
                      Expanding
                    </Segment>
                    <Segment selected={sizeMode === 'fixed'} onClick={chooseFixed}>
                      Fixed
                    </Segment>
                  </div>

                  {sizeMode === 'fixed' ? (
                    <>
                      <div className="mt-2.5 flex items-center gap-2">
                        <input
                          data-testid="new-map-width"
                          aria-label="Width in cells"
                          inputMode="numeric"
                          value={widthText}
                          onChange={(e) => setWidthText(e.target.value)}
                          className="w-[74px] h-8 px-2 rounded border border-border bg-background text-center text-sm text-foreground tabular-nums outline-none focus:border-ring focus:ring-3 focus:ring-ring/20 transition-colors"
                        />
                        <span className="text-sm text-muted-foreground">×</span>
                        <input
                          data-testid="new-map-height"
                          aria-label="Height in cells"
                          inputMode="numeric"
                          value={heightText}
                          onChange={(e) => setHeightText(e.target.value)}
                          className="w-[74px] h-8 px-2 rounded border border-border bg-background text-center text-sm text-foreground tabular-nums outline-none focus:border-ring focus:ring-3 focus:ring-ring/20 transition-colors"
                        />
                        <span className="text-xs text-muted-foreground">cells</span>
                      </div>
                      {fixedSize ? (
                        <Readout>
                          Boundary{' '}
                          <span className="text-foreground">
                            {fixedSize.width * cellScale.value} × {fixedSize.height * cellScale.value}{' '}
                            {cellScale.unit}
                          </span>{' '}
                          at {cellScale.value} {cellScale.unit} per cell. You can still draw past the
                          edge; it just sits outside the map.
                        </Readout>
                      ) : (
                        <InlineError>
                          Width and height must be whole numbers of cells, from 1 to{' '}
                          {MAX_FIXED_CELLS}.
                        </InlineError>
                      )}
                    </>
                  ) : isSettings ? (
                    <Readout>
                      {measured.width > 0 && measured.height > 0 ? (
                        <>
                          Currently measuring{' '}
                          <span className="text-foreground">
                            {measured.width} × {measured.height} cells
                          </span>
                          . Switch to Fixed to pin it there.
                        </>
                      ) : (
                        <>Nothing drawn yet, so there is no size to measure.</>
                      )}
                    </Readout>
                  ) : source === 'image' ? (
                    <Hint>The image sets the starting boundary once you&apos;ve lined up the grid.</Hint>
                  ) : (
                    <Hint>
                      Grows to enclose everything you draw, plus{' '}
                      <span className="text-foreground">one cell of padding</span>.
                    </Hint>
                  )}
                </div>
              ) : (
                <div>
                  <span className="text-xs text-muted-foreground mb-1.5 block">Name &amp; size</span>
                  <div className="rounded bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
                    Both come from the file. Rename it afterwards from the map&apos;s card.
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  data-testid="new-map-submit"
                  className="flex-1"
                  disabled={!canSubmit}
                  onClick={() => { void submit(); }}
                >
                  {busy ? 'Working…' : primaryLabel}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

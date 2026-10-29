import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { measureGridSize } from '@dnd/core/src/store/slices/maps';
import {
  CELL_SCALE_UNITS,
  normalizeCellScale,
  normalizeFixedSize,
  type CellScaleUnit,
} from '@dnd/core/src/store/slices/mapSettings';
import { Dialog, DialogPortal, DialogBackdrop, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/toast';
import { useStore } from '@/store/store';
import { SizeFields, type SizeMode } from './SizeFields';
import { useEscapeToClose } from './useEscapeToClose';

export interface MapSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Name, size and scale of the map that is open. Size and scale live in the document, not
 * the card index, so this only ever edits the open map; a card's "Map settings…" on the
 * home page opens that map in the editor and shows this over it.
 */
export function MapSettingsModal({ open, onOpenChange }: MapSettingsModalProps) {
  const [name, setName] = useState('');
  const [originalName, setOriginalName] = useState('');
  const [sizeMode, setSizeMode] = useState<SizeMode>('expanding');
  const [widthText, setWidthText] = useState('30');
  const [heightText, setHeightText] = useState('20');
  const [scaleText, setScaleText] = useState('5');
  const [unit, setUnit] = useState<CellScaleUnit>('ft');
  const [busy, setBusy] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);

  // Every open starts from the map's current truth, so a cancelled edit leaves nothing
  // behind. Read imperatively and keyed on `open` alone: the save changes the very values
  // a reactive version would track, and would reset the form under the running submit.
  useEffect(() => {
    if (!open) return;
    const state = useStore.getState();
    const settings = state.mapSettings;
    const current = state.mapIndex.find((m) => m.id === state.activeMapId)?.name ?? settings.name;
    setName(current);
    setOriginalName(current);
    setSizeMode(settings.fixedSize ? 'fixed' : 'expanding');
    // Fixed starts at what the map already measures, so pinning it is one click rather
    // than reading the size off the canvas and typing it back in.
    const measured = measureGridSize(state.layers, settings.terrain?.bounds ?? null);
    const start = settings.fixedSize ?? (measured.width > 0 && measured.height > 0 ? measured : null);
    setWidthText(String(start?.width ?? 30));
    setHeightText(String(start?.height ?? 20));
    setScaleText(String(settings.cellScale.value));
    setUnit(normalizeCellScale(settings.cellScale)?.unit ?? 'ft');
    setBusy(false);
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
  const cellScale = useMemo(
    () => normalizeCellScale({ value: scaleText.trim() === '' ? NaN : Number(scaleText), unit }),
    [scaleText, unit],
  );
  const scaleInvalid = cellScale === null;
  const canSubmit = !busy && !sizeInvalid && !scaleInvalid;

  const submit = useCallback(async () => {
    if (!canSubmit || !cellScale) return;
    setBusy(true);
    try {
      const store = useStore.getState();
      const id = store.activeMapId;
      const trimmed = name.trim();
      // An emptied name keeps the one the map has rather than inventing a placeholder.
      if (id && trimmed && trimmed !== originalName) await store.renameMap(id, trimmed);
      store.setFixedSize(sizeMode === 'fixed' ? fixedSize : null);
      store.setCellScale(cellScale);
      await useStore.getState().saveCurrentMap();
      notify.success('Settings saved');
      onOpenChange(false);
    } catch (err) {
      console.error('[v2/MapSettingsModal]', err);
      notify.error('Failed to save settings');
    } finally {
      setBusy(false);
    }
  }, [canSubmit, cellScale, name, originalName, sizeMode, fixedSize, onOpenChange]);

  // Escape closes from anywhere in the dialog, a focused field included.
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useEscapeToClose(open, close);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop className="v2-backdrop" />
        <DialogContent className="v2-modal max-w-[440px] p-0">
          <div
            data-v2-home=""
            data-testid="v2-map-settings-modal"
            onKeyDown={(e) => {
              // Keep the canvas shortcuts out of the form, and let Enter save it.
              e.stopPropagation();
              if (e.key !== 'Enter' || e.target instanceof HTMLButtonElement) return;
              e.preventDefault();
              void submit();
            }}
          >
            <div className="v2-modal__head">
              <DialogTitle className="v2-modal__title">Map settings</DialogTitle>
              <button type="button" className="v2-x" aria-label="Close" onClick={() => onOpenChange(false)}>
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>

            <div className="v2-modal__body">
              <div>
                <label htmlFor="v2-map-settings-name" className="v2-label">
                  Name
                </label>
                <input
                  id="v2-map-settings-name"
                  ref={nameRef}
                  className="v2-input"
                  value={name}
                  placeholder={originalName}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <SizeFields
                mode={sizeMode}
                onModeChange={setSizeMode}
                widthText={widthText}
                heightText={heightText}
                onWidthChange={setWidthText}
                onHeightChange={setHeightText}
                invalid={sizeInvalid}
              />

              <div>
                <span className="v2-label">Cell scale</span>
                <div className="v2-size-row v2-size-row--flush">
                  <span>1 square</span>
                  <input
                    className="v2-input v2-input--num"
                    inputMode="decimal"
                    aria-label="Distance per square"
                    aria-invalid={scaleInvalid || undefined}
                    value={scaleText}
                    onChange={(e) => setScaleText(e.target.value)}
                  />
                  <div className="v2-segs v2-segs--unit" role="radiogroup" aria-label="Unit">
                    {CELL_SCALE_UNITS.map((u) => (
                      <button
                        key={u}
                        type="button"
                        role="radio"
                        aria-checked={unit === u}
                        className={cn('v2-seg', unit === u && 'v2-seg--on')}
                        onClick={() => setUnit(u)}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
                {scaleInvalid ? (
                  <p role="alert" className="v2-error">
                    <AlertCircle size={14} className="mt-px shrink-0" />
                    A distance above zero, such as 5 or 1.5.
                  </p>
                ) : (
                  <p className="v2-hint">Rulers and the status bar measure in this.</p>
                )}
              </div>
            </div>

            <div className="v2-modal__foot">
              <button type="button" className="v2-btn v2-btn--ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="v2-btn v2-btn--primary"
                data-testid="v2-map-settings-save"
                disabled={!canSubmit}
                onClick={() => void submit()}
              >
                Save
              </button>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

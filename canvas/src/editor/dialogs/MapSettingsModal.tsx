import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { measureGridSize } from '@dnd/core/src/store/slices/maps';
import {
  CELL_SCALE_UNITS,
  normalizeCellScale,
  normalizeFixedSize,
  type CellScaleUnit,
} from '@dnd/core/src/store/slices/mapSettings';
import type { CrossingKind } from '@dnd/core/src/shared/types';
import { setCrossingKinds, setSightDropCells } from '@dnd/core/src/store/plateauCommands';
import { Button } from '@/ui/button';
import { Dialog, DialogContent } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { notify } from '@/lib/toast';
import { useStore } from '@/store/store';
import { CompositeCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type { Command } from '@/store/types';
import { PrimaryButton, Seg } from '@/editor/components';
import { useEscapeToClose } from '@/editor/useEscapeToClose';
import { Actions, DialogHead, ErrorLine, Field, Hint } from './parts';
import { SizeFields, type SizeMode } from './SizeFields';
import { PlateauRules } from './PlateauRules';
import { crossingIdsInUse } from './plateauRulesModel';

export interface MapSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Name, size and scale of the map that is open. Size and scale live in the document, not
 * the card index, so this only ever edits the open map; a card's "Map settings…" on the
 * home page opens that map in the editor and shows this over it. Wider than the other
 * dialogs: a crossing kind's row holds two fields, a switch and three buttons.
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
  const [sightDrop, setSightDrop] = useState(2);
  const [kinds, setKinds] = useState<CrossingKind[]>([]);

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
    setSightDrop(settings.sightDropCells);
    setKinds(settings.crossingKinds);
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
  const kindsInvalid = kinds.some((k) => k.name.trim() === '');
  const canSubmit = !busy && !sizeInvalid && !scaleInvalid && !kindsInvalid;

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
      // The plateau rules are undoable like any edit: one step for whatever changed.
      const trimmedKinds = kinds.map((k) => ({ ...k, name: k.name.trim() }));
      const rules = [
        setSightDropCells(sightDrop),
        JSON.stringify(trimmedKinds) !== JSON.stringify(store.mapSettings.crossingKinds) ? setCrossingKinds(trimmedKinds) : null,
      ].filter((c): c is Command => c !== null);
      if (rules.length > 0) undoManager.execute(rules.length === 1 ? rules[0] : new CompositeCommand('Plateau rules', rules));
      await useStore.getState().saveCurrentMap();
      notify.success('Settings saved');
      onOpenChange(false);
    } catch (err) {
      console.error('[MapSettingsModal]', err);
      notify.error('Failed to save settings');
    } finally {
      setBusy(false);
    }
  }, [canSubmit, cellScale, name, originalName, sizeMode, fixedSize, onOpenChange, sightDrop, kinds]);

  // Escape closes from anywhere in the dialog, a focused field included.
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useEscapeToClose(open, close);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[440px]"
        data-v2-home=""
        data-testid="v2-map-settings-modal"
        initialFocus={nameRef}
        onKeyDown={(e) => {
          // Keep the canvas shortcuts out of the form, and let Enter save it.
          e.stopPropagation();
          if (e.key !== 'Enter' || e.target instanceof HTMLButtonElement) return;
          e.preventDefault();
          void submit();
        }}
      >
        <DialogHead title="Map settings" onClose={close} />

        <Field label="Name" htmlFor="v2-map-settings-name">
          <Input id="v2-map-settings-name" ref={nameRef} value={name} placeholder={originalName} onChange={(e) => setName(e.target.value)} />
        </Field>

        <SizeFields
          mode={sizeMode}
          onModeChange={setSizeMode}
          widthText={widthText}
          heightText={heightText}
          onWidthChange={setWidthText}
          onHeightChange={setHeightText}
          invalid={sizeInvalid}
        />

        <Field label="Cell scale">
          <div className="flex items-center gap-1.5 text-[12px] text-text-2">
            <span>1 square</span>
            <Input
              className="w-[72px]"
              inputMode="decimal"
              aria-label="Distance per square"
              aria-invalid={scaleInvalid || undefined}
              value={scaleText}
              onChange={(e) => setScaleText(e.target.value)}
            />
            <Seg
              aria-label="Unit"
              value={unit}
              onValueChange={(v) => setUnit(v as CellScaleUnit)}
              options={CELL_SCALE_UNITS.map((u) => ({ value: u, label: u }))}
            />
          </div>
          {scaleInvalid ? <ErrorLine>A distance above zero, such as 5 or 1.5.</ErrorLine> : <Hint>Rulers and the status bar measure in this.</Hint>}
        </Field>

        <PlateauRules
          sightDropCells={sightDrop}
          onSightDropCells={setSightDrop}
          kinds={kinds}
          onKinds={setKinds}
          inUse={crossingIdsInUse(useStore.getState().layers)}
        />

        <Actions>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <PrimaryButton data-testid="v2-map-settings-save" disabled={!canSubmit} onClick={() => void submit()}>
            Save
          </PrimaryButton>
        </Actions>
      </DialogContent>
    </Dialog>
  );
}

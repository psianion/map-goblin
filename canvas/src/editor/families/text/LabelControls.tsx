// The Label tool's own controls: the size stepper, the colour swatch (the layer's ink until a
// colour is picked), the six style tiles, and the card's text field and Follows row.

import { useLayoutEffect, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { selectLayerForChild } from '@/store/selectors';
import { PropertyCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer, TextChild } from '@/store/types';
import { LABEL_STYLES } from '@dnd/core/src/shared/labelStyles';
import { removeFreshLabel, takeLabelFocus } from '@dnd/core/src/engine/tools/TextTool';
import { DockColumn, SecondaryButton, SettingRow, Stepper, Swatch, Tile } from '@/editor/components';
import { Input } from '@/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import type { SettingProps } from '@/editor/registry/types';
import { editChildren } from '@/editor/families/design/cardWrites';
import { CUSTOM, LABEL_SIZE_RANGE, inkOf, withBox } from './labelModel';

/** Size in cells, a tenth a step. */
export function SizeStepper({ def, value, onChange }: SettingProps<number>) {
  return (
    <Stepper
      label={def.label}
      value={value}
      min={LABEL_SIZE_RANGE.min}
      max={LABEL_SIZE_RANGE.max}
      step={LABEL_SIZE_RANGE.step}
      format={(v) => `${v.toFixed(1)} sq`}
      onValueChange={(v) => onChange(Math.round(v * 10) / 10)}
    />
  );
}

/** The next label's colour: the layer's ink until one is picked, Ink to go back to it. */
export function LabelColourSwatch({ def, value, onChange }: SettingProps<string | null>) {
  const ink = useStore((s) => inkOf(s));
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value ?? ink;
  return (
    <Popover>
      <PopoverTrigger render={<Swatch label={def.label} color={shown} />} />
      <PopoverContent side="top" align="start" className="flex w-auto flex-col gap-2">
        <HexColorPicker color={shown} onChange={onChange} />
        <Input
          aria-label={`${def.label} hex`}
          className="font-mono"
          value={draft ?? shown}
          onChange={(e) => {
            setDraft(e.target.value);
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase());
          }}
          onBlur={() => setDraft(null)}
        />
        <SecondaryButton disabled={value === null} onClick={() => onChange(null)}>
          Layer ink
        </SecondaryButton>
      </PopoverContent>
    </Popover>
  );
}

/** What each style tile shows: a sample of the style. */
const GLYPH: Record<string, string> = {
  'room-name': 'Aa',
  'door-tag': 'Door',
  'gm-note': 'Note',
  'number-pin': '3',
  callout: 'Aa',
  [CUSTOM]: 'Aa',
};

/** The six styles: a pick sets the size and colour to the style's and takes up the Label tool. */
export function StyleTilesColumn() {
  const label = useStore(useShallow((s) => s.tools.settings.label));
  return (
    <DockColumn title="Styles" data-column="styles" data-testid="label-styles">
      {LABEL_STYLES.map((s) => {
        const key = s.id ?? CUSTOM;
        const on = (label.style ?? CUSTOM) === key;
        return (
          <Tile
            key={key}
            name={s.name}
            aria-label={s.name}
            active={on}
            onClick={() => {
              const st = useStore.getState();
              st.updateToolSettings({ label: { ...label, style: s.id, fontSize: s.fontSize, color: s.color === 'ink' ? null : s.color } });
              if (st.tools.activeTool !== 'text') st.setActiveTool('text');
            }}
          >
            <span
              className={`absolute inset-0 m-auto flex items-center justify-center text-[12px] text-text ${s.weight === 'bold' ? 'font-semibold' : ''}`}
            >
              {GLYPH[key]}
            </span>
          </Tile>
        );
      })}
    </DockColumn>
  );
}

/* ── The label card ─────────────────────────────────────── */

function readLabel(id: string): { label: TextChild; layer: DungeonLayer } | null {
  const s = useStore.getState();
  const layer = selectLayerForChild(s, id);
  const label = layer?.children.find((c): c is TextChild => c.id === id && c.childType === 'text');
  return layer && label ? { label, layer } : null;
}

/**
 * The text, typed straight into the label (its box grows with it) and landed as one undo
 * step when the field lets go. A label just placed takes the typing at once; Escape on it
 * takes it back off the map.
 */
export function LabelTextField({ value }: SettingProps<string>) {
  const id = useStore((s) => s.selection.selectedIds[0] ?? '');
  const bound = useStore((s) => {
    const c = s.selection.selectedIds[0] ? readLabel(s.selection.selectedIds[0]) : null;
    return Boolean(c?.label.bound);
  });
  const ref = useRef<HTMLTextAreaElement>(null);
  const atFocus = useRef<Pick<TextChild, 'text' | 'width' | 'height'> | null>(null);
  const gone = useRef(false);
  const rows = Math.min(5, Math.max(2, value.split('\n').length));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !id || !takeLabelFocus(id)) return;
    const take = () => {
      el.focus();
      el.select();
    };
    take();
    // The canvas press that placed the label mounts this card during its pointerdown; the
    // mousedown after it moves focus to the page. Take it straight back, during that press
    // only (until the next frame), so keys typed at once land here.
    const regain = (e: FocusEvent) => {
      el.removeEventListener('blur', regain);
      if (e.relatedTarget !== null) return;
      queueMicrotask(() => {
        if (el.isConnected && (document.activeElement === null || document.activeElement === document.body)) take();
      });
    };
    el.addEventListener('blur', regain);
    requestAnimationFrame(() => el.removeEventListener('blur', regain));
  }, [id]);

  const finish = () => {
    const prior = atFocus.current;
    atFocus.current = null;
    const found = readLabel(id);
    if (!prior || gone.current || !found || found.label.text === prior.text) return;
    const { label, layer } = found;
    const after = { text: label.text, width: label.width, height: label.height };
    useStore.getState().updateChild(layer.id, id, prior);
    undoManager.execute(new PropertyCommand('Edit label', { type: 'child', layerId: layer.id, childId: id }, prior, after));
  };

  return (
    <label className="flex flex-col gap-1 text-[12px] text-text-2">
      Text
      <textarea
        ref={ref}
        aria-label="Label text"
        data-testid="label-text"
        className="min-h-11 resize-none rounded-control border border-line bg-panel px-2 py-1 text-[12px] text-text outline-none focus-visible:border-ink"
        value={value}
        rows={rows}
        readOnly={bound}
        spellCheck={false}
        onFocus={() => {
          const found = readLabel(id);
          if (bound || !found) return;
          gone.current = false;
          atFocus.current = { text: found.label.text, width: found.label.width, height: found.label.height };
        }}
        onChange={(e) => {
          const found = readLabel(id);
          if (!bound && found) useStore.getState().updateChild(found.layer.id, id, withBox(found.label, { text: e.target.value }));
        }}
        onBlur={finish}
        onKeyDown={(e) => {
          // Keys typed here are not canvas shortcuts.
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            const found = readLabel(id);
            if (found && removeFreshLabel(found.label)) {
              gone.current = true;
              atFocus.current = null;
              return;
            }
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

/** What a bound label follows, by name, and Unbind to make it a free label. */
export function FollowsField({ value }: SettingProps<string>) {
  const ids = useStore(useShallow((s) => s.selection.selectedIds));
  return (
    <SettingRow label="Follows">
      <span className="flex items-center gap-2">
        <span className="text-[12px] text-text">{value || 'nothing'}</span>
        <SecondaryButton onClick={() => editChildren('Unbind label', ids, () => ({ bound: undefined, offset: undefined }))}>Unbind</SecondaryButton>
      </span>
    </SettingRow>
  );
}

/** Size as a card row: the label left, the stepper right. */
export function SizeRow(props: SettingProps<number>) {
  return (
    <SettingRow label={props.def.label}>
      <SizeStepper {...props} />
    </SettingRow>
  );
}

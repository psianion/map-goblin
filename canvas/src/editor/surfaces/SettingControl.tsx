// One setting drawn with the composites. The panel and the card draw full rows (label left,
// control right); the dock draws the compact form: a seg with icons becomes a row of icon
// buttons, a switch with an icon becomes one icon button. Values pass through as the
// registry types them; a seg or select keys its options by position, so any value type works.

import { useRef, useState, type ReactNode } from 'react';
import {
  ColourRow,
  IconKeyButton,
  InputRow,
  SecondaryButton,
  Seg,
  SelectRow,
  SettingRow,
  SliderRow,
  Stepper,
  Swatch,
  SwitchRow,
  Slider,
} from '@dnd/ui';
import type { SettingMeta } from '@/editor/registry';
import { formatValue } from './model';

interface FieldProps {
  meta: SettingMeta<unknown>;
  value: unknown;
  onChange: (value: unknown) => void;
}

function optionIndex(meta: SettingMeta<unknown>, value: unknown): string {
  const i = (meta.options ?? []).findIndex((o) => Object.is(o.value, value));
  return String(Math.max(i, 0));
}

function fromIndex(meta: SettingMeta<unknown>, index: string): unknown {
  return meta.options?.[Number(index)]?.value;
}

function RangeRow({ meta, value, onChange }: FieldProps) {
  const [lo, hi] = (Array.isArray(value) ? value : [0, 0]) as [number, number];
  const range = meta.range ?? { min: 0, max: 1, step: 0.01 };
  return (
    <div data-setting={meta.id} className="grid grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-1.5">
      <span className="text-[12px] text-text-2">{meta.label}</span>
      <span className="min-w-[42px] text-right font-mono text-[11px] text-text tabular-nums">
        {formatValue(meta, lo)} - {formatValue(meta, hi)}
      </span>
      <Slider
        className="col-span-2"
        aria-label={meta.label}
        min={range.min}
        max={range.max}
        step={range.step}
        value={[lo, hi]}
        onValueChange={(next) => {
          if (Array.isArray(next)) onChange([next[0], next[1]]);
        }}
      />
    </div>
  );
}

/** A setting or card field as a full row. */
export function FieldControl({ meta, value, onChange }: FieldProps): ReactNode {
  const range = meta.range;
  switch (meta.control) {
    case 'slider':
      return (
        <SliderRow
          label={meta.label}
          value={Number(value)}
          onValueChange={onChange}
          min={range?.min}
          max={range?.max}
          step={range?.step}
          format={(v) => formatValue(meta, v)}
        />
      );
    case 'range':
      return <RangeRow meta={meta} value={value} onChange={onChange} />;
    case 'switch':
      return <SwitchRow label={meta.label} checked={value === true} onCheckedChange={onChange} />;
    case 'seg':
      return (
        <SettingRow label={meta.label}>
          <Seg
            aria-label={meta.label}
            value={optionIndex(meta, value)}
            onValueChange={(i) => onChange(fromIndex(meta, i))}
            options={(meta.options ?? []).map((o, i) => ({ value: String(i), label: o.label, disabled: o.disabled }))}
          />
        </SettingRow>
      );
    case 'select':
      return (
        <SelectRow
          label={meta.label}
          value={optionIndex(meta, value)}
          onValueChange={(i) => onChange(fromIndex(meta, i))}
          options={(meta.options ?? []).map((o, i) => ({ value: String(i), label: o.label, disabled: o.disabled }))}
        />
      );
    case 'stepper':
      return (
        <SettingRow label={meta.label}>
          <Stepper label={meta.label} value={Number(value)} onValueChange={onChange} min={range?.min} max={range?.max} step={range?.step} />
        </SettingRow>
      );
    case 'input':
      return <InputRow label={meta.label} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'colour':
      return <ColourRow label={meta.label} value={(value as string | null) ?? null} onValueChange={onChange} />;
    case 'swatches':
      return (
        <SettingRow label={meta.label}>
          <span className="flex gap-1.5">
            {(meta.options ?? []).map((o) => (
              <Swatch
                key={String(o.value)}
                label={o.label}
                color={String(o.value)}
                aria-pressed={Object.is(o.value, value)}
                onClick={() => onChange(o.value)}
              />
            ))}
          </span>
        </SettingRow>
      );
    case 'button':
      return <SecondaryButton onClick={() => onChange(value)}>{meta.label}</SecondaryButton>;
    case 'readout':
      return (
        <SettingRow label={meta.label}>
          <span className="font-mono text-[11px] text-text tabular-nums">{String(value)}</span>
        </SettingRow>
      );
    case 'custom': {
      const Render = meta.render;
      return Render ? <Render def={meta} value={value} onChange={onChange} /> : null;
    }
  }
}

/** A typed number in the units the readout shows: a percent of a 0..1 range is a share. */
function fromTyped(meta: SettingMeta<unknown>, text: string): number | null {
  const n = parseFloat(text);
  if (!Number.isFinite(n)) return null;
  const range = meta.range ?? { min: 0, max: 1, step: 0.01 };
  const v = range.unit === '%' && range.max <= 1 ? n / 100 : n;  return Math.min(range.max, Math.max(range.min, v));
}

/** The readout of a typed slider: click it to type the value; Enter or leaving commits, Escape cancels. */
function TypedValue({ meta, value, onChange }: { meta: SettingMeta<unknown>; value: number; onChange: (value: unknown) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  // Set once the field is done with, so the blur its closing fires commits nothing more.
  const done = useRef(false);
  const shown = formatValue(meta, value);
  if (draft === null) {
    return (
      <button
        type="button"
        aria-label={`${meta.label}: type a value`}
        className="w-9 text-right font-mono text-[11px] text-text tabular-nums hover:underline"
        onClick={() => {
          done.current = false;
          setDraft(shown.replace(/[^\d.-]/g, ''));
        }}
      >
        {shown}
      </button>
    );
  }
  const close = () => {
    done.current = true;
    setDraft(null);
  };
  const commit = () => {
    if (done.current) return;
    const v = fromTyped(meta, draft);
    close();
    if (v !== null) onChange(v);
  };
  return (
    <input
      aria-label={meta.label}
      autoFocus
      inputMode="decimal"
      className="h-5 w-9 rounded-control border border-line bg-transparent px-0.5 text-right font-mono text-[11px] text-text tabular-nums"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') close();
      }}
    />
  );
}

/** A slider in the dock: the track, the value beside it, under the column's caption. */
function DockSlider({ meta, value, onChange }: FieldProps) {
  const range = meta.range;
  const v = Number(value);
  return (
    <span className="flex w-[132px] items-center gap-2">
      <Slider
        aria-label={meta.label}
        className="flex-1"
        value={[v]}
        min={range?.min}
        max={range?.max}
        step={range?.step}
        onValueChange={(next: number | readonly number[]) => onChange(typeof next === 'number' ? next : next[0])}
      />
      <TypedValue meta={meta} value={v} onChange={onChange} />
    </span>
  );
}

/** The dock's compact form; anything without one draws as its row. */
export function DockControl({ meta, value, onChange }: FieldProps): ReactNode {
  if (meta.control === 'slider' && meta.typed) return <DockSlider meta={meta} value={value} onChange={onChange} />;
  if (meta.control === 'seg' && meta.options?.every((o) => o.icon)) {
    return (
      <span role="group" aria-label={meta.label} className="flex items-center gap-1">
        {meta.options.map((o) => (
          <IconKeyButton
            key={o.label}
            size={32}
            icon={o.icon!}
            label={o.label}
            shortcut={o.key}
            active={Object.is(o.value, value)}
            onClick={() => onChange(o.value)}
          />
        ))}
      </span>
    );
  }
  // A seg of words under the column's caption: the caption names it, the seg has no label of its own.
  if (meta.control === 'seg') {
    return (
      <Seg
        aria-label={meta.label}
        value={optionIndex(meta, value)}
        onValueChange={(i) => onChange(fromIndex(meta, i))}
        options={(meta.options ?? []).map((o, i) => ({ value: String(i), label: o.label, disabled: o.disabled }))}
      />
    );
  }
  if (meta.control === 'switch' && meta.icon) {
    return (
      <IconKeyButton
        size={32}
        icon={meta.icon}
        label={meta.label}
        shortcut={meta.key}
        active={value === true}
        onClick={() => onChange(value !== true)}
      />
    );
  }
  if (meta.control === 'stepper') {
    const range = meta.range;
    return <Stepper label={meta.label} value={Number(value)} onValueChange={onChange} min={range?.min} max={range?.max} step={range?.step} />;
  }
  return <FieldControl meta={meta} value={value} onChange={onChange} />;
}

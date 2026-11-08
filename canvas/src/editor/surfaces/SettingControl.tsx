// One setting drawn with the composites. The panel and the card draw full rows (label left,
// control right); the dock draws the compact form: a seg with icons becomes a row of icon
// buttons, a switch with an icon becomes one icon button. Values pass through as the
// registry types them; a seg or select keys its options by position, so any value type works.

import type { ReactNode } from 'react';
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

/** The dock's compact form; anything without one draws as its row. */
export function DockControl({ meta, value, onChange }: FieldProps): ReactNode {
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

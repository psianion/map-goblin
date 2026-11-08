// The Light tool's own controls: bright and dim in feet, a compact intensity slider, the
// colour swatch, the six presets, and the panel's way into the Sky and mood sheet.

import { useState } from 'react';
import { Eclipse, Flame, FlameKindling, Lamp, LampWallUp, Sparkles, SunMoon, type LucideIcon } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';
import { useStore } from '@/store/store';
import { LIGHT_PRESETS, presetDefaults, type LightPresetId } from '@dnd/core/src/store/lightPresets';
import {
  DockColumn,
  SecondaryButton,
  SettingRow,
  Stepper,
  Swatch,
  Tile,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Slider,
} from '@dnd/ui';
import type { SettingProps } from '@/editor/registry/types';
import { useShell } from '@/editor/shell/shellStore';
import { LIGHT_RADIUS_FT, toFt } from './lightModel';

/** A distance in feet, 5 ft a step. */
export function FeetStepper({ def, value, onChange }: SettingProps<number>) {
  return (
    <Stepper
      label={def.label}
      value={value}
      min={LIGHT_RADIUS_FT.min}
      max={LIGHT_RADIUS_FT.max}
      step={LIGHT_RADIUS_FT.step}
      format={(v) => `${v} ft`}
      onValueChange={onChange}
    />
  );
}

/** A short track and its percentage, for the dock. */
export function PercentSlider({ def, value, onChange }: SettingProps<number>) {
  const r = def.range;
  return (
    <span className="flex w-[132px] items-center gap-2">
      <Slider
        aria-label={def.label}
        className="flex-1"
        value={[value]}
        min={r?.min}
        max={r?.max}
        step={r?.step}
        onValueChange={(next: number | readonly number[]) => onChange(typeof next === 'number' ? next : next[0])}
      />
      <span className="w-9 text-right font-mono text-[11px] text-text tabular-nums">{Math.round(value * 100)}%</span>
    </span>
  );
}

/** The light's colour as a swatch with a picker and a hex field. */
export function ColourSwatch({ def, value, onChange }: SettingProps<string>) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Popover>
      <PopoverTrigger render={<Swatch label={def.label} color={value} />} />
      <PopoverContent side="top" align="start" className="flex w-auto flex-col gap-2">
        <HexColorPicker color={value} onChange={onChange} />
        <Input
          aria-label={`${def.label} hex`}
          className="font-mono"
          value={draft ?? value}
          onChange={(e) => {
            setDraft(e.target.value);
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase());
          }}
          onBlur={() => setDraft(null)}
        />
      </PopoverContent>
    </Popover>
  );
}

/** The next light's colour; a darkness source burns none, so it has no swatch. */
export function DockColourSwatch(props: SettingProps<string>) {
  const darkness = useStore((s) => s.tools.settings.lightDefaults.darkness === true);
  return darkness ? null : <ColourSwatch {...props} />;
}

const PRESET_ICON: Record<LightPresetId, LucideIcon> = {
  torch: Flame,
  lantern: LampWallUp,
  candle: Lamp,
  brazier: FlameKindling,
  magical: Sparkles,
  darkness: Eclipse,
};

/** Torch, Lantern, Candle, Brazier, Magical, Darkness: a pick sets up the next light. */
export function PresetsColumn() {
  const presetId = useStore((s) => s.tools.settings.lightDefaults.presetId);
  const ftPerCell = useStore((s) => s.mapSettings.cellScale.value);
  return (
    <DockColumn title="Presets" data-column="presets" data-testid="light-presets">
      {LIGHT_PRESETS.map((p) => {
        const Icon = PRESET_ICON[p.id];
        const reach = p.bright === p.dim ? `${toFt(p.dim, ftPerCell)} ft` : `${toFt(p.bright, ftPerCell)} / ${toFt(p.dim, ftPerCell)} ft`;
        return (
          <Tile
            key={p.id}
            name={p.label}
            aria-label={`${p.label}, ${reach}`}
            active={p.id === presetId}
            color={p.darkness ? undefined : p.color}
            data-tip={reach}
            onClick={() => useStore.getState().updateLightDefaults(presetDefaults(p))}
          >
            <Icon aria-hidden strokeWidth={1.75} className="absolute inset-0 m-auto size-4 text-text" />
          </Tile>
        );
      })}
    </DockColumn>
  );
}

/** The panel's foot: the map's sky and mood, which every light is seen against. */
export function SkyButton() {
  return (
    <div className="px-3 pb-2.5">
      <SecondaryButton icon={SunMoon} onClick={() => useShell.getState().openSheet('sky')}>
        Sky and mood…
      </SecondaryButton>
    </div>
  );
}

/** A distance as a card row: the label left, the stepper right. */
export function FeetRow(props: SettingProps<number>) {
  return (
    <SettingRow label={props.def.label}>
      <FeetStepper {...props} />
    </SettingRow>
  );
}

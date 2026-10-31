import { useState } from 'react';
import { Eclipse, Ellipsis, Flame, FlameKindling, LampWallUp, Sparkles, SunMoon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { cn } from '@/lib/utils';
import { ColorCtl, Ctl, DockPopover, RangeInput, Slider } from './controls';
import { CONE_RANGE, DIRECTION_RANGE, EFFECTS, NIGHT_ONLY, SPEED_RANGE, animationFor, clampFt, coneOf, toCells, toFt, type Effect } from './lightModel';
import { LIGHT_PRESETS, LIGHT_RADIUS_FT, presetDefaults, type LightPresetId } from './lightWrites';
import { setLitPreview, useLitPreview } from '../viewPrefs';
import './lighting.css';

/* The Lights tab of the dock (board 1): six presets, the quick settings for the next light,
 * "All settings" for the rest, and the Sky & mood sheet at the right end. */

/** The candle preset's glyph, on lucide's grid. */
function CandleIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.5 11h5v10h-5z" />
      <path d="M12 3c1.6 1.8 2 3.2 0 5.2-2-2-1.6-3.4 0-5.2z" />
      <path d="M12 8.2V11" />
    </svg>
  );
}

const PRESET_ICON: Record<LightPresetId, ReactNode> = {
  torch: <Flame size={14} strokeWidth={1.75} />,
  lantern: <LampWallUp size={14} strokeWidth={1.75} />,
  candle: <CandleIcon />,
  brazier: <FlameKindling size={14} strokeWidth={1.75} />,
  magical: <Sparkles size={14} strokeWidth={1.75} />,
  darkness: <Eclipse size={14} strokeWidth={1.75} />,
};

/** The six presets as tiles, each glowing with the light it places. A pick sets up the next light. */
export function LightPresets() {
  const presetId = useStore((s) => s.tools.settings.lightDefaults.presetId);
  const ftPerCell = useStore((s) => s.mapSettings.cellScale.value);
  return (
    <div className="v2-swatches" role="group" aria-label="Light presets" data-testid="v2-swatches">
      {LIGHT_PRESETS.map((p) => {
        const on = p.id === presetId;
        const dark = !!p.darkness;
        return (
          <button
            key={p.id}
            type="button"
            className={cn('v2-swatch v2-lswatch', dark && 'v2-lswatch--dark', on && 'v2-swatch--on')}
            aria-pressed={on}
            aria-label={p.label}
            data-tip={p.label}
            data-tip-key={
              p.bright === p.dim ? `${toFt(p.dim, ftPerCell)} ft` : `${toFt(p.bright, ftPerCell)} / ${toFt(p.dim, ftPerCell)} ft`
            }
            data-testid={`v2-light-preset-${p.id}`}
            style={dark ? undefined : ({ '--glow': p.color } as CSSProperties)}
            onClick={() => useStore.getState().updateLightDefaults(presetDefaults(p))}
          >
            {PRESET_ICON[p.id]}
          </button>
        );
      })}
    </div>
  );
}

function useDefaults() {
  return useStore(useShallow((s) => s.tools.settings.lightDefaults));
}

/** Bright · Dim · Colour · Flicker for the next light, then "⋯" for the rest. */
export function LightSettings() {
  const d = useDefaults();
  const ftPerCell = useStore((s) => s.mapSettings.cellScale.value);
  const set = useStore.getState().updateLightDefaults;
  const bright = toFt(d.featherRadius, ftPerCell);
  const dim = toFt(d.radius, ftPerCell);
  const cells = (ft: number) => toCells(clampFt(ft, LIGHT_RADIUS_FT), ftPerCell);
  const [more, setMore] = useState(false);
  const flicker = d.animation?.kind === 'flicker';
  return (
    <>
      <Slider
        label="Bright"
        width={72}
        value={bright}
        {...LIGHT_RADIUS_FT}
        format={(v) => `${v} ft`}
        onChange={(v) => set(v > dim ? { featherRadius: cells(v), radius: cells(v) } : { featherRadius: cells(v) })}
      />
      <Slider
        label="Dim"
        width={72}
        value={dim}
        {...LIGHT_RADIUS_FT}
        format={(v) => `${v} ft`}
        onChange={(v) => set(v < bright ? { radius: cells(v), featherRadius: cells(v) } : { radius: cells(v) })}
      />
      {!d.darkness && <ColorCtl label="Colour" value={d.color} onChange={(c) => set({ color: c })} />}
      <Ctl label="Flicker" width={44}>
        <button
          type="button"
          role="switch"
          aria-checked={flicker}
          aria-label="Flicker"
          className={cn('v2-switch', flicker && 'v2-switch--on')}
          onClick={() => set({ animation: flicker ? undefined : { kind: 'flicker', speed: d.animation?.speed ?? 1 } })}
        >
          <span />
        </button>
      </Ctl>
      <span className="v2-dock__section v2-settings__more">
        <button
          type="button"
          className={cn('v2-ib', more && 'v2-ib--on')}
          aria-label="All settings"
          aria-expanded={more}
          data-tip="All settings"
          data-testid="v2-settings-more"
          onClick={() => setMore((m) => !m)}
        >
          <Ellipsis size={15} strokeWidth={1.75} />
        </button>
        <DockPopover open={more} onClose={() => setMore(false)} className="v2-pop--lightmore" label="All settings">
          <LightMore />
        </DockPopover>
      </span>
    </>
  );
}

function PopRange({
  label,
  value,
  range,
  format,
  off,
  onChange,
}: {
  label: string;
  value: number;
  range: { min: number; max: number; step: number };
  format: (v: number) => string;
  off?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className={cn('v2-rrow', off && 'v2-prow--off')}>
      <span className="v2-rrow__lbl">{label}</span>
      <span className="v2-pscale">
        <RangeInput label={label} value={value} {...range} onChange={onChange} />
        <span className="v2-num v2-rsmall">{format(value)}</span>
      </span>
    </div>
  );
}

function PopSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="v2-rrow v2-prow--tight">
      <span className="v2-rrow__lbl v2-prow__wide">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={cn('v2-switch', checked && 'v2-switch--on')}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

/** The rest of the next light's settings: cone, direction, animation, behaviour. */
function LightMore() {
  const d = useDefaults();
  const set = useStore.getState().updateLightDefaults;
  const cone = coneOf(d);
  const effect: Effect = d.animation?.kind ?? 'none';
  const speed = d.animation?.speed ?? 1;
  return (
    <div className="v2-lcard" data-testid="v2-light-more">
      <PopRange label="Cone" value={cone.angle} range={CONE_RANGE} format={(v) => `${v}°`} onChange={(v) => set({ cone: { angle: v, direction: cone.direction } })} />
      <PopRange
        label="Direction"
        value={cone.direction}
        range={DIRECTION_RANGE}
        format={(v) => `${v}°`}
        off={cone.angle >= 360}
        onChange={(v) => set({ cone: { angle: cone.angle, direction: v } })}
      />
      <div className="v2-rrow">
        <span className="v2-rrow__lbl">Effect</span>
        <span className="v2-seg" role="group" aria-label="Effect">
          {EFFECTS.map((o) => (
            <button key={o.value} type="button" aria-pressed={effect === o.value} onClick={() => set({ animation: animationFor(o.value, speed) })}>
              {o.label}
            </button>
          ))}
        </span>
      </div>
      <PopRange
        label="Speed"
        value={speed}
        range={SPEED_RANGE}
        format={(v) => `${v.toFixed(1)} ×`}
        off={effect === 'none'}
        onChange={(v) => set({ animation: animationFor(effect, v) })}
      />
      <PopSwitch label="Through walls" checked={!!d.throughWalls} onChange={(v) => set({ throughWalls: v || undefined })} />
      <PopSwitch label="Night only" checked={!!d.nightOnly} onChange={(v) => set({ nightOnly: v ? { ...NIGHT_ONLY } : undefined })} />
      <PopSwitch label="Darkness source" checked={!!d.darkness} onChange={(v) => set({ darkness: v || undefined })} />
    </div>
  );
}

/** The right end of the Lights tab: the Sky & mood sheet. */
export function LightsDockTail({ skyOpen, onToggleSky }: { skyOpen: boolean; onToggleSky: () => void }) {
  const lit = useLitPreview();
  return (
    <>
      <span className="v2-dock__spacer" />
      {!lit && (
        <button
          type="button"
          className="v2-rbtn v2-rbtn--ghost"
          data-testid="v2-lights-unlit"
          data-tip="The map is shown unlit: lights and mood show with Lit preview on"
          data-tip-key="I"
          onClick={() => setLitPreview(true)}
        >
          Unlit · turn on
        </button>
      )}
      <span className="v2-vr" role="presentation" />
      <button
        type="button"
        className={cn('v2-rbtn', skyOpen && 'v2-rbtn--open')}
        aria-pressed={skyOpen}
        data-testid="v2-sky-toggle"
        data-tip="The map's sky, time, table defaults and mood tint"
        onClick={onToggleSky}
      >
        <SunMoon size={14} strokeWidth={1.75} />
        Sky &amp; mood
      </button>
    </>
  );
}

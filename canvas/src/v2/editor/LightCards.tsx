import { useCallback, useRef } from 'react';
import { useStore } from '@/store/store';
import type { AnyChild, DungeonLayer, LightChild } from '@/store/types';
import { cn } from '@/lib/utils';
import { ColorCtl, RangeInput, Slider } from './controls';
import { CardSwitch, NumBox, Section } from './PropCards';
import {
  CONE_RANGE,
  DIRECTION_RANGE,
  EFFECTS,
  NIGHT_ONLY,
  SPEED_RANGE,
  animationFor,
  attachedProp,
  clampFt,
  coneOf,
  effectOf,
  isFullCircle,
  nearestProp,
  speedOf,
  toCells,
  toFt,
  type Effect,
} from './lightModel';
import { LIGHT_RADIUS_FT, commitLightFields, toggleLightDarkness } from './lightWrites';
import './props.css';
import './rooms.css';
import './selection-card.css';
import './lighting.css';

/*
 * The selection card for one light (boards 2 and 3): its reach in feet, colour and
 * strength, the cone, the animation, how it behaves, and whether it starts on at the table.
 * A darkness source drops its colour and gains "Darkvision sees through". Every edit is one
 * undo step; a drag previews live and lands as one step when it ends.
 */

type Patch = Partial<LightChild>;

/**
 * A drag on the card patches the light on every tick, off the undo stack, and lands as one
 * light command when it ends, so undo returns to where the drag started.
 */
function useLightLive(layerId: string, id: string) {
  const before = useRef<Patch | null>(null);
  const read = useCallback((): LightChild | undefined => {
    const layer = useStore.getState().layers.find((l) => l.id === layerId) as DungeonLayer | undefined;
    return layer?.children.find((c): c is LightChild => c.id === id && c.childType === 'light');
  }, [layerId, id]);

  const preview = useCallback(
    (patch: Patch) => {
      const light = read();
      if (!light) return;
      const snap = before.current ?? {};
      for (const k of Object.keys(patch) as (keyof LightChild)[]) {
        if (!(k in snap)) (snap as Record<string, unknown>)[k] = structuredClone(light[k]);
      }
      before.current = snap;
      useStore.getState().updateChild(layerId, id, patch as Partial<AnyChild>);
    },
    [layerId, id, read],
  );

  const commit = useCallback(
    (label: string) => {
      const snap = before.current;
      before.current = null;
      const light = read();
      if (!snap || !light) return;
      const after: Patch = {};
      for (const k of Object.keys(snap) as (keyof LightChild)[]) (after as Record<string, unknown>)[k] = light[k];
      if (JSON.stringify(after) === JSON.stringify(snap)) return;
      useStore.getState().updateChild(layerId, id, snap as Partial<AnyChild>);
      commitLightFields(label, id, after, snap);
    },
    [layerId, id, read],
  );

  /** One step at once: a click, a typed number. */
  const set = useCallback(
    (label: string, patch: Patch) => {
      const light = read();
      if (!light) return;
      const prior: Patch = {};
      for (const k of Object.keys(patch) as (keyof LightChild)[]) (prior as Record<string, unknown>)[k] = light[k];
      if (JSON.stringify(prior) === JSON.stringify(patch)) return;
      commitLightFields(label, id, patch);
    },
    [id, read],
  );

  return { preview, commit, set };
}

/** A label, a track and the typed number with its unit after it. */
function DistRow({
  label,
  value,
  range,
  unit,
  format = (v) => String(Math.round(v)),
  off,
  onPreview,
  onCommit,
  onType,
}: {
  label: string;
  value: number;
  range: { min: number; max: number; step: number };
  unit: string;
  format?: (v: number) => string;
  off?: boolean;
  onPreview: (v: number) => void;
  onCommit: () => void;
  onType: (v: number) => void;
}) {
  return (
    <div className={cn('v2-rrow', off && 'v2-prow--off')}>
      <span className="v2-rrow__lbl">{label}</span>
      <span className="v2-pscale">
        <RangeInput label={label} value={value} {...range} onChange={onPreview} onCommit={onCommit} />
        <NumBox label="" title={label} value={value} format={format} unit={unit} disabled={off} onCommit={onType} />
      </span>
    </div>
  );
}

function SegRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="v2-rrow">
      <span className="v2-rrow__lbl">{label}</span>
      <span className="v2-seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => value !== o.value && onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </span>
    </div>
  );
}

function SwitchRow({
  label,
  checked,
  onChange,
  tight = true,
  sub,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  tight?: boolean;
  sub?: boolean;
}) {
  return (
    <div className={cn('v2-rrow', tight && 'v2-prow--tight', sub && 'v2-prow--sub')}>
      <span className="v2-rrow__lbl v2-prow__wide">{label}</span>
      <CardSwitch label={label} checked={checked} onChange={onChange} />
    </div>
  );
}

const FALLOFFS: { value: LightChild['falloff']; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'quadratic', label: 'Quadratic' },
];

const percent = (v: number) => `${Math.round(v * 100)}%`;

/** The whole card for one light. */
export function LightTargetCard({ light, layerId }: { light: LightChild; layerId: string }) {
  const ftPerCell = useStore((s) => s.mapSettings.cellScale.value);
  const attached = useStore((s) => attachedProp(s, light));
  const near = useStore((s) => {
    if (light.attachedTo) return null;
    const layer = s.layers.find((l) => l.id === layerId);
    return layer && layer.type === 'dungeon' ? nearestProp(layer as DungeonLayer, light) : null;
  });
  const { preview, commit, set } = useLightLive(layerId, light.id);
  const dark = !!light.darkness;
  const bright = toFt(light.featherRadius, ftPerCell);
  const dim = toFt(light.radius, ftPerCell);
  const cone = coneOf(light);
  const full = isFullCircle(light);
  const effect = effectOf(light);
  const speed = speedOf(light);
  const cells = (ft: number) => toCells(ft, ftPerCell);

  // Bright never passes dim: dragging one past the other carries the other with it.
  const brightPatch = (ft: number): Patch => {
    const v = clampFt(ft, LIGHT_RADIUS_FT);
    return v > dim ? { featherRadius: cells(v), radius: cells(v) } : { featherRadius: cells(v) };
  };
  const dimPatch = (ft: number): Patch => {
    const v = clampFt(ft, LIGHT_RADIUS_FT);
    return v < bright ? { radius: cells(v), featherRadius: cells(v) } : { radius: cells(v) };
  };
  const conePatch = (angle: number, direction = cone.direction): Patch => ({
    cone: { angle: Math.min(CONE_RANGE.max, Math.max(CONE_RANGE.min, Math.round(angle))), direction },
  });
  const dirPatch = (deg: number): Patch => ({ cone: { angle: cone.angle, direction: ((Math.round(deg) % 360) + 360) % 360 } });
  const speedPatch = (v: number): Patch => ({
    animation: animationFor(effect, Math.min(SPEED_RANGE.max, Math.max(SPEED_RANGE.min, Math.round(v * 20) / 20))),
  });

  return (
    <section
      className="v2-sel v2-float v2-pcard v2-lcard"
      data-testid="v2-selection-card"
      data-light-kind={dark ? 'darkness' : 'light'}
      data-chrome
      aria-label="Selection"
    >
      <header className="v2-sel__head v2-pcard__head">
        <span className="v2-sel__name">{light.name || 'Light'}</span>
        <span className="v2-sel__kind v2-rend">Light</span>
      </header>
      {attached ? (
        <div className="v2-lcard__attach" data-testid="v2-light-attach">
          <span className="v2-rquiet">
            Attached to <b>{attached.name || 'a prop'}</b>
          </span>
          <button type="button" className="v2-link v2-rend" onClick={() => set('Detach light', { attachedTo: undefined })}>
            Detach
          </button>
        </div>
      ) : (
        near && (
          <div className="v2-lcard__attach" data-testid="v2-light-attach">
            <span className="v2-rquiet">
              Near <b>{near.name || 'a prop'}</b>
            </span>
            <button type="button" className="v2-link v2-rend" onClick={() => set('Attach light', { attachedTo: near.id })}>
              Attach to nearest
            </button>
          </div>
        )
      )}

      <Section title="Light" testId="v2-light-light">
        <DistRow
          label="Bright"
          value={bright}
          range={LIGHT_RADIUS_FT}
          unit="ft"
          onPreview={(v) => preview(brightPatch(v))}
          onCommit={() => commit('Light bright')}
          onType={(v) => set('Light bright', brightPatch(v))}
        />
        <DistRow
          label="Dim"
          value={dim}
          range={LIGHT_RADIUS_FT}
          unit="ft"
          onPreview={(v) => preview(dimPatch(v))}
          onCommit={() => commit('Light dim')}
          onType={(v) => set('Light dim', dimPatch(v))}
        />
        {!dark && (
          <div className="v2-rrow v2-selc">
            <ColorCtl
              label="Colour"
              placement="beside"
              value={light.color}
              onChange={(c) => preview({ color: c })}
              onCommit={() => commit('Light colour')}
            />
            <span className="v2-selc__value v2-num">{light.color.toUpperCase()}</span>
          </div>
        )}
        <div className="v2-rrow v2-selc">
          <Slider
            label="Intensity"
            value={light.intensity}
            min={0}
            max={1}
            step={0.01}
            format={percent}
            onChange={(v) => preview({ intensity: v })}
            onCommit={() => commit('Light intensity')}
          />
        </div>
        <SegRow label="Falloff" value={light.falloff} options={FALLOFFS} onChange={(v) => set('Light falloff', { falloff: v })} />
      </Section>

      <Section title="Shape" quiet={full ? 'Full circle' : 'Cone'} testId="v2-light-shape">
        <DistRow
          label="Cone"
          value={cone.angle}
          range={CONE_RANGE}
          unit="°"
          onPreview={(v) => preview(conePatch(v))}
          onCommit={() => commit('Light cone')}
          onType={(v) => set('Light cone', conePatch(v))}
        />
        <DistRow
          label="Direction"
          value={cone.direction}
          range={DIRECTION_RANGE}
          unit="°"
          off={full}
          onPreview={(v) => preview(dirPatch(v))}
          onCommit={() => commit('Light direction')}
          onType={(v) => set('Light direction', dirPatch(v))}
        />
      </Section>

      <Section title="Animation" testId="v2-light-animation">
        <SegRow<Effect>
          label="Effect"
          value={effect}
          options={EFFECTS}
          onChange={(v) => set('Light effect', { animation: animationFor(v, speed) })}
        />
        <DistRow
          label="Speed"
          value={speed}
          range={SPEED_RANGE}
          unit="×"
          format={(v) => v.toFixed(1)}
          off={effect === 'none'}
          onPreview={(v) => preview(speedPatch(v))}
          onCommit={() => commit('Light speed')}
          onType={(v) => set('Light speed', speedPatch(v))}
        />
      </Section>

      <Section title="Behaviour" tight testId="v2-light-behaviour">
        <SwitchRow label="Through walls" checked={!!light.throughWalls} onChange={(v) => set('Through walls', { throughWalls: v || undefined })} />
        <SwitchRow
          label="Night only"
          checked={!!light.nightOnly}
          onChange={(v) => set('Night only', { nightOnly: v ? { ...NIGHT_ONLY } : undefined })}
        />
        <SwitchRow label="Darkness source" checked={dark} onChange={() => toggleLightDarkness(light.id)} />
        {dark && (
          <SwitchRow
            label="Darkvision sees through"
            sub
            checked={!!light.darkvisionSees}
            onChange={(v) => set('Darkvision sees through', { darkvisionSees: v || undefined })}
          />
        )}
      </Section>

      <Section title="Table" testId="v2-light-table">
        <SwitchRow
          label="On at the table"
          tight={false}
          checked={light.tableOn !== false}
          onChange={(v) => set('On at the table', { tableOn: v ? undefined : false })}
        />
      </Section>
    </section>
  );
}

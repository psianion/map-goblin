import { useMemo } from 'react';
import { useStore } from '@dnd/core/src/store/store';
import { LIGHT_RADIUS_FT } from '@dnd/core/src/store/lightPresets';
import type { LightEdit } from '@dnd/mechanics/triggers';
import { Button, Seg, SliderRow, SwitchRow } from '@dnd/ui';
import { MapCard } from '../../shell/MapCard';
import { useSessionStore } from '../../session/store';
import { mapScale } from '../tokens/sight';
import { useLightCommit } from './lightCommit';
import { lightById } from './lights';
import { useLightSelection } from './selection';

const send = (action: string, payload: unknown): void => useSessionStore.getState().sendCommand('triggers', action, payload);

const FALLOFF = [
  { value: 'linear', label: 'Linear' },
  { value: 'quadratic', label: 'Quadratic' },
];

/** The light card (DM): beside the selected light, on and off, bright, dim, intensity, falloff, colour. */
export function LightCard() {
  const selectedId = useLightSelection((s) => s.selectedId);
  const light = useStore((s) => (selectedId ? lightById(s.layers, selectedId) : undefined));
  const mapData = useSessionStore((s) => s.mapData);
  const ftPerCell = useMemo(() => mapScale(mapData).value, [mapData]);
  const commit = useLightCommit(light?.id ?? null);
  if (!light || !selectedId) return null;
  const id = selectedId;
  return (
    <MapCard
      testId="light-card"
      title={light.name || 'Light'}
      at={() => {
        const l = lightById(useStore.getState().layers, id);
        return l ? { x: l.position.x, y: l.position.y } : null;
      }}
      onClose={() => useLightSelection.getState().select(null)}
    >
      <SwitchRow label="Light on" className="w-full" checked={light.visible} onCheckedChange={(visible) => commit({ visible }, true)} />
      <SliderRow
        label="Bright"
        className="w-full"
        value={Math.round(light.featherRadius * ftPerCell)}
        min={LIGHT_RADIUS_FT.min}
        max={LIGHT_RADIUS_FT.max}
        step={LIGHT_RADIUS_FT.step}
        format={(v) => `${v} ft`}
        onValueChange={(ft) => {
          const featherRadius = ft / ftPerCell;
          commit(featherRadius > light.radius ? { featherRadius, radius: featherRadius } : { featherRadius });
        }}
      />
      <SliderRow
        label="Dim"
        className="w-full"
        value={Math.round(light.radius * ftPerCell)}
        min={LIGHT_RADIUS_FT.min}
        max={LIGHT_RADIUS_FT.max}
        step={LIGHT_RADIUS_FT.step}
        format={(v) => `${v} ft`}
        onValueChange={(ft) => {
          const radius = ft / ftPerCell;
          commit(light.featherRadius > radius ? { radius, featherRadius: radius } : { radius });
        }}
      />
      <SliderRow
        label="Intensity"
        className="w-full"
        value={Math.round(light.intensity * 100)}
        min={0}
        max={100}
        format={(v) => `${v}%`}
        onValueChange={(v) => commit({ intensity: v / 100 })}
      />
      <Seg aria-label="Falloff" options={FALLOFF} value={light.falloff} onValueChange={(v) => commit({ falloff: v as LightEdit['falloff'] }, true)} />
      <div className="flex items-center justify-between gap-2">
        <input
          type="color"
          aria-label="Colour"
          data-testid="light-color"
          value={light.color}
          onChange={(e) => commit({ color: e.target.value }, true)}
          className="size-6 shrink-0 cursor-pointer rounded-key border border-line bg-panel"
        />
        <Button variant="ghost" size="sm" data-testid="light-reset" onClick={() => send('reset-light', { lightId: light.id })}>
          Reset
        </Button>
      </div>
    </MapCard>
  );
}

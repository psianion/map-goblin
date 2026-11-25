import { useMemo } from 'react';
import { useStore } from '@dnd/core/src/store/store';
import { LIGHT_RADIUS_FT } from '@dnd/core/src/store/lightPresets';
import type { LightEdit } from '@dnd/mechanics/triggers';
import { Button, Seg, SliderRow, SwitchRow } from '@dnd/ui';
import { MapCard } from '../../shell/MapCard';
import { useSessionStore } from '../../session/store';
import { mapScale } from '../tokens/sight';
import { useLightCommit } from './lightCommit';
import { lightById, sendSwitch, switchIdsOf } from './lights';
import { LightStatePictures } from './LightStatePictures';
import { lightPropOf } from '@dnd/core/src/assets/packCatalog';
import { groupName, lightGroups } from '@dnd/core/src/shared/lightSwitches';
import { lightStateOf, type LightState } from '@dnd/core/src/shared/propLights';
import type { Layer } from '@dnd/core/src/store/types';
import type { LightChild } from '@dnd/core/src/shared/types';
import { useLightSelection } from './selection';

const send = (action: string, payload: unknown): void => useSessionStore.getState().sendCommand('triggers', action, payload);

const FALLOFF = [
  { value: 'linear', label: 'Linear' },
  { value: 'quadratic', label: 'Quadratic' },
];

/** The pictures by state of the prop a light is attached to, when that prop is a brazier (it has an Embers picture). */
function brazierStates(layers: readonly Layer[], light: LightChild) {
  if (!light.attachedTo) return undefined;
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    const host = layer.children.find((c) => c.id === light.attachedTo);
    if (host?.childType !== 'asset') continue;
    const states = lightPropOf(host.assetId)?.states;
    return states?.embers ? states : undefined;
  }
  return undefined;
}

/**
 * On or off for this light and its group (`set-lights`), and for a brazier's State its embers
 * flag too, on this light alone: the group follows on or off only, as in the editor.
 */
function switchLight(layers: readonly Layer[], light: LightChild, state: LightState): void {
  const on = state !== 'off';
  const mates = switchIdsOf(layers, [light.id]).filter((id) => id !== light.id);
  if (state === 'off') sendSwitch([light.id], false);
  else sendSwitch([light.id], true, state === 'embers');
  sendSwitch(mates, on);
}

/** The light card (DM): beside the selected light, on and off (a brazier's Off, Embers and On as its pictures), its group, bright, dim, intensity, falloff, colour. */
export function LightCard() {
  const selectedId = useLightSelection((s) => s.selectedId);
  const light = useStore((s) => (selectedId ? lightById(s.layers, selectedId) : undefined));
  const mapData = useSessionStore((s) => s.mapData);
  const ftPerCell = useMemo(() => mapScale(mapData).value, [mapData]);
  const commit = useLightCommit(light?.id ?? null);
  const layers = useStore((s) => s.layers);
  if (!light || !selectedId) return null;
  const id = selectedId;
  const states = brazierStates(layers, light);
  const group = groupName(light.group);
  const mates = group ? (lightGroups(layers).find((g) => g.name === group)?.lights.length ?? 1) : 0;
  // A darkness source is not one of the table's lights to switch (`set-lights` refuses it): its own edit.
  const setOn = (visible: boolean) => (light.darkness ? commit({ visible }, true) : sendSwitch(switchIdsOf(layers, [light.id]), visible));
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
      {group && (
        <p className="truncate text-xs text-text-3" title={group} data-testid="light-group">
          Group: {group}, switches {mates} {mates === 1 ? 'light' : 'lights'}
        </p>
      )}
      {states ? (
        <LightStatePictures states={states} value={lightStateOf(light)} onPick={(s) => switchLight(layers, light, s)} />
      ) : (
        <SwitchRow label="Light on" className="w-full" checked={light.visible} onCheckedChange={setOn} />
      )}
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

// The prop card's Light section: the light's state as the prop's own pictures (Off, Embers,
// On), or Off and On for a prop whose picture never changes; Select light to jump to the
// light's card; Add a light for a light prop that has none.

import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { AddChildCommand, CompositeCommand } from '@/store/commands';
import { SecondaryButton, Seg, SettingRow } from '@dnd/ui';
import { lightForProp } from '@dnd/core/src/store/propEdits';
import { setLightFields } from '@dnd/core/src/store/lightCommands';
import { groupName } from '@dnd/core/src/shared/lightSwitches';
import { GroupRow } from '@/editor/families/environment/LightCardFields';
import { groupSelectIds } from '@/canvas/linkModel';
import type { LightState } from '@dnd/core/src/shared/propLights';
import type { Command, DungeonLayer } from '@/store/types';
import type { SettingProps } from '@/editor/registry/types';
import { pickedProps } from './propModel';
import { ON_OFF, propLightView, setPropLightState } from './propLightModel';
import { LightStateTiles } from './LightStateTiles';

/** Each bare light prop gets the light its preset gives, on its own layer, as one step. */
function addLights(propIds: readonly string[]): void {
  const layers = useStore.getState().layers;
  const cmds: Command[] = [];
  for (const id of propIds) {
    const layer = layers.find((l): l is DungeonLayer => l.type === 'dungeon' && l.children.some((c) => c.id === id));
    const prop = layer?.children.find((c) => c.id === id);
    const light = prop?.childType === 'asset' ? lightForProp(prop) : null;
    if (layer && light) cmds.push(new AddChildCommand('Add light', layer.id, light));
  }
  if (cmds.length > 0) undoManager.execute(cmds.length === 1 ? cmds[0]! : new CompositeCommand('Add light', cmds));
}

/** The attached lights put in group `name` (or out of any, for an empty name), as one step. */
function setGroup(lightIds: readonly string[], name: string): void {
  const next = groupName(name);
  const label = next ? 'Join group' : 'Leave group';
  const cmds = lightIds.map((id) => setLightFields(id, { group: next }, undefined, label)).filter((c): c is Command => c !== null);
  if (cmds.length > 0) undoManager.execute(cmds.length === 1 ? cmds[0]! : new CompositeCommand(label, cmds));
}

export function PropLightField(_props: SettingProps<null>) {
  // The lights live on any layer and switch without the prop changing: read them here.
  useStore((s) => s.packs.installedPacks);
  const layers = useStore((s) => s.layers);
  useStore(useShallow((s) => s.selection.selectedIds));
  const view = propLightView(layers, pickedProps());
  const lightIds = view.lights.map((l) => l.id);
  const groups = new Set(view.lights.map((l) => groupName(l.group) ?? ''));
  const sharedGroup = groups.size === 1 ? [...groups][0]! : '';
  return (
    <div className="flex flex-col gap-1.5" data-testid="prop-light">
      {view.lights.length > 0 &&
        (view.states ? (
          <LightStateTiles states={view.states} value={view.state} onPick={(s) => setPropLightState(lightIds, s)} />
        ) : (
          <SettingRow label="State">
            <Seg
              aria-label="State"
              value={view.state === 'mixed' ? '' : view.state === 'off' ? 'off' : 'on'}
              onValueChange={(v) => setPropLightState(lightIds, v as LightState)}
              options={ON_OFF}
            />
          </SettingRow>
        ))}
      {view.state === 'mixed' && view.lights.length > 0 && (
        <SettingRow label="Lights">
          <span className="text-[12px] text-text">Mixed</span>
        </SettingRow>
      )}
      {view.lights.length > 0 && (
        <GroupRow
          value={sharedGroup}
          onChange={(name) => setGroup(lightIds, name)}
          after={
            sharedGroup ? (
              <SecondaryButton className="shrink-0" onClick={() => useStore.getState().setSelectedIds(groupSelectIds(useStore.getState().layers, sharedGroup))}>
                Select group
              </SecondaryButton>
            ) : null
          }
        />
      )}
      <span className="flex gap-1.5">
        {view.lights.length > 0 && (
          <SecondaryButton onClick={() => useStore.getState().setSelectedIds(lightIds)}>
            {view.lights.length === 1 ? 'Select light' : 'Select lights'}
          </SecondaryButton>
        )}
        {view.bare.length > 0 && <SecondaryButton onClick={() => addLights(view.bare.map((p) => p.id))}>Add a light</SecondaryButton>}
      </span>
    </div>
  );
}


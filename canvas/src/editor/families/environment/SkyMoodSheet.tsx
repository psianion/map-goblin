// The Sky sheet: the map's Place, its sun and moon (Cast shadows and the orientation), and
// its Tint. Climate, Weather, Night sky and Time are gone; maps that carry them load without
// them. How the map is previewed lives on the status bar (Preview as), not here.
//
// Every change goes through the environment or ambient command; a drag on Orientation or
// in the tint picker folds into one undo step.

import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { SetAmbientLightCommand, SetEnvironmentSettingsCommand } from '@/store/commands';
import { environmentOf, type MapEnvironment } from '@dnd/core/src/shared/world';
import { Caption, ColourRow, PlaceTiles, SliderRow, SwitchRow } from '@dnd/ui';
import { runEdit } from '@/editor/families/design/cardWrites';
import { usePreview } from '@/editor/viewPrefs';

type EnvPatch = Pick<MapEnvironment, 'environment' | 'naturalLight' | 'orientation'>;

/** One environment step from what the map holds; with `coalesce`, a drag folds into one. */
function setEnv(after: EnvPatch, coalesce?: string): void {
  const map = useStore.getState().mapSettings as MapEnvironment;
  const keys = Object.keys(after) as (keyof EnvPatch)[];
  if (keys.every((k) => Object.is(map[k], after[k]))) return;
  const before = Object.fromEntries(keys.map((k) => [k, map[k]])) as EnvPatch;
  runEdit('Environment', [new SetEnvironmentSettingsCommand(before, after)], coalesce);
}

function setTint(c: string): void {
  const before = useStore.getState().mapSettings.ambientLight;
  if (before !== c) runEdit('Tint', [new SetAmbientLightCommand(before, c)], 'sky.tint');
}

export function SkyMoodSheet() {
  const map = useStore(
    useShallow((s) => ({
      environment: environmentOf(s.mapSettings),
      naturalLight: s.mapSettings.naturalLight === true,
      orientation: s.mapSettings.orientation ?? 0,
      tint: s.mapSettings.ambientLight,
    })),
  );
  const unlit = usePreview() === 'unlit';
  return (
    <div className="flex flex-col gap-2.5 px-3 pt-2.5 pb-3" data-testid="sky-mood">
      {unlit && <p className="text-[11px] text-text-3">Shown unlit. Pick a time under Preview as, on the status bar, to see these changes.</p>}
      <section className="flex flex-col gap-px" data-section="Place">
        <Caption className="mb-1.5">Place</Caption>
        <PlaceTiles wide value={map.environment} onPick={(v) => v && setEnv({ environment: v })} />
        <p className="mt-1.5 text-[11px] text-text-3">A level or a room can differ on its card.</p>
      </section>
      <section className="flex flex-col gap-px" data-section="Sun and moon">
        <Caption className="mb-1.5">Sun and moon</Caption>
        <SwitchRow label="Cast shadows" checked={map.naturalLight} onCheckedChange={(v) => setEnv({ naturalLight: v })} />
        <SliderRow
          label="Orientation"
          value={map.orientation}
          min={0}
          max={359}
          step={1}
          format={(v) => `${Math.round(v)}°`}
          onValueChange={(v) => setEnv({ orientation: v }, 'sky.orientation')}
        />
      </section>
      <section className="flex flex-col gap-px" data-section="Tint">
        <Caption className="mb-1.5">Tint</Caption>
        <ColourRow label="Colour" value={map.tint} onValueChange={setTint} />
      </section>
    </div>
  );
}

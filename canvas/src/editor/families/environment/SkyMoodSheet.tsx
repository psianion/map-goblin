// The Sky sheet: the map's Place, its sun and moon (Cast shadows and where the sun rises), and
// its Tint. Climate, Weather, Night sky and Time are gone; maps that carry them load without
// them. How the map is previewed lives on the status bar (Preview as), not here.
//
// Every change goes through the environment or ambient command; a drag on the sundial or in
// the tint picker folds into one undo step. Where the sun rises is set on the sundial over the
// canvas (`Sundial`); the sheet reads it out, and Left and Right on the readout turn it 45°.

import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { SetAmbientLightCommand, SetEnvironmentSettingsCommand } from '@/store/commands';
import { environmentOf, type MapEnvironment } from '@dnd/core/src/shared/world';
import { Caption, ColourRow, PlaceTiles, SwitchRow } from '@dnd/ui';
import { runEdit } from '@/editor/families/design/cardWrites';
import { usePreview } from '@/editor/viewPrefs';
import { riseLabel, turnSun } from './sundialModel';

type EnvPatch = Pick<MapEnvironment, 'environment' | 'naturalLight'>;

/** One environment step from what the map holds. */
function setEnv(after: EnvPatch): void {
  const map = useStore.getState().mapSettings as MapEnvironment;
  const keys = Object.keys(after) as (keyof EnvPatch)[];
  if (keys.every((k) => Object.is(map[k], after[k]))) return;
  const before = Object.fromEntries(keys.map((k) => [k, map[k]])) as EnvPatch;
  runEdit('Environment', [new SetEnvironmentSettingsCommand(before, after)]);
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
        <div
          role="slider"
          tabIndex={0}
          aria-label="Where the sun rises"
          aria-valuemin={0}
          aria-valuemax={359}
          aria-valuenow={Math.round(map.orientation)}
          aria-valuetext={riseLabel(map.orientation)}
          data-testid="sky-rise"
          className="flex min-h-7 w-[248px] items-center rounded-sm text-[12px] text-text-2 outline-none focus-visible:ring-1 focus-visible:ring-text"
          onKeyDown={(e) => {
            const step = e.key === 'ArrowLeft' ? -45 : e.key === 'ArrowRight' ? 45 : 0;
            if (step === 0) return;
            e.preventDefault();
            e.stopPropagation();
            turnSun(map.orientation + step);
          }}
        >
          {riseLabel(map.orientation)}
        </div>
      </section>
      <section className="flex flex-col gap-px" data-section="Tint">
        <Caption className="mb-1.5">Tint</Caption>
        <ColourRow label="Colour" value={map.tint} onValueChange={setTint} />
      </section>
    </div>
  );
}

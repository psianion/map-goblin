// The Sky and mood sheet, rebuilt around what renders (plan 6.4): Environment, Natural
// shadows and Orientation outdoors, the Mood tint, and Preview with Lit preview. Climate,
// Weather, Night sky and Time are gone; maps that carry them load without them.
//
// Every change goes through the environment or ambient command; a drag on Orientation or
// in the tint picker folds into one undo step.

import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { SetAmbientLightCommand, SetEnvironmentSettingsCommand } from '@/store/commands';
import { environmentOf, type Environment, type MapEnvironment } from '@dnd/core/src/shared/world';
import { Caption, ColourRow, Seg, SliderRow, SwitchRow } from '@/editor/components';
import { runEdit } from '@/editor/families/design/cardWrites';
import { setLitPreview, useLitPreview } from '@/editor/viewPrefs';

const ENVIRONMENTS: { value: Environment; label: string }[] = [
  { value: 'outdoor', label: 'Outdoor' },
  { value: 'indoor', label: 'Indoor' },
  { value: 'underground', label: 'Underground' },
];

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
  if (before !== c) runEdit('Mood tint', [new SetAmbientLightCommand(before, c)], 'sky.tint');
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
  const lit = useLitPreview();
  const outdoor = map.environment === 'outdoor';
  return (
    <div className="flex flex-col gap-2.5 px-3 pt-2.5 pb-3" data-testid="sky-mood">
      {!lit && <p className="text-[11px] text-text-3">Shown unlit. Turn on Lit preview below to see these changes.</p>}
      <section className="flex flex-col gap-px" data-section="Environment">
        <Caption className="mb-1.5">Environment</Caption>
        <Seg aria-label="Environment" className="mb-1.5 self-start" value={map.environment} options={ENVIRONMENTS} onValueChange={(v) => setEnv({ environment: v as Environment })} />
        {/* The sun only reaches an outdoor map. */}
        {outdoor && (
          <>
            <SwitchRow label="Natural shadows" checked={map.naturalLight} onCheckedChange={(v) => setEnv({ naturalLight: v })} />
            <SliderRow
              label="Orientation"
              value={map.orientation}
              min={0}
              max={359}
              step={1}
              format={(v) => `${Math.round(v)}°`}
              onValueChange={(v) => setEnv({ orientation: v }, 'sky.orientation')}
            />
          </>
        )}
      </section>
      <section className="flex flex-col gap-px" data-section="Mood tint">
        <Caption className="mb-1.5">Mood tint</Caption>
        <ColourRow label="Tint" value={map.tint} onValueChange={setTint} />
      </section>
      <section className="flex flex-col gap-px" data-section="Preview">
        <Caption className="mb-1.5">Preview</Caption>
        <SwitchRow label="Lit preview" checked={lit} onCheckedChange={setLitPreview} />
      </section>
    </div>
  );
}

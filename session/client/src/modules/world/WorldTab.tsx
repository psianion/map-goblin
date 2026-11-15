import { useEffect, useRef } from 'react';
import { useStore } from '@dnd/core/src/store/store';
import { sceneTriggersOf, worldOf, worldSkyOf, type TriggersState } from '@dnd/mechanics/triggers';
import { Button, SliderRow, SwitchRow, TimeTiles } from '@dnd/ui';
import { useModuleState, useSessionStore } from '../../session/store';
import { setDarknessPreview, setDmLit, useDarknessPreview, useDmLit } from './worldPrefs';

const send = (action: string, payload: unknown): void => useSessionStore.getState().sendCommand('triggers', action, payload);

/** Slider values go to the table this long after the hand stops. */
const COMMIT_MS = 300;

/** The Sky tab: the campaign's time of day, this scene's darkness, and the DM's lit view. */
export function WorldBody() {
  const triggers = useModuleState<TriggersState>('triggers');
  const state = triggers ?? { byScene: {} };
  const world = worldOf(state);
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const map = useStore((s) => s.mapSettings);
  const dmLit = useDmLit();
  const preview = useDarknessPreview();
  const stored = sceneId ? sceneTriggersOf(state, sceneId).darkness : undefined;
  // What Auto would read: the time of day with no slider on top.
  const autoDarkness = worldSkyOf(state, map, null).darkness;
  const auto = stored === undefined && preview === null;
  const darkness = preview ?? stored ?? autoDarkness;
  const darkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(darkTimer.current), []);
  // The thumb's value belongs to the scene it was dragged on.
  useEffect(() => () => setDarknessPreview(null), [sceneId]);

  return (
    <div className="flex flex-col gap-2" data-testid="world-body">
      <TimeTiles value={world.time} onPick={(time) => time !== world.time && send('set-world', { time })} />
      {sceneId && (
        <>
          <SliderRow
            label={auto ? 'Darkness · Auto' : 'Darkness'}
            className="w-full"
            value={Math.round(darkness * 100)}
            min={0}
            max={100}
            format={(v) => (v / 100).toFixed(2)}
            onValueChange={(v) => {
              setDarknessPreview(v / 100);
              clearTimeout(darkTimer.current);
              darkTimer.current = setTimeout(() => send('set-darkness', { sceneId, value: v / 100 }), COMMIT_MS);
            }}
          />
          <Button
            variant="ghost"
            size="xs"
            className="self-start"
            disabled={auto}
            data-testid="world-darkness-auto"
            onClick={() => {
              clearTimeout(darkTimer.current);
              setDarknessPreview(null);
              send('set-darkness', { sceneId, value: null });
            }}
          >
            Auto
          </Button>
          <SwitchRow label="Show me everything lit" className="w-full" checked={dmLit} onCheckedChange={setDmLit} />
        </>
      )}
    </div>
  );
}

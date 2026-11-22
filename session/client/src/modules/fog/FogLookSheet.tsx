// The Customise sheet for the fog's look: colour, wind, edge softness and torch glow, and under
// Advanced a tint and strength per layer. It writes the DM's per-scene override
// (`SceneFog.look`), never the map. While it is open the map is drawn as players see it, so the
// DM judges the cloud solid; closing puts back what the view was.
//
// Every dial is a slider or a colour drag, so changes merge into one patch and go out on a
// 150 ms trailing debounce rather than one command per pixel. A pending overlay shows each change
// at once and drops when the confirmed value catches up, or after 4 s for one never confirmed.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '@dnd/core/src/store/store';
import { DEFAULT_FOG_LOOK, FOG_LOOK_RANGES, type FogLayer, type FogLook } from '@dnd/core/src/shared/fogLook';
import { fogLookOf, type FogState } from '@dnd/mechanics/fog';
import { ColourPicker, ColourRow, Fold, SecondaryButton, Slider, SliderRow } from '@dnd/ui';
import { useModuleState, useSessionStore } from '../../session/store';
import { closeSheet } from '../../shell/sheets/registry';
import { SheetFrame } from '../../shell/sheets/SheetFrame';
import { useAsPlayers } from './asPlayers';
import { sceneFog } from './fog';

/** How long an unconfirmed change shows before the confirmed value takes over again. */
const PENDING_TIMEOUT_MS = 4000;
/** The trailing debounce every dial shares. */
const LOOK_DEBOUNCE_MS = 150;

/** The three layers, bottom to top, as the sheet names them. */
const LAYER_NAMES = ['Deck', 'Haze', 'Top'] as const;

const send = (look: Partial<FogLook> | null): void => useSessionStore.getState().sendCommand('fog', 'set-fog-look', { look });

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** A slider with the words for its two ends under it. */
function EndedSlider({ low, high, children }: { low: string; high: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {children}
      <div className="flex justify-between text-[10.5px] text-text-3" aria-hidden>
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

export function FogLookSheet() {
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const map = useStore((s) => s.mapSettings);
  const fogState = useModuleState<FogState>('fog');
  const scene = sceneFog(fogState, sceneId);
  const authored = map.fogLook ?? DEFAULT_FOG_LOOK;
  const confirmed = fogLookOf(scene, authored);
  const changed = !!scene.look && Object.keys(scene.look).length > 0;

  // Drawn as players see it while open; what the view was comes back on close.
  useEffect(() => {
    const before = useAsPlayers.getState().on;
    useAsPlayers.getState().set(true);
    return () => useAsPlayers.getState().set(before);
  }, []);

  const [pending, setPending] = useState<Partial<FogLook>>({});
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Patches queued by the debounce but not yet sent: a second dial touched inside the window
  // merges in, so the one trailing send carries both.
  const outstanding = useRef<Partial<FogLook>>({});
  useEffect(
    () => () => {
      clearTimeout(pendingTimer.current);
      clearTimeout(debounceTimer.current);
    },
    [],
  );
  const confirmedKey = JSON.stringify(confirmed);
  useEffect(() => {
    setPending((p) => {
      const caught = (Object.keys(p) as (keyof FogLook)[]).filter((k) => JSON.stringify(p[k]) === JSON.stringify(confirmed[k]));
      if (caught.length === 0) return p;
      const next = { ...p };
      for (const key of caught) delete next[key];
      return next;
    });
    // confirmedKey is the trigger; `confirmed` is a fresh object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmedKey]);

  const view: FogLook = { ...confirmed, ...pending };

  const apply = (patch: Partial<FogLook>): void => {
    setPending((p) => ({ ...p, ...patch }));
    clearTimeout(pendingTimer.current);
    pendingTimer.current = setTimeout(() => setPending({}), PENDING_TIMEOUT_MS);
    clearTimeout(debounceTimer.current);
    outstanding.current = { ...outstanding.current, ...patch };
    debounceTimer.current = setTimeout(() => {
      const merged = outstanding.current;
      outstanding.current = {};
      send(merged);
    }, LOOK_DEBOUNCE_MS);
  };

  const setLayer = (index: number, patch: Partial<FogLayer>): void => {
    const layers = view.layers.map((l, i) => (i === index ? { ...l, ...patch } : l)) as FogLook['layers'];
    apply({ layers });
  };

  const reset = (): void => {
    clearTimeout(pendingTimer.current);
    clearTimeout(debounceTimer.current);
    outstanding.current = {};
    setPending({});
    send(null);
  };

  return (
    <SheetFrame
      title="Fog look"
      onClose={closeSheet}
      testId="fog-look-sheet"
      footer={
        <div className="flex items-center justify-between border-t border-line px-3 py-2.5">
          <span className="text-[11px] text-text-3">Saved with this scene</span>
          <SecondaryButton disabled={!changed && Object.keys(pending).length === 0} data-testid="fog-look-reset" onClick={reset}>
            Back to default
          </SecondaryButton>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5 px-3 py-3.5">
        <ColourRow label="Colour" value={view.base} onValueChange={(base) => apply({ base })} className="w-full" />
        <EndedSlider low="Still" high="Racing">
          <SliderRow
            label="Wind"
            value={view.wind}
            {...FOG_LOOK_RANGES.wind}
            step={0.5}
            format={(v) => v.toFixed(1)}
            onValueChange={(wind) => apply({ wind })}
            className="w-full"
          />
        </EndedSlider>
        <EndedSlider low="Crisp" high="Feathered">
          <SliderRow
            label="Edge softness"
            value={view.fade}
            {...FOG_LOOK_RANGES.fade}
            step={0.5}
            format={(v) => `${v} cells`}
            onValueChange={(fade) => apply({ fade })}
            className="w-full"
          />
        </EndedSlider>
        <EndedSlider low="None" high="Light warms the fog">
          <SliderRow
            label="Torch glow"
            value={view.glow}
            {...FOG_LOOK_RANGES.glow}
            step={0.05}
            format={pct}
            onValueChange={(glow) => apply({ glow })}
            className="w-full"
          />
        </EndedSlider>
      </div>
      <div className="border-t border-line px-3 py-2">
        <Fold title="Advanced" summary="the three layers" className="w-full">
          <div className="grid grid-cols-[52px_24px_minmax(0,1fr)_34px] items-center gap-x-2 gap-y-2 py-1.5" data-testid="fog-look-layers">
            {view.layers.map((layer, i) => {
              const name = LAYER_NAMES[i]!;
              return (
                <div key={name} className="contents">
                  <span className="text-[12px] text-text">{name}</span>
                  <ColourPicker label={`${name} tint`} value={layer.tint} onValueChange={(tint) => setLayer(i, { tint })} />
                  <Slider
                    aria-label={`${name} strength`}
                    value={[layer.strength]}
                    {...FOG_LOOK_RANGES.strength}
                    step={0.05}
                    onValueChange={(next: number | readonly number[]) => setLayer(i, { strength: typeof next === 'number' ? next : next[0]! })}
                  />
                  <span className="text-right font-mono text-[11px] text-text">{pct(layer.strength)}</span>
                </div>
              );
            })}
          </div>
          <span className="pb-1 text-[10.5px] text-text-3">Each layer has a tint and a strength.</span>
        </Fold>
      </div>
    </SheetFrame>
  );
}

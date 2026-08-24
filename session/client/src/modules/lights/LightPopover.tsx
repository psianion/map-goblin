// The on-map fast path (M2 §5, mirrors `doors/DoorMenu.tsx`): the popover a light's own icon
// opens when clicked, positioned at the icon rather than the rail. `LightsPanel.tsx`'s rail
// popover only turns the icons on and reads the click (`LightEditor.ts`); every actual control
// lives here.
//
// Unlike a door, a light can move while selected (dragging is the whole point), so its anchor
// is read fresh off the store every animation frame rather than off a value captured when the
// selection was made — `DoorMenu`'s own rAF loop can get away with a stale door reference
// because a door never moves out from under it.

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useStore } from '@dnd/core/src/store/store';
import type { LightEdit } from '@dnd/mechanics/triggers';
import { worldToScreen } from '../../renderer/camera';
import {
  applyPlacement,
  boundsOf,
  FALLBACK_SIZE,
  NOTCH_LEFT_CLASS,
  NOTCH_REST,
  placeBeside,
} from '../../shell/anchor';
import { Segmented, Switch } from '../../components/controls';
import { useSessionStore } from '../../session/store';
import { mapScale } from '../tokens/sight';
import { ghostButtonClass } from '../tokens/tokensUi';
import { lightById, patchLightLocal } from './lights';
import { useLightSelection } from './selection';

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('triggers', action, payload);

// Slider bounds in feet, same numbers the canvas editor's own Light properties panel uses —
// world-unit equivalents are derived at render time from the map's own cell scale.
const MIN_RADIUS_FT = 5;
const MAX_RADIUS_FT = 300;

const sliderClass = 'w-full';

const FALLOFF_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'quadratic', label: 'Quadratic' },
] as const;

export function LightPopover() {
  const selectedId = useLightSelection((s) => s.selectedId);
  const light = useStore((s) => (selectedId ? lightById(s.layers, selectedId) : undefined));
  const mapData = useSessionStore((s) => s.mapData);
  const ftPerCell = useMemo(() => mapScale(mapData).value, [mapData]);

  const rootRef = useRef<HTMLDivElement>(null);
  const notchRef = useRef<HTMLSpanElement>(null);

  // A press on the map (away from a light icon, which `LightEditor` already turns into a new
  // selection before this ever sees the event) clears the selection — same discipline
  // `DoorMenu` uses, capture phase so it beats the token/door target-phase handlers.
  useEffect(() => {
    if (!light) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (rootRef.current?.contains(target)) return;
      if (target?.closest('[data-testid="game-canvas"]')) useLightSelection.getState().select(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [light]);

  // Re-read the light's own position every frame this is open, straight to the DOM — a light
  // can be mid-drag, so (unlike `DoorMenu`) this reads live store state each tick rather than a
  // value closed over when the effect last ran.
  useLayoutEffect(() => {
    if (!selectedId) return;
    let raf = 0;
    const tick = () => {
      const el = rootRef.current;
      const mapEl = document.querySelector<HTMLElement>('[data-testid="game-canvas"]');
      const current = lightById(useStore.getState().layers, selectedId);
      const screen = current ? worldToScreen(current.position.x, current.position.y) : null;
      if (el && mapEl && screen) {
        const map = mapEl.getBoundingClientRect();
        const size = { width: el.offsetWidth || FALLBACK_SIZE.width, height: el.offsetHeight || FALLBACK_SIZE.height };
        applyPlacement(el, notchRef.current, placeBeside(screen, size, boundsOf(map)));
        el.style.visibility = 'visible';
      } else if (el) {
        el.style.visibility = 'hidden';
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [selectedId]);

  if (!light) return null;

  const commit = (patch: LightEdit): void => send('set-light', { lightId: light.id, patch });

  return (
    <div
      ref={rootRef}
      data-testid="light-popover"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{ visibility: 'hidden' }}
      className="absolute z-toolbar flex w-[220px] flex-col gap-2 rounded-md border border-border-structure bg-surface-1 px-2.5 py-2 shadow-panel motion-safe:animate-panel-in"
    >
      <span ref={notchRef} aria-hidden className={NOTCH_LEFT_CLASS} style={{ top: NOTCH_REST }} />

      <div className="flex items-center justify-between gap-2">
        <span data-testid="light-name" className="min-w-0 flex-1 truncate text-xs text-text-primary">
          {light.name || 'Light'}
        </span>
        <Switch
          testId="light-visible"
          checked={light.visible}
          onToggle={() => {
            const visible = !light.visible;
            patchLightLocal(light.id, { visible });
            commit({ visible });
          }}
        >
          Light on
        </Switch>
      </div>

      <label className="flex flex-col gap-0.5 text-xs text-text-secondary">
        <span className="flex items-center justify-between">
          <span>Radius</span>
          <span className="text-text-muted">{Math.round(light.radius * ftPerCell)} ft</span>
        </span>
        <input
          type="range"
          data-testid="light-radius-slider"
          aria-label="Radius"
          min={MIN_RADIUS_FT / ftPerCell}
          max={MAX_RADIUS_FT / ftPerCell}
          step={MIN_RADIUS_FT / ftPerCell}
          value={light.radius}
          onChange={(e) => {
            const radius = Number(e.target.value);
            const patch: LightEdit = { radius };
            // Keep featherRadius ≤ the new radius, same as the canvas Light properties panel.
            if (light.featherRadius > radius) patch.featherRadius = radius;
            patchLightLocal(light.id, patch);
          }}
          onPointerUp={() => commit({ radius: light.radius, featherRadius: light.featherRadius })}
          onKeyUp={() => commit({ radius: light.radius, featherRadius: light.featherRadius })}
          className={sliderClass}
        />
      </label>

      <label className="flex flex-col gap-0.5 text-xs text-text-secondary">
        <span className="flex items-center justify-between">
          <span>Bright zone</span>
          <span className="text-text-muted">
            {light.radius > 0 ? Math.round((light.featherRadius / light.radius) * 100) : 0}%
          </span>
        </span>
        <input
          type="range"
          data-testid="light-feather-slider"
          aria-label="Bright zone"
          min={0}
          max={100}
          step={5}
          value={light.radius > 0 ? Math.round((light.featherRadius / light.radius) * 100) : 0}
          onChange={(e) => patchLightLocal(light.id, { featherRadius: (Number(e.target.value) / 100) * light.radius })}
          onPointerUp={() => commit({ featherRadius: light.featherRadius })}
          onKeyUp={() => commit({ featherRadius: light.featherRadius })}
          className={sliderClass}
        />
      </label>

      <label className="flex flex-col gap-0.5 text-xs text-text-secondary">
        <span className="flex items-center justify-between">
          <span>Intensity</span>
          <span className="text-text-muted">{Math.round(light.intensity * 100)}%</span>
        </span>
        <input
          type="range"
          data-testid="light-intensity-slider"
          aria-label="Intensity"
          min={0}
          max={1}
          step={0.01}
          value={light.intensity}
          onChange={(e) => patchLightLocal(light.id, { intensity: Number(e.target.value) })}
          onPointerUp={() => commit({ intensity: light.intensity })}
          onKeyUp={() => commit({ intensity: light.intensity })}
          className={sliderClass}
        />
      </label>

      {/* The one control the canvas's own Light properties panel had and this did not. Same
          two choices, same wording — a pool that runs out evenly or one that holds its core. */}
      <Segmented
        label="Falloff"
        testId="light-falloff"
        value={light.falloff}
        options={FALLOFF_OPTIONS}
        onPick={(falloff) => {
          patchLightLocal(light.id, { falloff });
          commit({ falloff });
        }}
      />

      <div className="flex items-center justify-between gap-2">
        {/* The platform's own colour input, same as the token light row (`TokenPanel.tsx`):
            it can only produce `#rrggbb`, already inside the server's hex validation. */}
        <input
          type="color"
          aria-label="Colour"
          data-testid="light-color"
          value={light.color}
          onChange={(e) => {
            patchLightLocal(light.id, { color: e.target.value });
            commit({ color: e.target.value });
          }}
          className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border-default bg-surface-1"
        />
        <button
          type="button"
          data-testid="light-reset"
          onClick={() => send('reset-light', { lightId: light.id })}
          className={ghostButtonClass}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

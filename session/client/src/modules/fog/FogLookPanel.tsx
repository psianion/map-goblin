// D7/WP2 — the DM's live fog-look override. World's own shape: a read-only provenance line
// naming what the map authored, and below it the live controls that write the DM's per-scene
// override (`SceneFog.look`) rather than re-authoring the map. "Use the map's default" is the
// clear — `{ look: null }` on the wire — back to whatever `effectiveFogLook` falls to without
// one.
//
// Debounce follows the brief rather than World's release-commit idiom: every dial here is a
// slider or a colour drag, and D7 asks for a time-based trailing debounce (150ms) so a drag
// sends a few commands instead of one per pixel, not World's "wait for pointerup" — a colour
// input fires no pointerup mid-drag in every browser. `preset` and `heavy` are the one-shot
// picks (segmented/toggle) and send immediately, same as World's segmented/switch controls do.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useStore } from '@dnd/core/src/store/store';
import { FOG_LAYER_TYPES, FOG_LOOK_PRESETS, type FogLayer, type FogLayerType, type FogLook } from '@dnd/core/src/shared/fogLook';
import { fogLookOf, sceneFogOf, type FogState } from '@dnd/mechanics/fog';
import { Segmented, Switch } from '../../components/controls';
import { Icon } from '../../shell/icons';
import { registerPanel } from '../../session/panels';
import { useModuleState, useSessionStore } from '../../session/store';
import { DEFAULT_FOG_LOOK, FOG_PRESETS } from './livingFog';

/** Same window WorldPanel gives a dropped/never-confirmed pick before the optimistic echo
 *  gives up and falls back to whatever the wire last confirmed. */
const PENDING_TIMEOUT_MS = 4000;
/** D7's own number — a trailing debounce, not a release commit (see file header). */
const DEBOUNCE_MS = 150;

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const PRESET_OPTIONS = FOG_LOOK_PRESETS.map((p) => ({ value: p, label: cap(p) }));
const LAYER_TYPE_OPTIONS = FOG_LAYER_TYPES.map((t) => ({ value: t, label: cap(t) }));

/** Whether the DM left the "Layers" disclosure open, remembered for the browser session —
 *  a module-level flag rather than a store, since `FogLookPanel` only ever exists once per
 *  seat and only while its popover is open (a fresh mount every open, per D8's `mount`
 *  contract), so a plain closure variable outlives that the same way a store would. */
let layersOpenForSession = false;

const send = (look: Partial<FogLook> | null): void =>
  useSessionStore.getState().sendCommand('fog', 'set-fog-look', { look });

/** One numeric dial — every slider on this panel is this row, just a different range. The
 *  visible `label` stays short ("Strength"); `ariaLabel` carries the fuller name a layer's
 *  dial needs ("Layer 2 strength") without cluttering the row.
 *
 *  `stacked` swaps the label from beside the slider to above it — a 2-up grid cell (a
 *  layer's four dials) is too narrow for "Direction" plus a usable track on one line, but
 *  has the height to spare for two. The always-visible Wind/Fade/Veil/Glow rows keep the
 *  label-beside default, full width, one per row. */
function Dial({
  testId,
  label,
  ariaLabel,
  value,
  min,
  max,
  step,
  onChange,
  stacked,
}: {
  testId: string;
  label: string;
  ariaLabel?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  stacked?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const input = (
    <input
      type="range"
      data-testid={testId}
      aria-label={ariaLabel ?? label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`slider-minimal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus ${stacked ? 'w-full' : 'min-w-0 flex-1'}`}
      style={{ '--slider-fill': `${pct}%`, accentColor: 'rgb(var(--text-primary))' } as CSSProperties}
    />
  );
  if (stacked) {
    return (
      <label className="flex min-h-6 flex-col justify-center gap-0.5 text-xs text-text-secondary">
        <span>{label}</span>
        {input}
      </label>
    );
  }
  return (
    <label className="flex min-h-6 items-center gap-2 text-xs text-text-secondary">
      <span className="w-14 shrink-0">{label}</span>
      {input}
    </label>
  );
}

/** A themed colour swatch: a bordered 24px box painted the current colour. The real
 *  `<input type="color">` sits underneath, sized to the swatch and invisible — it still
 *  takes the click, the keyboard focus, and the OS picker, so nothing about how the control
 *  works changes, only how it looks. `focus-within` puts the ring on the visible box instead
 *  of the (invisible) input, so a keyboard user still sees it land.
 *
 *  `hex` (default on) prints the value beside the box, in text-text-secondary. Off for a
 *  layer's tint — three of those, each already sharing a row with its "Layer N" name and a
 *  4-option type Segmented, is the difference between the row fitting the rail's width and
 *  not; the exact value is still a hover (`title`) and a click (the native picker) away.
 */
function ColorSwatch({
  testId,
  ariaLabel,
  value,
  onChange,
  hex = true,
}: {
  testId: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  hex?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        title={hex ? undefined : value.toUpperCase()}
        className="relative h-6 w-6 shrink-0 overflow-hidden rounded border border-border-default focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-border-focus"
        style={{ backgroundColor: value }}
      >
        <input
          type="color"
          data-testid={testId}
          aria-label={ariaLabel}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0 opacity-0"
        />
      </span>
      {hex && <span className="font-mono text-xs text-text-secondary">{value.toUpperCase()}</span>}
    </span>
  );
}

/** One cloud stratum: a heading row (name, its noise type, its tint) and its four dials
 *  indented under it — spacing, not a border, is what separates one layer from the next. */
function LayerRow({
  index,
  layer,
  onChange,
}: {
  index: number;
  layer: FogLayer;
  onChange: (layer: FogLayer) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-6 items-center gap-1.5">
        <span
          aria-hidden
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-default text-[10px] text-text-muted"
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <Segmented
            testId={`fog-look-layer-${index}-type`}
            label=""
            ariaLabel={`Layer ${index + 1} type`}
            value={layer.type}
            options={LAYER_TYPE_OPTIONS}
            onPick={(type: FogLayerType) => onChange({ ...layer, type })}
          />
        </div>
        <ColorSwatch
          testId={`fog-look-layer-${index}-tint`}
          ariaLabel={`Layer ${index + 1} tint`}
          value={layer.tint}
          onChange={(color) => onChange({ ...layer, tint: color })}
          hex={false}
        />
      </div>
      {/* 2-up: strength/scale, then speed/direction — half the height of one dial per row,
          and "Direction" still reads fine stacked over its slider at a ~150px column. */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 pl-[26px]">
        <Dial
          stacked
          testId={`fog-look-layer-${index}-strength`}
          label="Strength"
          ariaLabel={`Layer ${index + 1} strength`}
          value={layer.strength}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => onChange({ ...layer, strength: v })}
        />
        <Dial
          stacked
          testId={`fog-look-layer-${index}-scale`}
          label="Scale"
          ariaLabel={`Layer ${index + 1} scale`}
          value={layer.scale}
          min={0.2}
          max={8}
          step={0.1}
          onChange={(v) => onChange({ ...layer, scale: v })}
        />
        <Dial
          stacked
          testId={`fog-look-layer-${index}-speed`}
          label="Speed"
          ariaLabel={`Layer ${index + 1} speed`}
          value={layer.speed}
          min={0}
          max={0.3}
          step={0.005}
          onChange={(v) => onChange({ ...layer, speed: v })}
        />
        <Dial
          stacked
          testId={`fog-look-layer-${index}-angle`}
          label="Direction"
          ariaLabel={`Layer ${index + 1} direction`}
          value={layer.angle}
          min={0}
          max={360}
          step={5}
          onChange={(v) => onChange({ ...layer, angle: v })}
        />
      </div>
    </div>
  );
}

export function FogLookPanel() {
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const map = useStore((s) => s.mapSettings);
  const fogState = useModuleState<FogState>('fog');
  const [layersOpen, setLayersOpen] = useState(layersOpenForSession);

  const authored = map.fogLook ?? DEFAULT_FOG_LOOK;
  const scene = sceneId ? sceneFogOf(fogState ?? { byScene: {} }, sceneId) : null;
  const confirmed: FogLook = scene ? fogLookOf(scene, authored) : authored;
  const overridden = !!scene?.look && Object.keys(scene.look).length > 0;
  // What the map itself authored, not what the DM's override resolved to (`confirmed`/`view`
  // below) — the map can leave `fogLook` unset entirely, which reads differently from having
  // set one with no `preset` tag (a hand-tuned mix rather than a named look).
  const provenance = map.fogLook
    ? `From the map: ${authored.preset ? cap(authored.preset) : 'custom mix'}`
    : 'Default look, the map has not set one';

  // Optimistic echo, World's own pattern: a pick shows the instant it is clicked, and a
  // pending field is dropped once the confirmed value catches up to it (or after the
  // timeout, for a command the wire never confirmed). Deep-compared rather than `===`, since
  // `confirmed` is a fresh merge every render and `layers` is a nested array.
  const [pending, setPending] = useState<Partial<FogLook>>({});
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Patches queued by the debounce but not yet sent. A second dial touched inside the
  // debounce window merges into this instead of replacing the first dial's patch, so the
  // single trailing timeout sends both fields. An immediate send (preset/toggle) flushes
  // this into its own patch first so a debounced edit in flight is never dropped.
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
      const stale = (Object.keys(p) as (keyof FogLook)[]).filter(
        (k) => JSON.stringify(p[k]) === JSON.stringify(confirmed[k]),
      );
      if (stale.length === 0) return p;
      const next = { ...p };
      for (const key of stale) delete next[key];
      return next;
    });
    // confirmedKey is the whole point of the effect firing; confirmed itself is a fresh
    // object every render and would fire on every keystroke of an unrelated dial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmedKey]);

  const view: FogLook = { ...confirmed, ...pending };

  const apply = (patch: Partial<FogLook>, immediate: boolean): void => {
    setPending((p) => ({ ...p, ...patch }));
    clearTimeout(pendingTimer.current);
    pendingTimer.current = setTimeout(() => setPending({}), PENDING_TIMEOUT_MS);
    clearTimeout(debounceTimer.current);
    if (immediate) {
      // Merge behaviour: flush whatever the debounce was still holding into this one
      // command rather than firing two — the toggle/preset command carries the dial's
      // value too, and the stale debounce timeout is cancelled above so it can't re-fire.
      const merged = { ...outstanding.current, ...patch };
      outstanding.current = {};
      send(merged);
    } else {
      outstanding.current = { ...outstanding.current, ...patch };
      debounceTimer.current = setTimeout(() => {
        const merged = outstanding.current;
        outstanding.current = {};
        send(merged);
      }, DEBOUNCE_MS);
    }
  };

  const setLayer = (index: number, layer: FogLayer, immediate: boolean): void => {
    const layers = view.layers.map((l, i) => (i === index ? layer : l)) as FogLook['layers'];
    apply({ layers }, immediate);
  };

  const reset = (): void => {
    clearTimeout(pendingTimer.current);
    clearTimeout(debounceTimer.current);
    setPending({});
    send(null);
  };

  const toggleLayers = (): void => {
    layersOpenForSession = !layersOpen;
    setLayersOpen(layersOpenForSession);
  };

  if (!sceneId) {
    return <p className="text-sm text-text-secondary">Activate a scene to set its fog look.</p>;
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p data-testid="fog-look-provenance" className="text-xs text-text-muted">
        {provenance}
      </p>

      <div>
        <Segmented
          testId="fog-look-preset"
          label="Preset"
          ariaLabel="Preset"
          value={view.preset ?? null}
          options={PRESET_OPTIONS}
          onPick={(preset) => apply({ preset, layers: FOG_PRESETS[preset] }, true)}
        />
        {!view.preset && <p className="mt-1 text-xs text-text-muted">Custom mix</p>}
      </div>

      <div className="flex min-h-6 items-center gap-2 text-xs text-text-secondary">
        <span className="w-14 shrink-0">Mist base</span>
        <ColorSwatch
          testId="fog-look-base"
          ariaLabel="Mist base"
          value={view.base}
          onChange={(color) => apply({ base: color }, false)}
        />
      </div>

      <div>
        <button
          type="button"
          data-testid="fog-look-layers-toggle"
          aria-expanded={layersOpen}
          aria-controls="fog-look-layers"
          onClick={toggleLayers}
          className="flex min-h-6 items-center gap-1.5 rounded px-1 py-1 text-left text-xs text-text-secondary transition-colors duration-150 ease-out-quart hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none"
        >
          <Icon
            name="chevron"
            size={12}
            className={`shrink-0 transition-transform duration-150 ease-out-quart motion-reduce:transition-none ${layersOpen ? '' : '-rotate-90'}`}
          />
          Layers
        </button>
        {layersOpen && (
          // No scroll region of its own: Popover's anchor `recalc` now re-clamps `top` (and
          // so `maxHeight`) off the body's live `scrollHeight` (a `ResizeObserver`, not just
          // window resize), so opening this reclaims exactly the room three layers need —
          // Wind/Fade/Veil/Glow/Heavy fog/Reset stay reachable below it without this box
          // needing to clip itself.
          <div id="fog-look-layers" className="mt-1.5 flex flex-col gap-2">
            {view.layers.map((layer, i) => (
              <LayerRow key={i} index={i} layer={layer} onChange={(next) => setLayer(i, next, false)} />
            ))}
          </div>
        )}
      </div>

      <Dial testId="fog-look-wind" label="Wind" value={view.wind} min={0.5} max={12} step={0.5} onChange={(v) => apply({ wind: v }, false)} />
      <Dial testId="fog-look-fade" label="Fade" value={view.fade} min={1} max={4} step={0.1} onChange={(v) => apply({ fade: v }, false)} />
      <Dial testId="fog-look-veil" label="Veil" value={view.veil} min={0} max={0.5} step={0.01} onChange={(v) => apply({ veil: v }, false)} />
      <Dial testId="fog-look-glow" label="Glow" value={view.glow} min={0} max={1} step={0.05} onChange={(v) => apply({ glow: v }, false)} />

      <div>
        <Switch testId="fog-look-heavy" checked={view.heavy ?? false} onToggle={() => apply({ heavy: !(view.heavy ?? false) }, true)}>
          Heavy fog
        </Switch>
        <p className="mt-1 text-xs text-text-muted">Allows three smoke layers instead of one.</p>
      </div>

      {overridden && (
        <button
          type="button"
          data-testid="fog-look-reset"
          onClick={reset}
          className="rounded border border-border-default px-2 py-1 text-xs text-text-secondary transition-colors duration-150 ease-out-quart hover:bg-surface-2 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none"
        >
          Use the map's default
        </button>
      )}
    </div>
  );
}

registerPanel({
  id: 'fog-look',
  title: 'Fog look',
  icon: 'fog',
  // K — "looK": F is FogTool's, L is the Log's, both already claimed (see hotkeys.ts).
  key: 'K',
  group: 'prep',
  roles: ['dm'],
  order: 65,
  component: FogLookPanel,
  width: 360,
});

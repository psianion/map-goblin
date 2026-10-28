// What the Lights UI shows and writes, kept out of the components: feet and cells, the
// cone and the animation as the card reads them, the presets as tiles, and the status
// bar's lines for the Light tool, a selected light and the Sky & mood sheet. Every write
// goes through core's light commands, one undo step each.
import type { AnyChild, AssetChild, DungeonLayer, LightChild, MapBuilderStore } from '@/store/types';
import { selectChildById } from '@/store/selectors';
import { LIGHT_RADIUS_FT } from '@dnd/core/src/store/lightPresets';
import type { ToolHint } from './roomModel';

/* ── Units ──────────────────────────────────────────────── */

/** Cells to whole feet, at the map's scale. */
export const toFt = (cells: number, ftPerCell: number): number => Math.round(cells * ftPerCell);
/** Feet to cells, at the map's scale. */
export const toCells = (ft: number, ftPerCell: number): number => ft / (ftPerCell || 5);

/** A distance kept inside the one radius range (card, dock, menu, table), snapped to its step. */
export function clampFt(ft: number, range: { min: number; max: number; step: number } = LIGHT_RADIUS_FT): number {
  const snapped = Math.round(ft / range.step) * range.step;
  return Math.min(range.max, Math.max(range.min, snapped));
}

/* ── Shape and animation ────────────────────────────────── */

export const CONE_RANGE = { min: 10, max: 360, step: 5 } as const;
export const DIRECTION_RANGE = { min: 0, max: 359, step: 1 } as const;
export const SPEED_RANGE = { min: 0.25, max: 4, step: 0.05 } as const;
export const GLOW_STRENGTH_RANGE = { min: 0.1, max: 1, step: 0.01 } as const;

export type Effect = 'none' | 'flicker' | 'pulse';
export const EFFECTS: { value: Effect; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'flicker', label: 'Flicker' },
  { value: 'pulse', label: 'Pulse' },
];

/** The "Night only" switch's window on the sky's darkness. */
export const NIGHT_ONLY = { min: 0.5, max: 1 } as const;

type Shaped = Pick<LightChild, 'cone' | 'animation'>;

/** The cone as the card shows it: a full circle reads 360°, facing east. */
export function coneOf(light: Shaped): { angle: number; direction: number } {
  const angle = light.cone ? Math.min(360, Math.max(CONE_RANGE.min, light.cone.angle)) : 360;
  return { angle, direction: light.cone ? ((light.cone.direction % 360) + 360) % 360 : 0 };
}

/** A cone of 360° or none at all lights every way: Direction means nothing. */
export const isFullCircle = (light: Shaped): boolean => coneOf(light).angle >= 360;

export const effectOf = (light: Shaped): Effect => light.animation?.kind ?? 'none';
export const speedOf = (light: Shaped): number => light.animation?.speed ?? 1;

/** The animation a pick of `effect` leaves, keeping the speed already set. */
export function animationFor(effect: Effect, speed: number): LightChild['animation'] {
  return effect === 'none' ? undefined : { kind: effect, speed };
}

/* ── Attach ─────────────────────────────────────────────── */

/** Within half a cell of a prop's centre a light can be glued to it (the Light tool's rule). */
export const ATTACH_RADIUS = 0.5;

/** The prop a free light would attach to: the nearest on its layer within half a cell. */
export function nearestProp(layer: DungeonLayer, light: LightChild): AssetChild | null {
  let best: AssetChild | null = null;
  let bestDist = ATTACH_RADIUS;
  for (const c of layer.children) {
    if (c.childType !== 'asset') continue;
    const d = Math.hypot(c.position.x - light.position.x, c.position.y - light.position.y);
    if (d <= bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/** The prop a light is glued to, if it still exists. */
export function attachedProp(state: MapBuilderStore, light: LightChild): AnyChild | null {
  return light.attachedTo ? (selectChildById(state, light.attachedTo) ?? null) : null;
}

/* ── Status hints ───────────────────────────────────────── */

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

export const LIGHT_TOOL_HINT: ToolHint = {
  label: 'Light',
  segments: [t('click to place'), k('Wheel'), t('bright'), k('Shift'), t('+'), k('Wheel'), t('dim'), k('R'), t('rotate cone'), k('Esc'), t('done')],
};

export function lightSelectedHint(name: string): ToolHint {
  return { label: name, segments: [k('Del'), t('delete'), k('Ctrl'), t('+'), k('D'), t('duplicate')] };
}

export const SKY_HINT: ToolHint = {
  label: 'Sky & mood',
  segments: [t('changes save to the map; preview rows do not')],
};

/** The one light selected on its own, with its layer, or null. */
export function soleLight(s: Pick<MapBuilderStore, 'layers' | 'selection'>): { light: LightChild; layer: DungeonLayer } | null {
  if (s.selection.selectedIds.length !== 1) return null;
  const id = s.selection.selectedIds[0];
  for (const l of s.layers) {
    if (l.type !== 'dungeon') continue;
    const c = l.children.find((x) => x.id === id);
    if (c) return c.childType === 'light' ? { light: c, layer: l } : null;
  }
  return null;
}

/**
 * The bar's line for the lighting UI: the Sky & mood sheet while it is open, the Light tool
 * in hand, else the one selected light. Null when none applies.
 */
export function lightHintFor(s: MapBuilderStore, skyOpen = false): ToolHint | null {
  if (skyOpen) return SKY_HINT;
  if (s.tools.activeTool === 'light') return LIGHT_TOOL_HINT;
  const sole = soleLight(s);
  return sole ? lightSelectedHint(sole.light.name || 'Light') : null;
}

/* ── Clock ──────────────────────────────────────────────── */

/** 24-hour clock. */
export const hhmm = (minutes: number): string => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

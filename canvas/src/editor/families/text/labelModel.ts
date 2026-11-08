// Pure pieces the Label tool and the label card share: the size range, the style list,
// re-measuring a label's box as its text or look changes, and a style picked onto a label.

import { useStore } from '@/store/store';
import type { DungeonLayer, LabelStyleId, MapBuilderStore, TextChild } from '@/store/types';
import { measureLabel } from '@dnd/core/src/engine/labelMetrics';
import { LABEL_SIZE_RANGE } from '@dnd/core/src/engine/tools/TextTool';
import { LABEL_STYLES, bindingFields, findBindTarget, labelStyle, styleLook } from '@dnd/core/src/shared/labelStyles';

export { LABEL_SIZE_RANGE };

/** A style's id as a control holds it: Custom has none. */
export const CUSTOM = 'custom';
export type StyleChoice = LabelStyleId | typeof CUSTOM;

export const STYLE_OPTIONS: { value: StyleChoice; label: string }[] = LABEL_STYLES.map((s) => ({ value: s.id ?? CUSTOM, label: s.name }));

export const clampSize = (v: number) => Math.min(LABEL_SIZE_RANGE.max, Math.max(LABEL_SIZE_RANGE.min, Math.round(v * 10) / 10));

type Patch = Partial<TextChild>;

/** `patch` with the box it leaves the label in: text, size, weight and backdrop all move it. */
export function withBox(child: TextChild, patch: Patch): Patch {
  const next = { ...child, ...patch };
  return { ...patch, ...measureLabel(next.text, next.fontSize, next) };
}

/** The ink a label without a colour of its own takes: its layer's wall colour. */
export function inkOf(s: Pick<MapBuilderStore, 'layers' | 'ui'> = useStore.getState()): string {
  const layer = s.layers.find((l) => l.id === s.ui.activeLayerId);
  return layer?.type === 'dungeon' ? (layer as DungeonLayer).style.wallColor : '#222222';
}

/**
 * Style `choice` onto `child`: its look, and for Room name, Number pin and Door tag what it
 * follows (the room under it, the door beside it) with that one's text.
 */
export function stylePatch(child: TextChild, choice: StyleChoice, layerId: string): Patch {
  const style = labelStyle(choice === CUSTOM ? undefined : choice);
  const s = useStore.getState();
  const layer = s.layers.find((l) => l.id === layerId) as DungeonLayer | undefined;
  const look = styleLook(style, layer?.style.wallColor ?? child.color);
  const target = style.binds ? findBindTarget(style.binds, child.position, s.layers, layerId) : null;
  const { text, ...bind } = bindingFields(style.id, child.position, target);
  return withBox(child, { ...look, ...bind, ...(text !== undefined ? { text } : {}) });
}

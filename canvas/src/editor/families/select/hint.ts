// The Select tool's status line: with nothing picked, that, and what a box will grab when
// Pick only is on; with a pick, what it is and the keys that act on it.

import { resolveSelection, selectionTitle } from '@dnd/core/src/store/selectionResolve';
import type { MapBuilderStore } from '@/store/types';
import type { EditorState, HintLine } from '@/editor/registry/types';
import { PICK_CHIPS, pickOnlyBinding } from './pickOnly';
import { mergePlan } from './merge';
import { isFreestanding } from '@dnd/core/src/shared/freestandingDoor';
import type { DoorChild } from '@/store/types';
import { compareLayerIds } from '@/store/selectors';
import { levelLabel } from '@/editor/surfaces/model';
import { keyCaption } from '@/shortcuts/formatCombo';
import { lightsOnProp } from '@dnd/core/src/shared/lightSwitches';
import { lightPropOf } from '@dnd/core/src/assets/packCatalog';
import { linkModel } from '@/canvas/linkModel';

const t = (text: string) => ({ text });
const k = (text: string) => ({ text, key: true });

/** "· comparing with L1 Ground at 40%" while the compare pass draws another level. */
function compareSegment(s: MapBuilderStore): { text: string }[] {
  if (compareLayerIds(s).length === 0 || !s.ui.compare) return [];
  const { levelId, opacity } = s.ui.compare;
  const i = s.levels.findIndex((l) => l.id === levelId);
  return [t(`· comparing with ${levelLabel(i, s.levels.length, s.levels[i].name)} at ${Math.round(opacity * 100)}%`)];
}

/**
 * Over a light, or a prop with lights attached, what a double-click switches: "its light", or
 * the group it reaches ("Double-click to switch East hall, 3 lights"); a brazier's Embers is
 * on the card. "Locked" over one that will not switch. Null over anything else.
 */
export function lightPropHover(s: MapBuilderStore): HintLine | null {
  const id = s.selection.hoveredId;
  if (!id) return null;
  for (const layer of s.layers) {
    if (layer.type !== 'dungeon') continue;
    const child = layer.children.find((c) => c.id === id);
    if (child?.childType !== 'asset' && child?.childType !== 'light') continue;
    const lights = child.childType === 'asset' ? lightsOnProp(s.layers, child.id) : [child];
    if (lights.length === 0) return null;
    const line = (text: string): HintLine => ({ label: 'Select', segments: [t(text)] });
    if (child.locked || layer.locked || lights.every((l) => l.locked)) return line('Locked');
    const prop = child.childType === 'asset' ? child : layer.children.find((c) => c.id === child.attachedTo);
    const embers = prop?.childType === 'asset' && !!lightPropOf(prop.assetId)?.states?.embers ? ', Embers on the card' : '';
    const group = linkModel(s, child.id);
    if (group) return line(`Double-click to switch ${group.group}, ${group.lights} ${group.lights === 1 ? 'light' : 'lights'}${embers}`);
    return line(embers ? `Double-click to switch${embers}` : 'Double-click to switch its light');
  }
  return null;
}

/** A light fixed to a prop, picked on its own: dragging it carries the prop, the arrows move the light alone. */
function fixtureSegments(s: MapBuilderStore, ids: readonly string[]): { text: string; key?: boolean }[] {
  if (ids.length !== 1) return [];
  const light = s.layers.flatMap((l) => (l.type === 'dungeon' ? l.children : [])).find((c) => c.id === ids[0]);
  if (light?.childType !== 'light' || !light.attachedTo) return [];
  return [t('Drag moves the fixture, arrows move the light alone ·')];
}

/** "4 here, right-click to pick" while more than one object stands under the pointer (`selection.hoverCount`). */
export function crowdText(n: number | undefined): string | null {
  return n && n > 1 ? `${n} here, right-click to pick` : null;
}

/** `line` with the crowd count after it, when there is one. */
function withCrowd(s: MapBuilderStore, line: HintLine): HintLine {
  const crowd = crowdText(s.selection.hoverCount);
  return crowd ? { ...line, segments: [...line.segments, t(`· ${crowd}`)] } : line;
}

export function selectHint(state: EditorState): HintLine {
  const s = state as MapBuilderStore;
  return withCrowd(s, selectLine(s));
}

function selectLine(s: MapBuilderStore): HintLine {
  const state = s as unknown as EditorState;
  const hover = lightPropHover(s);
  if (hover) return hover;
  const ids = s.selection.selectedIds;
  if (ids.length === 0) {
    // A trace in hand: how see-through it is, and the key that hides and shows it.
    const trace = s.layers.find((l) => l.id === s.ui.activeLayerId);
    if (trace?.type === 'image') {
      const name = trace.name || 'Trace';
      return { label: 'Select', segments: [t(`${name} ${Math.round(trace.opacity * 100)}% ·`), k(keyCaption('view.traceToggle')), t('toggles the trace')] };
    }
    const chips = pickOnlyBinding.read(state);
    const names = PICK_CHIPS.filter((c) => chips.includes(c.id)).map((c) => c.label.toLowerCase());
    return {
      label: 'Select',
      segments: [t('Nothing picked'), ...(names.length ? [t(`· a box picks ${names.join(', ')}`)] : []), ...compareSegment(s)],
    };
  }
  const sel = resolveSelection(s, ids);
  const title = selectionTitle(sel.kinds) || 'Selection';
  const members = sel.children.length + sel.walls.length;
  if (members > 0 && sel.locked.length === members && sel.rooms.length === 0) {
    return { label: title, segments: [t(`${title} · locked, Unlock in the card`)] };
  }
  const editable = ids.length === 1 && (sel.walls.length === 1 || sel.children[0]?.child.childType === 'shape');
  // Two walls: whether Merge can join them, and why not when it cannot.
  const merge = mergePlan(state);
  const pair = merge ? [t(`${'refusal' in merge ? merge.refusal : 'touching at one point'} ·`)] : [];
  const only = ids.length === 1 ? sel.children[0] : undefined;
  const free = only?.child.childType === 'door' && isFreestanding(only.layer, only.child as DoorChild) ? [t('freestanding ·')] : [];
  const below = only?.child.childType === 'asset' && only.child.belowWater ? [t('below water ·')] : [];
  return {
    label: title,
    segments: [t(`${title} ·`), ...pair, ...free, ...below, ...fixtureSegments(s, ids), ...(editable ? [k('N'), t('nodes ·')] : []), k('Del'), t('delete')],
  };
}

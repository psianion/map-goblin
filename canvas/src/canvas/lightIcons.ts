// View > Light icons: whether the editor's canvas draws the light and darkness bulbs. Off, the
// bulbs go and so do their click targets (a click, a hover, a marquee), so nothing invisible
// can be picked; a prop with lights attached still switches them on a double-click, and the
// Layers sheet still lists every light. Two things keep their bulbs while it is off: the Light
// tool in hand (placing and editing lights is the point), and a light already selected (its
// marker and handles stay with it). The table and the export never read this.

import type { LightChild } from '@/store/types';
import { useStore } from '@/store/store';
import type { LightingRenderer } from '@dnd/core/src/engine/lighting/LightingRenderer';
import { setLightPicking } from '@dnd/core/src/engine/hitTest';
import { getLightIcons, subscribeLightIcons } from '@/editor/viewPrefs';

/** Which bulbs show: all of them, or only the ones named. */
export interface LightIconRule {
  all: boolean;
  only: ReadonlySet<string>;
}

const NONE: ReadonlySet<string> = new Set();

/** The rule for the pref, the tool in hand and the selection. */
export function lightIconRule(shown: boolean, activeTool: string, selectedIds: readonly string[]): LightIconRule {
  if (shown || activeTool === 'light') return { all: true, only: NONE };
  return { all: false, only: new Set(selectedIds) };
}

/** Whether `light` shows its bulb, and so can be picked, under `rule`. */
export const showsIcon = (rule: LightIconRule, light: Pick<LightChild, 'id'>): boolean => rule.all || rule.only.has(light.id);

/**
 * Keeps the renderer's bulbs and the pick rule in step with the pref, the tool and the
 * selection. Call once where the editor mounts its overlays; the returned function undoes it.
 */
export function mountLightIcons(renderer: Pick<LightingRenderer, 'setIconsVisible'>): () => void {
  let last: string | null = null;
  let inputs: unknown[] = [];
  let rule: LightIconRule = { all: true, only: NONE };
  const apply = (): void => {
    const s = useStore.getState();
    // Every store change lands here: three reads decide whether anything is left to do.
    const now = [getLightIcons(), s.tools.activeTool, s.selection.selectedIds];
    if (now.every((v, i) => v === inputs[i])) return;
    inputs = now;
    const next = lightIconRule(getLightIcons(), s.tools.activeTool, s.selection.selectedIds);
    const key = next.all ? 'all' : `only:${[...next.only].join(',')}`;
    if (key === last) return;
    last = key;
    rule = next;
    renderer.setIconsVisible(next.all, [...next.only]);
  };
  setLightPicking((light) => showsIcon(rule, light));
  apply();
  const unsubPref = subscribeLightIcons(apply);
  const unsubStore = useStore.subscribe(apply);
  return () => {
    unsubPref();
    unsubStore();
    setLightPicking(null);
  };
}

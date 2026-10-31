import type { MapBuilderStore } from '@/store/types';
import { resolveSelection, selectionTitle } from '@dnd/core/src/store/selectionResolve';
import type { ToolHint } from './roomModel';

/** The Select tool's line for a selection that is all locked; it outranks every kind's own line. */
export const SELECT_LOCKED_TEXT = 'Locked · Unlock in the card';

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

/**
 * The Select tool's status line: with nothing selected, what a click, a drag and the held
 * keys do; with a selection, its title and the keys that act on it; with only locked
 * members, how to get them back. Null for every other tool and inside a node edit.
 */
export function selectHintFor(state: MapBuilderStore): ToolHint | null {
  if (state.tools.activeTool !== 'select') return null;
  if (state.tools.nodeEditWallId || state.tools.shapeNodeEditId) return null;
  const ids = state.selection.selectedIds;
  if (ids.length === 0) {
    return {
      label: 'Select',
      segments: [t('Click select · Drag marquee'), k('Shift'), t('add'), k('Alt'), t('subtract'), k('Alt'), t('+ click next below')],
    };
  }
  const sel = resolveSelection(state, ids);
  const members = sel.children.length + sel.walls.length;
  const title = selectionTitle(sel.kinds) || 'Selection';
  if (members > 0 && sel.locked.length === members && sel.rooms.length === 0) {
    return { label: title, segments: [t(SELECT_LOCKED_TEXT)] };
  }
  return {
    label: title,
    segments: [
      t('Arrows nudge'),
      k('Shift'),
      t('+'),
      k('R'),
      t('rotate'),
      k('Ctrl'),
      t('+'),
      k('D'),
      t('duplicate'),
      k('Alt'),
      t('+ drag copy'),
      k('Del'),
      t('delete'),
    ],
  };
}

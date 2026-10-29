// What the status bar says for the Props tool and for selected props. Pure: the store
// state and the running stroke's counts come in, a hint line goes out.
import { propField } from '@dnd/core/src/shared/propFields';
import type { MapBuilderStore } from '@/store/types';
import type { ToolHint } from './roomModel';
import { resolvePropTarget } from './selectionModel';

/** The counts of the scatter stroke under way (`strokeStatus()` of the Props tool). */
export interface PropStroke {
  placed: number;
  skippedOverlap: number;
  skippedFloor: number;
  noFloor: boolean;
}

const k = (text: string) => ({ text, key: true });
const t = (text: string) => ({ text });

export const STAMP_HINT: ToolHint = {
  label: 'Stamp',
  segments: [
    t('click to place'),
    k('Wheel'),
    t('rotate 15°'),
    k('Alt'),
    t('+wheel scale'),
    k('Shift'),
    t('+wheel variant · right-click 90°'),
    k('F'),
    t('mirror'),
    k('Ctrl'),
    t('+wheel zoom'),
    k('Esc'),
    t('done'),
  ],
};

export const SCATTER_HINT: ToolHint = {
  label: 'Scatter',
  segments: [t('drag to paint · one undo per stroke'), k('E'), t('erase'), k('Esc'), t('cancel stroke')],
};

export const ERASE_HINT: ToolHint = {
  label: 'Erase',
  segments: [t('drag over props to erase · images and cave rock are kept'), k('E'), t('back to placing')],
};

/** "12 placed · 4 skipped (overlap 3, off floor 1)", while a scatter stroke runs. */
export function strokeText(stroke: PropStroke): string {
  const skipped = stroke.skippedOverlap + stroke.skippedFloor;
  const why = [
    stroke.skippedOverlap ? `overlap ${stroke.skippedOverlap}` : '',
    stroke.skippedFloor ? `off floor ${stroke.skippedFloor}` : '',
  ].filter(Boolean);
  const base = `${stroke.placed} placed`;
  return skipped > 0 ? `${base} · ${skipped} skipped (${why.join(', ')})` : base;
}

export function scatterStrokeHint(stroke: PropStroke): ToolHint {
  const text = stroke.noFloor ? `${strokeText(stroke)} · No floor on this layer: Stay on floors is off` : strokeText(stroke);
  return { label: 'Scatter', segments: [t(text), k('Esc'), t('cancel stroke')] };
}

export function propSelectedHint(name: string, locked: boolean): ToolHint {
  if (locked) return { label: name, segments: [t('Locked: right-click to unlock')] };
  return {
    label: name,
    segments: [
      k('Ctrl'),
      t('+'),
      k(']'),
      t('forward'),
      k('Ctrl'),
      t('+'),
      k('Shift'),
      t('+'),
      k(']'),
      t('front'),
      k('Shift'),
      t('+'),
      k('H'),
      t('mirror'),
      k('Del'),
      t('delete'),
    ],
  };
}

export function propsSelectedHint(count: number): ToolHint {
  return {
    label: `${count} props`,
    segments: [
      k('Shift'),
      t('+click add or remove'),
      k('Ctrl'),
      t('+'),
      k('G'),
      t('group'),
      k('Del'),
      t(`delete all ${count}`),
      k('Esc'),
      t('deselect'),
    ],
  };
}

export function propGroupHint(name: string, members: number): ToolHint {
  return {
    label: `${name} · ${members} props`,
    segments: [
      k('Ctrl'),
      t('+'),
      k('Shift'),
      t('+click one member'),
      k('Del'),
      t(`delete all ${members}`),
      k('Esc'),
      t('deselect'),
    ],
  };
}

/**
 * The bar's line for the Props tool in hand (stamp, scatter, the stroke under way, erase),
 * else for selected props. Null when neither applies.
 */
export function propHintFor(s: MapBuilderStore, stroke: PropStroke | null = null): ToolHint | null {
  if (s.tools.activeTool === 'scatterBrush') {
    if (s.tools.eraseMode) return ERASE_HINT;
    if (s.tools.settings.scatterBrush.stampMode) return STAMP_HINT;
    return stroke ? scatterStrokeHint(stroke) : SCATTER_HINT;
  }
  const target = resolvePropTarget(s, s.selection.selectedIds);
  if (!target) return null;
  if (target.kind === 'prop') return propSelectedHint(target.child.name || 'Prop', propField(target.child, 'locked'));
  if (target.kind === 'props') return propsSelectedHint(target.children.length);
  return propGroupHint(target.group.name, target.members.length);
}

// The stair kit tiles: the stairs card's Kit row, and the Door tool's Kit column with the Stairs style.

import { useMemo } from 'react';
import { useStore } from '@/store/store';
import { DockColumn } from '@dnd/ui';
import type { SettingProps } from '@/editor/registry/types';
import { SwatchPicker, type Swatch } from '@/editor/SwatchPicker';
import { swatchLabel } from '@/editor/swatchLabel';
import { DEFAULT_STAIRS, pickedStairs, pickStairKit, stairKitSwatches } from './stairsModel';
import { DoorKitColumn } from './DoorFields';
import { SelectionPanel } from '@/editor/families/select/SelectionPanel';
import { ToolPanel } from '@/editor/surfaces/ToolPanel';
import { useActiveTool } from '@/editor/surfaces/hooks';

/** The tiles for what is picked: Stone takes the colour of the picked stairs' cliff. */
function useStairSwatches(): Swatch[] {
  const key = useStore((s) => JSON.stringify(stairKitSwatches(pickedStairs(s)?.plateau.edgeArt)));
  return useMemo(() => JSON.parse(key) as Swatch[], [key]);
}

/** The stairs card's Kit: the default kit, Stone, then each kit an installed pack ships. */
export function StairKitField({ def, value, onChange }: SettingProps<string>) {
  const swatches = useStairSwatches();
  if (swatches.length === 0) return null;
  return <SwatchPicker label={swatchLabel(def)} name={def.label} swatches={swatches} value={value} onPick={onChange} twoLines />;
}

/** The Door tool's Kit column with the Stairs style: the picked stairs' kit, else the next stairs'. */
export function StairKitColumn() {
  const swatches = useStairSwatches();
  const value = useStore((s) => {
    const pick = pickedStairs(s);
    return (pick ? pick.span.kit : s.tools.settings.stairKit) ?? DEFAULT_STAIRS;
  });
  if (swatches.length < 2) return null;
  return (
    <DockColumn title="Kit" data-column="stairs-kit" data-testid="design-stairs-kit">
      <SwatchPicker name="Stair kit" swatches={swatches} value={value} onPick={pickStairKit} compact twoLines />
    </DockColumn>
  );
}

/** The Door tool's box beside the rail while something is picked: the stairs card for picked stairs, else its own panel. */
export function DoorSelectionPanel() {
  const stairs = useStore((s) => pickedStairs(s) !== null);
  const tool = useActiveTool();
  if (stairs) return <SelectionPanel />;
  return tool ? <ToolPanel tool={tool} /> : null;
}

/** The Door tool's Kit column: the stair kits with the Stairs style, else the door kits. */
export function KitColumn() {
  const stairs = useStore((s) => s.tools.settings.doorStairs === true);
  return stairs ? <StairKitColumn /> : <DoorKitColumn />;
}

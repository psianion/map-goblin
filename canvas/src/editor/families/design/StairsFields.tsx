// The stair kit tiles: the stairs card's Kit row, and the Door tool's Kit column with the Stairs style.
// The cave mouth tiles likewise: the cave mouth card's Kit row, and the Kit column with the Opening style.

import { useMemo } from 'react';
import { useStore } from '@/store/store';
import { DockColumn } from '@dnd/ui';
import type { SettingProps } from '@/editor/registry/types';
import { SwatchPicker, type Swatch } from '@/editor/SwatchPicker';
import { swatchLabel } from '@/editor/swatchLabel';
import { DEFAULT_STAIRS, pickedStairs, pickStairKit, stairKitSwatches } from './stairsModel';
import { entranceKitSwatches, entranceKitValue, pickedEntrance, pickEntranceKit } from './entranceModel';
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

/** The cave mouth tiles for what is picked, or for the next mouth with none picked. */
function useEntranceSwatches(): Swatch[] {
  const key = useStore((s) => JSON.stringify(entranceKitSwatches(s)));
  return useMemo(() => JSON.parse(key) as Swatch[], [key]);
}

/** The cave mouth card's Kit: its kit's mouths of its width, as pictures. */
export function EntranceKitField({ def, onChange }: SettingProps<string>) {
  const swatches = useEntranceSwatches();
  const value = useStore(entranceKitValue);
  if (swatches.length === 0) return null;
  return <SwatchPicker label={swatchLabel(def)} name={def.label} swatches={swatches} value={value} onPick={onChange} twoLines />;
}

/** The Door tool's Kit column with the Opening style: the picked mouth's piece, else the next mouth's, on a cliff whose kit has mouths. */
export function EntranceKitColumn() {
  const swatches = useEntranceSwatches();
  const value = useStore(entranceKitValue);
  if (swatches.length < 2) return null;
  return (
    <DockColumn title="Kit" data-column="entrance-kit" data-testid="design-entrance-kit">
      <SwatchPicker name="Cave mouth" swatches={swatches} value={value} onPick={pickEntranceKit} compact twoLines />
    </DockColumn>
  );
}

/** The Door tool's box beside the rail while something is picked: the stairs or cave mouth card for those, else its own panel. */
export function DoorSelectionPanel() {
  const stairs = useStore((s) => pickedStairs(s) !== null || pickedEntrance(s) !== null);
  const tool = useActiveTool();
  if (stairs) return <SelectionPanel />;
  return tool ? <ToolPanel tool={tool} /> : null;
}

/**
 * The Door tool's Kit column: the stair kits with the Stairs style; the cave mouths with a mouth
 * picked (a cliff's, or an Opening's on a wall with mouth pieces) or the Opening style last over an
 * edge whose rock lays them; else the door kits.
 */
export function KitColumn() {
  const stairs = useStore((s) => s.tools.settings.doorStairs === true);
  const mouths = useStore((s) => pickedEntrance(s) !== null || entranceKitSwatches(s).length > 1);
  return stairs ? <StairKitColumn /> : mouths ? <EntranceKitColumn /> : <DoorKitColumn />;
}

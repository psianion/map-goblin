import { useRef, useState, type ReactElement } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ColourRow, Seg, SettingRow, SwitchRow } from '@/editor/components';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { useStore } from '@/store/store';
import { selectActiveLayer } from '@/store/selectors';
import { LayerStyleChangeCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer, GridConfig } from '@/store/types';

type SnapDivision = GridConfig['snapDivision'];
const DIVISIONS: readonly SnapDivision[] = [1, 2, 3, 4, 6, 8];

/**
 * The grid chip's popover: show the grid, the colour of the active layer's grid lines, snap,
 * and how finely. These are view toggles, not map edits, so none of them goes through undo;
 * the line colour is a map edit, one undo step per visit, written when the popover closes.
 */
export function GridPopover({ trigger }: { trigger: ReactElement }) {
  const grid = useStore(useShallow((s) => ({ visible: s.grid.visible, snap: s.grid.snapEnabled, division: s.grid.snapDivision })));
  const layer = useStore((s) => {
    const l = selectActiveLayer(s);
    return l?.type === 'dungeon' ? (l as DungeonLayer) : null;
  });
  const [open, setOpen] = useState(false);
  // The line colour when this visit began, so the visit undoes as one step.
  const start = useRef<{ layerId: string; colour: string } | null>(null);

  const onOpenChange = (next: boolean) => {
    if (next && layer) start.current = { layerId: layer.id, colour: layer.style.wallColor };
    if (!next && start.current) {
      const { layerId, colour } = start.current;
      const now = (useStore.getState().layers.find((l) => l.id === layerId) as DungeonLayer | undefined)?.style.wallColor;
      if (now && now !== colour) undoManager.execute(new LayerStyleChangeCommand('Change grid lines colour', layerId, 'wallColor', colour, now));
      start.current = null;
    }
    setOpen(next);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent side="top" align="start" className="flex w-[264px] flex-col gap-px p-2" data-testid="shell-grid-popover">
        <SwitchRow label="Show grid" checked={grid.visible} onCheckedChange={(v) => useStore.getState().setGridVisible(v)} />
        {layer && (
          <ColourRow
            label="Grid lines"
            value={layer.style.wallColor}
            onValueChange={(c) => useStore.getState().updateLayer(layer.id, { style: { ...layer.style, wallColor: c } } as Partial<DungeonLayer>)}
          />
        )}
        <SwitchRow label="Snap" checked={grid.snap} onCheckedChange={(v) => useStore.getState().setSnapEnabled(v)} />
        <SettingRow label="Snap to">
          <Seg
            aria-label="Snap to"
            disabled={!grid.snap}
            value={String(grid.division)}
            onValueChange={(v) => useStore.getState().setSnapDivision(Number(v) as SnapDivision)}
            options={DIVISIONS.map((d) => ({ value: String(d), label: d === 1 ? '1' : `1/${d}` }))}
          />
        </SettingRow>
      </PopoverContent>
    </Popover>
  );
}

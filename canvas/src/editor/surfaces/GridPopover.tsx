import { useRef, useState, type ReactElement } from 'react';
import { useEscapeToClose } from '@/editor/useEscapeToClose';
import { useShallow } from 'zustand/react/shallow';
import { ColourRow, Seg, SettingRow, SwitchRow, Popover, PopoverContent, PopoverTrigger } from '@dnd/ui';
import { useStore } from '@/store/store';
import { selectActiveLayer } from '@/store/selectors';
import { CompositeCommand, LayerStyleChangeCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { gridColourLayerIds } from '@/editor/models/layerSheetModel';
import type { DungeonLayer, GridConfig } from '@/store/types';

type SnapDivision = GridConfig['snapDivision'];
const DIVISIONS: readonly SnapDivision[] = [1, 2, 3, 4, 6, 8];

const dungeonById = (id: string) => useStore.getState().layers.find((l): l is DungeonLayer => l.id === id && l.type === 'dungeon');

/**
 * The grid chip's popover: show the grid, the colour of the grid lines, snap, and how finely.
 * These are view toggles, not map edits, so none of them goes through undo; the line colour
 * is a map edit, one undo step per visit, written when the popover closes. The colour is the
 * active layer's, and it goes to the pictures' layers on the level too (gridColourLayerIds),
 * so the grid over a battlemap follows it.
 */
export function GridPopover({ trigger }: { trigger: ReactElement }) {
  const grid = useStore(useShallow((s) => ({ visible: s.grid.visible, snap: s.grid.snapEnabled, division: s.grid.snapDivision })));
  const layer = useStore((s) => {
    const l = selectActiveLayer(s);
    return l?.type === 'dungeon' ? (l as DungeonLayer) : null;
  });
  const [open, setOpen] = useState(false);
  // Each target layer's line colour when this visit began, so the visit undoes as one step.
  const start = useRef<Map<string, string> | null>(null);

  const onOpenChange = (next: boolean) => {
    if (next && layer) {
      const ids = gridColourLayerIds(useStore.getState().layers, layer);
      start.current = new Map(ids.flatMap((id) => {
        const l = dungeonById(id);
        return l ? [[id, l.style.wallColor] as const] : [];
      }));
    }
    if (!next && start.current) {
      const label = 'Change grid lines colour';
      const changes = [...start.current].flatMap(([id, colour]) => {
        const now = dungeonById(id)?.style.wallColor;
        return now && now !== colour ? [new LayerStyleChangeCommand(label, id, 'wallColor', colour, now)] : [];
      });
      if (changes.length > 0) undoManager.execute(changes.length === 1 ? changes[0] : new CompositeCommand(label, changes));
      start.current = null;
    }
    setOpen(next);
  };
  // Over a sheet, Escape closes this first: the sheet hears it only once the popover is gone.
  useEscapeToClose(open, () => onOpenChange(false));

  const setColour = (c: string) => {
    const store = useStore.getState();
    for (const id of start.current?.keys() ?? (layer ? [layer.id] : [])) {
      const l = dungeonById(id);
      if (l) store.updateLayer(id, { style: { ...l.style, wallColor: c } } as Partial<DungeonLayer>);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent side="top" align="start" className="flex w-[264px] flex-col gap-px p-2" data-testid="shell-grid-popover">
        <SwitchRow label="Show grid" checked={grid.visible} onCheckedChange={(v) => useStore.getState().setGridVisible(v)} />
        {layer && <ColourRow label="Grid lines" value={layer.style.wallColor} onValueChange={setColour} />}
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

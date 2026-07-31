import { useStore } from '@/store/store';
import { SelectInput } from '@/components/inputs/SelectInput';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { NumberInput } from '@/components/inputs/NumberInput';
import { PropertyField } from './PropertyField';
import type { DoorChild, DoorStyle, DoorState } from '@/shared/types';
import type { DungeonLayer } from '@/store/types';
import { UpdateChildCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { minDoorWidth } from '@dnd/core/src/engine/tools/DoorTool';

// V1 ships single + double only. Portcullis/archway still render and still
// deserialize from older files — they just can't be picked here any more.
const STYLE_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'double', label: 'Double' },
];

const STATE_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'locked', label: 'Locked' },
];

interface DoorPropertiesProps {
  layerId: string;
  childId: string;
}

export function DoorProperties({ layerId, childId }: DoorPropertiesProps) {
  const door = useStore((state) => {
    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer || layer.type !== 'dungeon') return null;
    const child = (layer as DungeonLayer).children.find((c) => c.id === childId);
    if (!child || child.childType !== 'door') return null;
    return child as DoorChild;
  });

  if (!door) return null;

  const update = (before: Partial<DoorChild>, after: Partial<DoorChild>) => {
    undoManager.execute(new UpdateChildCommand('Update door', layerId, childId, before, after));
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-panel-heading uppercase text-text-muted">Door Properties</span>

      <PropertyField label="Style">
        <SelectInput
          value={door.style}
          options={STYLE_OPTIONS}
          onChange={(v) => {
            // Switching to a wider style takes the width up with it — a double
            // door left at a single door's width has no room for two leaves.
            const style = v as DoorStyle;
            const width = Math.max(door.width, minDoorWidth(style));
            update({ style: door.style, width: door.width }, { style, width });
          }}
        />
      </PropertyField>

      <PropertyField label="State">
        <SelectInput
          value={door.state}
          options={
            door.style === 'archway'
              ? STATE_OPTIONS.filter((o) => o.value !== 'locked')
              : STATE_OPTIONS
          }
          onChange={(v) => update({ state: door.state }, { state: v as DoorState })}
        />
      </PropertyField>

      <PropertyField label="Secret">
        <ToggleSwitch
          checked={door.isSecret}
          onChange={(v: boolean) => update({ isSecret: door.isSecret }, { isSecret: v })}
          label="Secret door"
        />
      </PropertyField>

      <PropertyField label="Width">
        <NumberInput
          value={door.width}
          min={minDoorWidth(door.style)}
          max={4}
          step={0.25}
          // The spinner respects `min`, typing does not, so clamp here too.
          onChange={(v) =>
            update({ width: door.width }, { width: Math.max(v, minDoorWidth(door.style)) })
          }
        />
      </PropertyField>

    </div>
  );
}

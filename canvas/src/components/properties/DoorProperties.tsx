import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { SelectInput } from '@/components/inputs/SelectInput';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { NumberInput } from '@/components/inputs/NumberInput';
import { PropertyField } from './PropertyField';
import type { DoorChild, DoorStyle, DoorState } from '@/shared/types';
import type { DungeonLayer } from '@/store/types';
import { UpdateChildCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import {
  minDoorWidth,
  clampDoorWidth,
  doorStyleLabel,
  PLACEABLE_DOOR_STYLES,
} from '@dnd/core/src/engine/tools/DoorTool';
import { polylineLength, resolveDoors, resolveWalls } from '@dnd/core/src/shared/wallResolve';

// The same list the door tool places from, so a placed portcullis or archway
// can be recognised here and changed into something else.
const STYLE_OPTIONS = PLACEABLE_DOOR_STYLES.map((value) => ({
  value,
  label: doorStyleLabel(value),
}));

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
  // The host wall's length rides along with the door: every width the panel can
  // produce has to fit the opening, and only the resolved wall knows how long
  // that is.
  const { door, wallLength } = useStore(
    useShallow((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer || layer.type !== 'dungeon') return { door: null, wallLength: Infinity };
      const child = (layer as DungeonLayer).children.find((c) => c.id === childId);
      if (!child || child.childType !== 'door') return { door: null, wallLength: Infinity };
      const resolved = resolveDoors(layer, resolveWalls(layer)).find((r) => r.door.id === childId);
      return {
        door: child as DoorChild,
        // A detached door has no opening to fit — leave it unclamped.
        wallLength: resolved?.wall ? polylineLength(resolved.wall.points) : Infinity,
      };
    }),
  );

  // `null` = not being edited, so the field follows the door. Typing takes it
  // over until blur or Enter commits, the way renaming a room works.
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  if (!door) return null;

  const update = (before: Partial<DoorChild>, after: Partial<DoorChild>) => {
    undoManager.execute(new UpdateChildCommand('Update door', layerId, childId, before, after));
  };

  const commitName = () => {
    const name = nameDraft?.trim();
    // An empty box means "I changed my mind", not "call it nothing" — a door
    // with no name is a blank row in the table's door list.
    if (name && name !== door.name) update({ name: door.name }, { name });
    setNameDraft(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-panel-heading uppercase text-text-muted">Door Properties</span>

      <PropertyField label="Name">
        <input
          type="text"
          aria-label="Door name"
          value={nameDraft ?? door.name}
          placeholder={doorStyleLabel(door.style)}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setNameDraft(null);
          }}
          className="min-w-0 rounded border border-border-default bg-surface-1 px-1 py-0.5 text-panel-body text-text-primary outline-none focus:border-border-focus"
        />
      </PropertyField>

      <PropertyField label="Style">
        <SelectInput
          value={door.style}
          options={STYLE_OPTIONS}
          onChange={(v) => {
            // Switching style resizes both ways: up so a double has room for two
            // leaves, and back down so a width the new style only had because the
            // old one demanded it cannot be left overhanging the opening.
            const style = v as DoorStyle;
            const width = clampDoorWidth(door.width, style, wallLength);
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
          max={Math.max(minDoorWidth(door.style), Math.min(4, wallLength))}
          step={0.25}
          // The spinner respects `min`/`max`, typing does not, so clamp here too.
          onChange={(v) =>
            update({ width: door.width }, { width: clampDoorWidth(v, door.style, wallLength) })
          }
        />
      </PropertyField>

    </div>
  );
}

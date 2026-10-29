import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { SelectInput } from '@/components/inputs/SelectInput';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { NumberInput } from '@/components/inputs/NumberInput';
import { SliderInput } from '@/components/inputs/SliderInput';
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

import { DEFAULT_OPEN_ANGLE, MAX_OPEN_ANGLE, isKitStyle } from '@dnd/core/src/assets/doorKits';

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
  /** Owning layer is locked or hidden — inspect, don't edit. */
  disabled?: boolean;
}

export function DoorProperties({ layerId, childId, disabled }: DoorPropertiesProps) {
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

  const updateChild = useStore((s) => s.updateChild);

  // `null` = not being edited, so the field follows the door. Typing takes it
  // over until blur or Enter commits, the way renaming a room works.
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  if (!door) return null;

  const wallDoor = door;
  const style: DoorStyle = door.style;

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
    // A disabled fieldset disables every control under it natively, so the
    // layer lock is one attribute rather than a `disabled` prop per input.
    // `contents` keeps it out of the layout.
    <fieldset disabled={disabled} className="contents">
    <div className="flex flex-col gap-2">
      <span className="font-mono text-panel-heading uppercase text-text-muted">Door Properties</span>

      <PropertyField label="Name">
        <input
          type="text"
          aria-label="Door name"
          value={nameDraft ?? door.name}
          placeholder={doorStyleLabel(style)}
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
          aria-label="Door style"
          value={style}
          options={STYLE_OPTIONS}
          onChange={(v) => {
            const next = v as DoorStyle;
            // Switching style resizes both ways: up so a double has room for two
            // leaves, and back down so a width the new style only had because the
            // old one demanded it cannot be left overhanging the opening.
            const width = clampDoorWidth(wallDoor.width, next, wallLength);
            update({ style: wallDoor.style, width: wallDoor.width }, { style: next, width });
          }}
        />
      </PropertyField>

      {/* An archway cannot be shut — nothing downstream can express it — so the
          row is not there to promise otherwise. */}
      {style !== 'archway' && (
        <PropertyField label="State">
          <SelectInput
            aria-label="Door state"
            value={door.state}
            options={STATE_OPTIONS}
            onChange={(v) => update({ state: door.state }, { state: v as DoorState })}
          />
        </PropertyField>
      )}

      <PropertyField label="Secret">
        <ToggleSwitch
          checked={door.isSecret}
          onChange={(v: boolean) => update({ isSecret: door.isSecret }, { isSecret: v })}
          label="Secret door"
        />
      </PropertyField>

      {wallDoor && (
        <PropertyField label="Width">
          <NumberInput
            value={wallDoor.width}
            min={minDoorWidth(style)}
            max={Math.max(minDoorWidth(style), Math.min(4, wallLength))}
            step={0.25}
            // The spinner respects `min`/`max`, typing does not, so clamp here too.
            onChange={(v) =>
              update({ width: wallDoor.width }, { width: clampDoorWidth(v, style, wallLength) })
            }
          />
        </PropertyField>
      )}

      {/* How a hinged door opens. The angle is where it stands when its state is
          open, up to folded flat against the wall; dragging previews it live and
          lands as one undo step on release. */}
      {wallDoor && isKitStyle(style) && (
        <>
          <PropertyField label="Opens to">
            <SliderInput
              ariaLabel="Open angle"
              value={wallDoor.openAngle ?? DEFAULT_OPEN_ANGLE}
              min={0}
              max={MAX_OPEN_ANGLE}
              step={5}
              unit="°"
              onChange={(v) => updateChild(layerId, childId, { openAngle: v })}
              onChangeCommit={(v, start) => update({ openAngle: start }, { openAngle: v })}
            />
          </PropertyField>

          {style === 'single' && (
            <PropertyField label="Hinge">
              <ToggleSwitch
                checked={wallDoor.hinge === 'end'}
                onChange={(v: boolean) =>
                  update({ hinge: wallDoor.hinge }, { hinge: v ? 'end' : 'start' })
                }
                label="Hinge on the other edge"
              />
            </PropertyField>
          )}

          <PropertyField label="Swing">
            <ToggleSwitch
              checked={wallDoor.swing === -1}
              onChange={(v: boolean) => update({ swing: wallDoor.swing }, { swing: v ? -1 : 1 })}
              label="Swing to the other side"
            />
          </PropertyField>

          <PropertyField label="Hinges">
            <ToggleSwitch
              checked={wallDoor.hinges !== false}
              onChange={(v: boolean) => update({ hinges: wallDoor.hinges }, { hinges: v })}
              label="Show hinge hardware"
            />
          </PropertyField>
        </>
      )}

    </div>
    </fieldset>
  );
}

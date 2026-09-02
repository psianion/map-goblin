import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { SelectInput } from '@/components/inputs/SelectInput';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { NumberInput } from '@/components/inputs/NumberInput';
import { PropertyField } from './PropertyField';
import type { ConnectorChild, DoorChild, DoorStyle, DoorState } from '@/shared/types';
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
import { connectorKindForStyle } from '@dnd/core/src/shared/authoredRooms';

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
  // that is. A door drawn as a blob between two rooms has no host wall at all —
  // it is the same concept on a different anchor, so it wears the same panel.
  const { door, wallLength } = useStore(
    useShallow((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer || layer.type !== 'dungeon') return { door: null, wallLength: Infinity };
      const child = (layer as DungeonLayer).children.find((c) => c.id === childId);
      if (child?.childType === 'connector') {
        // Its size is the geometry the DM drew — nothing to fit, nothing to clamp.
        return { door: child as ConnectorChild, wallLength: Infinity };
      }
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

  // A wall door only — the blob has no width to fit and no wall to fit it to.
  const wallDoor = door.childType === 'door' ? door : null;
  // A blob drawn before styles were authoritative carries only its kind; read it
  // as the style that kind means, so the picker always has something to show.
  const style: DoorStyle =
    door.style ?? (door.childType === 'connector' && door.kind === 'arch' ? 'archway' : 'single');

  const update = (
    before: Partial<DoorChild | ConnectorChild>,
    after: Partial<DoorChild | ConnectorChild>,
  ) => {
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
            if (wallDoor) {
              // Switching style resizes both ways: up so a double has room for two
              // leaves, and back down so a width the new style only had because the
              // old one demanded it cannot be left overhanging the opening.
              const width = clampDoorWidth(wallDoor.width, next, wallLength);
              update({ style: wallDoor.style, width: wallDoor.width }, { style: next, width });
              return;
            }
            // On a blob the style is the authored truth and `kind` follows it. The
            // state follows what the tool would have placed — an arch is open, a
            // door that was an arch a moment ago reads shut — in the one undo entry.
            const state: DoorState =
              next === 'archway'
                ? 'open'
                : style === 'archway' && door.state === 'open'
                  ? 'closed'
                  : door.state;
            update(
              { style: door.style, kind: (door as ConnectorChild).kind, state: door.state },
              { style: next, kind: connectorKindForStyle(next), state },
            );
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

    </div>
    </fieldset>
  );
}

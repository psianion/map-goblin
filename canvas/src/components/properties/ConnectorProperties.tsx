import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { SelectInput } from '@/components/inputs/SelectInput';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { PropertyField } from './PropertyField';
import type { ConnectorChild, DoorState } from '@/shared/types';
import type { DungeonLayer } from '@/store/types';
import { UpdateChildCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';

const KIND_OPTIONS = [
  { value: 'arch', label: 'Arch' },
  { value: 'door', label: 'Door' },
];

const STATE_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'locked', label: 'Locked' },
];

interface ConnectorPropertiesProps {
  layerId: string;
  childId: string;
  /** Owning layer is locked or hidden — inspect, don't edit. */
  disabled?: boolean;
}

export function ConnectorProperties({ layerId, childId, disabled }: ConnectorPropertiesProps) {
  const connector = useStore(
    useShallow((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer || layer.type !== 'dungeon') return null;
      const child = (layer as DungeonLayer).children.find((c) => c.id === childId);
      return child?.childType === 'connector' ? (child as ConnectorChild) : null;
    }),
  );

  // `null` = not being edited, so the field follows the connector — the same
  // draft pattern DoorProperties uses.
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  if (!connector) return null;

  const update = (before: Partial<ConnectorChild>, after: Partial<ConnectorChild>) => {
    undoManager.execute(new UpdateChildCommand('Update connector', layerId, childId, before, after));
  };

  const commitName = () => {
    const name = nameDraft?.trim();
    if (name && name !== connector.name) update({ name: connector.name }, { name });
    setNameDraft(null);
  };

  const setKind = (kind: 'arch' | 'door') => {
    if (kind === connector.kind) return;
    // A joint just turned into a door should read shut, matching what the tool
    // places; flipping back to an arch leaves state alone (an arch ignores it).
    const state = kind === 'door' && connector.state === 'open' ? 'closed' : connector.state;
    update({ kind: connector.kind, state: connector.state }, { kind, state });
  };

  return (
    <fieldset disabled={disabled} className="contents">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-panel-heading uppercase text-text-muted">
          Connector Properties
        </span>

        <PropertyField label="Name">
          <input
            type="text"
            aria-label="Connector name"
            value={nameDraft ?? connector.name}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setNameDraft(null);
            }}
            className="min-w-0 rounded border border-border-default bg-surface-1 px-1 py-0.5 text-panel-body text-text-primary outline-none focus:border-border-focus"
          />
        </PropertyField>

        <PropertyField label="Kind">
          <SelectInput
            aria-label="Connector kind"
            value={connector.kind}
            options={KIND_OPTIONS}
            onChange={(v) => setKind(v as 'arch' | 'door')}
          />
        </PropertyField>

        {connector.kind === 'door' && (
          <PropertyField label="State">
            <SelectInput
              aria-label="Connector state"
              value={connector.state}
              options={STATE_OPTIONS}
              onChange={(v) => update({ state: connector.state }, { state: v as DoorState })}
            />
          </PropertyField>
        )}

        <PropertyField label="Secret">
          <ToggleSwitch
            checked={connector.isSecret}
            onChange={(v: boolean) => update({ isSecret: connector.isSecret }, { isSecret: v })}
            label="Secret passage"
          />
        </PropertyField>
      </div>
    </fieldset>
  );
}

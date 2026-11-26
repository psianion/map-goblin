// The Light tool's Groups list: one row per light group on the map, with its name, how many
// lights it switches (or how many of them are on while they differ), its switch, Select (every
// light of it, so the light card edits them together) and a rename pencil. A group switches
// together; it never moves together (attaching a light to a prop is what moves it).

import { useState } from 'react';
import { PencilLine } from 'lucide-react';
import { Caption, IconKeyButton, Input, SecondaryButton, Switch } from '@dnd/ui';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { lightGroups } from '@dnd/core/src/shared/lightSwitches';
import { renameGroupCommand, switchLightsCommand } from '@dnd/core/src/store/lightCommands';
import { useRegistry } from '@/editor/shell/registryContext';
import { pickTool } from '@/editor/surfaces/hooks';
import { groupRows, type GroupRowModel } from './lightModel';
import { selectGroup } from './lightEdits';
import type { Layer, LightChild } from '@/store/types';

/** Locked on its own or on a locked layer: a switch leaves it alone. */
function lockedOutOf(layers: readonly Layer[]): (l: LightChild) => boolean {
  const lockedOn = new Set<string>();
  for (const layer of layers) {
    if (layer.type === 'dungeon' && layer.locked) for (const c of layer.children) lockedOn.add(c.id);
  }
  return (l) => !!l.locked || lockedOn.has(l.id);
}

function switchGroup(row: GroupRowModel, on: boolean): void {
  // Locked lights, and lights on locked layers, stay as they are (`switchIds`).
  const cmd = switchLightsCommand(row.switchIds, { visible: on }, `Switch group ${row.name}`);
  if (cmd) undoManager.execute(cmd);
}

function GroupListRow({ row, onSelect }: { row: GroupRowModel; onSelect: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const land = () => {
    if (draft === null) return;
    const cmd = renameGroupCommand(row.name, draft);
    setDraft(null);
    if (cmd) undoManager.execute(cmd);
  };
  return (
    <div className="flex min-h-7 w-full min-w-0 items-center gap-1.5" data-testid="light-group-row" data-group={row.name}>
      {draft === null ? (
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="min-w-0 truncate text-[12px] text-text" title={row.name}>
            {row.name}
          </span>
          <span className="shrink-0 text-[11px] text-text-3 tabular-nums">{row.count}</span>
        </span>
      ) : (
        <Input
          aria-label={`New name for ${row.name}`}
          autoFocus
          className="min-w-0 flex-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={land}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setDraft(null);
          }}
        />
      )}
      {/* Mixed reads off; turning it on switches them all on. */}
      <Switch aria-label={`${row.name} on`} checked={row.on === 'all'} onCheckedChange={(on: boolean) => switchGroup(row, on)} />
      <SecondaryButton className="shrink-0" onClick={onSelect}>
        Select
      </SecondaryButton>
      <IconKeyButton size={26} icon={PencilLine} label={`Rename ${row.name}`} data-tip="Rename the group" onClick={() => setDraft(row.name)} />
    </div>
  );
}

/** Groups: every light group on the map, switched, picked or renamed from here. */
export function LightGroupsPanel() {
  const layers = useStore((s) => s.layers);
  const { registry } = useRegistry();
  const rows = groupRows(lightGroups(layers), lockedOutOf(layers));
  const select = (name: string) => {
    selectGroup(name);
    // The light card lives with Select: take it, so the picked group's card shows.
    const tool = registry.toolById('select');
    if (tool) pickTool(tool);
  };
  return (
    <div className="flex w-full min-w-0 flex-col gap-px" data-section="Groups" data-testid="light-groups">
      <Caption className="mb-1.5">Groups</Caption>
      {rows.length === 0 ? (
        <p className="text-[11px] text-text-3">No groups yet. Name a group on a light&apos;s card.</p>
      ) : (
        rows.map((row) => <GroupListRow key={row.name} row={row} onSelect={() => select(row.name)} />)
      )}
    </div>
  );
}

import { useRef, useState } from 'react';
import {
  ActionRow,
  Caption,
  FloatBox,
  PanelHeader,
  SecondaryButton,
  SettingRow,
  SwitchRow,
  Input,
} from '@dnd/ui';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { createDissolveGroupCommand, createRenameGroupCommand, SetGroupMergedCommand } from '@/store/commands';
import type { AnyChild, AssetChild, ChildGroupInfo, Command, DungeonLayer } from '@/store/types';
import { createSetPropFieldsCommand } from '@dnd/core/src/store/propEdits';
import { propFieldCount } from '@/editor/models/selectionModel';
import { VerbButton } from '@/editor/surfaces/Card';
import { liveVerbs } from '@/editor/surfaces/model';
import { SELECTION_VERBS } from './verbs';

function run(cmd: Command | null): void {
  if (cmd) undoManager.execute(cmd);
}

/** The group's name, edited in place: Enter or leaving keeps it, Escape puts the old one back. */
function GroupName({ layer, group }: { layer: DungeonLayer; group: ChildGroupInfo }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return (
    <Input
      className="w-[136px]"
      value={draft ?? group.name}
      aria-label="Group name"
      spellCheck={false}
      onFocus={() => {
        cancelled.current = false;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft?.trim();
        setDraft(null);
        if (cancelled.current || !next || next === group.name) return;
        run(createRenameGroupCommand(useStore.getState().layers, layer.id, group.id, next));
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * Every member of one group picked: its name, what it holds, whether a click takes the
 * whole group, Overhead and Lock over its props, and Ungroup. One undo step each.
 */
export function GroupCard({ group, layer, members }: { group: ChildGroupInfo; layer: DungeonLayer; members: AnyChild[] }) {
  const props = members.filter((c): c is AssetChild => c.childType === 'asset');
  const n = props.length;
  const editable = props.filter((c) => !c.locked).map((c) => c.id);
  const overhead = propFieldCount(props, 'overhead');
  const locked = propFieldCount(props, 'locked');
  const holds = members.length === n ? `${n} prop${n === 1 ? '' : 's'}` : `${members.length} objects, ${n} prop${n === 1 ? '' : 's'}`;
  const setFields = (ids: string[], patch: Partial<Pick<AssetChild, 'overhead' | 'locked'>>) => run(createSetPropFieldsCommand(ids, patch));
  return (
    <FloatBox className="flex w-[272px] flex-col overflow-hidden p-0" data-testid="shell-card" data-kind="group">
      <PanelHeader path={['Selection']} title={group.name}>
        <span className="inline-flex h-[22px] items-center rounded-pill border border-line px-2.5 text-[10px] text-text-2">{layer.name}</span>
      </PanelHeader>
      <ActionRow aria-label={`${group.name} actions`}>
        {liveVerbs(SELECTION_VERBS).map((v) => (
          <VerbButton key={v.id} verb={v} />
        ))}
      </ActionRow>
      <div className="flex flex-col gap-2.5 px-3 pt-2.5 pb-3">
        <div className="flex flex-col gap-px" data-section="">
          <SettingRow label="Name">
            <GroupName layer={layer} group={group} />
          </SettingRow>
          <SettingRow label="Members">
            <span className="font-mono text-[11px] text-text tabular-nums">{holds}</span>
          </SettingRow>
        </div>
        <div className="flex flex-col gap-px" data-section="Group">
          <Caption className="mb-1.5">Group</Caption>
          <SwitchRow label="Merged" checked={!!group.merged} onCheckedChange={(v) => run(new SetGroupMergedCommand(layer.id, group.id, v))} />
          <SwitchRow label="Overhead" checked={n > 0 && overhead === n} disabled={editable.length === 0} onCheckedChange={(v) => setFields(editable, { overhead: v })} />
          <SwitchRow label="Lock" checked={n > 0 && locked === n} onCheckedChange={(v) => setFields(props.map((c) => c.id), { locked: v })} />
        </div>
        <SecondaryButton
          className="self-start"
          onClick={() => run(createDissolveGroupCommand(useStore.getState().layers, layer.id, group.id))}
        >
          Ungroup
        </SecondaryButton>
      </div>
    </FloatBox>
  );
}

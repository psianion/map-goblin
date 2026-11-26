// The light card's rows for prop lights: the State tiles of the prop it is attached to, the
// Group row (a name, the map's groups as chips, Leave), the Motion kind with its icons, a
// spin's direction, and the line under a full circle's Cone.

import { useState } from 'react';
import { MoveHorizontal, PencilLine, RotateCcw, RotateCw, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { Button, Chip, IconKeyButton, Input, SecondaryButton, Seg, SettingRow } from '@dnd/ui';
import { getCatalogEntry } from '@dnd/core/src/assets/packCatalog';
import { selectChildById } from '@/store/selectors';
import { lightGroups } from '@dnd/core/src/shared/lightSwitches';
import { renameGroupCommand } from '@dnd/core/src/store/lightCommands';
import { MIXED } from '@/editor/surfaces/model';
import { undoManager } from '@/store/undoManager';
import { sharedLightState, type LightState } from '@dnd/core/src/shared/propLights';
import type { LightChild, MapBuilderStore } from '@/store/types';
import type { SettingProps } from '@/editor/registry/types';
import { LightStateTiles } from '@/editor/families/objects/LightStateTiles';
import { setPropLightState } from '@/editor/families/objects/propLightModel';
import { hostStates } from './lightHosts';
import { ROTATE_STEP, selectGroup } from './lightEdits';
import type { MotionKind } from './lightModel';

/** The picked lights, as the card's rows read them live. */
function usePickedLights(): LightChild[] {
  return useStore(
    useShallow((s) =>
      s.selection.selectedIds
        .map((id) => selectChildById(s as MapBuilderStore, id))
        .filter((c): c is LightChild => c?.childType === 'light'),
    ),
  );
}

/** State: the attached prop's own pictures, the picked one outlined, none while the picked lights differ. */
export function LightStateField(_props: SettingProps<null>) {
  useStore((s) => s.packs.installedPacks);
  const lights = usePickedLights();
  const states = lights.length > 0 ? hostStates(lights[0]!) : undefined;
  if (!states) return null;
  return (
    <LightStateTiles
      states={states}
      value={sharedLightState(lights)}
      onPick={(s: LightState) => setPropLightState(lights.map((l) => l.id), s)}
    />
  );
}

/** Select group: the button that picks every light of group `name`. */
export function SelectGroupButton({ name }: { name: string }) {
  return (
    <SecondaryButton className="shrink-0" onClick={() => selectGroup(name)}>
      Select group
    </SecondaryButton>
  );
}

/**
 * The light card's Group field: the shared row (`GroupRow`) on the picked lights. One light of a
 * group picked on its own says so, and Select group picks them all, so the card edits all of them.
 */
export function GroupField({ value, onChange, mixed }: SettingProps<string>) {
  const lights = usePickedLights();
  const layers = useStore((s) => s.layers);
  const members = value ? lightGroups(layers).find((g) => g.name === value)?.lights.length ?? 0 : 0;
  const alone = lights.length === 1 && members > 1;
  return (
    <GroupRow
      value={mixed ? '' : value}
      mixed={mixed}
      onChange={onChange}
      note={alone ? `Part of ${value}. Select group to edit all ${members}` : undefined}
      after={alone ? <SelectGroupButton name={value} /> : undefined}
    />
  );
}

/**
 * Group: type a name to make or join a group (this light alone moves); the map's groups sit
 * under it as chips with their counts, a click joins one, Leave takes it out, and the pencil
 * renames the whole group (every light in it, one step) to the name typed. While it is in one,
 * the line under says how many lights the group switches, and `after` (the prop card's Select
 * group) sits beside it. A group switches its lights together; it never moves them.
 */
export function GroupRow({
  value,
  onChange,
  after,
  note,
  mixed = false,
}: {
  value: string;
  onChange: (name: string) => void;
  after?: React.ReactNode;
  /** The line under the row in place of "Switches 4 lights together". */
  note?: string;
  /** Several lights in different groups: the name field reads "Mixed" until a name is typed. */
  mixed?: boolean;
}) {
  const layers = useStore((s) => s.layers);
  const [draft, setDraft] = useState<string | null>(null);
  const groups = lightGroups(layers);
  const mine = groups.find((g) => g.name === value);
  const land = () => {
    if (draft === null) return;
    const next = draft.trim();
    setDraft(null);
    if (next !== value) onChange(next);
  };
  const renameTo = draft?.trim() ?? '';
  const canRename = !!value && !!renameTo && renameTo !== value;
  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5" data-testid="light-group">
      <div className="flex w-full min-w-0 items-center gap-1">
        <span className="shrink-0 pr-1.5 text-[12px] text-text-2">Group</span>
          <Input
            aria-label="Group name"
            placeholder={mixed ? MIXED : 'None'}
            title={value || undefined}
            className="min-w-0 flex-1"
            value={draft ?? value}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={land}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setDraft(null);
            }}
          />
          {canRename && (
            <IconKeyButton
              size={26}
              icon={PencilLine}
              label={`Rename group ${value} to ${renameTo}, every light in it`}
              data-tip="Rename the group"
              // Keeps the name field focused, so its blur does not move this light first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const cmd = renameGroupCommand(value, renameTo);
                setDraft(null);
                if (cmd) undoManager.execute(cmd);
              }}
            />
          )}
          <IconKeyButton size={26} icon={X} label="Leave the group" disabled={!value || undefined} onClick={() => onChange('')} />
      </div>
      {groups.length > 0 && (
        <div role="group" aria-label="Light groups" className="flex w-full min-w-0 flex-wrap gap-1">
          {groups.map((g) => (
            // Outlined only for the group this light is in: "outline = active".
            <Chip key={g.name} className="max-w-full" pressed={g.name === value} title={g.name} onPressedChange={() => g.name !== value && onChange(g.name)}>
              <span className="min-w-0 truncate">{g.name}</span>
              <span className="font-mono text-text-3 tabular-nums">{g.lights.length}</span>
            </Chip>
          ))}
        </div>
      )}
      {mine && (
        <div className="flex min-w-0 items-center justify-between gap-2">
          {note ? (
            <span className="min-w-0 text-[11px] text-text-3" data-testid="light-group-note">
              {note}
            </span>
          ) : (
            <span className="truncate text-[11px] text-text-3">
              Switches {mine.lights.length} {mine.lights.length === 1 ? 'light' : 'lights'} together
            </span>
          )}
          {after}
        </div>
      )}
    </div>
  );
}

const MOTION_OPTIONS: { value: MotionKind; label: React.ReactNode }[] = [
  { value: 'still', label: 'Still' },
  {
    value: 'spin',
    label: (
      <span className="inline-flex items-center gap-1">
        <RotateCw aria-hidden strokeWidth={1.75} className="size-3" />
        Spin
      </span>
    ),
  },
  {
    value: 'sweep',
    label: (
      <span className="inline-flex items-center gap-1">
        <MoveHorizontal aria-hidden strokeWidth={1.75} className="size-3" />
        Sweep
      </span>
    ),
  },
];

/** Motion: Still, Spin or Sweep; none chosen while the picked lights differ. */
export function MotionKindField({ def, value, onChange, mixed }: SettingProps<MotionKind>) {
  return (
    <SettingRow label={def.label}>
      <Seg aria-label={def.label} value={mixed ? '' : value} onValueChange={(v) => onChange(v as MotionKind)} options={MOTION_OPTIONS} />
    </SettingRow>
  );
}

/** A spin's way round: clockwise or counter-clockwise, the one in use outlined (neither while the picked lights differ). */
export function SpinDirectionField({ def, value, onChange, mixed }: SettingProps<boolean>) {
  return (
    <SettingRow label={def.label}>
      <span role="group" aria-label={def.label} className="flex gap-[2px]">
        <IconKeyButton size={26} icon={RotateCw} label="Clockwise" active={(!mixed && value) || undefined} onClick={() => onChange(true)} />
        <IconKeyButton size={26} icon={RotateCcw} label="Counter-clockwise" active={(!mixed && !value) || undefined} onClick={() => onChange(false)} />
      </span>
    </SettingRow>
  );
}

/** The line under a full circle's Cone: only a narrower cone can move. */
export function ConeNote() {
  return <p className="text-[11px] text-text-3">Narrow the cone to make it move</p>;
}

const STEP_CELL =
  'h-full w-[22px] rounded-none border-0 p-0 font-mono text-[11px] text-text-3 hover:bg-panel-2 hover:text-text focus-visible:outline-offset-[-2px]';

const wrapDeg = (deg: number): number => ((Math.round(deg) % 360) + 360) % 360;

/**
 * A sweep edge in degrees, drawn as the shared stepper: minus and plus move it by the field's
 * step and wrap through north (355 then 0), and the value takes a typed angle, landed on Enter or
 * on leaving, Escape putting it back.
 */
export function EdgeStepper({ def, value, onChange }: SettingProps<number>) {
  const [draft, setDraft] = useState<string | null>(null);
  const step = def.range?.step ?? 5;
  const land = () => {
    if (draft === null) return;
    const typed = parseFloat(draft);
    setDraft(null);
    if (Number.isFinite(typed) && wrapDeg(typed) !== value) onChange(wrapDeg(typed));
  };
  return (
    <SettingRow label={def.label}>
      <div
        role="group"
        aria-label={def.label}
        data-composite="stepper"
        className="inline-flex h-6 items-center overflow-hidden rounded-control border border-line font-mono text-[11px] text-text"
      >
        <Button variant="ghost" aria-label={`Decrease ${def.label}`} className={`${STEP_CELL} border-r border-line`} onClick={() => onChange(wrapDeg(value - step))}>
          −
        </Button>
        <input
          aria-label={`${def.label} in degrees`}
          inputMode="numeric"
          className="h-full w-11 bg-transparent px-1 text-center tabular-nums outline-none"
          value={draft ?? `${value}°`}
          onFocus={(e) => {
            setDraft(String(value));
            e.currentTarget.select();
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={land}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
        />
        <Button variant="ghost" aria-label={`Increase ${def.label}`} className={`${STEP_CELL} border-l border-line`} onClick={() => onChange(wrapDeg(value + step))}>
          +
        </Button>
      </div>
    </SettingRow>
  );
}

/**
 * An angle the picked lights do not share (Direction, a sweep edge): "Mixed", with minus and plus
 * turning every light by 15° and a typed "rotate by" angle (Enter or leaving lands it, Escape
 * drops it). `onChange` is handed the turn, not an angle, so the beams keep their spread.
 */
export function RotateByRow({ def, onChange }: SettingProps<number>) {
  const [draft, setDraft] = useState<string | null>(null);
  const land = () => {
    if (draft === null) return;
    const turn = parseFloat(draft);
    setDraft(null);
    if (Number.isFinite(turn) && wrapDeg(turn) !== 0) onChange(turn);
  };
  const what = def.label.toLowerCase();
  return (
    <SettingRow label={def.label}>
      <div
        role="group"
        aria-label={`Rotate ${what}`}
        data-composite="stepper"
        data-testid="rotate-by"
        className="inline-flex h-6 items-center overflow-hidden rounded-control border border-line font-mono text-[11px] text-text"
      >
        <Button
          variant="ghost"
          aria-label={`Turn every ${what} back ${ROTATE_STEP}°`}
          data-tip={`Turn all back ${ROTATE_STEP}°`}
          className={`${STEP_CELL} border-r border-line`}
          onClick={() => onChange(-ROTATE_STEP)}
        >
          −
        </Button>
        <input
          aria-label={`Rotate ${what} by, degrees`}
          title="Type an angle to turn every light by it"
          inputMode="numeric"
          placeholder={MIXED}
          className="h-full w-11 bg-transparent px-1 text-center tabular-nums outline-none placeholder:text-text-3"
          value={draft ?? ''}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={land}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
        />
        <Button
          variant="ghost"
          aria-label={`Turn every ${what} on ${ROTATE_STEP}°`}
          data-tip={`Turn all on ${ROTATE_STEP}°`}
          className={`${STEP_CELL} border-l border-line`}
          onClick={() => onChange(ROTATE_STEP)}
        >
          +
        </Button>
      </div>
    </SettingRow>
  );
}

/** A light fixed to a prop: which prop it is fixed to, and the way to it. Detach is the card's own verb. */
export function AttachedRow(_props: SettingProps<null>) {
  const lights = usePickedLights();
  const hostId = lights.length === 1 ? lights[0]!.attachedTo : undefined;
  const host = useStore((s) => (hostId ? selectChildById(s as MapBuilderStore, hostId) : undefined));
  if (!host || host.childType !== 'asset') return null;
  const name = host.name || getCatalogEntry(host.assetId)?.label || 'its prop';
  return (
    <div className="flex min-w-0 items-center justify-between gap-2" data-testid="light-attached">
      <span className="min-w-0 truncate text-[12px] text-text-2" title={name}>
        Attached to {name}
      </span>
      <SecondaryButton className="shrink-0" onClick={() => useStore.getState().setSelectedIds([host.id])}>
        Select prop
      </SecondaryButton>
    </div>
  );
}

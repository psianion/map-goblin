import { Chip, SecondaryButton, SettingRow, Kbd } from '@dnd/ui';
import type { SettingProps } from '@/editor/registry/types';
import { usePreviousTool } from './previousTool';
import { PICK_CHIPS, type PickChip } from './pickOnly';

/** All, then a chip per kind; All is on when no kind is, and clears them. */
export function PickOnlyChips({ value, onChange }: SettingProps<PickChip[]>) {
  const toggle = (id: PickChip) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Pick only">
      <Chip pressed={value.length === 0} onPressedChange={() => onChange([])}>
        All
      </Chip>
      {PICK_CHIPS.map((c) => (
        <Chip key={c.id} pressed={value.includes(c.id)} onPressedChange={() => toggle(c.id)}>
          {c.label}
        </Chip>
      ))}
    </div>
  );
}

/** After the chips: how picking works, keys as keycaps, and the way back to the last tool. */
export function SelectGuide() {
  const { last, back } = usePreviousTool();
  return (
    <>
      <p className="text-[12px] leading-[1.6] text-text-3" data-testid="select-howto">
        Click something, or drag a box.
        <br />
        <Kbd>Shift</Kbd> adds to the pick, <Kbd>Alt</Kbd> takes away.
        <br />
        Double-click a floor or wall to edit its nodes.
      </p>
      {last && (
        <SettingRow label={`Back to ${last.label}`}>
          <SecondaryButton onClick={back} data-testid="select-previous">
            Previous tool <Kbd>X</Kbd>
          </SecondaryButton>
        </SettingRow>
      )}
    </>
  );
}

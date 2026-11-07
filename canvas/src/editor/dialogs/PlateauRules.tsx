import { ArrowDown, ArrowUp, X } from 'lucide-react';
import type { CrossingKind } from '@dnd/core/src/shared/types';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Switch } from '@/ui/switch';
import { Caption, SecondaryButton, Stepper } from '@/editor/components';

/*
 * The map's plateau rules in Map settings: the drop at which a plateau's top hides from
 * below, and the crossing kinds the DM names for cliffs and slopes. Edited here as a draft;
 * the dialog's Save writes them as undo steps.
 */

/** A fresh id for a new kind, unlike any in `kinds`. */
function newKindId(kinds: readonly CrossingKind[]): string {
  let n = kinds.length + 1;
  while (kinds.some((k) => k.id === `kind-${n}`)) n++;
  return `kind-${n}`;
}

export interface PlateauRulesProps {
  sightDropCells: number;
  onSightDropCells: (n: number) => void;
  kinds: CrossingKind[];
  onKinds: (kinds: CrossingKind[]) => void;
  inUse: ReadonlySet<string>;
}

export function PlateauRules({ sightDropCells, onSightDropCells, kinds, onKinds, inUse }: PlateauRulesProps) {
  const edit = (i: number, patch: Partial<CrossingKind>) => onKinds(kinds.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...kinds];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onKinds(next);
  };

  return (
    <div data-testid="v2-map-plateau-rules" className="flex flex-col gap-2 border-t border-line pt-3">
      <Caption>Plateaus</Caption>
      <div className="flex items-center gap-1.5 text-[12px] text-text-2">
        <span>Hide plateau tops from below at</span>
        <Stepper
          label="drop"
          value={sightDropCells}
          min={1}
          onValueChange={onSightDropCells}
        />
        <span>cells</span>
      </div>

      <div className="text-[12px] text-text-2">Crossing kinds</div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="v2-map-crossing-kinds">
        {kinds.map((k, i) => (
          <li key={k.id} className="flex items-center gap-1.5">
            <Input
              className="w-[112px] flex-none"
              aria-label="Crossing name"
              value={k.name}
              onChange={(e) => edit(i, { name: e.target.value })}
            />
            <Input
              className="min-w-0 flex-1"
              aria-label={`${k.name} note`}
              placeholder="Note"
              value={k.note ?? ''}
              onChange={(e) => edit(i, { note: e.target.value || undefined })}
            />
            <Switch
              aria-label={`${k.name} refuses moves`}
              data-tip="Impassable: a player's move across it is refused"
              checked={k.blocks}
              onCheckedChange={(blocks: boolean) => edit(i, { blocks })}
            />
            <span className="flex gap-0.5">
              <Button variant="ghost" size="icon-xs" aria-label={`Move ${k.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp aria-hidden strokeWidth={1.75} />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Move ${k.name} down`}
                disabled={i === kinds.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown aria-hidden strokeWidth={1.75} />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Delete ${k.name}`}
                disabled={inUse.has(k.id)}
                data-tip={inUse.has(k.id) ? 'In use on this map: pick another kind there first' : undefined}
                onClick={() => onKinds(kinds.filter((_, j) => j !== i))}
              >
                <X aria-hidden strokeWidth={1.75} />
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <SecondaryButton
        className="self-start"
        data-testid="v2-map-crossing-add"
        onClick={() => onKinds([...kinds, { id: newKindId(kinds), name: 'New kind', blocks: false }])}
      >
        Add kind
      </SecondaryButton>
    </div>
  );
}

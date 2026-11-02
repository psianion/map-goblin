import { ArrowDown, ArrowUp, Minus, Plus, X } from 'lucide-react';
import type { CrossingKind } from '@dnd/core/src/shared/types';
import { cn } from '@/lib/utils';

/*
 * The map's plateau rules in Map settings (plan §5.3): the drop at which a plateau's top
 * hides from below, and the crossing kinds the DM names for cliffs, slopes, openings and
 * bridges. Edited here as a draft; the dialog's Save writes them as undo steps.
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
  const edit = (i: number, patch: Partial<CrossingKind>) =>
    onKinds(kinds.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...kinds];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onKinds(next);
  };

  return (
    <div data-testid="v2-map-plateau-rules">
      <span className="v2-label">Plateaus</span>
      <div className="v2-size-row v2-size-row--flush">
        <span>Hide plateau tops from below at</span>
        <span className="v2-stepper" data-testid="v2-map-sight-drop">
          <button
            type="button"
            aria-label="Lower drop"
            disabled={sightDropCells <= 1}
            onClick={() => onSightDropCells(Math.max(1, sightDropCells - 1))}
          >
            <Minus size={10} />
          </button>
          <span className="v2-num">{sightDropCells}</span>
          <button type="button" aria-label="Higher drop" onClick={() => onSightDropCells(sightDropCells + 1)}>
            <Plus size={10} />
          </button>
        </span>
        <span>cells</span>
      </div>

      <span className="v2-label">Crossing kinds</span>
      <ul className="v2-crossing-kinds" data-testid="v2-map-crossing-kinds">
        {kinds.map((k, i) => (
          <li key={k.id} className="v2-size-row v2-size-row--flush">
            <input
              className="v2-input"
              aria-label="Crossing name"
              value={k.name}
              onChange={(e) => edit(i, { name: e.target.value })}
            />
            <input
              className="v2-input"
              aria-label={`${k.name} note`}
              placeholder="Note"
              value={k.note ?? ''}
              onChange={(e) => edit(i, { note: e.target.value || undefined })}
            />
            <button
              type="button"
              role="switch"
              aria-checked={k.blocks}
              aria-label={`${k.name} refuses moves`}
              data-tip="Impassable: a player's move across it is refused"
              className={cn('v2-switch', k.blocks && 'v2-switch--on')}
              onClick={() => edit(i, { blocks: !k.blocks })}
            >
              <span />
            </button>
            <button type="button" className="v2-x" aria-label={`Move ${k.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              className="v2-x"
              aria-label={`Move ${k.name} down`}
              disabled={i === kinds.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown size={13} />
            </button>
            <button
              type="button"
              className="v2-x"
              aria-label={`Delete ${k.name}`}
              disabled={inUse.has(k.id)}
              data-tip={inUse.has(k.id) ? 'In use on this map: pick another kind there first' : undefined}
              onClick={() => onKinds(kinds.filter((_, j) => j !== i))}
            >
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="v2-btn v2-btn--ghost"
        data-testid="v2-map-crossing-add"
        onClick={() => onKinds([...kinds, { id: newKindId(kinds), name: 'New kind', blocks: false }])}
      >
        Add kind
      </button>
    </div>
  );
}

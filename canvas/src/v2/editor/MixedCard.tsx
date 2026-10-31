import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDown,
  ArrowUp,
  Lock,
} from 'lucide-react';
import { useStore } from '@/store/store';
import type { DungeonLayer } from '@/store/types';
import type { AlignEdge } from '@dnd/core/src/store/propEdits';
import { resolveSelection, type SelectionKind } from '@dnd/core/src/store/selectionResolve';
import { KIND_LABEL, mixedModel, type MixedModel } from './cardModels';
import {
  alignSelection,
  distributeSelection,
  moveSelectionToLayer,
  orderSelectionNow,
} from '@/shortcuts/defaultShortcuts';
import { CardActions, LockFields } from './CardActions';
import './selection-actions.css';

/*
 * The card for a selection of several kinds (board S3): a title that counts each kind, the
 * shared action row, Move to layer, Align and Distribute for anything with a box, Order
 * when props are in it, a way to narrow to one kind, and the fields every member shares
 * (passed in by the dispatcher, which owns those field groups).
 */

const ALIGN: { edge: AlignEdge; label: string; icon: ReactNode }[] = [
  { edge: 'left', label: 'Align left', icon: <AlignStartVertical size={14} strokeWidth={1.75} /> },
  { edge: 'hcenter', label: 'Align centre', icon: <AlignCenterVertical size={14} strokeWidth={1.75} /> },
  { edge: 'right', label: 'Align right', icon: <AlignEndVertical size={14} strokeWidth={1.75} /> },
  { edge: 'top', label: 'Align top', icon: <AlignStartHorizontal size={14} strokeWidth={1.75} /> },
  { edge: 'vcenter', label: 'Align middle', icon: <AlignCenterHorizontal size={14} strokeWidth={1.75} /> },
  { edge: 'bottom', label: 'Align bottom', icon: <AlignEndHorizontal size={14} strokeWidth={1.75} /> },
];

function Btn({ label, testId, onClick, children }: { label: string; testId?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="v2-ib v2-ib--sm" aria-label={label} data-tip={label} data-testid={testId} onClick={onClick}>
      {children}
    </button>
  );
}

/** The layers the selection may move to: the level on show, unlocked. */
function useLayerChoices(): { id: string; name: string }[] {
  return useStore(
    useShallow((s) =>
      s.layers
        .filter((l): l is DungeonLayer => l.type === 'dungeon' && l.levelId === s.ui.activeLevelId && !l.locked)
        .map((l) => `${l.id}\u0000${l.name || 'Unnamed layer'}`),
    ),
  ).map((k) => {
    const [id, name] = k.split('\u0000');
    return { id, name };
  });
}

export function MixedCard({ children, dims }: { children?: ReactNode; dims?: ReactNode }) {
  const modelKey = useStore((s) => JSON.stringify(mixedModel(resolveSelection(s, s.selection.selectedIds))));
  const m = JSON.parse(modelKey) as MixedModel;
  const layers = useLayerChoices();
  return (
    <section className="v2-sel v2-float" data-testid="v2-selection-card" data-keys="canvas" data-chrome aria-label="Selection">
      <header className="v2-sel__head v2-pcard__head">
        <span className="v2-sel__name" data-testid="v2-mixed-title">
          {m.title}
        </span>
        {m.locked > 0 && (
          <span className="v2-sel__lock" data-testid="v2-sel-locked">
            <Lock size={10} strokeWidth={2} aria-hidden />
            {m.locked} locked
          </span>
        )}
        <span className="v2-sel__kind v2-rend">{m.kinds.length > 1 ? 'Mixed' : 'Selection'}</span>
      </header>
      <CardActions />
      {dims}
      <div className="v2-mix__rows">
        {/* Moving to a layer, ordering and the shared fields write to every member: a
            locked one holds them all back (the header's tag says how many). */}
        <LockFields locked={m.locked > 0}>
          {layers.length > 0 && (
            <div className="v2-mix__row">
              <span className="v2-mix__lbl">Layer</span>
              <select
                className="v2-select v2-mix__select"
                aria-label="Move to layer"
                data-testid="v2-mixed-layer"
                value={m.layerId ?? ''}
                onChange={(e) => e.target.value && moveSelectionToLayer(e.target.value)}
              >
                {!m.layerId && <option value="">Several layers</option>}
                {layers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </LockFields>
        {m.arrangeable >= 2 && (
          <div className="v2-mix__row" data-testid="v2-mixed-align">
            <span className="v2-mix__lbl">Align</span>
            <span className="v2-mix__btns" role="group" aria-label="Align">
              {ALIGN.slice(0, 3).map((a) => (
                <Btn key={a.edge} label={a.label} testId={`v2-mixed-align-${a.edge}`} onClick={() => alignSelection(a.edge)}>
                  {a.icon}
                </Btn>
              ))}
            </span>
            <span className="v2-mix__btns" role="group" aria-label="Align vertically">
              {ALIGN.slice(3).map((a) => (
                <Btn key={a.edge} label={a.label} testId={`v2-mixed-align-${a.edge}`} onClick={() => alignSelection(a.edge)}>
                  {a.icon}
                </Btn>
              ))}
            </span>
          </div>
        )}
        {m.arrangeable >= 3 && (
          <div className="v2-mix__row" data-testid="v2-mixed-distribute">
            <span className="v2-mix__lbl">Distribute</span>
            <span className="v2-mix__btns" role="group" aria-label="Distribute">
              <Btn label="Distribute horizontally" testId="v2-mixed-distribute-h" onClick={() => distributeSelection('h')}>
                <AlignHorizontalDistributeCenter size={14} strokeWidth={1.75} />
              </Btn>
              <Btn label="Distribute vertically" testId="v2-mixed-distribute-v" onClick={() => distributeSelection('v')}>
                <AlignVerticalDistributeCenter size={14} strokeWidth={1.75} />
              </Btn>
            </span>
          </div>
        )}
        <LockFields locked={m.locked > 0}>
          {m.hasProps && (
            <div className="v2-mix__row" data-testid="v2-mixed-order">
              <span className="v2-mix__lbl">Order</span>
              <span className="v2-mix__btns" role="group" aria-label="Order">
                <Btn label="Send backward" onClick={() => orderSelectionNow('backward')}>
                  <ArrowDown size={14} strokeWidth={1.75} />
                </Btn>
                <Btn label="Bring forward" onClick={() => orderSelectionNow('forward')}>
                  <ArrowUp size={14} strokeWidth={1.75} />
                </Btn>
              </span>
            </div>
          )}
        </LockFields>
        <div data-testid="v2-mixed-kinds">
          {m.kinds.map(([kind, n]) => (
            <div key={kind} className="v2-mix__kind">
              <span>{KIND_LABEL[kind]}</span>
              <span className="v2-num">{n}</span>
              <button type="button" className="v2-link v2-sel__quiet" onClick={() => selectOnly(kind)}>
                Select only
              </button>
            </div>
          ))}
        </div>
      </div>
      <LockFields locked={m.locked > 0}>{children}</LockFields>
    </section>
  );
}

/** Narrows the selection to the members of one kind. */
function selectOnly(kind: SelectionKind): void {
  const s = useStore.getState();
  const sel = resolveSelection(s, s.selection.selectedIds);
  const ids =
    kind === 'wall'
      ? sel.walls.map((w) => w.wall.id)
      : kind === 'room'
        ? sel.rooms.map((r) => r.room.id)
        : sel.children.filter((c) => c.child.childType === kind).map((c) => c.child.id);
  s.setSelectedIds(ids);
}

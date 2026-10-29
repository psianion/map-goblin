import { useCallback, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogPortal, DialogBackdrop, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useStore } from '@/store/store';
import { SplitRoomCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { interiorPoint, nextRoomNumber, pointInRing } from '@dnd/core/src/shared/roomUtils';
import type { DoorChild, DungeonLayer, PendingSplit, Room } from '@/store/types';
import { cn } from '@/lib/utils';
import { useEscapeToClose } from '../useEscapeToClose';
import { compassOf, doorsOnFace, halfLabel, halfMeta, otherHalfName } from './roomModel';
import './rooms.css';

type Ring = [number, number][];

/** The split waiting for an answer, with the room and layer it cuts; null when there is none to show. */
function usePending(): { split: PendingSplit; layer: DungeonLayer; room: Room } | null {
  const split = useStore((s) => s.ui.pendingSplit);
  const layer = useStore((s) => (split ? s.layers.find((l) => l.id === split.layerId) : undefined));
  if (!split || !layer || layer.type !== 'dungeon') return null;
  const room = (layer as DungeonLayer).rooms?.find((r) => r.id === split.roomId);
  return room ? { split, layer: layer as DungeonLayer, room } : null;
}

/**
 * The split dialog (board 4). A Divide stroke cut one room in two: which half keeps the
 * room's id (its name, key and fog), what the other half is called, and whether its fog
 * at the table copies the room's explored state or starts hidden. Split lands it as one
 * undo step; Cancel adds nothing.
 */
export function SplitDialog() {
  const pending = usePending();
  // Keyed on the split so each one opens on its own defaults.
  return pending ? <SplitForm key={JSON.stringify(pending.split.threshold.points)} {...pending} /> : null;
}

function SplitForm({ split, layer, room }: { split: PendingSplit; layer: DungeonLayer; room: Room }) {
  const halves = split.halves as [Ring, Ring];
  const dirs = useMemo(() => [compassOf(halves[0], halves[1]), compassOf(halves[1], halves[0])] as const, [halves]);
  const doorPositions = useMemo(
    () =>
      layer.children
        .filter((c): c is DoorChild => c.childType === 'door')
        .map((d) => d.position),
    [layer.children],
  );
  // The larger half keeps the room by default: `halves` arrives larger first.
  const [keeper, setKeeper] = useState<0 | 1>(0);
  const other = keeper === 0 ? 1 : 0;
  const [name, setName] = useState<string | null>(null);
  const [fog, setFog] = useState<'copy' | 'hidden'>('copy');
  const number = nextRoomNumber(layer.rooms);
  const shownName = name ?? otherHalfName(room.name, dirs[other]);

  const cancel = useCallback(() => useStore.getState().setPendingSplit(null), []);
  useEscapeToClose(true, cancel);

  const commit = () => {
    const keeperFace = halves[keeper];
    const otherFace = halves[other];
    const otherRoom: Room = {
      id: crypto.randomUUID(),
      name: shownName.trim() || otherHalfName(room.name, dirs[other]),
      number,
      anchor: interiorPoint(otherFace),
    };
    // The id follows the half picked: when that is not where the room's badge sits, it moves.
    const keeperAnchor = pointInRing(room.anchor[0], room.anchor[1], keeperFace) ? undefined : interiorPoint(keeperFace);
    undoManager.execute(new SplitRoomCommand(layer.id, room.id, split.threshold, otherRoom, fog, keeperAnchor));
    useStore.getState().setPendingSplit(null);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && cancel()}>
      <DialogPortal>
        <DialogBackdrop className="v2-backdrop" />
        <DialogContent className="v2-modal max-w-[520px] p-0">
          <div
            data-v2-home=""
            data-testid="v2-split-dialog"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key !== 'Enter' || e.target instanceof HTMLButtonElement) return;
              e.preventDefault();
              commit();
            }}
          >
            <div className="v2-modal__head">
              <DialogTitle className="v2-modal__title">Split {room.name || 'room'}</DialogTitle>
              <button type="button" className="v2-x" aria-label="Close" onClick={cancel}>
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>
            <div className="v2-modal__body">
              <div>
                <span className="v2-label">Which half keeps the name, notes and fog progress?</span>
                <div className="v2-split__opts">
                  {([0, 1] as const).map((i) => (
                    <button
                      key={i}
                      type="button"
                      className={cn('v2-split__opt', keeper === i && 'v2-split__opt--on')}
                      aria-pressed={keeper === i}
                      data-testid={`v2-split-half-${i}`}
                      onClick={() => setKeeper(i)}
                    >
                      <span className="v2-split__pv">
                        <HalfPreview halves={halves} pick={i} threshold={split.threshold.points} />
                      </span>
                      <span className="v2-split__optline">
                        <span className="v2-split__optname">{halfLabel(dirs[i])}</span>
                        <span className="v2-num v2-split__meta">{halfMeta(halves[i], doorsOnFace(halves[i], doorPositions))}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="v2-label" htmlFor="v2-split-name">
                  The other half becomes
                </label>
                <input
                  id="v2-split-name"
                  className="v2-input"
                  value={shownName}
                  onChange={(e) => setName(e.target.value)}
                />
                <p className="v2-hint">It gets the next free number, {number}. Renumber from the rooms list.</p>
              </div>
              <div>
                <span className="v2-label">Its fog at the table</span>
                <div className="v2-split__radios" role="radiogroup" aria-label="Its fog at the table">
                  <label className="v2-split__radio">
                    <input type="radio" name="v2-split-fog" checked={fog === 'copy'} onChange={() => setFog('copy')} />
                    Copy the explored state <span className="v2-split__quiet">(the party has seen this room)</span>
                  </label>
                  <label className="v2-split__radio">
                    <input type="radio" name="v2-split-fog" checked={fog === 'hidden'} onChange={() => setFog('hidden')} />
                    Start hidden
                  </label>
                </div>
              </div>
            </div>
            <div className="v2-modal__foot">
              <button type="button" className="v2-btn v2-btn--ghost" onClick={cancel}>
                Cancel
              </button>
              <button type="button" className="v2-btn v2-btn--primary" data-testid="v2-split-commit" onClick={commit}>
                Split
              </button>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

const PV_W = 120;
const PV_H = 56;
const PV_PAD = 2;

/** Both halves drawn small, the one `pick` names shaded, the cut dashed. */
function HalfPreview({ halves, pick, threshold }: { halves: [Ring, Ring]; pick: 0 | 1; threshold: [number, number][] }) {
  const all = [...halves[0], ...halves[1]];
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(1e-6, Math.max(...xs) - minX);
  const h = Math.max(1e-6, Math.max(...ys) - minY);
  const k = Math.min((PV_W - PV_PAD * 2) / w, (PV_H - PV_PAD * 2) / h);
  const ox = (PV_W - w * k) / 2;
  const oy = (PV_H - h * k) / 2;
  const pt = ([x, y]: [number, number]) => `${(ox + (x - minX) * k).toFixed(1)},${(oy + (y - minY) * k).toFixed(1)}`;
  const poly = (ring: Ring) => ring.map(pt).join(' ');
  return (
    <svg viewBox={`0 0 ${PV_W} ${PV_H}`} aria-hidden>
      <polygon className="v2-split__floor" points={poly(halves[0])} />
      <polygon className="v2-split__floor" points={poly(halves[1])} />
      <polygon className="v2-split__pick" points={poly(halves[pick])} />
      <polyline className="v2-split__cut" points={threshold.map(pt).join(' ')} />
    </svg>
  );
}

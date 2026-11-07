import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { useStore } from '@/store/store';
import { SplitRoomCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { interiorPoint, nextRoomNumber, pointInRing } from '@dnd/core/src/shared/roomUtils';
import type { DoorChild, DungeonLayer, PendingSplit, Room } from '@/store/types';
import { PrimaryButton, Seg } from '@/editor/components';
import { compassOf, doorsOnFace, halfLabel, halfMeta, otherHalfName } from '@/editor/models/roomModel';
import { useEscapeToClose } from '@/editor/useEscapeToClose';
import { Actions, DialogHead, Field, Hint } from './parts';

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
 * The split dialog. A Divide stroke cut one room in two: which half keeps the room's id (its
 * name, key and fog), what the other half is called, and whether its fog at the table copies
 * the room's explored state or starts hidden. Split lands it as one undo step; Cancel adds
 * nothing.
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
      <DialogContent
        data-v2-home=""
        data-testid="v2-split-dialog"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key !== 'Enter' || e.target instanceof HTMLButtonElement) return;
          e.preventDefault();
          commit();
        }}
      >
        <DialogHead title={`Split ${room.name || 'room'}`} onClose={cancel} />
        <Field label="Which half keeps the name, notes and fog progress?">
          <div className="grid grid-cols-2 gap-1.5">
            {([0, 1] as const).map((i) => (
              <Button
                key={i}
                variant="outline"
                aria-pressed={keeper === i}
                data-testid={`v2-split-half-${i}`}
                className="h-auto flex-col items-stretch gap-1.5 p-1.5 text-left whitespace-normal"
                onClick={() => setKeeper(i)}
              >
                <span className="flex h-14 items-center justify-center rounded-key bg-panel-2">
                  <HalfPreview halves={halves} pick={i} threshold={split.threshold.points} />
                </span>
                <span className="flex items-baseline justify-between gap-1.5 px-0.5">
                  <span className="truncate text-[12px] font-medium text-text">{halfLabel(dirs[i])}</span>
                  <span className="font-mono text-[10px] whitespace-nowrap text-text-3 tabular-nums">
                    {halfMeta(halves[i], doorsOnFace(halves[i], doorPositions))}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        </Field>
        <Field label="The other half becomes" htmlFor="v2-split-name">
          <Input id="v2-split-name" value={shownName} onChange={(e) => setName(e.target.value)} />
          <Hint>It gets the next free number, {number}. Renumber from the rooms list.</Hint>
        </Field>
        <Field label="Its fog at the table">
          <Seg
            aria-label="Its fog at the table"
            value={fog}
            onValueChange={(v) => setFog(v as 'copy' | 'hidden')}
            options={[
              { value: 'copy', label: 'Copy explored state' },
              { value: 'hidden', label: 'Start hidden' },
            ]}
          />
          {fog === 'copy' && <Hint>The party has seen this room.</Hint>}
        </Field>
        <Actions>
          <Button variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <PrimaryButton data-testid="v2-split-commit" onClick={commit}>
            Split
          </PrimaryButton>
        </Actions>
      </DialogContent>
    </Dialog>
  );
}

const PV_W = 120;
const PV_H = 48;
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
    <svg viewBox={`0 0 ${PV_W} ${PV_H}`} aria-hidden className="h-12 w-[120px]">
      <polygon className="fill-line-strong stroke-text-2 [stroke-linejoin:round] [stroke-width:2]" points={poly(halves[0])} />
      <polygon className="fill-line-strong stroke-text-2 [stroke-linejoin:round] [stroke-width:2]" points={poly(halves[1])} />
      <polygon className="fill-ink/20 stroke-none" points={poly(halves[pick])} />
      <polyline className="fill-none stroke-ink [stroke-dasharray:4_3] [stroke-width:1.5]" points={threshold.map(pt).join(' ')} />
    </svg>
  );
}

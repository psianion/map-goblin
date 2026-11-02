import { Minus, Plus } from 'lucide-react';
import { useStore } from '@/store/store';
import { CompositeCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type { Command, DungeonLayer, ShapeChild } from '@/store/types';
import { setPlateauFields, type PlateauPatch } from '@dnd/core/src/store/plateauCommands';
import { defaultCrossingId, edgeHides, edgeOf, ownHeight, shapeDrop, type EdgeKind } from '@dnd/core/src/shared/plateaus';
import { cliffArtSetIds } from '@dnd/core/src/engine/plateauKit';
import { Ctl, Seg, Select, Switch } from './controls';

/*
 * The plateau rows of a floor's card (plan §5.3): Height first, and once a floor stands
 * above or below its ground, how its edge meets the lower ground, the art and slope of
 * that edge, its contour lines, whether it hides its top from below and how it is crossed.
 * Every row writes every selected floor as one undo step; the rows show the first one.
 */

const EDGE_OPTIONS: { value: EdgeKind; label: string; tip: string }[] = [
  { value: 'wall', label: 'Wall', tip: 'Walls round it, like any room' },
  { value: 'slope', label: 'Slope', tip: 'A slope down to the ground around it' },
  { value: 'cliff', label: 'Cliff', tip: 'A rock edge, laid along the ring' },
  { value: 'none', label: 'None', tip: 'No edge drawn' },
];

type SightChoice = 'auto' | 'hide' | 'show';
const SIGHT_OPTIONS: { value: SightChoice; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'hide', label: 'Always' },
  { value: 'show', label: 'Never' },
];

const DEFAULT_ART = '';
const SLOPE_STEP = 0.5;

function apply(label: string, ids: readonly string[], patch: PlateauPatch): void {
  const cmds = ids.map((id) => setPlateauFields(id, patch, label)).filter((c): c is Command => c !== null);
  if (cmds.length === 0) return;
  undoManager.execute(cmds.length === 1 ? cmds[0] : new CompositeCommand(label, cmds));
}

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

export function PlateauFields({ layerId, ids }: { layerId: string; ids: readonly string[] }) {
  const layer = useStore((s) => s.layers.find((l) => l.id === layerId)) as DungeonLayer | undefined;
  const kinds = useStore((s) => s.mapSettings.crossingKinds);
  const threshold = useStore((s) => s.mapSettings.sightDropCells);
  useStore((s) => s.packs.installedPacks);
  const head = layer?.children.find((c): c is ShapeChild => c.childType === 'shape' && c.id === ids[0]);
  if (!layer || !head) return null;

  const height = ownHeight(head);
  const edge = edgeOf(head);
  const raised = height !== 0;
  const step = (d: number) => apply('Plateau height', ids, { height: height + d === 0 ? undefined : height + d });

  const drop = raised ? shapeDrop(layer, head.id) : 0;
  const hides = edgeHides(head, edge, drop, threshold);
  const sight: SightChoice = head.sightOverride ?? 'auto';
  const artIds = cliffArtSetIds();
  const crossingDefault = kinds.find((k) => k.id === defaultCrossingId(edge));

  return (
    <div className="v2-selc__group" data-testid="v2-sel-plateau">
      <div className="v2-sel__row">
        <Ctl label="Height" wide>
          <span className="v2-stepper" data-testid="v2-plateau-height">
            <button type="button" aria-label="Lower" onClick={() => step(-1)}>
              <Minus size={10} />
            </button>
            <span className="v2-num">{signed(height)}</span>
            <button type="button" aria-label="Raise" onClick={() => step(1)}>
              <Plus size={10} />
            </button>
          </span>
        </Ctl>
        <span className="v2-selc__value v2-selc__value--quiet">{raised ? 'cells' : 'ground'}</span>
      </div>

      {raised && (
        <>
          <div className="v2-sel__row">
            <Seg label="Edge" value={edge} options={EDGE_OPTIONS} onChange={(v) => apply('Plateau edge', ids, { edge: v === 'wall' ? undefined : v })} />
          </div>

          {edge === 'cliff' && (
            <div className="v2-sel__row">
              <Select
                label="Cliff art"
                value={head.edgeArt ?? DEFAULT_ART}
                options={[
                  { value: DEFAULT_ART, label: 'Cave ink ledge' },
                  ...artIds.map((id) => ({ value: id, label: id.replace(/_/g, ' ') })),
                ]}
                onChange={(v) => apply('Cliff art', ids, { edgeArt: v === DEFAULT_ART ? undefined : v })}
              />
            </div>
          )}

          {edge === 'slope' && (
            <div className="v2-sel__row">
              <Ctl label="Slope width" wide>
                <span className="v2-stepper" data-testid="v2-plateau-slope">
                  <button
                    type="button"
                    aria-label="Steeper"
                    disabled={(head.slopeWidth ?? 1) <= SLOPE_STEP}
                    onClick={() => apply('Slope width', ids, { slopeWidth: (head.slopeWidth ?? 1) - SLOPE_STEP })}
                  >
                    <Minus size={10} />
                  </button>
                  <span className="v2-num">{head.slopeWidth ?? 1}</span>
                  <button type="button" aria-label="Gentler" onClick={() => apply('Slope width', ids, { slopeWidth: (head.slopeWidth ?? 1) + SLOPE_STEP })}>
                    <Plus size={10} />
                  </button>
                </span>
              </Ctl>
              <span className="v2-selc__value v2-selc__value--quiet">cells a cell</span>
            </div>
          )}

          {(edge === 'slope' || edge === 'cliff') && (
            <div className="v2-sel__row">
              <Switch
                label="Contour lines"
                checked={head.contourLines ?? true}
                onChange={(on) => apply('Contour lines', ids, { contourLines: on ? undefined : false })}
              />
            </div>
          )}

          {edge !== 'wall' && (
            <div className="v2-sel__row" data-testid="v2-plateau-sight">
              <Seg
                label="Sight"
                value={sight}
                options={SIGHT_OPTIONS}
                onChange={(v) => apply('Blocks sight', ids, { sightOverride: v === 'auto' ? undefined : v })}
              />
            </div>
          )}
          {edge !== 'wall' && sight === 'auto' && (
            // Auto's answer on a line of its own: beside the three choices it ran off the card.
            <div className="v2-sel__row">
              <span className="v2-selc__label" />
              <span className="v2-selc__value v2-selc__value--quiet" data-testid="v2-plateau-sight-auto">
                {hides ? 'Top hidden from below' : 'Top seen from below'} · drop {Math.abs(drop)}
              </span>
            </div>
          )}

          {edge !== 'wall' && (
            <div className="v2-sel__row">
              <Select
                label="Crossing"
                value={head.crossingId ?? ''}
                options={[
                  { value: '', label: `Default (${crossingDefault?.name ?? 'none'})` },
                  ...kinds.map((k) => ({ value: k.id, label: k.name })),
                ]}
                onChange={(v) => apply('Crossing', ids, { crossingId: v === '' ? undefined : v })}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

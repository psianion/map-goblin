import { Minus, Plus } from 'lucide-react';
import { useStore } from '@/store/store';
import { CompositeCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type { Command, DungeonLayer, PlateauChild } from '@/store/types';
import { setPlateauFields, type PlateauPatch } from '@dnd/core/src/store/plateauCommands';
import { absoluteHeight, defaultCrossingId, edgeHides, edgeOf, ownHeight, shapeDrop, type EdgeKind } from '@dnd/core/src/shared/plateaus';
import { cliffArtSetIds } from '@dnd/core/src/engine/plateauKit';
import { plateauSettings } from '@dnd/core/src/engine/tools/PlateauTool';
import { Ctl, Seg, Select, Switch } from './controls';

/*
 * The rows of a plateau's card (plan §5.3): Height first, then how its edge meets the lower
 * ground, the art and slope of that edge, its contour lines, whether it hides its top from
 * below and how it is crossed. Every row writes every selected plateau as one undo step; the
 * rows show the first one.
 */

const EDGE_OPTIONS: { value: EdgeKind; label: string; tip: string }[] = [
  { value: 'none', label: 'None', tip: 'No edge drawn' },
  { value: 'slope', label: 'Slope', tip: 'A slope down to the ground around it' },
  { value: 'cliff', label: 'Cliff', tip: 'A rock edge, laid along the ring' },
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

/** A plateau is never flat: a step that lands on 0 goes on to the other side. */
const stepHeight = (height: number, d: number): number => (height + d === 0 ? height + 2 * d : height + d);

/** The Plateau tool's dock settings: the height and edge the next plateau is drawn with. */
export function PlateauSettings() {
  const settings = useStore((s) => s.tools.settings.plateau) ?? plateauSettings();
  const set = (patch: Partial<typeof settings>) =>
    useStore.getState().updateToolSettings({ plateau: { ...plateauSettings(), ...patch } });
  return (
    <>
      <Ctl label="Height">
        <span className="v2-stepper" data-testid="v2-plateau-tool-height">
          <button type="button" aria-label="Lower" onClick={() => set({ height: stepHeight(settings.height, -1) })}>
            <Minus size={10} />
          </button>
          <span className="v2-num">{signed(settings.height)}</span>
          <button type="button" aria-label="Raise" onClick={() => set({ height: stepHeight(settings.height, 1) })}>
            <Plus size={10} />
          </button>
        </span>
      </Ctl>
      <Seg label="Edge" value={settings.edge} options={EDGE_OPTIONS} onChange={(v) => set({ edge: v })} />
    </>
  );
}

export function PlateauFields({ layerId, ids }: { layerId: string; ids: readonly string[] }) {
  const layer = useStore((s) => s.layers.find((l) => l.id === layerId)) as DungeonLayer | undefined;
  const kinds = useStore((s) => s.mapSettings.crossingKinds);
  const threshold = useStore((s) => s.mapSettings.sightDropCells);
  useStore((s) => s.packs.installedPacks);
  const head = layer?.children.find((c): c is PlateauChild => c.childType === 'plateau' && c.id === ids[0]);
  if (!layer || !head) return null;

  const height = ownHeight(head);
  const edge = edgeOf(head);
  const step = (d: number) => apply('Plateau height', ids, { height: stepHeight(height, d) });

  const drop = shapeDrop(layer, head.id);
  const standing = absoluteHeight(layer, head.id);
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
        {/* Where it stands in the stack and how far its edge falls: the stepper is its own height. */}
        <span className="v2-selc__value v2-selc__value--quiet" data-testid="v2-plateau-standing">
          {`${signed(standing)} · drop ${Math.abs(drop)}`}
        </span>
      </div>

      <div className="v2-sel__row">
        <Seg label="Edge" value={edge} options={EDGE_OPTIONS} onChange={(v) => apply('Plateau edge', ids, { edge: v })} />
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

      {edge === 'cliff' && (
        <div className="v2-sel__row" data-testid="v2-plateau-foot-rubble">
          <Switch
            label="Foot rubble"
            checked={head.footRubble ?? false}
            onChange={(on) => apply('Foot rubble', ids, { footRubble: on ? true : undefined })}
          />
        </div>
      )}

      <div className="v2-sel__row" data-testid="v2-plateau-sight">
        <Seg
          label="Sight"
          value={sight}
          options={SIGHT_OPTIONS.map((o) => (o.value === 'auto' ? { ...o, label: `Auto (${hides ? 'hides' : 'shows'})` } : o))}
          onChange={(v) => apply('Blocks sight', ids, { sightOverride: v === 'auto' ? undefined : v })}
        />
      </div>
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
    </div>
  );
}

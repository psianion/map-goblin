import { Minus, Plus } from 'lucide-react';
import { useStore } from '@/store/store';
import { UpdateChildCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type { AnyChild, DungeonLayer } from '@/store/types';
import type { OpeningChild } from '@dnd/core/src/shared/types';
import { openingSettings, OPENING_LABEL } from '@dnd/core/src/engine/tools/OpeningTool';
import { stairsArtEntries } from '@dnd/core/src/engine/plateauRenderer';
import { Ctl, Seg, Select } from './controls';

/*
 * An opening's card rows (plan §5.4) and the Opening tool's dock settings: the kind, the
 * width along the ring, the stairs art and the crossing kind. Card edits are one undo step.
 */

const KINDS = (['stairs', 'ramp', 'ladder'] as const).map((value) => ({ value, label: OPENING_LABEL[value] }));
const WIDTH_STEP = 0.5;
const MIN_WIDTH = 0.5;
const DEFAULT_ART = '';

function artOptions() {
  return [
    { value: DEFAULT_ART, label: 'Default' },
    ...stairsArtEntries().map((e) => ({ value: e.id, label: e.material.replace(/_/g, ' ') + ` ${e.gridSize}` })),
  ];
}

function WidthStepper({ value, onChange, testId }: { value: number; onChange: (v: number) => void; testId: string }) {
  return (
    <Ctl label="Width" wide>
      <span className="v2-stepper" data-testid={testId}>
        <button type="button" aria-label="Narrower" disabled={value <= MIN_WIDTH} onClick={() => onChange(Math.max(MIN_WIDTH, value - WIDTH_STEP))}>
          <Minus size={10} />
        </button>
        <span className="v2-num">{value}</span>
        <button type="button" aria-label="Wider" onClick={() => onChange(value + WIDTH_STEP)}>
          <Plus size={10} />
        </button>
      </span>
    </Ctl>
  );
}

export function OpeningFields({ layerId, openingId }: { layerId: string; openingId: string }) {
  const layer = useStore((s) => s.layers.find((l) => l.id === layerId)) as DungeonLayer | undefined;
  const kinds = useStore((s) => s.mapSettings.crossingKinds);
  useStore((s) => s.packs.installedPacks);
  const opening = layer?.children.find((c): c is OpeningChild => c.id === openingId && c.childType === 'opening');
  if (!layer || !opening) return null;

  const set = (label: string, patch: Partial<OpeningChild>) => {
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(patch)) before[k] = (opening as unknown as Record<string, unknown>)[k];
    undoManager.execute(new UpdateChildCommand(label, layerId, openingId, before as Partial<AnyChild>, patch as Partial<AnyChild>));
  };
  const free = kinds.find((k) => k.id === 'free');

  return (
    <div className="v2-sel__rows v2-selc" data-testid="v2-sel-opening">
      <div className="v2-sel__row">
        <Seg label="Kind" value={opening.kind} options={KINDS} onChange={(v) => set('Opening kind', { kind: v })} />
      </div>
      <div className="v2-sel__row">
        <WidthStepper value={opening.width} onChange={(v) => set('Opening width', { width: v })} testId="v2-opening-width" />
        <span className="v2-selc__value v2-selc__value--quiet">cells</span>
      </div>
      {opening.kind === 'stairs' && (
        <div className="v2-sel__row">
          <Select
            label="Art"
            value={opening.artId ?? DEFAULT_ART}
            options={artOptions()}
            onChange={(v) => set('Stairs art', { artId: v === DEFAULT_ART ? undefined : v })}
          />
        </div>
      )}
      <div className="v2-sel__row">
        <Select
          label="Crossing"
          value={opening.crossingId ?? ''}
          options={[{ value: '', label: `Default (${free?.name ?? 'Free'})` }, ...kinds.map((k) => ({ value: k.id, label: k.name }))]}
          onChange={(v) => set('Crossing', { crossingId: v === '' ? undefined : v })}
        />
      </div>
    </div>
  );
}

/** The Opening tool's dock: what the next click places. */
export function OpeningSettings() {
  const settings = useStore((s) => s.tools.settings.opening) ?? openingSettings();
  useStore((s) => s.packs.installedPacks);
  const set = (patch: Partial<typeof settings>) =>
    useStore.getState().updateToolSettings({ opening: { ...openingSettings(), ...patch } });
  return (
    <>
      <Seg label="Kind" value={settings.kind} options={KINDS} onChange={(v) => set({ kind: v })} />
      <WidthStepper value={settings.width} onChange={(v) => set({ width: v })} testId="v2-opening-tool-width" />
      {settings.kind === 'stairs' && (
        <Select
          label="Art"
          width={120}
          value={settings.artId ?? DEFAULT_ART}
          options={artOptions()}
          onChange={(v) => set({ artId: v === DEFAULT_ART ? undefined : v })}
        />
      )}
    </>
  );
}

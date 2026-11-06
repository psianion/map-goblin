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
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Lock,
  type LucideIcon,
} from 'lucide-react';
import { ActionRow, Caption, FloatBox, IconKeyButton, PanelHeader, SecondaryButton, SelectRow, SettingRow } from '@/editor/components';
import { useStore } from '@/store/store';
import type { DungeonLayer } from '@/store/types';
import type { AlignEdge, ZOrderOp } from '@dnd/core/src/store/propEdits';
import { resolveSelection, type SelectionKind } from '@dnd/core/src/store/selectionResolve';
import { alignSelection, distributeSelection, moveSelectionToLayer, orderSelectionNow } from '@/shortcuts/defaultShortcuts';
import { KIND_LABEL, mixedModel, type MixedModel } from './cardModels';
import type { CardDef } from '@/editor/registry/types';
import { VerbButton } from '@/editor/surfaces/Card';
import { liveVerbs } from '@/editor/surfaces/model';
import { groupBySection } from '@/editor/surfaces/sections';
import { CardField } from '@/editor/surfaces/SettingItems';
import { SELECTION_VERBS } from './verbs';
import { selectOnly } from './selectOnly';

const ALIGN: { edge: AlignEdge; label: string; icon: LucideIcon }[] = [
  { edge: 'left', label: 'Align left', icon: AlignStartVertical },
  { edge: 'hcenter', label: 'Align centre', icon: AlignCenterVertical },
  { edge: 'right', label: 'Align right', icon: AlignEndVertical },
  { edge: 'top', label: 'Align top', icon: AlignStartHorizontal },
  { edge: 'vcenter', label: 'Align middle', icon: AlignCenterHorizontal },
  { edge: 'bottom', label: 'Align bottom', icon: AlignEndHorizontal },
];

const ORDER: { op: ZOrderOp; label: string; icon: LucideIcon }[] = [
  { op: 'back', label: 'Send to back', icon: ArrowDownToLine },
  { op: 'backward', label: 'Send backward', icon: ArrowDown },
  { op: 'forward', label: 'Bring forward', icon: ArrowUp },
  { op: 'front', label: 'Bring to front', icon: ArrowUpToLine },
];

function Buttons({ label, children }: { label: string; children: ReactNode }) {
  return (
    <SettingRow label={label}>
      <span role="group" aria-label={label} className="flex gap-[2px]">
        {children}
      </span>
    </SettingRow>
  );
}

function Btn({ icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return <IconKeyButton size={26} icon={icon} label={label} data-tip={label} data-tip-side="bottom" onClick={onClick} />;
}

/** The level on show's unlocked layers, which a pick may move to. */
function useLayerChoices(): { value: string; label: string }[] {
  return useStore(
    useShallow((s) =>
      s.layers
        .filter((l): l is DungeonLayer => l.type === 'dungeon' && l.levelId === s.ui.activeLevelId && !l.locked)
        .map((l) => `${l.id}\u0000${l.name || 'Unnamed layer'}`),
    ),
  ).map((key) => {
    const [value, label] = key.split('\u0000');
    return { value, label };
  });
}

/**
 * The card for several things, or for one kind no card covers yet: the kinds counted in
 * the title, the shared verbs, Move to layer, Align and Distribute for what has a box,
 * Order (four) when props are in it, Select only per kind, and, when every member is one
 * kind with a card, that card's fields written to all of them. A locked member holds the
 * writes back; the header says how many are locked.
 */
export function MixedCard({ kindCard }: { kindCard?: CardDef }) {
  const key = useStore((s) => JSON.stringify(mixedModel(resolveSelection(s, s.selection.selectedIds))));
  const m = JSON.parse(key) as MixedModel;
  const ids = useStore(useShallow((s) => s.selection.selectedIds));
  const first = useStore((s) => {
    const sel = resolveSelection(s, s.selection.selectedIds);
    return sel.children[0]?.child ?? sel.walls[0]?.wall ?? sel.rooms[0]?.room ?? null;
  });
  const layers = useLayerChoices();
  const locked = m.locked > 0;
  const layerOptions = m.layerId ? layers : [{ value: '', label: 'Several layers' }, ...layers];
  const fields = kindCard ? groupBySection(kindCard.fields) : [];

  return (
    <FloatBox className="flex w-[272px] flex-col overflow-hidden p-0" data-testid="shell-card" data-kind="mixed">
      <PanelHeader path={['Selection']} title={m.title || 'Selection'}>
        {locked && (
          <span
            className="inline-flex h-[22px] items-center gap-1 rounded-pill border border-line px-2.5 text-[10px] text-text-2"
            data-testid="mixed-locked"
          >
            <Lock aria-hidden strokeWidth={2} className="size-2.5" />
            {m.locked} locked
          </span>
        )}
      </PanelHeader>
      <ActionRow aria-label="Selection actions">
        {liveVerbs(SELECTION_VERBS).map((v) => (
          <VerbButton key={v.id} verb={v} />
        ))}
      </ActionRow>
      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto px-3 pt-2.5 pb-3">
        <fieldset disabled={locked} className="m-0 flex flex-col gap-px border-0 p-0 disabled:opacity-[0.38]" data-section="">
          {layers.length > 0 && (
            <SelectRow
              label="Move to layer"
              value={m.layerId ?? ''}
              options={layerOptions}
              onValueChange={(id) => id && moveSelectionToLayer(id)}
            />
          )}
        </fieldset>
        {m.arrangeable >= 2 && (
          <div className="flex flex-col gap-px" data-section="Arrange">
            <Caption className="mb-1.5">Arrange</Caption>
            <Buttons label="Align">
              {ALIGN.map((a) => (
                <Btn key={a.edge} icon={a.icon} label={a.label} onClick={() => alignSelection(a.edge)} />
              ))}
            </Buttons>
            {m.arrangeable >= 3 && (
              <Buttons label="Distribute">
                <Btn icon={AlignHorizontalDistributeCenter} label="Distribute horizontally" onClick={() => distributeSelection('h')} />
                <Btn icon={AlignVerticalDistributeCenter} label="Distribute vertically" onClick={() => distributeSelection('v')} />
              </Buttons>
            )}
          </div>
        )}
        {m.hasProps && (
          <fieldset disabled={locked} className="m-0 flex flex-col gap-px border-0 p-0 disabled:opacity-[0.38]" data-section="Order">
            <Caption className="mb-1.5">Order</Caption>
            <Buttons label="Order">
              {ORDER.map((o) => (
                <Btn key={o.op} icon={o.icon} label={o.label} onClick={() => orderSelectionNow(o.op)} />
              ))}
            </Buttons>
          </fieldset>
        )}
        {m.kinds.length > 1 && (
          <div className="flex flex-col gap-px" data-section="Kinds" data-testid="mixed-kinds">
            <Caption className="mb-1.5">Kinds</Caption>
            {m.kinds.map(([kind, n]) => (
              <SettingRow key={kind} label={`${KIND_LABEL[kind as SelectionKind]} · ${n}`}>
                <SecondaryButton onClick={() => selectOnly(kind as SelectionKind)}>Select only</SecondaryButton>
              </SettingRow>
            ))}
          </div>
        )}
        {first &&
          fields.map((sec, i) => (
            <fieldset
              key={sec.title ?? `f${i}`}
              disabled={locked}
              className="m-0 flex flex-col gap-px border-0 p-0 disabled:opacity-[0.38]"
              data-section={sec.title ?? ''}
            >
              {sec.title && <Caption className="mb-1.5">{sec.title}</Caption>}
              {sec.items.map((f) => (
                <CardField key={f.id} field={f} object={first} ids={ids} />
              ))}
            </fieldset>
          ))}
      </div>
    </FloatBox>
  );
}

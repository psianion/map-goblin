import { ActionRow, Caption, FloatBox, IconKeyButton, PanelHeader } from '@/editor/components';
import { useStore } from '@/store/store';
import type { CardDef, Verb } from '@/editor/registry';
import { liveVerbs } from './model';
import { groupBySection } from './sections';
import { CardField } from './SettingItems';

export function VerbButton({ verb }: { verb: Verb }) {
  return (
    <IconKeyButton
      size={26}
      icon={verb.icon}
      label={verb.label}
      shortcut={verb.key}
      danger={verb.danger}
      data-tip={verb.label}
      data-tip-key={verb.key}
      data-tip-side="bottom"
      onClick={() => verb.run(useStore)}
    />
  );
}

/**
 * What is picked, in the slot: the kind's title with its layer, the verbs, then the
 * kind's fields under their captions. Fields read the object and write through the def.
 */
export function Card({ card, object, ids, layerName }: { card: CardDef; object: unknown; ids: readonly string[]; layerName: string | null }) {
  // Re-render on any store change so `when` and the verbs' state stay current.
  useStore((s) => s.selection);
  const title = (card.title as (o: unknown) => string)(object);
  const sections = groupBySection(card.fields);
  return (
    <FloatBox className="flex w-[272px] flex-col overflow-hidden p-0" data-testid="shell-card" data-kind={card.kind}>
      <PanelHeader path={['Selection']} title={title}>
        {layerName && (
          <span className="inline-flex h-[22px] items-center rounded-pill border border-line px-2.5 text-[10px] text-text-2">
            {layerName}
          </span>
        )}
      </PanelHeader>
      <ActionRow aria-label={`${title} actions`}>
        {liveVerbs(card.verbs).map((v) => (
          <VerbButton key={v.id} verb={v} />
        ))}
      </ActionRow>
      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto px-3 pt-2.5 pb-3">
        {sections.map((sec, i) => (
          <div key={sec.title ?? `s${i}`} className="flex flex-col gap-px" data-section={sec.title ?? ''}>
            {sec.title && <Caption className="mb-1.5">{sec.title}</Caption>}
            {sec.items.map((f) => (
              <CardField key={f.id} field={f} object={object} ids={ids} />
            ))}
          </div>
        ))}
      </div>
    </FloatBox>
  );
}

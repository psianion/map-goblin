import { Card } from '@/editor/surfaces/Card';
import { useCardTarget } from '@/editor/surfaces/hooks';
import { useStore } from '@/store/store';
import { resolveSelection, type SelectionKind } from '@dnd/core/src/store/selectionResolve';
import { useRegistry } from '@/editor/shell/registryContext';
import type { CardDef } from '@/editor/registry';
import { resolvePropTarget } from '@/editor/models/selectionModel';
import { GroupCard } from './GroupCard';
import { MixedCard } from './MixedCard';

/**
 * Select's card host: one thing picked with a card for its kind shows that card; several
 * things, or one of a kind no card covers yet, show the Mixed card, with the kind's
 * fields when every member is that kind. Every member of one group picked shows the group card.
 */
export function SelectionPanel() {
  const { registry } = useRegistry();
  const target = useCardTarget();
  const count = useStore((s) => s.selection.selectedIds.length);
  const soleKind = useStore((s) => {
    const kinds = Object.keys(resolveSelection(s, s.selection.selectedIds).kinds) as SelectionKind[];
    return kinds.length === 1 ? kinds[0] : null;
  });
  const ids = useStore((s) => s.selection.selectedIds);
  const layers = useStore((s) => s.layers);
  const many = ids.length > 1 ? resolvePropTarget({ layers }, ids) : null;
  const group = many?.kind === 'prop-group' ? many : null;
  if (count === 1 && target) return <Card {...target} />;
  if (group) return <GroupCard group={group.group} layer={group.layer} members={group.members} />;
  return <MixedCard kindCard={soleKind ? (registry.cardForKind(soleKind) as CardDef | undefined) : undefined} />;
}

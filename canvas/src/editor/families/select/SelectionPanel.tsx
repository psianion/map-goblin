import { Card } from '@/editor/surfaces/Card';
import { useCardTarget } from '@/editor/surfaces/hooks';
import { useStore } from '@/store/store';
import { resolveSelection, type SelectionKind } from '@dnd/core/src/store/selectionResolve';
import { useRegistry } from '@/editor/shell/registryContext';
import type { CardDef } from '@/editor/registry';
import { MixedCard } from './MixedCard';

/**
 * Select's card host: one thing picked with a card for its kind shows that card; several
 * things, or one of a kind no card covers yet, show the Mixed card, with the kind's
 * fields when every member is that kind.
 */
export function SelectionPanel() {
  const { registry } = useRegistry();
  const target = useCardTarget();
  const count = useStore((s) => s.selection.selectedIds.length);
  const soleKind = useStore((s) => {
    const kinds = Object.keys(resolveSelection(s, s.selection.selectedIds).kinds) as SelectionKind[];
    return kinds.length === 1 ? kinds[0] : null;
  });
  if (count === 1 && target) return <Card {...target} />;
  return <MixedCard kindCard={soleKind ? (registry.cardForKind(soleKind) as CardDef | undefined) : undefined} />;
}

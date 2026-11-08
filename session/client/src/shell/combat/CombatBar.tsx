import { FloatBox, IconKeyButton, PrimaryButton, cn } from '@dnd/ui';
import { ChevronLeft } from '@dnd/ui/icons';
import { useCombatBar } from '../../modules/initiative/useCombatBar';
import { useTokenInteraction } from '../../modules/tokens/drag';
import { useRole } from '../../session/store';
import { TokenPortrait } from '../../modules/tokens/TokenPortrait';
import { seatColour } from '../seatColour';

/**
 * Board 3 and 5: top centre while an encounter runs on this scene. Portrait chips in turn
 * order, the current one enlarged with a ring, the round, the previous arrow and Next for the
 * DM, End turn for the player whose turn it is. The data is the initiative side's
 * (`useCombatBar`); this only draws it.
 */
export function CombatBar() {
  const bar = useCombatBar();
  const dm = useRole() === 'dm';
  if (!bar.active) return null;
  return (
    <FloatBox
      className="absolute top-3 left-1/2 z-20 flex h-14 max-w-xl -translate-x-1/2 items-center gap-2 px-2 py-0"
      data-testid="combat-bar"
      data-chrome
      role="region"
      aria-label="Combat"
    >
      {bar.canAdvance && !bar.gathering && (
        <IconKeyButton size={28} icon={ChevronLeft} label="Previous turn" data-testid="combat-previous" onClick={bar.previous} />
      )}
      <ol className="flex min-w-0 items-center gap-1.5 overflow-x-auto" aria-label="Turn order">
        {bar.order.map((c) => (
          <li
            key={c.key}
            data-testid="combat-chip"
            data-current={c.current ? 'true' : undefined}
            title={c.name}
            aria-current={c.current ? 'true' : undefined}
            className={cn('shrink-0 rounded-pill', c.current && 'ring-2 ring-ink ring-offset-2 ring-offset-panel', c.down && 'opacity-40')}
            style={c.identityId ? { boxShadow: `0 0 0 2px ${seatColour(c.identityId)}` } : undefined}
          >
            {dm && c.tokenId ? (
              // The DM picks a combatant from the bar: it selects that token, for damage and effects.
              <button
                type="button"
                aria-label={`Select ${c.name}`}
                data-testid="combat-chip-select"
                className="block rounded-pill"
                onClick={() => useTokenInteraction.getState().select(c.tokenId)}
              >
                <TokenPortrait name={c.name} assetId={c.imageAssetId} className={c.current ? 'size-10' : 'size-8'} />
              </button>
            ) : (
              <TokenPortrait name={c.name} assetId={c.imageAssetId} className={c.current ? 'size-10' : 'size-8'} />
            )}
          </li>
        ))}
      </ol>
      <span className="px-1 font-mono text-xs whitespace-nowrap text-text-2" data-testid="combat-round">
        {bar.gathering ? 'Rolling initiative' : `Round ${bar.round}`}
      </span>
      {bar.canAdvance && !bar.gathering && (
        <PrimaryButton className="h-8 px-3 text-xs" data-testid="combat-next" onClick={bar.next}>
          Next
        </PrimaryButton>
      )}
      {bar.isMyTurn && (
        <PrimaryButton className="h-8 px-3 text-xs" data-testid="combat-end-turn" onClick={bar.endTurn}>
          End turn
        </PrimaryButton>
      )}
    </FloatBox>
  );
}

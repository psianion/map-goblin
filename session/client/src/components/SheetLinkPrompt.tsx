// The one-time nudge to link a claimed token to the D&D Beyond sheet Beyond20 just detected.
// Same shape as InitiativePrompt and for the same reason — a modal mid-session stops the game
// to ask something the player can answer with one click and forget. Binding is always
// player-confirmed (never a silent auto-bind); first-sheet-sticks is enforced here, not on
// the server (module.ts's `update` lets an owner overwrite an existing link on purpose) — this
// only offers the prompt for a claimed token that has none yet, so a bound token never asks
// again unless the player unlinks it (MePanel) first.

import { useClaimedTokens } from '../modules/tokens/TokenRenderer';
import { sheetKey, useDetectedSheet } from '../session/detectedSheet';
import { prefersReducedMotion } from '../session/motion';
import { useSessionStore } from '../session/store';

const link = (tokenId: string, sheet: unknown): void =>
  useSessionStore.getState().sendCommand('tokens', 'update', { id: tokenId, sheet });

export function SheetLinkPrompt() {
  const sheet = useDetectedSheet((s) => s.sheet);
  const dismissed = useDetectedSheet((s) => s.dismissed);
  const dismiss = useDetectedSheet((s) => s.dismiss);
  const claimed = useClaimedTokens();

  // Any claimed token already holding this exact sheet ends the offer outright — without this
  // a PC linked first left the loop re-offering the same sheet for a familiar the moment the
  // PC's own link landed. Unlinking that token clears its `sheet`, which drops it out of this
  // check and brings the prompt straight back; a different detected sheet is unaffected, so it
  // can still prompt for the second token.
  const alreadyLinked =
    !!sheet && claimed.some((t) => t.sheet && sheetKey(t.sheet) === sheetKey(sheet));
  // First-sheet-sticks: only a claimed token with no binding yet is offered one.
  const target = claimed.find((t) => !t.sheet);
  if (!sheet || !target || alreadyLinked || dismissed.has(sheetKey(sheet))) return null;

  const entrance = prefersReducedMotion() ? '' : 'animate-toast-in';

  return (
    <div
      // Same track InitiativePrompt sits on; the two are mutually exclusive in practice (a
      // sheet link is offered outside combat's gather phase) but stack cleanly if they ever
      // do coincide.
      className="pointer-events-none absolute inset-x-0 bottom-32 z-toolbar flex flex-col items-center px-4 max-sm:bottom-40"
    >
      <div
        data-testid="sheet-link-prompt"
        // Neutral surface (chrome-style-guide.md "Overlays neutral, accent themeable") — the
        // accent lives on the Link button alone, never on the card itself.
        className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded border border-border-default bg-surface-2 px-3 py-2 text-sm text-text-primary shadow-lg shadow-black/50 ${entrance}`}
      >
        <p className="min-w-0 flex-1 truncate">
          Link {sheet.name} to {target.name}?
        </p>
        <button
          type="button"
          data-testid="sheet-link-dismiss"
          onClick={() => dismiss(sheetKey(sheet))}
          className="shrink-0 rounded-chip border border-border-default px-2 py-1 text-xs font-medium text-text-primary transition-colors duration-150 ease-out-quart hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:bg-surface-1 motion-reduce:transition-none"
        >
          Not now
        </button>
        <button
          type="button"
          data-testid="sheet-link-confirm"
          onClick={() => link(target.id, sheet)}
          className="shrink-0 rounded-chip border border-accent-active bg-accent-active px-2 py-1 text-xs font-medium text-on-accent transition-colors duration-150 ease-out-quart hover:bg-accent-active/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none"
        >
          Link
        </button>
      </div>
    </div>
  );
}

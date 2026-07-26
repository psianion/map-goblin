import { ConnectionStatus, ReconnectingBanner } from '../components/ConnectionStatus';
import { InviteCodeChip } from '../components/InviteCodeChip';
import { PlayerList } from '../components/PlayerList';
import { GameRenderer } from '../renderer/GameRenderer';

/**
 * §2.6 — the table. Renderer takes the room, sidebar carries presence.
 *
 * D9: the whole page is `h-full` off `#root`, never `100vh`. Below `md` the
 * sidebar stacks under the map instead of beside it.
 */
export default function GameTable() {
  return (
    <div data-page="table" className="flex h-full flex-col bg-neutral-950 text-neutral-100 md:flex-row">
      {/* min-w-0/min-h-0: without them the canvas's intrinsic size pins this flex
          item open, so the page overflows instead of the renderer shrinking. */}
      <main className="relative min-h-0 min-w-0 flex-1">
        <ReconnectingBanner />
        <GameRenderer />
      </main>

      <aside className="flex shrink-0 flex-col gap-4 border-neutral-800 p-3 max-md:border-t md:w-64 md:overflow-y-auto md:border-l">
        <InviteCodeChip />

        <section>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Players
          </h2>
          <PlayerList />
        </section>

        <div className="mt-auto border-t border-neutral-800 pt-3">
          <ConnectionStatus />
        </div>
      </aside>
    </div>
  );
}

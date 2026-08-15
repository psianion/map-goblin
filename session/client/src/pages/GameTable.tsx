import { useEffect } from 'react';
import { ActiveToolIndicator } from '../components/ActiveToolIndicator';
import { ReconnectingBanner } from '../components/ConnectionStatus';
import { ToastHost } from '../components/Toast';
import { TriggerPrompts } from '../components/TriggerPrompts';
import { GameRenderer } from '../renderer/GameRenderer';
import { FitScreenButton, TableStatusBar } from '../components/TableStatusBar';
import { usePanels } from '../session/panels';
import { resumeSeat, useRole } from '../session/store';
import { useTriggerToasts } from '../session/useTriggerToasts';

// Side-effect imports: each of these calls `registerPanel` at module scope. This
// list is the only thing a new module adds to the shell (D8) — the sidebar below
// never learns their names. Module folders (`src/modules/*`) register from their
// own index; nothing here needs to change for them.
import '../components/SessionControls';
import '../components/PlayerScenes';
import '../components/GameLog';
import '../modules/rolls/beyond20';
import '../modules/tokens';
import '../modules/doors';
import '../modules/fog';
import '../modules/triggers';
import '../modules/world';

/**
 * §2.6 — the table. Renderer takes the room, sidebar carries the registered panels.
 *
 * D9: the whole page is `h-full` off `#root`, never `100vh`. Below `md` the
 * sidebar stacks under the map instead of beside it.
 */
export default function GameTable() {
  const panels = usePanels(useRole());

  // A refresh unmounts everything but the seat is in sessionStorage — take it back.
  useEffect(() => {
    resumeSeat();
  }, []);

  // The table's ear for trigger narration (§useTriggerToasts) — mounted once here rather
  // than inside a panel, because it has to run whether or not the triggers panel (DM-only)
  // or any panel at all is on screen.
  useTriggerToasts();

  return (
    <div data-page="table" className="flex h-full flex-col bg-surface-0 text-text-primary md:flex-row">
      {/* min-w-0/min-h-0: without them the canvas's intrinsic size pins this flex
          item open, so the page overflows instead of the renderer shrinking. */}
      {/* The tool indicator and the toast belong over the map, not in the sidebar: they are
          about what the next click does and what the last one did. */}
      <main className="relative min-h-0 min-w-0 flex-1">
        <ReconnectingBanner />
        <GameRenderer />
        <ActiveToolIndicator />
        <FitScreenButton />
        <TableStatusBar />
        <ToastHost />
        <TriggerPrompts />
      </main>

      <aside className="flex shrink-0 flex-col gap-4 border-border-default p-3 max-md:border-t md:w-64 md:overflow-y-auto md:border-l">
        {panels.map(({ id, title, component: Panel }) => (
          <section key={id} data-panel={id}>
            {title && (
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                {title}
              </h2>
            )}
            <Panel />
          </section>
        ))}

      </aside>
    </div>
  );
}

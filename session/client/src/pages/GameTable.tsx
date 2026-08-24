import { useEffect } from 'react';
import { ReconnectingBanner } from '../components/ConnectionStatus';
import { InitiativePrompt } from '../components/InitiativePrompt';
import { ToastHost } from '../components/Toast';
import { TriggerPrompts } from '../components/TriggerPrompts';
import { mountTurnRingWhenReady } from '../modules/initiative/TurnRing';
import { TokenMenu } from '../modules/tokens/TokenMenu';
import { DoorMenu } from '../modules/doors/DoorMenu';
import { LightPopover } from '../modules/lights/LightPopover';
import { GameRenderer } from '../renderer/GameRenderer';
import { TableStatusBar } from '../components/TableStatusBar';
import { LogDrawer } from '../shell/LogDrawer';
import { PartyStrip } from '../shell/PartyStrip';
import { Popover } from '../shell/Popover';
import { Rail } from '../shell/Rail';
import { RollBar } from '../shell/RollBar';
import { Ticker } from '../shell/Ticker';
import { TurnPill } from '../shell/TurnPill';
import { useHotkeys } from '../shell/hotkeys';
import { usePanels } from '../session/panels';
import { resumeSeat, useRole } from '../session/store';
import { useTriggerToasts } from '../session/useTriggerToasts';

// Side-effect imports: each of these calls `registerPanel` at module scope. This
// list is the only thing a new module adds to the shell (D8) — the rail below
// never learns their names. Module folders (`src/modules/*`) register from their
// own index; nothing here needs to change for them.
import '../components/GameLog';
import '../modules/initiative';
import '../modules/rolls/beyond20';
import '../modules/tokens';
import '../modules/doors';
import '../modules/fog';
import '../modules/lights';
import '../modules/scene';
import '../modules/triggers';
import '../modules/world';
import '../shell/SessionPopover';

/**
 * §2.6 — the table. Renderer owns the whole viewport; every registered panel lives behind
 * the icon rail as an anchored popover (M1) instead of a permanent sidebar.
 *
 * D9: the whole page is `h-full` off `#root`, never `100vh`.
 */
export default function GameTable() {
  // M4 — the player shell swaps the party strip for a turn pill + roll bar; the DM keeps the
  // strip and gets neither (InitiativePanel/PartyStrip already answer both questions there).
  const role = useRole();

  // A refresh unmounts everything but the seat is in sessionStorage — take it back.
  useEffect(() => {
    resumeSeat();
  }, []);

  // The table's ear for trigger narration (§useTriggerToasts) — mounted once here rather
  // than inside a panel, because it has to run whether or not the triggers panel (DM-only)
  // or any panel at all is open.
  useTriggerToasts();

  // Mounted here rather than from a panel for the same reason: whose turn it is has to be
  // marked on the map for every seat, however the rail happens to be filtered.
  useEffect(() => mountTurnRingWhenReady(), []);

  // Every module's map-side companion (token layer, door layer, fog overlay) — a popover
  // renders only while open, so the overlays mount from here, once per seat.
  const panels = usePanels(role);
  useEffect(() => {
    const downs = panels.map((p) => p.mount?.()).filter((d): d is () => void => typeof d === 'function');
    return () => downs.forEach((d) => d());
  }, [panels]);

  // One shell-wide keydown listener (panel letters, L, Shift+D, Esc order) — see hotkeys.ts.
  useHotkeys();

  return (
    <div data-page="table" className="relative h-full bg-surface-0 text-text-primary">
      <main className="relative h-full">
        {/* Inset by the rail's own width so the renderer's true pixel size — and therefore
            fit-to-screen — matches what is actually visible beside the rail (D9). */}
        <div className="absolute inset-0 right-14">
          <GameRenderer />
        </div>

        <ReconnectingBanner />
        {role === 'player' ? (
          <>
            <TurnPill />
            <RollBar />
          </>
        ) : (
          <PartyStrip />
        )}
        <Ticker />
        <LogDrawer />
        <TableStatusBar />
        <DoorMenu />
        <TokenMenu />
        <LightPopover />
        <Rail />
        <Popover />
        <ToastHost />
        <TriggerPrompts />
        <InitiativePrompt />
      </main>
    </div>
  );
}

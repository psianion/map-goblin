import { useEffect } from 'react';
import { ReconnectingBanner } from '../components/ConnectionStatus';
import { InitiativePrompt } from '../components/InitiativePrompt';
import { SheetLinkPrompt } from '../components/SheetLinkPrompt';
import { ToastHost } from '../components/Toast';
import { TriggerPrompts } from '../components/TriggerPrompts';
import { mountTurnRingWhenReady } from '../modules/initiative/TurnRing';
import { TokenMenu } from '../modules/tokens/TokenMenu';
import { DoorMenu } from '../modules/doors/DoorMenu';
import { CrossingMenu } from '../modules/crossings/CrossingMenu';
import { CrossingChips } from '../modules/crossings/CrossingChips';
import { LightPopover } from '../modules/lights/LightPopover';
import { GameRenderer } from '../renderer/GameRenderer';
import { TableStatusBar } from '../components/TableStatusBar';
import { LogDrawer } from '../shell/LogDrawer';
import { PartyStrip } from '../shell/PartyStrip';
import { Popover } from '../shell/Popover';
import { Rail } from '../shell/Rail';
import { RollBar } from '../shell/RollBar';
import { Sidebar } from '../shell/Sidebar';
import { Ticker } from '../shell/Ticker';
import { TurnPill } from '../shell/TurnPill';
import { Dock } from '../shell/dock/Dock';
import { useDockMounts } from '../shell/dock/useDockTabs';
import { useHotkeys } from '../shell/hotkeys';
import { legacyShellOn } from '../shell/legacy';
import { MarksLayer } from '../shell/marks/MarksLayer';
import { mountMarkInputWhenReady } from '../shell/marks/markInput';
import { TableRail } from '../shell/rail/Rail';
import { SheetHost } from '../shell/sheets/SheetHost';
import { TopRight } from '../shell/top/TopRight';
import { useOverlayMode, useShell } from '../shell/shellStore';
import { usePanels } from '../session/panels';
import { resumeSeat, useRole } from '../session/store';
import { useRefusalToasts } from '../session/useRefusalToasts';
import { useTriggerToasts } from '../session/useTriggerToasts';

// Side-effect imports: each of these calls `registerPanel` at module scope. The panels' map
// companions (token layer, door layer, fog overlay) still mount through them; the popovers
// themselves only show with the old shell (`legacyShellOn`).
import '../components/GameLog';
import '../modules/initiative';
import '../modules/rolls/beyond20';
import '../modules/tokens';
import '../modules/doors';
import '../modules/crossings';
import '../modules/fog';
import '../modules/lights';
import '../modules/scene';
import '../modules/triggers';
import '../modules/world';
import '../shell/SessionPopover';
// The new chrome's registries: dock tabs, rail tools, sheets.
import '../shell/dock/tabs';
import '../shell/rail/tools';
import '../shell/sheets';

const LEGACY = legacyShellOn();

/**
 * §2.6 — the table. The renderer owns the whole viewport and the chrome floats over it:
 * title card and rail on the left, presence and menus top right, the DM's dock along the
 * bottom, sheets on the right.
 *
 * D9: the whole page is `h-full` off `#root`, never `100vh`.
 */
export default function GameTable() {
  const role = useRole();

  // A refresh unmounts everything but the seat is in sessionStorage — take it back.
  useEffect(() => {
    resumeSeat();
  }, []);

  // Trigger narration and refused commands: both have to be heard whatever is open.
  useTriggerToasts();
  useRefusalToasts();

  // Whose turn it is is marked on the map for every seat.
  useEffect(() => mountTurnRingWhenReady(), []);
  // The rail's mark tools (ping, measure, template, draw, pin) on the map.
  useEffect(() => mountMarkInputWhenReady(), []);

  // Every module's map-side companion (token layer, door layer, fog overlay), once per seat.
  const panels = usePanels(role);
  useEffect(() => {
    const downs = panels.map((p) => p.mount?.()).filter((d): d is () => void => typeof d === 'function');
    return () => downs.forEach((d) => d());
  }, [panels]);
  // …and the dock tabs' own, for the DM.
  useDockMounts(role);

  // One shell-wide keydown listener (registries plus board 9's fixed keys) — see hotkeys.ts.
  useHotkeys();

  const sidebarOpen = useShell((s) => s.sidebarOpen);
  const drawerOpen = useShell((s) => s.drawerOpen);
  const overlay = useOverlayMode();
  const inset = LEGACY
    ? `${sidebarOpen && !overlay ? 'left-[300px]' : 'left-0'} ${drawerOpen ? 'right-[356px]' : 'right-14'}`
    : '';

  return (
    <div data-page="table" className="relative h-full bg-bg text-text">
      <main className="relative h-full">
        {/* The renderer's true pixel size is what is visible, so fit-to-screen fits (D9). */}
        <div className={`absolute inset-0 ${inset}`}>
          <GameRenderer />
          <MarksLayer />
        </div>

        <ReconnectingBanner />
        {role === 'player' && (
          <>
            <TurnPill />
            <RollBar />
          </>
        )}
        {LEGACY && (
          <>
            {role === 'dm' && <PartyStrip />}
            <Ticker />
            <LogDrawer />
            <TableStatusBar />
            <Sidebar />
            <Rail />
            <Popover />
          </>
        )}
        <DoorMenu />
        <CrossingMenu />
        <CrossingChips />
        <TokenMenu />
        <LightPopover />
        {!LEGACY && (
          <>
            <TableRail />
            <TopRight />
            {role === 'dm' && <Dock />}
            <SheetHost />
          </>
        )}
        <ToastHost />
        <TriggerPrompts />
        <InitiativePrompt />
        <SheetLinkPrompt />
      </main>
    </div>
  );
}

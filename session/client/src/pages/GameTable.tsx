import { useEffect } from 'react';
import { SheetLinkPrompt } from '../components/SheetLinkPrompt';
import { TriggerPrompts } from '../components/TriggerPrompts';
import { CrossingChips } from '../modules/crossings/CrossingChips';
import { CrossingMenu } from '../modules/crossings/CrossingMenu';
import { DoorCard } from '../modules/doors/DoorCard';
import { LightCard } from '../modules/lights/LightCard';
import { StoryOverlay } from '../modules/story/StoryOverlay';
import { TokenMenu } from '../modules/tokens/TokenMenu';
import { GameRenderer } from '../renderer/GameRenderer';
import { ConnectionNotice } from '../shell/Connection';
import { DiagnosticsChip } from '../shell/DiagnosticsChip';
import { CombatBar } from '../shell/combat/CombatBar';
import { Dock } from '../shell/dock/Dock';
import { useDockMounts } from '../shell/dock/useDockTabs';
import { useHotkeys } from '../shell/hotkeys';
import { useMapLayers } from '../shell/mapLayers';
import { MarksLayer } from '../shell/marks/MarksLayer';
import { PinCard } from '../shell/marks/PinCard';
import { PhoneBar } from '../shell/phone/PhoneBar';
import { TableRail } from '../shell/rail/Rail';
import { SheetHost } from '../shell/sheets/SheetHost';
import { TabColumn } from '../shell/sheets/TabColumn';
import { TableToaster } from '../shell/TableToaster';
import { InviteCard } from '../shell/top/InviteCard';
import { TitleCard } from '../shell/top/TitleCard';
import { TopRight } from '../shell/top/TopRight';
import { WaitingCard } from '../shell/WaitingCard';
import { ZoomPill } from '../shell/ZoomPill';
import { resumeSeat, useRole } from '../session/store';
import { useRefusalToasts } from '../session/useRefusalToasts';
import { useTriggerToasts } from '../session/useTriggerToasts';

// The play side's registrations (Token type, Party and Character sheets, Beyond20).
import '../modules/initiative';
import '../modules/rolls/beyond20';
import '../modules/tokens';
// The chrome's registries: dock tabs, rail tools, sheets.
import '../shell/dock/tabs';
import '../shell/rail/tools';
import '../shell/sheets';

/**
 * §2.6: the table. The renderer owns the whole viewport and the chrome floats over it: title
 * card and rail on the left, presence and menus top right, the DM's dock along the bottom,
 * sheets on the right, the phone bar under a player's thumb.
 *
 * D9: the whole page is `h-full` off `#root`, never `100vh`.
 */
export default function GameTable() {
  const role = useRole();

  // A refresh unmounts everything but the seat is in sessionStorage: take it back.
  useEffect(() => {
    resumeSeat();
  }, []);

  // Trigger narration and refused commands have to be heard whatever is open.
  useTriggerToasts();
  useRefusalToasts();

  // What every seat draws on the map, and the DM's dock tabs' own overlays.
  useMapLayers(role);
  useDockMounts(role);

  // One shell-wide keydown listener (registries plus board 9's fixed keys): see hotkeys.ts.
  useHotkeys();

  return (
    <div data-page="table" className="relative h-full bg-bg text-text">
      <main className="relative h-full">
        {/* The renderer's true pixel size is what is visible, so fit-to-screen fits (D9). */}
        <div className="absolute inset-0">
          <GameRenderer />
          <MarksLayer />
        </div>

        <CrossingMenu />
        <CrossingChips />
        <TokenMenu />
        <DoorCard />
        <LightCard />
        <PinCard />

        <TitleCard />
        <TableRail />
        <TopRight />
        <CombatBar />
        <TabColumn />
        {role === 'dm' ? <Dock /> : <ZoomPill />}
        <SheetHost />
        <PhoneBar />
        <InviteCard />
        <WaitingCard />
        <StoryOverlay />
        <DiagnosticsChip />
        <ConnectionNotice />
        <TableToaster />

        <TriggerPrompts />
        <SheetLinkPrompt />
      </main>
    </div>
  );
}

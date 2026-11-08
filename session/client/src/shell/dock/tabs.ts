// The DM dock's eight tabs, one `registerDockTab` call each. A tab's owner replaces its stub
// by pointing that call at the real Body (and Strip, context, onMap); nothing else in the
// shell changes. Imported once, from GameTable.
import { BookOpen, Clapperboard, CloudFog, CloudSun, Dice5, Map as MapIcon, Swords, Users } from '@dnd/ui/icons';
import { registerDockTab } from './registry';
import { TokensBody, TokensStrip } from '../../modules/tokens/TokensTab';
import { tokensContext } from '../../modules/tokens/play';
import { EncounterBody, EncounterStrip } from '../../modules/initiative/EncounterTab';
import { encounterContext, encounterOnMap } from '../../modules/initiative/encounterDock';
import { DiceBody, DiceStrip } from '../../modules/rolls/DiceTab';
import { diceContext } from '../../modules/rolls/dice';
import { FogBody, FogStrip } from '../../modules/fog/FogTab';
import { MapBody, MapStrip } from '../../modules/map/MapTab';
import { StoryBody, StoryStrip } from '../../modules/story/StoryTab';
import { WorldBody, WorldStrip } from '../../modules/world/WorldTab';
import { ScenesBody, ScenesStrip } from '../../modules/scene/ScenesTab';
import { useSessionStore } from '../../session/store';
import { mountFogOverlayWhenReady } from '../../modules/fog/FogOverlay';
import { mountLightsEditor } from '../../modules/lights/LightEditor';
import { mountCrossingInput } from '../../modules/crossings/crossingInput';
import { mountWhenEngineReady } from '../../renderer/overlayLayer';

/** The Map tab's overlays: light icons to click, and the crossing picker on right-click. */
const mapOnMap = (): (() => void) => {
  const downs = [mountWhenEngineReady(mountLightsEditor), mountCrossingInput()];
  return () => downs.forEach((down) => down());
};

/** "on Web Gallery": the live scene the tab is working on. */
const onScene = (): string | null => {
  const session = useSessionStore.getState().session;
  const name = session?.scenes.find((s) => s.id === session.activeSceneId)?.name;
  return name ? `on ${name}` : null;
};

registerDockTab({ id: 'fog', title: 'Fog', icon: CloudFog, key: '1', Body: FogBody, Strip: FogStrip, context: onScene, onMap: () => mountFogOverlayWhenReady() });
registerDockTab({ id: 'map', title: 'Map', icon: MapIcon, key: '2', Body: MapBody, Strip: MapStrip, context: onScene, onMap: mapOnMap });
registerDockTab({ id: 'tokens', title: 'Tokens', icon: Users, key: '3', Body: TokensBody, Strip: TokensStrip, context: tokensContext });
registerDockTab({ id: 'encounter', title: 'Encounter', icon: Swords, key: '4', Body: EncounterBody, Strip: EncounterStrip, context: encounterContext, onMap: encounterOnMap });
registerDockTab({ id: 'story', title: 'Story', icon: BookOpen, key: '5', Body: StoryBody, Strip: StoryStrip });
registerDockTab({ id: 'world', title: 'World', icon: CloudSun, key: '6', Body: WorldBody, Strip: WorldStrip, context: onScene });
registerDockTab({ id: 'scenes', title: 'Scenes', icon: Clapperboard, key: '7', Body: ScenesBody, Strip: ScenesStrip });
registerDockTab({ id: 'dice', title: 'Dice', icon: Dice5, key: '8', Body: DiceBody, Strip: DiceStrip, context: diceContext });

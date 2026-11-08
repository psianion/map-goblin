// The DM dock's eight tabs, one `registerDockTab` call each. A tab's owner replaces its stub
// by pointing that call at the real Body (and Strip, context, onMap); nothing else in the
// shell changes. Imported once, from GameTable.
import { BookOpen, Clapperboard, CloudFog, CloudSun, Dice5, Map as MapIcon, Swords, Users } from '@dnd/ui/icons';
import { registerDockTab } from './registry';
import { TokensBody, TokensStrip } from '../../modules/tokens/TokensTab';
import { tokensContext } from '../../modules/tokens/play';
import { DiceStub, EncounterStub } from './stubs';
import { FogBody, FogStrip } from '../../modules/fog/FogTab';
import { MapBody, MapStrip } from '../../modules/map/MapTab';
import { StoryBody, StoryStrip } from '../../modules/story/StoryTab';
import { WorldBody, WorldStrip } from '../../modules/world/WorldTab';
import { ScenesBody, ScenesStrip } from '../../modules/scene/ScenesTab';
import { useSessionStore } from '../../session/store';

/** "on Web Gallery": the live scene the tab is working on. */
const onScene = (): string | null => {
  const session = useSessionStore.getState().session;
  const name = session?.scenes.find((s) => s.id === session.activeSceneId)?.name;
  return name ? `on ${name}` : null;
};

registerDockTab({ id: 'fog', title: 'Fog', icon: CloudFog, key: '1', Body: FogBody, Strip: FogStrip, context: onScene });
registerDockTab({ id: 'map', title: 'Map', icon: MapIcon, key: '2', Body: MapBody, Strip: MapStrip, context: onScene });
registerDockTab({ id: 'tokens', title: 'Tokens', icon: Users, key: '3', Body: TokensBody, Strip: TokensStrip, context: tokensContext });
registerDockTab({ id: 'encounter', title: 'Encounter', icon: Swords, key: '4', Body: EncounterStub });
registerDockTab({ id: 'story', title: 'Story', icon: BookOpen, key: '5', Body: StoryBody, Strip: StoryStrip });
registerDockTab({ id: 'world', title: 'World', icon: CloudSun, key: '6', Body: WorldBody, Strip: WorldStrip, context: onScene });
registerDockTab({ id: 'scenes', title: 'Scenes', icon: Clapperboard, key: '7', Body: ScenesBody, Strip: ScenesStrip });
registerDockTab({ id: 'dice', title: 'Dice', icon: Dice5, key: '8', Body: DiceStub });

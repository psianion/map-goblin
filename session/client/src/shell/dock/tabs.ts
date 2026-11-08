// The DM dock's eight tabs, one `registerDockTab` call each. A tab's owner replaces its stub
// by pointing that call at the real Body (and Strip, context, onMap); nothing else in the
// shell changes. Imported once, from GameTable.
import { BookOpen, Clapperboard, CloudFog, CloudSun, Dice5, Map as MapIcon, Swords, Users } from '@dnd/ui/icons';
import { registerDockTab } from './registry';
import { DiceStub, EncounterStub, FogStub, MapStub, ScenesStub, StoryStub, TokensStub, WorldStub } from './stubs';

registerDockTab({ id: 'fog', title: 'Fog', icon: CloudFog, key: '1', Body: FogStub });
registerDockTab({ id: 'map', title: 'Map', icon: MapIcon, key: '2', Body: MapStub });
registerDockTab({ id: 'tokens', title: 'Tokens', icon: Users, key: '3', Body: TokensStub });
registerDockTab({ id: 'encounter', title: 'Encounter', icon: Swords, key: '4', Body: EncounterStub });
registerDockTab({ id: 'story', title: 'Story', icon: BookOpen, key: '5', Body: StoryStub });
registerDockTab({ id: 'world', title: 'World', icon: CloudSun, key: '6', Body: WorldStub });
registerDockTab({ id: 'scenes', title: 'Scenes', icon: Clapperboard, key: '7', Body: ScenesStub });
registerDockTab({ id: 'dice', title: 'Dice', icon: Dice5, key: '8', Body: DiceStub });

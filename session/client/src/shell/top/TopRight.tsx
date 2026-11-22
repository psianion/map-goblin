import { fogOn, type FogState } from '@dnd/mechanics/fog';
import { FloatBox, SecondaryButton, Separator } from '@dnd/ui';
import { Eye } from '@dnd/ui/icons';
import { toggleAsPlayers, useAsPlayers } from '../../modules/fog/asPlayers';
import { sceneFog } from '../../modules/fog/fog';
import { useModuleState, useSessionStore } from '../../session/store';
import { InviteButton } from './InviteCard';
import { Presence } from './Presence';
import { SessionMenu } from './SessionMenu';
import { ViewMenu } from './ViewMenu';
import { TableDownloadPill } from './TableDownloadPill';

/** The DM's "As players see it", while the scene has fog to see: the cloud solid on this tab. */
export function AsPlayersButton() {
  const isDm = useSessionStore((s) => s.you?.role === 'dm');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const fog = useModuleState<FogState>('fog');
  const on = useAsPlayers((s) => s.on);
  if (!isDm || !fogOn(sceneFog(fog, sceneId))) return null;
  return (
    <SecondaryButton icon={Eye} active={on} className="mx-0.5" data-testid="as-players" onClick={toggleAsPlayers}>
      As players see it
    </SecondaryButton>
  );
}

/** Top right: presence, Invite (DM), As players see it (DM, fog on), View and Session, then the download pill. */
export function TopRight() {
  return (
    <FloatBox className="absolute top-3 right-3 z-20 flex h-11 items-center gap-1 px-1.5 py-0" data-testid="top-right" data-chrome>
      <Presence />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <InviteButton />
      <AsPlayersButton />
      <ViewMenu />
      <SessionMenu />
      <TableDownloadPill />
    </FloatBox>
  );
}

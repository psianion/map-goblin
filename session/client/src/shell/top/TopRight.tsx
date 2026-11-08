import { FloatBox, Separator } from '@dnd/ui';
import { InviteButton } from './InviteCard';
import { Presence } from './Presence';
import { SessionMenu } from './SessionMenu';
import { ViewMenu } from './ViewMenu';
import { TableDownloadPill } from './TableDownloadPill';

/** Top right: presence, Invite (DM), View and Session, then the download pill while art downloads. */
export function TopRight() {
  return (
    <FloatBox className="absolute top-3 right-3 z-20 flex h-11 items-center gap-1 px-1.5 py-0" data-testid="top-right" data-chrome>
      <Presence />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <InviteButton />
      <ViewMenu />
      <SessionMenu />
      <TableDownloadPill />
    </FloatBox>
  );
}

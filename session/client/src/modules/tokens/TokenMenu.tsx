// The on-map play surface GameTable mounts. Table v2 replaces the old action strip with the
// token card and the group card (board 13), and puts the roll surfaces beside them: result
// chips by each roller's token, and for players the roll bar and the roll prompt card.
import { PlayOverlays } from '../rolls/PlayOverlays';
import { TokenCards } from './TokenCard';

export function TokenMenu() {
  return (
    <>
      <TokenCards />
      <PlayOverlays />
    </>
  );
}

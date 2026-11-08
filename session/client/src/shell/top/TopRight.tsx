import { FloatBox } from '@dnd/ui';
import { ViewMenu } from './ViewMenu';

/** Top right: presence, Invite, View and Session. */
export function TopRight() {
  return (
    <FloatBox className="absolute top-3 right-3 z-20 flex h-11 items-center gap-1 px-1.5 py-0" data-testid="top-right" data-chrome>
      <ViewMenu />
    </FloatBox>
  );
}

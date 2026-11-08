import { Button } from '@dnd/ui';
import { Lock, LockOpen } from '@dnd/ui/icons';
import { frameWorldPoint } from '../../renderer/camera';
import { useSessionStore } from '../../session/store';
import type { LiveDoor } from './doors';

const send = (action: string, payload: unknown): void => useSessionStore.getState().sendCommand('doors', action, payload);

/**
 * A door's controls: Open or Close, Lock or Unlock and Reveal secret for the DM, Frame for
 * everyone. One component, so the door card and the Map tab's strip never disagree. A locked
 * door says so instead of offering an Open the server would refuse, and an archway (a hole in
 * the wall, always open) offers neither Close nor Lock: the server refuses both, silently.
 */
export function DoorActions({ entry, frame = true }: { entry: LiveDoor; frame?: boolean }) {
  const isDm = useSessionStore((s) => s.you?.role === 'dm');
  const { door, live } = entry;
  const archway = door.style === 'archway';
  return (
    <div data-testid="door-actions" className="flex flex-wrap items-center gap-1">
      {isDm && archway && (
        <span className="text-xs text-text-3" data-testid="door-archway" title="An archway has no door to close or lock">
          Archway, always open
        </span>
      )}
      {isDm && !archway && (
        <Button variant="outline" size="xs" data-testid="door-toggle" disabled={live.locked} onClick={() => send('toggle', { id: door.id })}>
          {live.locked ? 'Locked' : live.open ? 'Close' : 'Open'}
        </Button>
      )}
      {isDm && !archway && (
        <Button variant="outline" size="xs" data-testid="door-lock" onClick={() => send(live.locked ? 'unlock' : 'lock', { id: door.id })}>
          {live.locked ? <LockOpen aria-hidden strokeWidth={1.75} /> : <Lock aria-hidden strokeWidth={1.75} />}
          {live.locked ? 'Unlock' : 'Lock'}
        </Button>
      )}
      {isDm && door.isSecret && (
        <Button variant="outline" size="xs" data-testid="door-reveal-secret" disabled={live.revealed} onClick={() => send('reveal-secret', { id: door.id })}>
          {live.revealed ? 'Secret revealed' : 'Reveal secret'}
        </Button>
      )}
      {frame && (
        <Button variant="ghost" size="xs" data-testid="door-frame" onClick={() => frameWorldPoint(door.position[0], door.position[1])}>
          Frame
        </Button>
      )}
    </div>
  );
}

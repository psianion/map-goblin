import type { ReactNode } from 'react';
import { roomLabel } from '@dnd/core/src/shared/prep';
import type { Mood } from '@dnd/core/src/shared/types';
import { roomEditsOf, roomShareKey, roomSpawnKey, shareReceiptsOf, type TriggersState } from '@dnd/mechanics/triggers';
import { Button, Caption, Seg } from '@dnd/ui';
import { frameWorldPoint } from '../../renderer/camera';
import { closeSheet } from '../../shell/sheets/registry';
import { SheetFrame } from '../../shell/sheets/SheetFrame';
import { useModuleState, useSessionStore } from '../../session/store';
import { useMapRooms, useScenePrep } from './scenePrep';

const send = (action: string, payload: unknown): void => useSessionStore.getState().sendCommand('triggers', action, payload);

const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

const MOODS: { value: '' | Mood; label: string }[] = [
  { value: '', label: 'Inherit' },
  { value: 'lit', label: 'Lit' },
  { value: 'dim', label: 'Dim' },
  { value: 'dark', label: 'Dark' },
];

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <Caption>{title}</Caption>
      {children}
    </section>
  );
}

/**
 * Board 11's Room key sheet (DM): the read-aloud with Share, the encounter with Spawn, the
 * DM's notes, treasure, traps and checks, and the room's live mood.
 */
export function RoomKeySheet({ roomId }: { roomId: string }) {
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const triggers = useModuleState<TriggersState>('triggers');
  const { prep, roomVerdicts, error } = useScenePrep();
  const rooms = useMapRooms();
  const room = rooms.get(roomId);
  const key = prep?.rooms?.find((k) => k.roomId === roomId);
  const label = (room ? roomLabel(room) : roomVerdicts[roomId]?.label) || 'Room';
  const receipt = triggers ? shareReceiptsOf(triggers)[roomShareKey(roomId)] : undefined;
  const spawnedAt = sceneId ? triggers?.byScene[sceneId]?.fired[roomSpawnKey(roomId)] : undefined;
  const scene = sceneId ? triggers?.byScene[sceneId] : undefined;
  const mood = scene ? roomEditsOf(scene)[roomId]?.mood : undefined;
  const readAloud = key?.readAloud.trim() ?? '';
  const encounter = key?.encounter;

  return (
    <SheetFrame
      title="Key"
      path={['Rooms', label]}
      onClose={closeSheet}
      testId="room-key-sheet"
      actions={
        room ? (
          <Button variant="ghost" size="xs" onClick={() => frameWorldPoint(room.anchor[0], room.anchor[1])}>
            Frame
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 px-3 py-2.5 text-xs">
        {error && <p role="alert" className="text-danger">Could not load this scene's prep: {error}</p>}
        {!key && !error && <p className="text-text-3">This room has no key. Write one in the canvas.</p>}
        {readAloud && (
          <Block title="Read-aloud">
            <p className="border-l-2 border-line-strong pl-2 whitespace-pre-wrap text-text" data-testid="room-read-aloud">
              {readAloud}
            </p>
            {receipt ? (
              <span className="text-text-3">Shared {clock(receipt.at)}</span>
            ) : (
              <Button variant="outline" size="sm" className="self-start" data-testid="room-share" onClick={() => send('share-card', { sceneId, roomId })}>
                Share
              </Button>
            )}
          </Block>
        )}
        {encounter && encounter.monsters.length > 0 && (
          <Block title="Encounter">
            <ul className="flex flex-col gap-0.5 text-text-2" data-testid="room-encounter">
              {encounter.name && <li className="text-text">{encounter.name}</li>}
              {encounter.monsters.map((m, i) => (
                <li key={`${m.name}-${i}`}>{m.count > 1 ? `${m.count} × ${m.name}` : m.name}</li>
              ))}
            </ul>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              data-testid="room-spawn"
              disabled={!!roomVerdicts[roomId]?.encounterInert}
              onClick={() => send('spawn-encounter', { sceneId, roomId })}
            >
              {spawnedAt !== undefined ? 'Spawn again' : 'Spawn'}
            </Button>
          </Block>
        )}
        {key?.notes.trim() && (
          <Block title="DM notes">
            <p className="whitespace-pre-wrap text-text-2">{key.notes}</p>
          </Block>
        )}
        {key?.treasure.trim() && (
          <Block title="Treasure">
            <p className="whitespace-pre-wrap text-text-2">{key.treasure}</p>
          </Block>
        )}
        {key && key.traps.length > 0 && (
          <Block title="Traps">
            <ul className="flex flex-col gap-0.5 text-text-2">
              {key.traps.map((t) => (
                <li key={t.id}>
                  {t.text}
                  {t.save && <span className="text-text-3"> · {t.save.ability.toUpperCase()} DC {t.save.dc}</span>}
                  {t.damage && <span className="text-text-3"> · {t.damage}</span>}
                </li>
              ))}
            </ul>
          </Block>
        )}
        {key && key.checks.length > 0 && (
          <Block title="Checks">
            <ul className="flex flex-col gap-0.5 text-text-2">
              {key.checks.map((c) => (
                <li key={c.id}>
                  <span className="text-text-3">
                    {c.ability.toUpperCase()} DC {c.dc}
                  </span>{' '}
                  {c.text}
                </li>
              ))}
            </ul>
          </Block>
        )}
        {room && sceneId && (
          <Block title="Mood">
            <Seg
              aria-label="Room mood"
              options={MOODS}
              value={mood ?? ''}
              onValueChange={(v) => send('set-room', { sceneId, roomId, patch: { mood: v || null } })}
            />
          </Block>
        )}
      </div>
    </SheetFrame>
  );
}

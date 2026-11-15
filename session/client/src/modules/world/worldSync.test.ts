// The Table's sky, levels and room places, handed to the engine (`worldSync.ts`).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import { useStore } from '@dnd/core/src/store/store';
import { tableAllLit, tableRoomPlaces, tableWorld, tableWorldSnaps } from '@dnd/core/src/engine/worldOverride';
import type { RoomEdit, TriggersState } from '@dnd/mechanics/triggers';
import { useSessionStore } from '../../session/store';
import { syncWorldToScene } from './worldSync';
import { dmLit, setDarknessPreview, setDmLit } from './worldPrefs';

const dm: PlayerInfo = { identityId: 'dm1', name: 'Ann', role: 'dm', connected: true };
const player: PlayerInfo = { identityId: 'p1', name: 'Bo', role: 'player', connected: true };

const triggers = (
  world: TriggersState['world'],
  roomEdits: Record<string, RoomEdit> = {},
  darkness?: number,
): TriggersState => ({
  byScene: {
    'scene-1': {
      fired: {},
      armed: {},
      disabled: {},
      lightOverrides: {},
      lightEdits: {},
      roomEdits,
      ...(darkness !== undefined ? { darkness } : {}),
      prompts: [],
      log: [],
    },
  },
  world,
});

function seat(you: PlayerInfo, t: TriggersState, tokens: Record<string, unknown> = {}): void {
  useSessionStore.setState({
    you,
    session: {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: 's1',
      campaignId: 'c1',
      activeSceneId: 'scene-1',
      scenes: [{ id: 'scene-1', name: 'Crypt' }],
      players: [dm, player],
      modules: { triggers: t, tokens: { library: {}, byScene: { 'scene-1': tokens } } },
    } as unknown as SessionState,
  });
}

let stop: (() => void) | null = null;
beforeEach(() => {
  useStore.getState().resetToDefault();
  useStore.setState((s) => {
    s.mapSettings.environment = 'outdoor';
  });
});
afterEach(() => {
  stop?.();
  stop = null;
  setDarknessPreview(null);
  setDmLit(false);
});

describe('syncWorldToScene', () => {
  it('installs the whole sky: the campaign time and the scene slider', () => {
    seat(dm, triggers({ time: 'night' }, {}, 0.4));
    stop = syncWorldToScene();
    expect(tableWorld()).toMatchObject({ minutes: 0, darkness: 0.4 });
  });

  it('a slider drag previews locally and lands at once; releasing hands back to the scene', () => {
    seat(dm, triggers({ time: 'day' }));
    stop = syncWorldToScene();
    expect(tableWorld()?.darkness).toBe(0);
    setDarknessPreview(0.9);
    expect(tableWorld()?.darkness).toBe(0.9);
    expect(tableWorldSnaps()).toBe(true);
    setDarknessPreview(null);
    expect(tableWorld()?.darkness).toBe(0);
    expect(tableWorldSnaps()).toBe(false);
  });

  it('shows the DM everything lit on the DM seat only, and hands the room places over', () => {
    seat(player, triggers({ time: 'night' }, { cellar: { place: 'underground' } }));
    setDmLit(true);
    stop = syncWorldToScene();
    expect(dmLit()).toBe(true);
    expect(tableAllLit()).toBe(false);
    expect(tableRoomPlaces()).toEqual({ cellar: 'underground' });
    stop();
    seat(dm, triggers({ time: 'night' }));
    stop = syncWorldToScene();
    expect(tableAllLit()).toBe(true);
  });

  it('shows a player the level their token stands on, and a pin beats the token', () => {
    useStore.getState().addLevel({ id: 'L2', name: 'Two' });
    const first = useStore.getState().levels[0]!.id;
    seat(player, triggers({ time: 'day' }), {
      t1: { id: 't1', ownerId: 'p1', levelId: 'L2', x: 0, y: 0 },
    });
    stop = syncWorldToScene();
    expect(useStore.getState().ui.activeLevelId).toBe('L2');
    const pinned = triggers({ time: 'day' });
    pinned.byScene['scene-1']!.seatLevel = { p1: first };
    seat(player, pinned, { t1: { id: 't1', ownerId: 'p1', levelId: 'L2', x: 0, y: 0 } });
    expect(useStore.getState().ui.activeLevelId).toBe(first);
  });

  it('hands the sky back on cleanup', () => {
    seat(dm, triggers({ time: 'day' }));
    stop = syncWorldToScene();
    stop();
    stop = null;
    expect(tableWorld()).toBeNull();
    expect(tableRoomPlaces()).toBeNull();
  });
});

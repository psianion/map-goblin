import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import type { ScenePrep } from '@dnd/core/src/shared/prep';
import type { Room } from '@dnd/core/src/shared/types';
import { useStore } from '@dnd/core/src/store/store';
import { getScenePrep, type ResolvedRoomVerdict } from '../../session/auth';
import { useSessionStore } from '../../session/store';

/** The live scene's prep (triggers, notes, room keys) as the DM fetched it over REST. */
export interface PrepAnswer {
  prep: ScenePrep | null;
  inertById: Record<string, string>;
  roomVerdicts: Record<string, ResolvedRoomVerdict>;
  error: string | null;
}

const EMPTY: PrepAnswer = { prep: null, inertById: {}, roomVerdicts: {}, error: null };

/** Keyed by `scene:revision`, so a slow answer for a scene left behind never shows as this one's. */
const usePrepCache = create<{ byKey: Record<string, PrepAnswer> }>()(() => ({ byKey: {} }));
const inFlight = new Set<string>();

function fetchPrep(sceneId: string, key: string): void {
  const token = useSessionStore.getState().token;
  if (!token || inFlight.has(key)) return;
  inFlight.add(key);
  getScenePrep(sceneId, token)
    .then((res) => {
      const inertById: Record<string, string> = {};
      for (const r of res.resolved) if (r.inert) inertById[r.id] = r.inert;
      const roomVerdicts: Record<string, ResolvedRoomVerdict> = {};
      for (const r of res.resolvedRooms ?? []) roomVerdicts[r.roomId] = r;
      return { prep: res.prep, inertById, roomVerdicts, error: null };
    })
    .catch((e: unknown) => ({ ...EMPTY, error: e instanceof Error ? e.message : String(e) }))
    .then((answer) => usePrepCache.setState((s) => ({ byKey: { ...s.byKey, [key]: answer } })))
    .finally(() => inFlight.delete(key));
}

/** The live scene's prep (DM): fetched on a scene switch and on `prep-changed`. */
export function useScenePrep(): PrepAnswer {
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const revision = useSessionStore((s) => s.prepRevision);
  const key = sceneId ? `${sceneId}:${revision}` : null;
  const answer = usePrepCache((s) => (key ? s.byKey[key] : undefined));
  useEffect(() => {
    if (sceneId && key) fetchPrep(sceneId, key);
  }, [sceneId, key]);
  return answer ?? EMPTY;
}

/** For tests and a seat change: forget every fetched answer. */
export function resetScenePrep(): void {
  usePrepCache.setState({ byKey: {} });
}

/** Every room on the loaded map, by id. */
export function useMapRooms(): Map<string, Room> {
  const layers = useStore((s) => s.layers);
  return useMemo(() => {
    const rooms = new Map<string, Room>();
    for (const layer of layers) if (layer.type === 'dungeon') for (const room of layer.rooms ?? []) rooms.set(room.id, room);
    return rooms;
  }, [layers]);
}

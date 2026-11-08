import { useEffect, useRef } from 'react';
import type { LightEdit } from '@dnd/mechanics/triggers';
import { useSessionStore } from '../../session/store';
import { patchLightLocal } from './lights';

const send = (action: string, payload: unknown): void => useSessionStore.getState().sendCommand('triggers', action, payload);

/** A slider's value goes to the table this long after the hand stops. */
const COMMIT_MS = 250;

/** Commits a light patch once the dial settles; the light is patched locally as it moves. */
export function useLightCommit(lightId: string | null): (patch: LightEdit, now?: boolean) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<LightEdit>({});
  useEffect(() => () => clearTimeout(timer.current), []);
  return (patch, now = false) => {
    if (!lightId) return;
    patchLightLocal(lightId, patch);
    pending.current = { ...pending.current, ...patch };
    clearTimeout(timer.current);
    const flush = (): void => {
      send('set-light', { lightId, patch: pending.current });
      pending.current = {};
    };
    if (now) flush();
    else timer.current = setTimeout(flush, COMMIT_MS);
  };
}


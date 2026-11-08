// The DM's right-click on a cliff or a slope (plan §7): the crossing kind the
// table plays it as, changed live. The pick goes over the socket (`crossings.set-edge`) like a
// door's state and is kept with the campaign, so every seat's next drag reads it.

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useStore } from '@dnd/core/src/store/store';
import { defaultCrossingKinds } from '@dnd/core/src/shared/crossingKinds';
import { sceneCrossings, type CrossingsState } from '@dnd/mechanics/crossings';
import { worldToScreen } from '../../renderer/camera';
import { useModuleState, useSessionStore } from '../../session/store';
import { useCrossingMenu } from './menu';

const WHAT: Record<string, string> = { cliff: 'Cliff', slope: 'Slope', none: 'Edge' };

const close = () => useCrossingMenu.getState().open(null);

export function CrossingMenu() {
  const target = useCrossingMenu((s) => s.target);
  const kinds = useStore((s) => s.mapSettings.crossingKinds) ?? defaultCrossingKinds();
  const state = useModuleState<CrossingsState>('crossings');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Any press elsewhere closes it.
  useEffect(() => {
    if (!target) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [target]);

  // Placed beside the world point every frame, straight to the DOM (as `DoorMenu` is).
  useLayoutEffect(() => {
    if (!target) return;
    let raf = 0;
    const tick = () => {
      const el = rootRef.current;
      const map = document.querySelector<HTMLElement>('[data-testid="game-canvas"]')?.getBoundingClientRect();
      const at = worldToScreen(target.x, target.y);
      if (el && map && at) {
        el.style.left = `${map.left + at.x + 12}px`;
        el.style.top = `${map.top + at.y}px`;
        el.style.visibility = 'visible';
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [target]);

  if (!target) return null;
  const live = sceneCrossings(state, sceneId).edges[target.targetId];
  const send = (crossingId: string | null) => {
    useSessionStore.getState().sendCommand('crossings', 'set-edge', { targetId: target.targetId, crossingId });
    close();
  };
  const mapKind = kinds.find((k) => k.id === target.mapKindId);

  return (
    <div
      ref={rootRef}
      data-testid="crossing-menu"
      onPointerDown={(e) => e.stopPropagation()}
      style={{ visibility: 'hidden' }}
      className="fixed z-20 flex min-w-[180px] flex-col gap-1.5 rounded-md border border-line-strong bg-panel px-2.5 py-2 text-xs shadow-e"
    >
      <span className="text-text-2">{WHAT[target.what] ?? 'Edge'} · crossing</span>
      <select
        aria-label="Crossing"
        data-testid="crossing-menu-kind"
        className="rounded border border-line bg-bg px-1.5 py-1 text-text"
        value={live ?? ''}
        onChange={(e) => send(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">Map ({mapKind?.name ?? target.mapKindId})</option>
        {kinds.map((k) => (
          <option key={k.id} value={k.id}>
            {k.name}
          </option>
        ))}
      </select>
    </div>
  );
}

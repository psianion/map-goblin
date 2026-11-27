// The party start area on the DM's map (plan 3.5, finishing pass 12.1): a rounded rectangle,
// a light dashed line over a dark one on a soft fill, labelled "Party start" on a pill, shown while the table is not started and while the tool is armed. The tool
// ('party-start' in `useActiveTool`, so Esc disarms it) drags a rectangle snapped to cells and
// sends `tokens.set-party-start`. Its listeners sit on the window's capture phase, ahead of the
// canvas's own, so the press never reaches the token drag or the camera.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PartyStartArea, TokensState } from '@dnd/mechanics/tokens';
import { Users } from '@dnd/ui/icons';
import { useStore } from '@dnd/core/src/store/store';
import { mountWhenEngineReady } from '../../renderer/overlayLayer';
import { worldToScreen } from '../../renderer/camera';
import { useModuleState, useSessionStore } from '../../session/store';
import { useActiveTool } from '../../session/tools';
import { cellRect, sendCommand, useTable, type Cell } from './lobbyState';

/** The drag itself, while the tool is armed. */
function usePartyStartDrag(armed: boolean, onDraft: (rect: PartyStartArea | null) => void): void {
  useEffect(() => {
    if (!armed) return;
    const unmount = mountWhenEngineReady((engine) => {
      const canvas = engine.canvas();
      let from: Cell | null = null;
      const cellAt = (e: PointerEvent): Cell => {
        const r = canvas.getBoundingClientRect();
        const w = engine.screenToWorld(e.clientX - r.left, e.clientY - r.top);
        return { x: Math.floor(w.x), y: Math.floor(w.y) };
      };
      const take = (e: PointerEvent) => {
        e.stopImmediatePropagation();
        e.preventDefault();
      };
      const onDown = (e: PointerEvent) => {
        if (e.button !== 0 || !canvas.contains(e.target as Node)) return;
        take(e);
        from = cellAt(e);
        onDraft(cellRect(from, from));
      };
      const onMove = (e: PointerEvent) => {
        if (!from) return;
        take(e);
        onDraft(cellRect(from, cellAt(e)));
      };
      const onUp = (e: PointerEvent) => {
        if (!from) return;
        take(e);
        const rect = cellRect(from, cellAt(e));
        from = null;
        onDraft(null);
        const { session } = useSessionStore.getState();
        const { levels, ui } = useStore.getState();
        sendCommand('tokens', 'set-party-start', {
          ...(session?.activeSceneId ? { sceneId: session.activeSceneId } : {}),
          rect,
          ...(levels.length > 1 && ui.activeLevelId ? { levelId: ui.activeLevelId } : {}),
        });
        useActiveTool.getState().setActiveTool(null);
      };
      window.addEventListener('pointerdown', onDown, true);
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      canvas.style.cursor = 'crosshair';
      return () => {
        window.removeEventListener('pointerdown', onDown, true);
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        canvas.style.cursor = '';
        onDraft(null);
      };
    });
    return unmount;
  }, [armed, onDraft]);
}

/** The outline, kept over its cells as the camera moves; written straight to the node. */
function Outline({ rect, draft }: { rect: PartyStartArea; draft: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let raf = 0;
    const step = () => {
      const el = ref.current;
      const a = worldToScreen(rect.x0, rect.y0);
      const b = worldToScreen(rect.x1 + 1, rect.y1 + 1);
      if (el && a && b) {
        el.style.transform = `translate(${a.x}px, ${a.y}px)`;
        el.style.width = `${b.x - a.x}px`;
        el.style.height = `${b.y - a.y}px`;
        el.style.visibility = 'visible';
      }
      raf = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, [rect]);
  // Drawn over the map, not the page, so its colours are fixed rather than themed: a dark line
  // under a light dashed one reads on pale floor, dark rock and black fog alike. The node is
  // sized in screen pixels, so line and label stay one size at every zoom.
  return (
    <div
      ref={ref}
      aria-hidden
      data-testid="party-start-outline"
      data-draft={draft || undefined}
      className="pointer-events-none absolute top-0 left-0 z-10"
      style={{ visibility: 'hidden' }}
    >
      <svg className="absolute inset-0 size-full overflow-visible">
        <rect width="100%" height="100%" rx="6" fill="rgb(255 255 255 / 0.12)" stroke="rgb(17 17 17 / 0.7)" strokeWidth="4" />
        <rect width="100%" height="100%" rx="6" fill="none" stroke="rgb(250 250 250)" strokeWidth="2" strokeDasharray="7 5" strokeLinecap="round" />
      </svg>
      <span className="absolute top-0 left-2 inline-flex -translate-y-1/2 items-center gap-1 rounded-pill border border-line bg-panel py-0.5 pr-2 pl-1.5 text-[11px] leading-4 font-medium whitespace-nowrap text-text shadow-sm">
        <Users aria-hidden strokeWidth={1.75} className="size-3 text-text-2" />
        Party start
      </span>
    </div>
  );
}

/** The DM's party start area and its tool. Nothing on a player's seat. */
export function PartyStartLayer() {
  const dm = useSessionStore((s) => s.you?.role === 'dm');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const area = useModuleState<TokensState>('tokens')?.partyStart?.[sceneId ?? ''];
  const { started } = useTable();
  const armed = useActiveTool((s) => s.activeTool === 'party-start') && dm;
  const [draft, setDraft] = useState<PartyStartArea | null>(null);
  usePartyStartDrag(armed, setDraft);
  if (!dm) return null;
  if (draft) return <Outline rect={draft} draft />;
  if (area && (!started || armed)) return <Outline rect={area} draft={false} />;
  return null;
}

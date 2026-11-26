// The party start area on the DM's map (plan 3.5): a dashed rounded rectangle labelled
// "Party start", shown while the table is not started and while the tool is armed. The tool
// ('party-start' in `useActiveTool`, so Esc disarms it) drags a rectangle snapped to cells and
// sends `tokens.set-party-start`. Its listeners sit on the window's capture phase, ahead of the
// canvas's own, so the press never reaches the token drag or the camera.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PartyStartArea, TokensState } from '@dnd/mechanics/tokens';
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
  return (
    <div
      ref={ref}
      aria-hidden
      data-testid="party-start-outline"
      data-draft={draft || undefined}
      className="pointer-events-none absolute top-0 left-0 z-10 rounded-float border-2 border-dashed border-ink/70 bg-ink/[0.06]"
      style={{ visibility: 'hidden' }}
    >
      <span className="absolute -top-3 left-2 rounded-pill border border-line bg-panel px-2 py-0.5 text-[11px] whitespace-nowrap text-text shadow-sm">
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

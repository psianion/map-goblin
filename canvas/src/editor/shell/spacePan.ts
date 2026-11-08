// Hold Space to pan with any tool in hand, as in Photoshop: Pan while the key is down, the
// tool back when it comes up (or the window loses focus). Space keeps its own meaning in a
// field or on a focused button, and inside a node edit, which a tool change would end.

import { useEffect } from 'react';
import { useStore } from '@/store/store';
import type { ToolType } from '@/store/types';
import { canvasKeysAllowed } from '@/shortcuts/keyGuard';
import { useShell } from './shellStore';

const isSpace = (e: KeyboardEvent) => e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey;

export function useSpacePan(): void {
  useEffect(() => {
    let held: ToolType | null = null;
    const restore = () => {
      if (held === null) return;
      const back = held;
      held = null;
      // The shell sees this as the same tool coming back, not a new pick (no library opening).
      useShell.setState({ spaceReturn: back });
      useStore.getState().setActiveTool(back);
    };
    const down = (e: KeyboardEvent) => {
      if (!isSpace(e)) return;
      if (held !== null) {
        e.preventDefault();
        return;
      }
      if (e.repeat || !canvasKeysAllowed(e)) return;
      const { tools } = useStore.getState();
      if (tools.activeTool === 'pan' || tools.nodeEditWallId || tools.shapeNodeEditId) return;
      e.preventDefault();
      held = tools.activeTool;
      useStore.getState().setActiveTool('pan');
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== ' ' || held === null) return;
      e.preventDefault();
      restore();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', restore);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', restore);
      restore();
    };
  }, []);
}

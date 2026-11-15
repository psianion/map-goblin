// An entry whose sheet is open (Sky) stands as the tool in hand: the core tool in hand before
// it is held and Pan takes its place, so the canvas only pans and zooms while the sheet is up,
// and the surfaces show the entry (`toolInHand`), not the held tool's panel and dock. However
// the sheet closes (its close button, Escape, another sheet, the asset panel), the held tool
// comes back. Picking another tool closes the sheet first (`pickTool`), so the pick lands on
// top; a tool put in hand any other way while the sheet is up keeps its place and the sheet goes.

import { useEffect } from 'react';
import { useStore } from '@/store/store';
import type { Registry } from '@/editor/registry';
import { useShell, type ShellSheet } from './shellStore';

export function useSheetHold(registry: Registry): void {
  useEffect(() => {
    const isEntrySheet = (sheet: ShellSheet) => typeof sheet === 'string' && registry.tools.some((t) => t.sheet === sheet);
    const hold = () => {
      if (useShell.getState().held !== null) return;
      const store = useStore.getState();
      useShell.setState({ held: store.tools.activeTool });
      if (store.tools.activeTool !== 'pan') store.setActiveTool('pan');
    };
    const giveBack = () => {
      const back = useShell.getState().held;
      if (back === null) return;
      useShell.setState({ held: null });
      if (back === 'pan' || useStore.getState().tools.activeTool !== 'pan') return;
      // The same tool coming back, not a new pick: no asset library opening for it.
      useShell.setState({ spaceReturn: back });
      useStore.getState().setActiveTool(back);
    };
    const sync = (sheet: ShellSheet) => (isEntrySheet(sheet) ? hold() : giveBack());
    sync(useShell.getState().sheet);
    const offShell = useShell.subscribe((s, prev) => {
      if (s.sheet !== prev.sheet) sync(s.sheet);
    });
    const offStore = useStore.subscribe(
      (s) => s.tools.activeTool,
      (tool) => {
        if (useShell.getState().held === null || tool === 'pan') return;
        useShell.setState({ held: null });
        useShell.getState().closeSheet();
      },
    );
    return () => {
      offShell();
      offStore();
      giveBack();
    };
  }, [registry]);
}

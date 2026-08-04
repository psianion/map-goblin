import type { StateCreator } from 'zustand';
import type { MapBuilderStore, ModalState, UISlice } from '../types';

export interface UIActions {
  setActiveLayerId: (id: string) => void;
  setActivePanel: (panel: UISlice['activePanel']) => void;
  togglePanel: (panel: 'left' | 'right') => void;
  toggleExpandedLayerId: (layerId: string) => void;
  showModal: (modal: ModalState | null) => void;
  setClipperReady: (ready: boolean) => void;
  setFocusMode: (mode: UISlice['focusMode']) => void;
  setHighlightedRoomId: (roomId: string | null) => void;
  toggleSoloLayer: (id: string) => void;
  clearSolo: () => void;
}

export const createUISlice: StateCreator<
  MapBuilderStore,
  [['zustand/immer', never]],
  [],
  UIActions
> = (set) => ({
  setActiveLayerId: (id) =>
    set((state) => {
      state.ui.activeLayerId = id;
    }),
  setActivePanel: (panel) =>
    set((state) => {
      state.ui.activePanel = panel;
    }),
  togglePanel: (panel) =>
    set((state) => {
      if (panel === 'left') state.ui.leftPanelOpen = !state.ui.leftPanelOpen;
      else state.ui.rightPanelOpen = !state.ui.rightPanelOpen;
    }),
  toggleExpandedLayerId: (layerId) =>
    set((state) => {
      const idx = state.ui.expandedLayerIds.indexOf(layerId);
      if (idx >= 0) {
        state.ui.expandedLayerIds.splice(idx, 1);
      } else {
        state.ui.expandedLayerIds.push(layerId);
      }
    }),
  showModal: (modal) =>
    set((state) => {
      state.ui.modalState = modal;
    }),
  setClipperReady: (ready) =>
    set((state) => {
      state.ui.clipperReady = ready;
    }),
  setFocusMode: (mode) =>
    set((state) => {
      state.ui.focusMode = mode;
    }),
  setHighlightedRoomId: (roomId) =>
    set((state) => {
      state.ui.highlightedRoomId = roomId;
    }),
  // Direct state mutation, same tier as setActiveLayerId — not routed through
  // undoManager. Soloing is a view convenience (like expanding a layer row),
  // not an authored edit worth an undo entry.
  toggleSoloLayer: (id) =>
    set((state) => {
      const target = state.layers.find((l) => l.id === id);
      if (!target || target.type !== 'dungeon') return;

      const current = state.ui.solo;

      // Same layer again: restore what solo hid and clear it.
      if (current && current.layerId === id) {
        for (const layer of state.layers) {
          if (layer.type === 'dungeon' && layer.id in current.prevVisibility) {
            layer.visible = current.prevVisibility[layer.id];
          }
        }
        state.ui.solo = null;
        return;
      }

      // A different layer was soloed: restore it first so the fresh snapshot
      // below is taken from the pre-solo state, not the soloed-away one.
      if (current) {
        for (const layer of state.layers) {
          if (layer.type === 'dungeon' && layer.id in current.prevVisibility) {
            layer.visible = current.prevVisibility[layer.id];
          }
        }
      }

      const prevVisibility: Record<string, boolean> = {};
      for (const layer of state.layers) {
        if (layer.type !== 'dungeon') continue; // background is left untouched
        prevVisibility[layer.id] = layer.visible;
        layer.visible = layer.id === id;
      }
      state.ui.solo = { layerId: id, prevVisibility };
    }),
  clearSolo: () =>
    set((state) => {
      state.ui.solo = null;
    }),
});

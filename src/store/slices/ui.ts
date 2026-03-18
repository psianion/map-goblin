import type { StateCreator } from 'zustand';
import type { MapBuilderStore, ModalState, Toast, UISlice } from '../types.ts';

export interface UIActions {
  setActiveLayerId: (id: string) => void;
  setActivePanel: (panel: UISlice['activePanel']) => void;
  togglePanel: (panel: 'left' | 'right') => void;
  toggleExpandedLayerId: (layerId: string) => void;
  pushToast: (toast: Toast) => void;
  dismissToast: (id: string) => void;
  showModal: (modal: ModalState | null) => void;
  setClipperReady: (ready: boolean) => void;
  setFocusMode: (mode: UISlice['focusMode']) => void;
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
  pushToast: (toast) =>
    set((state) => {
      state.ui.toastQueue.push(toast);
    }),
  dismissToast: (id) =>
    set((state) => {
      const idx = state.ui.toastQueue.findIndex((t) => t.id === id);
      if (idx >= 0) state.ui.toastQueue.splice(idx, 1);
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
});

import type { StateCreator } from 'zustand';
import type { MapBuilderStore, ModalState, NightSky, UISlice } from '../types';

export interface UIActions {
  setActiveLayerId: (id: string) => void;
  setActivePanel: (panel: UISlice['activePanel']) => void;
  togglePanel: (panel: 'left' | 'right') => void;
  toggleExpandedLayerId: (layerId: string) => void;
  showModal: (modal: ModalState | null) => void;
  setClipperReady: (ready: boolean) => void;
  setFocusMode: (mode: UISlice['focusMode']) => void;
  setHighlightedRoomId: (roomId: string | null) => void;
  toggleChildGroup: (key: string) => void;
  setPanelHoverChildId: (id: string | null) => void;
  setRevealChildId: (id: string | null) => void;
  toggleSoloLayer: (id: string) => void;
  clearSolo: () => void;
  setPreviewClock: (minutes: number | null) => void;
  setPreviewSky: (sky: NightSky | null) => void;
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
  // Layer-panel child groups ("layerId:childType"). The set stores
  // DEVIATIONS from each type's default (assets start collapsed, everything
  // else expanded — see isChildGroupExpanded in store/selectors.ts), so an
  // untouched map always gets the defaults.
  toggleChildGroup: (key) =>
    set((state) => {
      const idx = state.ui.childGroupOverrides.indexOf(key);
      if (idx >= 0) state.ui.childGroupOverrides.splice(idx, 1);
      else state.ui.childGroupOverrides.push(key);
    }),
  // Layer-panel row hover → canvas outline (childHoverHighlight). Separate
  // from selection.hoveredId on purpose: that one is the canvas pointer's
  // hover, already drawn by SelectTool — sharing it would double-draw.
  setPanelHoverChildId: (id) =>
    set((state) => {
      state.ui.panelHoverChildId = id;
    }),
  // One-shot "scroll this row into view" marker, consumed (and cleared) by
  // whichever layer-panel list ends up rendering the row. Same tier as solo:
  // view convenience, never undoable, never serialized.
  setRevealChildId: (id) =>
    set((state) => {
      state.ui.revealChildId = id;
    }),
  // Direct state mutation, same tier as setActiveLayerId — not routed through
  // undoManager. Soloing is a view convenience (like expanding a layer row),
  // not an authored edit worth an undo entry.
  //
  // Render-only: this never writes a layer's `visible` flag. Every consumer
  // that cares whether a layer is showing reads `isLayerEffectivelyVisible`
  // (store/selectors.ts) instead, so solo can never leak into autosave and
  // never fights an undo/redo done while it was on.
  toggleSoloLayer: (id) =>
    set((state) => {
      const target = state.layers.find((l) => l.id === id);
      if (!target || target.type !== 'dungeon') return;
      state.ui.solo = state.ui.solo?.layerId === id ? null : { layerId: id };
    }),
  clearSolo: () =>
    set((state) => {
      state.ui.solo = null;
    }),
  // Same tier as solo: a view convenience, not an authored edit — never undoable, never
  // serialized, and (unlike the Table's clock) never sent to anybody.
  setPreviewClock: (minutes) =>
    set((state) => {
      state.ui.previewClock = minutes;
    }),
  // Same tier as setPreviewClock: a view convenience, never undoable, never serialized,
  // never sent to anybody.
  setPreviewSky: (sky) =>
    set((state) => {
      state.ui.previewSky = sky;
    }),
});

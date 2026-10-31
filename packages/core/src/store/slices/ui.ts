import type { StateCreator } from 'zustand';
import type { MapBuilderStore, ModalState, NightSky, PendingSplit, RoomSuggestions, UISlice, Weather } from '../types';

export interface UIActions {
  setActiveLayerId: (id: string) => void;
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
  setPreviewWeather: (weather: Weather | null) => void;
  setRoomOverlayVisible: (visible: boolean) => void;
  setActiveLevelId: (levelId: string) => void;
  setRoomLabels: (labels: UISlice['roomLabels']) => void;
  setRoomSuggestions: (suggestions: RoomSuggestions | null) => void;
  setRoomsSheetOpen: (open: boolean) => void;
  setRoomsSheetRoomId: (roomId: string | null) => void;
  setDividerMode: (mode: UISlice['dividerMode']) => void;
  setRoomWalls: (walls: UISlice['roomWalls']) => void;
  setPendingSplit: (split: PendingSplit | null) => void;
  setSeeUnderOverhead: (on: boolean) => void;
  setMarqueeFilter: (filter: UISlice['marqueeFilter']) => void;
  setPropReplaceIds: (ids: string[] | null) => void;
}

export const createUISlice: StateCreator<
  MapBuilderStore,
  [['zustand/immer', never]],
  [],
  UIActions
> = (set) => ({
  // The active layer always belongs to the active level, so picking a layer on
  // another level (from a list, a search, a selection) brings its level along.
  setActiveLayerId: (id) =>
    set((state) => {
      state.ui.activeLayerId = id;
      const layer = state.layers.find((l) => l.id === id);
      if (layer && state.levels.some((l) => l.id === layer.levelId)) state.ui.activeLevelId = layer.levelId;
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
  // Same tier as setPreviewSky.
  setPreviewWeather: (weather) =>
    set((state) => {
      state.ui.previewWeather = weather;
    }),
  // Same tier as grid.visible: a view preference over editor-only ink, never undoable
  // and never serialized. The overlay itself ignores it while an authoring tool is held.
  setRoomOverlayVisible: (visible) =>
    set((state) => {
      state.ui.roomOverlayVisible = visible;
    }),
  // View state, same tier as activeLayerId. Switching level shows its layers, so the
  // active layer moves to the level's first dungeon layer (else its first layer) —
  // unless it already sits on that level.
  setActiveLevelId: (levelId) =>
    set((state) => {
      if (!state.levels.some((l) => l.id === levelId)) return;
      state.ui.activeLevelId = levelId;
      const active = state.layers.find((l) => l.id === state.ui.activeLayerId);
      if (active?.levelId === levelId) return;
      const onLevel = state.layers.filter((l) => l.levelId === levelId);
      const first = onLevel.find((l) => l.type === 'dungeon') ?? onLevel[0];
      if (first) state.ui.activeLayerId = first.id;
    }),
  // The room view preferences below are view state: never undoable, never in the
  // map. Labels, divider mode, room walls and the sheet persist per browser
  // through the v2 view prefs; the rest lives for the session.
  setRoomLabels: (labels) =>
    set((state) => {
      state.ui.roomLabels = labels;
    }),
  setRoomSuggestions: (suggestions) =>
    set((state) => {
      state.ui.roomSuggestions = suggestions;
    }),
  setRoomsSheetOpen: (open) =>
    set((state) => {
      state.ui.roomsSheetOpen = open;
    }),
  setRoomsSheetRoomId: (roomId) =>
    set((state) => {
      state.ui.roomsSheetRoomId = roomId;
    }),
  setDividerMode: (mode) =>
    set((state) => {
      state.ui.dividerMode = mode;
    }),
  setRoomWalls: (walls) =>
    set((state) => {
      state.ui.roomWalls = walls;
    }),
  setPendingSplit: (split) =>
    set((state) => {
      state.ui.pendingSplit = split;
    }),
  setSeeUnderOverhead: (on) =>
    set((state) => {
      state.ui.seeUnderOverhead = on;
    }),
  setMarqueeFilter: (filter) =>
    set((state) => {
      state.ui.marqueeFilter = filter;
    }),
  setPropReplaceIds: (ids) =>
    set((state) => {
      state.ui.propReplaceIds = ids;
    }),
});

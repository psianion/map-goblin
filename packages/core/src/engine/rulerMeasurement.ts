/**
 * Live ruler reading, published for the status bar.
 *
 * A module ref polled by the UI's animation frame, the same shape as
 * fpsMetrics and cursorPosition. A measurement is throwaway — it never belongs
 * in the map, so it never belongs in the store or the undo stack.
 */
export const rulerMeasurement: { current: { cells: number } | null } = {
  current: null,
};

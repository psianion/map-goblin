/**
 * Extent of a label in world units.
 *
 * ponytail: estimated from character count, not measured. Real measurement
 * needs a 2D canvas, which would drag a browser dependency into a pure module
 * and into every test that touches a label. The box only has to be good enough
 * to click and to frame a selection, and an estimate is deterministic and
 * testable. Measure properly if labels ever need to be laid out against each
 * other rather than just picked.
 *
 * 0.55em average advance and 1.2em line height are the usual approximations for
 * a proportional sans face.
 */
const AVG_ADVANCE_EM = 0.55;
const LINE_HEIGHT_EM = 1.2;

export function measureLabel(
  text: string,
  fontSize: number,
): { width: number; height: number } {
  const lines = text.split('\n');
  const longest = lines.reduce((n, l) => Math.max(n, l.length), 0);
  return {
    // An empty label still needs a grabbable box, or it can never be selected
    // again to be given text.
    width: Math.max(longest, 1) * fontSize * AVG_ADVANCE_EM,
    height: Math.max(lines.length, 1) * fontSize * LINE_HEIGHT_EM,
  };
}

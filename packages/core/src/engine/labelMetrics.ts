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
/**
 * Type face for map labels.
 *
 * A system stack, deliberately: it renders offline with no webfont and no CDN,
 * which the runner's no-network rule requires and the editor is moving to. The
 * shared self-hosted face is being settled in the chrome design work — when it
 * lands, this is the one place to change. Labels are map content rather than
 * chrome, so they may end up on a different face entirely.
 */
export const LABEL_FONT_FAMILY =
  'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

const AVG_ADVANCE_EM = 0.55;
/** Bold letters run a little wider. */
const BOLD_ADVANCE_EM = 0.6;
const LINE_HEIGHT_EM = 1.2;
/** The pill's padding either side of the text, in em: the plate is the label's box. */
export const PILL_PAD_X_EM = 0.35;
export const PILL_PAD_Y_EM = 0.1;

export function measureLabel(
  text: string,
  fontSize: number,
  look?: { weight?: 'bold'; backdrop?: 'halo' | 'pill' },
): { width: number; height: number } {
  const lines = text.split('\n');
  const longest = lines.reduce((n, l) => Math.max(n, l.length), 0);
  const advance = look?.weight === 'bold' ? BOLD_ADVANCE_EM : AVG_ADVANCE_EM;
  const pill = look?.backdrop === 'pill';
  return {
    // An empty label still needs a grabbable box, or it can never be selected
    // again to be given text.
    width: (Math.max(longest, 1) * advance + (pill ? 2 * PILL_PAD_X_EM : 0)) * fontSize,
    height: (Math.max(lines.length, 1) * LINE_HEIGHT_EM + (pill ? 2 * PILL_PAD_Y_EM : 0)) * fontSize,
  };
}

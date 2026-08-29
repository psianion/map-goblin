/**
 * Table icon set — style A, "fine ink": 1.5px single-weight stroke on a
 * 24px grid, round caps/joins, no fills except small accent dots (door
 * knobs, map pins, pips, badges). Drawn from scratch; see
 * docs/mockups/2026-08-22-table-ui/icons.html for the sign-off sheet.
 *
 * `GLYPHS` holds raw SVG inner markup (paths/circles only) per icon, kept
 * in sync with docs/mockups/2026-08-22-table-ui/icons-data.js via
 * scripts/icons-sheet.mjs (run manually, not part of the build).
 */
import { useMemo } from 'react';

export type IconName =
  | 'initiative'
  | 'fog'
  | 'doors'
  | 'tokens'
  | 'scene'
  | 'world'
  | 'triggers'
  | 'lights'
  | 'log'
  | 'me'
  | 'session'
  | 'sidebar'
  | 'reveal'
  | 'hide'
  | 'brush'
  | 'lock'
  | 'unlock'
  | 'secret'
  | 'frame'
  | 'place'
  | 'copy'
  | 'close'
  | 'more'
  | 'plus'
  | 'whisper'
  | 'dice'
  | 'chevron'
  | 'check';

const GLYPHS: Record<IconName, string> = {
  // ── rail ──
  // Crossed swords. The guards used to be 3px ticks beside the crossing and the pommels were
  // not drawn at all, so at the rail's 20px the whole glyph collapsed into a bare ✕ — read as
  // a close button sitting on top of the rail, which is exactly what it looked like. The
  // guards now sit down each grip at full width and each sword gets a pommel dot (the set's
  // own accent-dot vocabulary), so the silhouette says "swords" before the label does.
  initiative:
    '<path d="M5 5L18.4 18.4"/><path d="M19 5L5.6 18.4"/><path d="M13.1 16.7L16.7 13.1"/><path d="M7.3 13.1L10.9 16.7"/><circle cx="19.1" cy="19.1" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.9" cy="19.1" r="1.3" fill="currentColor" stroke="none"/>',
  fog:
    '<path d="M3 8c1.6-2.2 3.6-2.2 5.2 0s3.6 2.2 5.2 0 3.6-2.2 5.2 0"/><path d="M3 13.2c1.7-2.2 3.7-2.2 5.4 0s3.7 2.2 5.4 0 3.7-2.2 5.4 0"/><path d="M3 18c1.6 2.2 3.6 2.2 5.2 0s3.6-2.2 5.2 0 3.6 2.2 5.2 0"/>',
  doors:
    '<path d="M6 20V11a6 6 0 0 1 12 0v9"/><path d="M9 20V12.5a3 3 0 0 1 6 0v7.5"/><circle cx="13" cy="16" r="1" fill="currentColor" stroke="none"/><path d="M4 21h16"/>',
  tokens:
    '<circle cx="12" cy="7.5" r="3.2"/><path d="M7 20c0-5 2.2-8.2 5-8.2s5 3.2 5 8.2"/><path d="M6 20h12"/>',
  scene:
    '<path d="M3 6l6-2.5 6 2.5 6-2.5v14.5L15 20.5 9 18l-6 2.5z"/><path d="M9 3.5V18"/><path d="M15 6v14.5"/><circle cx="12" cy="11" r="1.2" fill="currentColor" stroke="none"/>',
  world:
    '<path d="M14.5 3a8.5 8.5 0 1 0 6.5 14.5A7 7 0 0 1 14.5 3z"/><circle cx="18" cy="5" r="1" fill="currentColor" stroke="none"/>',
  triggers:
    '<path d="M5.5 15H18.5A1.5 1.5 0 0 1 20 16.5V18.5A1.5 1.5 0 0 1 18.5 20H5.5A1.5 1.5 0 0 1 4 18.5V16.5A1.5 1.5 0 0 1 5.5 15Z"/><path d="M12 12V5"/><path d="M8 12.5L5 8"/><path d="M16 12.5L19 8"/><circle cx="12" cy="3" r=".8" fill="currentColor" stroke="none"/><circle cx="3.5" cy="6" r=".8" fill="currentColor" stroke="none"/><circle cx="20.5" cy="6" r=".8" fill="currentColor" stroke="none"/>',
  // M2 table UI — unreviewed placeholder (a lamp), not yet run through the icons.html
  // sign-off sheet this file's own header describes; swap for the reviewed glyph when M2
  // gets its own icon pass.
  lights:
    '<path d="M9 18.5H15"/><path d="M10 21H14"/><path d="M12 3A6 6 0 0 0 8.4 13.8C9.1 14.4 9.5 15.1 9.5 16H14.5C14.5 15.1 14.9 14.4 15.6 13.8A6 6 0 0 0 12 3Z"/>',
  log:
    '<path d="M4 20h8"/><path d="M4 16h6"/><path d="M4 12h5"/><path d="M21 3c-5 0-9 4-10 9l-2 5 5-2c5-1 8-6 7-12z"/><path d="M11 12l-3.5 5"/><path d="M13 10c2-1 4-1 6-2"/>',
  me:
    '<path d="M6.5 3.5H17.5A3 3 0 0 1 20.5 6.5V17.5A3 3 0 0 1 17.5 20.5H6.5A3 3 0 0 1 3.5 17.5V6.5A3 3 0 0 1 6.5 3.5Z"/><circle cx="12" cy="9.5" r="2.8"/><path d="M6.5 20.5c0-4 2.5-6 5.5-6s5.5 2 5.5 6"/>',
  session:
    '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="3.7" r="1.3" fill="currentColor" stroke="none"/><circle cx="19.2" cy="16.2" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.8" cy="16.2" r="1.3" fill="currentColor" stroke="none"/>',
  // table-shell-redesign — the left sidebar's edge toggle (docs/mockups/table-shell-redesign-mockup.html).
  sidebar:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5V19.5"/>',

  // ── inline ──
  reveal:
    '<path d="M3 12Q12 4 21 12Q12 20 3 12Z"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>',
  hide: '<path d="M3 12Q12 4 21 12Q12 20 3 12Z"/><path d="M4 4L20 20"/>',
  brush:
    '<path d="M15 3L21 9L12 18L6 12Z"/><circle cx="10.5" cy="20" r="1.6" fill="currentColor" stroke="none"/>',
  lock:
    '<path d="M7 10H17A2 2 0 0 1 19 12V19A2 2 0 0 1 17 21H7A2 2 0 0 1 5 19V12A2 2 0 0 1 7 10Z"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.2" fill="currentColor" stroke="none"/>',
  unlock:
    '<path d="M7 10H17A2 2 0 0 1 19 12V19A2 2 0 0 1 17 21H7A2 2 0 0 1 5 19V12A2 2 0 0 1 7 10Z"/><path d="M8 10V7a4 4 0 0 1 8 0"/><circle cx="12" cy="15.5" r="1.2" fill="currentColor" stroke="none"/>',
  secret:
    '<circle cx="12" cy="9" r="3.2"/><path d="M10.8 12L9.5 19H14.5L13.2 12Z"/>',
  frame:
    '<path d="M4 9V5a1 1 0 0 1 1-1h4"/><path d="M20 9V5a1 1 0 0 0-1-1h-4"/><path d="M4 15v4a1 1 0 0 0 1 1h4"/><path d="M20 15v4a1 1 0 0 1-1 1h-4"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  place:
    '<circle cx="10" cy="7" r="2.6"/><path d="M6 18c0-4 1.6-6 4-6s4 2 4 6"/><path d="M5 18h9"/><path d="M18.5 15.7V20.3"/><path d="M16.2 18H20.8"/>',
  copy:
    '<path d="M10 3H17A2 2 0 0 1 19 5V12A2 2 0 0 1 17 14H10A2 2 0 0 1 8 12V5A2 2 0 0 1 10 3Z"/><path d="M7 8H14A2 2 0 0 1 16 10V17A2 2 0 0 1 14 19H7A2 2 0 0 1 5 17V10A2 2 0 0 1 7 8Z"/>',
  close: '<path d="M6 6L18 18"/><path d="M18 6L6 18"/>',
  more:
    '<circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5V19"/><path d="M5 12H19"/>',
  whisper:
    '<path d="M7 4H17A3 3 0 0 1 20 7V12A3 3 0 0 1 17 15H12L8 19L9 15H7A3 3 0 0 1 4 12V7A3 3 0 0 1 7 4Z"/><path d="M10 8H14V11H10Z"/><path d="M11 8V7a1 1 0 0 1 2 0V8"/>',
  dice:
    '<path d="M8 4H16A4 4 0 0 1 20 8V16A4 4 0 0 1 16 20H8A4 4 0 0 1 4 16V8A4 4 0 0 1 8 4Z"/><circle cx="8.3" cy="8.3" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.7" cy="15.7" r="1.3" fill="currentColor" stroke="none"/>',
  chevron: '<path d="M6 9L12 15L18 9"/>',
  check: '<path d="M5 13L10 18L19 7"/>',
};

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;',
  );
}

export function Icon({
  name,
  size = 16,
  className,
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  title?: string;
}) {
  // One object per markup string, not per render: React re-sets innerHTML whenever the
  // `dangerouslySetInnerHTML` prop is a new object, which replaces the paths mid-press — a
  // mousedown on a stroke then finds its target gone by mouseup and the browser drops the
  // click (the rail re-renders on focus, so every icon click on a stroke used to vanish).
  const html = useMemo(
    () => ({ __html: (title ? `<title>${escapeXml(title)}</title>` : '') + GLYPHS[name] }),
    [name, title],
  );
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={!title}
      role={title ? 'img' : undefined}
      dangerouslySetInnerHTML={html}
    />
  );
}

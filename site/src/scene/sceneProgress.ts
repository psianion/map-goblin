// Tiny mutable singleton shared between ScrollCamera (which drives it from
// scroll) and Diorama (which reads it every frame). Plain object, not React
// state — these values change every scroll tick and only need to reach the
// R3F frame loop, which ScrollCamera already invalidates on every update.
export interface SceneProgress {
  /** Beat 1 "Ink" — how much of the wall footprints have drawn in, 0→1. */
  inkT: number;
  /** Beat 2 "The rise" — how far walls have risen / torches ignited, 0→1. */
  riseT: number;
  /** Beat 3 "Sight" — token's progress along its walk path, 0→1. */
  sightT: number;
  /** Beat 3 is the currently pinned section (drives token/wedge/door visibility). */
  sightActive: boolean;
  /** Beat 4 "Trust" — how far the DM/player panes have pulled apart, 0→1. */
  trustT: number;
  /** Beat 4 is the currently pinned section (engages the scissor split render). */
  trustActive: boolean;
  /** Beat 5 "The world turns" — scroll-scrubbed clock, dawn→night, 0→1.
   * Re-windowed off `worldP` (below), NOT beat 5's raw pin progress. */
  clockT: number;
  /** Beat 5's RAW pin progress, 0→1 — what `clockT` used to be. Beat 4's
   * dual-pane split closes, and beat 5's own clock widget fades in, over
   * this pin's first 20% (SceneRenderer.tsx), i.e. before the beat is
   * readable at all — so the visible clock rides the remainder instead (see
   * ScrollCamera.tsx, `i === 4`). Anything that needs "how far into beat 5's
   * pin are we" — the split close, the widget reveal, beat 5's own copy
   * fade — reads this; only the day itself reads `clockT`. */
  worldP: number;
  /** Beat 5 is the currently pinned section — gates rain to its own pin
   * (clockT never resets once past beat 5, so rain needs its own flag or it
   * would keep falling through every later beat). */
  worldActive: boolean;
  /** Beat 6 "The swap" — scene-swap-in-place progress, 0→1. */
  swapT: number;
  /** Beat 6→7 pull-back progress, 0→1 — gates TableScene's props into view
   * (see TableScene.tsx) so the table doesn't bleed into earlier beats'
   * pure-black negative space when the camera's FOV slightly overshoots a
   * room's footprint. */
  kitT: number;
  /** True once ScrollCamera has mounted and is driving these fields from
   * scroll — i.e. the 3D scene actually exists (desktop + WebGL). Stays
   * false on mobile (<900px) or when WebGL is unavailable, where nothing
   * ever writes these fields and they'd otherwise sit stuck at 0 forever
   * (see useBeatCopy.ts, which reads this to decide whether it's safe to
   * gate copy on these values at all). */
  live: boolean;
}

export const sceneProgress: SceneProgress = {
  inkT: 0,
  riseT: 0,
  sightT: 0,
  sightActive: false,
  trustT: 0,
  trustActive: false,
  clockT: 0,
  worldP: 0,
  worldActive: false,
  swapT: 0,
  kitT: 0,
  live: false,
};

/** Beat-copy progress keys — every numeric field of SceneProgress (the
 * boolean "*Active"/"live" flags aren't beat progress). Derived from the
 * interface instead of hand-listed so it can't drift out of sync with it. */
type NumericKeys<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];
export type BeatProgressKey = NumericKeys<SceneProgress>;

// Beat-copy fade window, driven by ScrollCamera's scroll-driven updates.
// Contract: copy starts fading in once the beat's own picture is 5% done,
// fully in by 20%; then holds fully visible until the tail of the beat's own
// pin, dissolving over that pin's RAW progress 80% → 95% so it's gone before
// the pin releases.
// F3/F4 fix round: was 30% → 55% in, and a dissolve keyed to the NEXT beat's
// picture (50% → 75%). Both were wrong for the same reason — they timed the
// copy against a picture the viewer couldn't yet (or could no longer) see.
// The headline arrived past the halfway point of an already-playing picture,
// and the dissolve only ever ran while this beat's section had already
// scrolled off screen through the 1vh spacer gap that used to sit between
// every pair of pins. Keying the exit to the beat's OWN pin tail is also what
// lets those spacers be collapsed (ScrollCamera.tsx) without the copy popping
// out of frame the instant its pin releases.
const FADE_START = 0.05;
const FADE_DONE = 0.2;
const EXIT_START = 0.8;
const EXIT_END = 0.95;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Computes and writes a beat's --copy-v (and the data-copy-hidden attribute
 * that drives its visibility/pointer-events, see global.css) from its own
 * picture's progress and its own pin's raw progress.
 *
 * @param ownT this beat's picture progress — pass 1 for a beat with no "own"
 *   picture to establish (the whisper, already at rest when the page loads).
 * @param exitT this beat's pin's RAW progress, 0→1. Deliberately not the
 *   picture progress: clockT is re-windowed and swapT saturates at 45% of its
 *   pin, so neither can time its own beat's exit (see ScrollCamera's rawP).
 */
export function writeCopyV(el: HTMLElement, ownT: number, exitT: number): void {
  const fadeIn = clamp01((ownT - FADE_START) / (FADE_DONE - FADE_START));
  const fadeOut = 1 - clamp01((exitT - EXIT_START) / (EXIT_END - EXIT_START));
  const v = Math.min(fadeIn, fadeOut);
  el.style.setProperty('--copy-v', String(v));
  if (v <= 0) el.setAttribute('data-copy-hidden', '');
  else el.removeAttribute('data-copy-hidden');
}

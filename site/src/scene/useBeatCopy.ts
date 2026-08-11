// Attaches the ref a beat's copy wrapper needs so ScrollCamera.tsx can find
// it and write its --copy-v CSS var. The actual fade math lives in
// sceneProgress.ts (writeCopyV) — ScrollCamera is the only writer: it mounts
// after App's layout effects (requestIdleCallback + lazy import), so a
// useLayoutEffect here would always see sceneProgress.live === false and
// never fire. ScrollCamera's own updateCopy() call right after it goes live
// (see ScrollCamera.tsx) establishes the initial value instead. When the 3D
// scene never mounts — mobile (<900px) or no WebGL — nothing ever writes
// --copy-v and the CSS default (1, fully visible) stands, so copy is simply
// always visible.
import { useRef } from 'react';
import type { BeatProgressKey } from './sceneProgress';

export type { BeatProgressKey };

/**
 * @param _own progress key for THIS beat's picture, or null if it has none
 *   (whisper — already at rest when the page loads, nothing to establish).
 *   Unused here — kept so call sites document which beat they're wiring up,
 *   same as before this hook stopped doing anything with it itself. The
 *   matching fade-OUT key used to be a second param; every beat now exits on
 *   its own pin's raw progress instead, which only ScrollCamera can see.
 */
export function useBeatCopy(_own: BeatProgressKey | null) {
  return useRef<HTMLDivElement | null>(null);
}

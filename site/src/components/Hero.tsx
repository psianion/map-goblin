// Decides desktop-3D vs mobile-image-hero once, deferred to an idle tick
// after first paint — the semantic DOM (App.tsx) is already fully rendered
// and readable before this even runs, and on a phone or a browser without
// WebGL the ~1MB Canvas3D chunk (three.js + gsap + lenis) is never imported
// at all, not just hidden after loading.
import { lazy, Suspense, useEffect, useState } from 'react';
import { markLoad } from '../loadProgress';

// Loader milestone: whichever chunk this page needs is down and evaluated —
// for the 3D path that's the ~1MB three/gsap/lenis payload, the single
// longest leg of a cold load.
const Canvas3D = lazy(() =>
  import('./Canvas3D').then((m) => {
    markLoad('scene-code');
    return { default: m.Canvas3D };
  }),
);
const MobileHero = lazy(() =>
  import('./MobileHero').then((m) => {
    markLoad('scene-code');
    return { default: m.MobileHero };
  }),
);

const MOBILE_QUERY = '(max-width: 899px)';

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export function Hero() {
  const [use3D, setUse3D] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const decide = () => setUse3D(!mq.matches && hasWebGL());
    // { timeout: 1500 } — an idle callback with no timeout is only serviced when a frame
    // has budget left over, and the loader (index.html) runs an unbroken rAF chain for up
    // to 12s on a cold load, concurrently with this ~1MB chunk's own download/parse. That
    // can starve an untimed idle callback outright, leaving the page dead (no hero mounts,
    // ScrollCamera's effect never runs, zero pin spacers). 1500ms converts "run when
    // convenient" into "run when convenient, but never later than this" — see the
    // nine-issue fix plan §1.
    const idleId =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(decide, { timeout: 1500 })
        : window.setTimeout(decide, 0);
    mq.addEventListener('change', decide);
    return () => {
      mq.removeEventListener('change', decide);
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idleId as number);
      else window.clearTimeout(idleId as number);
    };
  }, []);

  // Nothing mounts until the decision lands — no flash of the wrong hero,
  // and the WebGL bundle's import() is never even triggered speculatively.
  if (use3D === null) return null;
  return <Suspense fallback={null}>{use3D ? <Canvas3D /> : <MobileHero />}</Suspense>;
}

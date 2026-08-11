import { markLoad } from '../loadProgress';

// Mobile / no-WebGL hero — replaces Canvas3D everywhere the 3D scene doesn't
// mount (Hero.tsx). Ships as a single static composed image, not a scroll-
// scrubbed sequence: sequencing needs scripted screenshots of the live
// scroll-scrubbed beats, and this build has no browser-automation access to
// take them (the plan's explicit fallback — "a static composed hero image
// if sequencing is impractical" — applies). The image is a faithful redraw
// of beat 2 ("the rise": walls up, torches lit) built from the same MAIN_MAP
// geometry the 3D scene renders, not a generic mockup.
//
// Same fixed full-bleed slot as .canvas-mount (global.css) so the semantic
// DOM content layers on top identically to the desktop layout.
export function MobileHero() {
  return (
    <div className="canvas-mount" aria-hidden="true">
      {/* onLoad/onError is this path's "first frame" milestone for the loader
          (index.html) — the desktop equivalent lives in SceneRenderer. */}
      <img
        src="/hero-mobile.jpg"
        alt=""
        className="hero-mobile-img"
        onLoad={() => markLoad('frame')}
        onError={() => markLoad('frame')}
      />
    </div>
  );
}

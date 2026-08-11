import { Hero } from './components/Hero';
// SeamLayer REMOVED from the page 2026-08-08 (user call: four fix rounds in,
// the DOM-overlay crack still fought the 3D scene on containment, aspect
// coverage, and frame cost). The seam idea is parked for a redesign, not
// deleted — src/seam/* stays on disk as reference. Do not re-mount without
// an approved new design.
import { WaitlistForm } from './components/WaitlistForm';
import { useBeatCopy, type BeatProgressKey } from './scene/useBeatCopy';

// Progress key each feature room's copy fades in on (see useBeatCopy.ts) —
// order matches featureRooms below, which matches DOM/pin order in
// ScrollCamera. The fade-out is the beat's own pin tail, not a key.
const featureRoomProgress: Record<string, BeatProgressKey> = {
  sight: 'sightT',
  trust: 'trustT',
  // worldP, not clockT: clockT is re-windowed onto the readable part of this
  // beat's pin, so it's still 0 while the headline is arriving.
  'world-turns': 'worldP',
  scenes: 'swapT',
};

const featureRooms = [
  {
    id: 'sight',
    eyebrow: 'FOG & SIGHT',
    title: 'Fog of war that reads your walls.',
    sub: 'Line of sight is computed from the walls you drew. Doors block until they swing open; torches carry exactly as far as you placed them. Nothing to trace, nothing to mask, nothing to babysit.',
    voice: 'You drew the walls. Why would you draw them again?',
  },
  {
    id: 'trust',
    eyebrow: 'TRUST',
    title: 'The server never sends your players the secret door.',
    sub: (
      <>
        Not hidden with styling. Not ghosted and hoping. What a player hasn't been shown is{' '}
        <em>not in the data their browser receives</em>. And you, the DM, never lose sight of any
        of it.
      </>
    ),
    voice: 'The goblin keeps secrets professionally.',
  },
  {
    id: 'world-turns',
    eyebrow: 'LIVE TABLE',
    title: 'Night falls on schedule. Or when you say so.',
    sub: 'Scrub the hour and the whole map relights — torch pools holding warm against the blue, rain rolling over the roofs. Your weather is a play tool, not a slider buried in settings.',
    voice: 'Players argue about the marching order; the goblin brings the storm.',
  },
  {
    id: 'scenes',
    eyebrow: 'SCENES',
    title: 'Swap scenes mid-session.',
    sub: 'No blackout, no loading bar, no “one sec, guys.”',
    voice: null,
  },
] as const;

type FeatureRoomData = (typeof featureRooms)[number];

function FeatureRoom({ room }: { room: FeatureRoomData }) {
  const copyRef = useBeatCopy(featureRoomProgress[room.id]);

  return (
    <section className="beat feature-room" data-beat={room.id} aria-label={room.title}>
      <div ref={copyRef} className="copy-scrub">
        <span className="eyebrow">{room.eyebrow}</span>
        <h2>{room.title}</h2>
        <p className="sub">{room.sub}</p>
        {room.voice && <p className="voice">{room.voice}</p>}
      </div>
      {/* R6 fix round: the YOUR VIEW / THEIR VIEW pane tags used to render
          here, but this section un-pins and scrolls away before the canvas
          split (SceneRenderer.tsx) is done easing shut — see that file's own
          comment. SceneRenderer now creates the .pane-tags element itself,
          parented to .canvas-mount (same home as its trustVignette overlay),
          so the markup lives somewhere that never scrolls out from under
          the still-split canvas. */}
      {room.id === 'world-turns' && (
        <div className="scrub" aria-hidden="true">
          <div className="scrub-track">
            <span className="scrub-fill" />
            <span className="scrub-thumb" />
          </div>
          <div className="scrub-labels">
            <span>dawn</span>
            <span>noon</span>
            <span>dusk</span>
            <span>23:40</span>
          </div>
        </div>
      )}
    </section>
  );
}

function App() {
  const whisperCopy = useBeatCopy(null);
  const inkCopy = useBeatCopy('inkT');
  const kitCopy = useBeatCopy('kitT');

  return (
    <>
      <Hero />
      {/* Seam removed — see the import-site comment at the top of this file. */}
      {/* .stage-lamp retired (issue 4): the table's own lamp now bakes into
          the canvas world at LAMP_WORLD (textures.ts) instead of standing in
          as a viewport-pinned DOM sticker — see global.css's own comment at
          the old rule's former location for the full rationale. */}
      {/* Matte finish over the whole page — art-style-guide's "texture
          everywhere, contrast nowhere" rule, applied at the page level. */}
      <div className="grain" aria-hidden="true" />
      <header className="brand mono">GOOD GOBLIN</header>
      <main>
        <section className="beat beat-whisper" aria-label="Opening">
          <div ref={whisperCopy} className="copy-scrub">
            <p>psst. over here. yes, you, the one with the folder of half-finished maps —</p>
          </div>
        </section>

        <section className="beat beat-ink" aria-label="You draw the map">
          <div ref={inkCopy} className="copy-scrub">
            <p className="ink-line">You draw the map.</p>
          </div>
        </section>

        {/* Hero copy is exempt from scroll-gating entirely (F6/F7) — it
            carries the primary H1 + CTA and must never be hidden. */}
        <section className="beat beat-hero" aria-label="The map you drew is the game you run">
          <h1>
            The map you <span className="drew">drew</span>
            <br />
            is the game you <span className="run">run</span>.
          </h1>
          <p className="sub">
            Draw walls, doors, torches — once. Fog, sight, and light run themselves at the
            table, live, in front of your players.
          </p>
          <p className="aside voice">
            No re-tracing. No lighting homework. The goblin finds double work insulting.
          </p>
          <div className="cta-row">
            <a className="cta" href="#door">
              Join the waitlist
            </a>
            <span className="cta-quiet">Free while in the goblin's favor</span>
          </div>
        </section>

        {featureRooms.map((room) => (
          <FeatureRoom key={room.id} room={room} />
        ))}

        <section className="beat beat-kit" aria-label="The whole DM kit">
          <div ref={kitCopy} className="copy-scrub">
            <h2>
              Every table deserves
              <br />a <em>good</em> goblin.
            </h2>
            <p className="sub">
              The whole DM kit: prep in the Editor, run at the Table, players join with a link.
            </p>
          </div>
          {/* Closing CTA is exempt from scroll-gating entirely (F6) — the
              primary conversion element is never hidden. */}
          <div className="cta-row">
            <a className="cta" href="#door">
              Join the waitlist
            </a>
            <span className="cta-quiet">The goblin holds your seat.</span>
          </div>
        </section>

        <section className="beat beat-door" id="door" aria-label="Join the waitlist">
          <div className="doorstage">
            <svg
              className="eyes"
              width="120"
              height="44"
              viewBox="0 0 120 44"
              aria-hidden="true"
            >
              {/* stroke: art-style-guide's "dark ink outline on every prop"
                  rule — on the light D2 field a flat green fill (1.2:1
                  against parchment) nearly disappears without it. */}
              <ellipse cx="38" cy="22" rx="13" ry="9" fill="#b6d648" stroke="#16180f" strokeWidth="1.5" />
              <ellipse cx="82" cy="22" rx="13" ry="9" fill="#b6d648" stroke="#16180f" strokeWidth="1.5" />
              <circle cx="41" cy="22" r="3.5" fill="#16180f" />
              <circle cx="85" cy="22" r="3.5" fill="#16180f" />
            </svg>
            <div className="door">
              <WaitlistForm />
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

export default App;

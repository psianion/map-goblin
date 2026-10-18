# Good Goblin landing page — build plan (2026-08-07)

Chosen concept: Direction A ("From Ink to Alive") with B's war-table pull-back kept as beat 7
and C's whisper-lede opening the hero. Mockup board: `docs/landing-mockups/2026-08-07-landing-concepts.html`.

## The page (final beat list)

0. Whisper-lede fades in over the void: "psst. over here. yes, you, the one with the folder of half-finished maps —"
1. **Ink** — lines draw themselves, top-down. "You draw the map."
2. **The rise** — walls extrude, torches ignite staggered, positioning line lands: "The map you drew is the game you run."
3. **Sight** — token walks, real visibility sweep, door-swing light spill.
4. **Trust** — split render; player pane's geometry genuinely lacks the secret door.
5. **The world turns** — scroll scrubs the clock; ambient lerps warm→cool, rain rolls in.
6. **The swap** — walls sink, a new map rises in place (no blackout).
7. **The kit** — camera pulls back: the diorama sits on a wooden table, dice, mug, empty DM chair. "The whole DM kit: prep in the Editor, run at the Table, players join with a link."
8. **The door** — waitlist. Knock, success "Hoarded.", blinking eyes.

Copy: sets and microcopy from the board's copy section (Set 1 hero + Set 4 whisper, feature-room copy, full waitlist states).

## Where it lives

New top-level `site/` package in the monorepo: Vite + React + TypeScript + @react-three/fiber + drei + GSAP (ScrollTrigger) + Lenis for scroll smoothing. Builds to static files; no coupling to canvas/session packages. Fonts self-hosted (Newsreader, IBM Plex Sans/Mono) — no Google CDN on the public page.

Waitlist backend (recommendation): `POST /api/waitlist` as a tiny handler on session/server (SQLite table: email, created_at, unique index). The static site points at it via env. No third-party form service, no new infra. Duplicate → 200 with the "Already hoarded" copy; never leak list membership beyond that copy.

## Phases (each ends with a browser walk; nothing advances on a broken beat)

**P1 — Skeleton & words.** `site/` scaffold, palette/type tokens from the board spec, full page in semantic DOM with all copy and the form working against a stubbed endpoint. This DOM is the SEO/no-JS/reduced-motion floor: the page is complete and readable before any WebGL loads.

**P2 — Greybox diorama & camera.** Author the demo map as product-shaped data (wall polylines, door gaps, torch points, one secret door). Build flat/extruded greybox geometry from it. Camera path through all 9 beats on ScrollTrigger pins, untextured. Exit gate: the whole scroll feels right in the browser at 60fps with ugly boxes.

**P3 — Beat mechanics.** Line-draw (beat 1), staggered extrusion + torch ignition (2), per-frame visibility sweep from the wall segments (3), scissor split render with geometry actually absent from the player pane (4), clock-driven relighting + instanced rain (5), swap-in-place (6), table pull-back with props (7), door + form focus (8). Still greybox materials.

**P4 — Art pass.** Toon ramp + ink outline post-pass, bespoke painterly textures (owned art only — nothing FA-derived), grain, parchment plaque, wood, eyes. Judged against docs/art-style-guide.md: if a frame reads "Unity demo," it fails.

**P5 — Hardening.** Reduced-motion = composed stills with hard cuts. Mobile = pre-rendered scrubbed image sequence (WebGL never ships to phones). DPR clamp 1.5, frameloop demand outside pins. Real waitlist endpoint + all form states. Meta/OG image, favicon, a11y pass (contrast, focus, escape, labels).

**P6 — Gate.** Deployed build walked end-to-end in the browser: full scroll, form submit/duplicate/error states, reduced-motion mode, mobile viewport, zero console/network errors. Final design review pass on the shipped page.

Worker structure per the standing workflow mandate: small contained steps, design review riding along on every UI step, adjudication between phases.

## Open decisions (non-blocking, flag now)

- Hosting/domain for the site and the waitlist endpoint (P5 needs the answer; P1–P4 don't).
- Launch email tooling is out of scope; we only store addresses.

## Out of scope

Mascot illustration (eyes + voice carry the goblin), sound design (stub the toggle, ship muted or cut), any reuse of app screenshots or dungeon-classic art.

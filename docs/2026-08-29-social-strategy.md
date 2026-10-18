# Good Goblin — pre-beta social strategy

Written 2026-08-29. Horizon: 12 weeks to open beta, then launch week.
Owner: solo. Budget: ~4–5 h/week. Primary channel: Reddit.

---

## 0. Settle this before a single map is posted

**The forge generates floor and wall textures with ComfyUI (Stable Diffusion).**
See `forge/prompt-floor*.txt`, `forge/submit-floors*.mjs`, `forge/run-job.mjs`.

r/battlemaps, r/dndmaps and r/DnD treat AI-generated art as a hard ban *and* a
witch-hunt trigger. Not "downvoted" — accounts named, posts archived, the brand
carried into other threads for years. This is the highest-variance risk in the
whole plan, and the entire content engine below runs on posting maps into exactly
those subs.

Three ways out:

1. **Ship hand-painted or licensed textures in the public packs.** Aligns with the
   existing real-art-textures direction. Keep ComfyUI as an internal blocking-in
   tool that never produces a shipped pixel. *Recommended.*
2. **Commission a texture artist for the 8–10 biome sets**, and credit them by name
   in every map post. The credit is itself good content and it inoculates you.
3. Post only where AI is tolerated. This deletes the main channel. Not viable.

Until 1 or 2 is done, the Reddit plan runs on craft posts and UI demos only — a
much weaker engine. **Do not post a map made with forge-generated textures.**

Two related landmines:

- `docs/art-style-guide.md` points at a Pinterest board of third-party Patreon
  creators' maps. Never name the board, never post side-by-sides, and never let a
  shipped tile land recognisably close to a single pin. "Trained on / traced from a
  Patreon creator" is the same fire as above.
- Every asset you give away needs a stated licence. Pick one now: CC-BY 4.0 for the
  free maps, with "personal and commercial use at your table" spelled out in plain
  words underneath it.

---

## 1. The bet

Reddit does not reward announcing. It rewards **giving something usable away** and
**answering a specific question specifically**. Two things travel in this niche:

- a free map good enough that a DM saves it, and
- a tool that deletes a chore the reader did last Tuesday and hated.

Good Goblin has a rare property: **the product manufactures its own marketing
collateral.** Every map made in the editor is a free-map post, and it ships with
walls, doors and lights already baked — so the giveaway is strictly better than
every other free map on the subreddit. That is the wedge:

> Free battlemap. Walls, doors and lights already done — drop it in and run it.

Nobody else can post that. That single line is the strategy; everything below is
scheduling.

---

## 2. Positioning for social

**One line:** Draw the map, run the game. The walls, doors and light you drew are
already the fog.

**Three hooks**, in order of how well they land cold:

1. *No re-tracing.* Foundry's setup burden is the most complained-about thing in the
   VTT world. "The map is already walled" is the hook that gets upvotes.
2. *The server is the referee.* Players cannot peek — redaction is enforced
   server-side, not styled client-side. This lands hard with anyone who has been
   burned by a player inspecting a fog layer.
3. *Players join from a link.* No install, no account wall to sit at the table.

**Voice split, per PRODUCT.md.** The goblin register is the marketing voice —
cheeky, quick, feral. It works on Reddit *only* in a first-person builder's mouth
("I got sick of tracing every wall twice, so —"). It does not work as a brand
account talking about itself in the third person. On Reddit, be a person.

---

## 3. Accounts — claim this week

| Thing | Handle | Role |
|---|---|---|
| Reddit personal | your existing account | **Primary voice.** Every comment, every map post. |
| Reddit brand | u/GoodGoblinApp | Low volume. Own-sub posts, replies when tagged, verification. |
| Subreddit | r/GoodGoblin | Claim now, park it. Cheap, and unrecoverable if squatted. |
| Discord | Good Goblin | **The real destination.** The beta cohort lives here. |
| Bluesky + X | @goodgoblin | Auto-cross-post map drops and GIFs. Zero extra effort. |
| YouTube | Good Goblin | The one secondary channel that earns its keep — see §6. |
| Waitlist page | on the site | One field. A distinct UTM link per channel. |

Reddit dislikes brand accounts and it is right to. The personal account carries the
relationship; the brand account exists so the name is not squatted and so there is
something for people to tag.

---

## 4. Where to be

Verify current rules and sizes before your first post in any of these — subreddit
rules change, and the numbers below are rough bands, not gospel.

| Sub | Rough size | Rewards | Promo posture | Your play |
|---|---|---|---|---|
| **r/battlemaps** | ~250k | Free, usable, VTT-ready maps | Free links fine; paywalls hostile; **AI banned** | **The engine.** One map drop a week. |
| **r/dndmaps** | ~200k | Same, broader, more hand-drawn | Same | Second home for the same map, retitled, 3+ days later. |
| **r/FoundryVTT** | ~90k | Tooling that removes setup | Restricted — read the rules, ask the mods | "Walls and lights pre-baked" matters more here than anywhere. |
| **r/DMAcademy** | ~700k | Specific answers to "how do I run X" | **Zero promo.** Profile flair only. | Two real answers a week. No links, ever. |
| **r/DnDBehindTheScreen** | ~800k | Long-form prep resources | No promo | One substantial prep resource a month. |
| **r/rpg** | ~1.5M | System-agnostic tool talk, allergic to hype | Very strict; self-promo thread only | Participate honestly for weeks first. Launch goes in their promo thread. |
| **r/DnD** | ~4M | OC art, mass reach | Strict, promo windows | One big art post a month, maximum. Highest ceiling, highest risk. |
| r/dungeondraft, r/inkarnate, r/wonderdraft | small | Map-maker craft | Mixed | High intent. Be useful, be honest about the differences. |
| r/DMToolkit, r/dmdivulge | small | Tools, finished prep | Mild | Cheap incremental reach. |
| r/SideProject, r/IndieDev, r/gamedev | large | Build-in-public | Open | Low conversion, near-zero cost. Cross-post the build logs. |
| r/Roll20, r/talespire, r/AlchemyRPG | — | Competitor homes | — | **Observe only.** Never pitch. Poaching gets remembered. |

---

## 5. The content engine — four pillars

**Pillar 1 — The Map Drop.** *Weekly. This is the engine; protect it.*
A finished free map. Ship it as gridded PNG, gridless PNG, and the walls/lights
data. Small credit mark in one corner, never a watermark across the art. The title
names the scene, never the tool — "Flooded Tannery, 30×22" beats anything with a
product name in it. The tool appears in your own first comment, once, as a person
talking: "made in the thing I'm building — the walls and lights come out with it,
happy to answer anything."

**Pillar 2 — The Chore Kill.** *Every other week.*
A 20–40s silent GIF of exactly one chore disappearing. Paint a wall, watch the fog
update live. Drag a light, watch the room change. One idea per clip, no UI tour, no
music, no voiceover. Goes to r/FoundryVTT (rules permitting), r/SideProject,
r/GoodGoblin, Bluesky/X. This is where product-forward posting is allowed.

**Pillar 3 — DM Craft.** *Two comments a week plus one post a month. Zero product.*
You already have the material from the prep-layer work: room notes, encounter
triggers, running a reveal. Post it as craft, not as a feature. This is what buys
you the right to post pillars 1 and 2 without being read as a marketer.

**Pillar 4 — The Build Log.** *Every other week. r/GoodGoblin + Discord + X.*
Honest, including what broke. Build logs convert badly and retain brilliantly —
they are what turns forty strangers into a beta cohort that actually shows up.

### Weekly rhythm (~4 h)

- **Mon, 30 min** — pick the week's map, write both titles.
- **Wed, 60 min** — post the map drop to one sub. Then stay on it: reply to every
  comment for the next two hours. Early engagement is most of the ranking.
- **Thu, 30 min** — retitled post to the second sub. Never a same-day cross-post.
- **Fri, 45 min** — GIF or build log.
- **Daily, 15 min** — comment pass. Search `battlemap`, `fog of war`, `vtt`,
  `map maker` sorted by new. Answer three. Link to nothing.

---

## 6. Channels beyond Reddit

Pick **one** secondary and ignore the rest until launch.

**YouTube (plus Shorts) is the one.** Map timelapses are free — you are rendering
anyway — and they stay findable in a way Reddit posts do not. A 45-second "tavern,
start to finish" short is the highest-leverage asset you can make twice a month.

Bluesky, X and Instagram get the same asset auto-posted with no bespoke work.
TikTok only if a short does well on its own. **Do not build any of these before the
Discord exists** — traffic with nowhere to land is wasted.

---

## 7. Twelve weeks

**Weeks 1–2 — Foundation.** Settle §0. Claim every handle. Waitlist page live with
per-subreddit UTM links. Discord skeleton (five channels, not twenty). Message the
mods of r/battlemaps, r/dndmaps and r/FoundryVTT before posting anything. Warm the
personal account: comment only, zero links, get to a few hundred comment karma so
the spam filter stops eating you.

**Weeks 3–6 — Give.** A map drop every week. No CTA beyond one honest line in the
comments. Craft answers daily. The goal is narrow: become a name people recognise
in r/battlemaps.
*Gate:* three drops clearing roughly 100 upvotes. If not, the maps are the problem
— fix the art before adding channels.

**Weeks 7–10 — Wedge.** Introduce the Chore Kill clips. The waitlist link appears
in comments only when someone asks. Pull 10–20 DMs from Discord into a closed alpha
and watch them prep a real session.
*Gate:* ~300 waitlist, ~100 Discord. If short, the gift is wrong, not the volume —
change what you are giving away rather than posting more of it.

**Weeks 11–12 — Cohort.** Beta invites in waves of 25, so support stays survivable.
Collect three real DM quotes and one recorded session. Make it one click for a beta
user to export a map with a small credit — **their** posts are the only channel
that scales past your own arms.

**Launch week.** Day −7: tell Discord, hand them invite codes to give away. Day 1:
lead with a bundle of five free maps, not with the product — "I've been posting free
maps here for three months; here are five more, and the thing I made them with."
Then r/rpg's self-promo thread, r/DnD inside its promo window, r/SideProject and
r/FoundryVTT. Never all in one day; the site-wide spam filter is real. Be awake and
answering for the whole first day.

---

## 8. Interaction rules

- **Nine to one, give to ask.** Count it. Nine comments or free things per
  self-referential post.
- **Always disclose.** "I built this" in every thread, every time. Undisclosed
  promotion is a permanent ban and a screenshot that outlives the ban.
- **Message mods first.** Before your first self-promo post in a sub, not after.
- **Reply to everything for the first four hours.** Highest-ROI hour of your week.
- **One reply to hostility, then stop.** Arguing in public costs more than the point
  is worth.
- **Never pitch in a competitor's sub.**
- **No alt accounts, no upvote coordination.** Vote manipulation is detected, and it
  ends the brand, not just the account.
- **Never post the same link twice in 24 hours**, and never the same asset to two
  subs on the same day.

**Mod DM template:**

> Hi — I make free battlemaps and I've been posting in r/[sub] for a few weeks. I'm
> also building the editor I make them in, and I'd rather ask than guess: is it okay
> to mention it in the comments of my own map posts? The maps are free, CC-BY, no
> paywall and no signup. Happy to leave it out entirely if you'd prefer.

---

## 9. The funnel

`Reddit post → comment mention → waitlist page → email → Discord → beta code →
user posts their own map → Reddit`

The loop only closes if the last arrow is one click. Build the "export with credit"
share path before beta, not after.

Give every subreddit its own short link so you can tell which community actually
converts — it is usually not the biggest one.

---

## 10. Metrics and kill criteria

**North star:** waitlist signups per week. Everything else is a proxy.
**Watch:** Discord joins, map downloads, comment replies per post.
**Ignore:** karma totals, follower counts, impressions.

- Six weeks of weekly drops under ~50 total waitlist → the *offer* is wrong, not the
  frequency. Change the gift.
- A drop clears 500 upvotes and converts nothing → the comment mention is too quiet,
  or the landing page does not explain the wedge in five seconds.
- Two removed posts in one sub → stop posting there and talk to the mods.

---

## 11. Don't

- No AI-generated art anywhere near a D&D subreddit. See §0.
- No paywalled "free" map, no email wall on a download, no gated grid version.
- No engagement-bait titles. This audience punishes them specifically.
- No third-person brand voice in comments.
- No launching to six subs in one day.
- No second social channel before the Discord has people in it.

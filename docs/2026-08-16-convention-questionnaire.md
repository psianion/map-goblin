# Convention questionnaire — DM & player field research

How to use: don't hand this over as a form. Pick the section matching who you're talking to (map-maker, game-runner, player), ask 4–6 questions, let them rant. The rants are the data. Legend on every question: ✅ we have it (validate), 🔲 gap (sizing), 🚧 planned/parked (prioritize).

---

## 30-second hallway version (when you only get one shot)

1. What do you build maps in, and what do you run games in — and are they the same tool? 🔲 *(our whole bet is editor+table in one)*
2. When you find a great map image online, what do you do with it? Walk me through it. 🔲
3. How do you handle fog of war and lighting — do you set it up, skip it, or fight it? ✅
4. What do you use for music/ambience mid-session, and does it ever fall apart? 🔲
5. If one thing about your current setup vanished tomorrow and you'd quit — what is it?

---

## Screener (everyone, 30 seconds)

- DM, player, or both? How often do you play — weekly, monthly, con-only?
- In person, online, or hybrid? If in person: is there a screen/TV on the table?
- What system? (5e, PF2e, OSR, other — tells you rules-integration expectations)
- What's your current stack, end to end: map tool → VTT → dice → music → character sheets?

---

## Section A — Map builders (Inkarnate / Dungeondraft / Dungeon Scrawl users)

**A1. Which tool, and why that one?** What did you try and abandon, and what made you leave?

**A2. Battlemaps, region maps, or world maps — what do you actually make most?** 🔲 *(We only do battlemaps. If everyone makes all three, that's a scope signal.)*

**A3. When you finish a map, what happens next?** Export PNG and re-import into a VTT? Re-trace walls and lighting there? How long does that second pass take? ✅ *(This is our core pitch — zero re-tracing. If they don't feel this pain, our positioning is off. Probe hard.)*

**A4. Do you export/import UVTT / dd2vtt files (maps with embedded wall+light data)?** 🔲 *(Dungeondraft exports these; Foundry imports them. If this format is common currency, importing it is a cheap adoption bridge for us.)*

**A5. Asset style: do you want a curated consistent art style, or a giant marketplace of mixed assets?** ✅/🔲 *(We're curated hand-painted packs, no marketplace. Inkarnate wins on volume; do people feel the inconsistency?)*

**A6. Do you ever paint terrain/floors vs. stamping tiles?** How important are seams, texture quality, variation? ✅

**A7. Animated/live maps (water, fire, weather) — gimmick or must-have?** ✅ partial *(we have time-of-day, ambient light, weather surfacing)*

**A8. Do you print maps or export for physical play?** 🔲

---

## Section B — Game runners (Roll20 / Owlbear / Foundry / Fantasy Grounds users)

**B1. Which VTT, and what's the single worst thing about it?** *(Roll20 users usually say performance/UI age; Foundry users say setup burden; Owlbear users say it's light but shallow. Let them confirm or surprise you.)*

**B2. Fog of war: manual reveal, dynamic line-of-sight, or none?** How long does wall/vision setup take per map? ✅ *(Our fog derives from authored walls automatically — measure their setup pain in minutes.)*

**B3. Have players ever seen something they shouldn't have — peeked fog, inspected the page, seen a hidden token?** Did it matter? ✅ *(Server-enforced redaction is our trust story; Owlbear's fog is client-side courtesy. Find out if anyone actually cares.)*

**B4. Dynamic lighting: do you use it, and is it worth the setup?** Torches, darkvision, light-gated sight? ✅

**B5. What does your player onboarding look like — accounts, installs, invite links?** How many minutes from "here's the link" to playing? ✅ *(We're zero-install invite links.)*

**B6. Initiative & combat tracking — in the VTT, on paper, or a separate app?** What should a combat tracker do that yours doesn't? 🚧 *(Sprint 5. This shapes it.)*

**B7. Character sheets and rules automation — must the VTT have them, or do you prefer D&D Beyond/paper alongside?** 🔲 *(Big scope question. If sheets are table stakes, that's a strategy problem; if "alongside" is fine, we're safe.)*

**B8. Dice: where do you roll?** Physical, VTT, Discord bot? 🔲🚧 *(Discord bot parked; dice not built.)*

**B9. Foundry users specifically: which modules are load-bearing for you?** *(The top-5 module list is a free roadmap.)*

**B10. Performance: table size, token count, map size where your VTT starts choking?** ✅ *(We've invested here; get their numbers.)*

**B11. Do you run in-person games through a VTT on a TV/tablet?** What breaks in that mode? 🔲

---

## Section C — Imported content (the "DMs source images from the internet" thread)

**C1. Where do your maps actually come from?** Self-made, Patreon creators (Czepeku, Dyson, etc.), Reddit, publisher PDFs — rough percentages?  🔲 *(If most maps are found, not made, then image import + fast wall-tracing on top of an imported image matters more than our editor. This is the most strategically important section.)*

**C2. Walk me through importing a found map into your VTT.** Gridding/alignment, scaling, then walls/fog on top — where's the friction? How long per map? 🔲

**C3. Would you pay for a tool that auto-detects grid and traces walls on an imported image?** 🔲

**C4. Tokens: where do they come from?** Token makers, art rips, top-down vs portrait? Do you need a token editor in-app? 🔲

**C5. Copyright/licensing — does it ever affect what you use or where?** *(Matters for whether a marketplace needs licensing rails.)*

---

## Section D — Audio (the music thread)

**D1. What's your current music/ambience setup mid-session?** Spotify/YouTube alt-tabbing, Syrinscape, Kenku FM into Discord, physical speaker? 🔲

**D2. What breaks?** Ads, sync, fumbling to change tracks mid-combat, players hearing different things, quality loss over Discord? 🔲 *(One DM already asked us for easy lossless integration — validate how common this is.)*

**D3. Would you want audio attached to the map itself — this room plays dungeon drips, combat starting swaps the track, walking into the tavern fades in the bard?** Or is a separate soundboard fine? 🔲 *(This is the differentiating version: audio as authored map data, same as our walls→fog story. Scene/room-triggered audio fits our architecture.)*

**D4. Where does the audio need to come out — everyone's own browser, a Discord voice channel, one speaker at the table?** 🔲 *(Determines whether we build browser playback, a Discord bot bridge, or both.)*

**D5. Do you own audio files, or stream from services?** Licensing awareness? 🔲

---

## Section E — Players (don't skip them; they outnumber DMs 4:1)

**E1. What annoys you about the VTT your DM uses?** Login, lag, can't find your token, tiny map on phone?

**E2. Do you ever join from a phone or tablet?** How bad is it? 🔲

**E3. Does map/art quality change how immersed you feel, or do you not notice?** ✅ *(Tests whether our hand-painted art bar is a real differentiator or DM vanity.)*

**E4. Has fog/hidden-info ever been spoiled for you, and did it deflate the moment?** ✅

---

## Section F — Money (ask everyone, last)

**F1. What do you pay today, across everything — VTT sub, Inkarnate sub, Patreon map creators, D&D Beyond?** *(Most DMs pay more than they think; total it out loud with them.)*

**F2. One-time purchase, subscription, or free-with-paid-assets — what feels fair for a map editor + VTT in one?**

**F3. The magic wand: describe your dream prep-to-play flow, start of prep to first initiative roll.** How long should it take?

---

## After each conversation, jot (2 lines max)

- Stack + weekly/monthly + biggest rant
- Any quote worth stealing for marketing — verbatim

## What I'd tally at the end of the con

1. % of maps found-online vs self-made (decides how much Section C should reshape roadmap)
2. Count of DMs who feel the re-tracing pain (validates core positioning)
3. Audio setup breakage frequency (sizes the music feature)
4. Whether sheets/dice are table stakes or fine-alongside (bounds scope)

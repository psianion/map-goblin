# Audio v1 — music, ambience, cues on the table

Status: PLAN — awaiting approval. 2026-08-25.

Scope agreed: Tier 1 full (slots + soundboard + playlists + mixing) + Tier 2
(door cues, reveal sting, combat music) + Tier 3 (room-based ambience,
door-closed stop/muffle) + weather audio (rain layer, lightning strikes) +
DM-addable cue sounds + proper mix balance. Licensing deliberately out of
scope for now (invite-only free platform); assets tagged anyway.

Format decision: ship **Opus** (~160k, transparent, gapless), keep FLAC
masters in the forge/source tree. FLAC toggle later only if asked.

---

## 1. Architecture overview

No streaming. Audio files are pack/CDN assets fetched like textures; the
server syncs only *tiny cue events and state*. Clients play locally.

```
DM action ──sendCommand('audio',…)──▶ audio GameModule
                                        ├─ setState  → durable AudioState (state-update, all clients)
                                        └─ broadcast → transient audio-cue (one-shots, not persisted)
clients ──▶ AudioEngine (Web Audio) ──▶ buses ──▶ limiter ──▶ speakers
```

### Server: new `audio` GameModule

`packages/mechanics/src/audio/{types.ts,module.ts}`, registered in server
boot next to doors/fog/initiative. Bump `PROTOCOL_VERSION` (existing v4/v5
comment convention in `packages/core/src/shared/protocol.ts`).

```ts
AudioState = {
  byScene: {
    [sceneId]: {
      music:  { trackId, startedAtServer, loop, gain, fadeMs } | null,
      combatTrackId: string | null,          // DM-set; engine switches on initiative status
      weatherAudio: boolean,                  // follow the environment dial (default on)
      roomAmbience: { [roomId]: { trackId, gain } },
    }
  }
}
```

Commands (all `['dm']`): `play-music`, `stop-music`, `set-combat-track`,
`set-room-ambience`, `clear-room-ambience`, `set-weather-audio`, `cue`
(one-shot → `ctx.broadcast({type:'audio-cue', cueId, gain?})`), `stop-all`
(panic: clears music + broadcasts a stop-everything cue).

No redaction needed v1 — players hear what the DM plays. (Room ambience is
*attenuated client-side* by where your token is, not redacted server-side.)

Late joiners: `music.startedAtServer` → seek `(now − startedAt) % duration`.
Room loops don't need phase sync; they just start.

### Client: AudioEngine

`session/client/src/modules/audio/` — `registerPanel({id:'audio', mount: AudioEngineMount, …})`.
The **`mount`** hook (runs once per seat, popover open or not) hosts the
engine — exactly what it exists for.

Web Audio graph:

```
musicBus ─┐
ambientBus ├─ duckable ─▶ masterGain ─▶ DynamicsCompressor (limiter) ─▶ destination
sfxBus ───┘
```

- **Music**: `HTMLAudioElement` + `MediaElementAudioSourceNode` — streams,
  no PCM in memory (a 3-min track decoded is ~66 MB; unacceptable).
  Crossfade = two elements + gain ramps.
- **Ambience loops + one-shots**: `decodeAudioData` → `AudioBufferSourceNode`
  with `loop=true` — gapless. Loops capped ≤ 60 s (~23 MB PCM each);
  concurrent decoded-loop budget ~6, LRU-release.
- **Ducking**: any sfx cue ramps music+ambient −6 dB for its duration.
- **Voice cap**: max 8 concurrent one-shots, drop-oldest.
- **Unlock**: create/resume `AudioContext` in the `JoinSession.tsx` submit
  handler and `HostSetup.tsx` start handler (real click events); fallback
  resume on first pointerdown on the table.

### Player prefs (local, never synced)

zustand + `localStorage` (precedent: `beyond20.ts`): master + per-bus
sliders, mute. Lives in the Audio panel, visible to all roles.

### Mix balance rules

- Assets loudness-normalized at import: music/loops −16 LUFS, cues −12 LUFS
  (ffmpeg `loudnorm` step in the pack build — pipeline, not runtime).
- Default bus gains: music 0.8, ambient 0.6, sfx 1.0.
- Limiter on master so stacked thunder + creak + music never clips.

---

## 2. Tier 2 — entity cues (client-side derivations, zero new wire traffic)

All three observe existing `state-update` diffs, mirroring the
`trackDoorIds`/fade "just arrived" pattern in `DoorRenderer.ts`:

| Hook | Signal | Sound |
|---|---|---|
| Door | `doors.byScene[..].open` flip in state diff | creak (open) / thud (close); locked-refusal rattle on the targeted `error` frame is a freebie |
| Reveal | `fog` room status → `'revealed'` transition | soft sting (skip during bulk `set-bulk`/auto-explore floods — debounce: >3 rooms in one frame = one sting) |
| Combat | `initiative.status` `idle→running` / `→idle` | crossfade to `combatTrackId`, back to scene music on end |

Bot needs nothing: it already just reads the same state.

---

## 3. Tier 3 — room-based ambience + door muffling

Inputs that already exist:

- Rooms first-class with stable ids + polygons (`roomUtils.ts`).
- Doors carry `roomA`/`roomB` (`roomBinding.ts`) → adjacency graph.
- `blocksSound` on walls/doors per open/closed state (`occlusion.ts`) —
  **currently unused, written for this feature**. Its comment even proposes
  upgrading bool → numeric attenuation later.

Listener model:

- **Player**: listening room = room containing your token (point-in-polygon,
  client-side, recomputed on token move — cheap, rooms are few).
- **DM**: room under the camera/viewport center (DM has no single token).

Mix per frame (recomputed on room-change / door-toggle only, then gain ramps):

- Current room's ambience: full gain.
- Adjacent room (shares a door): door **open** → −10 dB bleed;
  door **closed & blocksSound** → lowpass ~600 Hz + −20 dB ("music behind
  the door"); door closed & !blocksSound (window/ethereal per wall type) →
  lowpass off, −14 dB.
- Non-adjacent: silent (loop released if outside budget).
- Transitions are 400 ms gain/filter ramps — walking through a door sounds
  like walking through a door.

DM authoring: assign ambience per room from the Audio panel (click room →
pick track), stored in `AudioState.roomAmbience`. (Trigger-based authoring
is the stretch in §6.)

---

## 4. Weather audio

The environment dial already exists (`WEATHERS` in `prep.ts`, `triggers`
`set-environment`) and currently only writes a log line. The engine
subscribes to it — **no new UI**:

- `rain` → rain loop on ambient bus (global, not room-scoped, but *outdoor
  only if we ever tag rooms; v1: global with room-ambience ducking it
  slightly indoors — skip room tagging).
- `storm` → heavier rain loop + **lightning scheduler**: thunder one-shot at
  random 20–60 s intervals, 3 thunder variants. Each client schedules
  independently (remote players; ±seconds of thunder skew is unobservable).
- `snow`/`fog` → wind-low loop / nothing. `clear` → fade out.
- `weatherAudio` flag in AudioState lets the DM mute the layer without
  changing the narrative dial.

---

## 5. Assets & DM-addable cues

### Pack audio kind

- Extend `PackManifest` with `type:'audio'` entries (subtype tag:
  `music | loop | cue`), files as `.opus`. Update **both** schema copies
  (`assetPackManager.ts` and `packages/vault-engine/src/schemas/pack-manifest.ts`).
- `ensureAudioForScene` sibling of `ensureTexturesForMap`: enumerate track
  ids referenced by AudioState for the active scene + the built-in cue set,
  fetch/checksum/cache via the existing packDB/IndexedDB path.
- **Starter audio pack** (needed to demo anything): 2–3 music tracks,
  1 combat track, 4–6 ambience loops (dungeon drip, tavern, forest, wind),
  door creak + thud + rattle, reveal sting, rain + storm loops, 3 thunders.
  Sourced CC0/CC-BY now; forge-generated (local music/audio gen models on
  the ComfyUI box) replaces them later. Every asset gets `license` +
  `attribution` fields in the manifest from day one.

### DM uploads ("addable cue sounds")

Reuse the `AssetStore` blob pattern (`POST /api/campaigns/:id/assets`,
currently token portraits): accept audio mime, cap 10 MB, serve via
`GET /api/assets/:id`. Uploaded cues appear in the soundboard grid alongside
pack cues. Music-length uploads deferred (uploads are cues only, ≤10 MB).

---

## 6. Stretch (in-plan, cut first if v1 runs long)

- **Trigger action `{kind:'audio', cueId}`** in the `TriggerCondition/Action`
  unions (`prep.ts`, `triggers/module.ts`) — zone-anchored cues
  (enter-region → sound) with the existing authoring surface. Small because
  it mirrors the `light` action shape exactly.

Explicitly **out** of v1: positional stereo panning, outdoor/indoor room
tagging, FLAC delivery toggle, Discord-voice playback, layered mood-designer
tooling, playlist shuffle/queue (one music slot + combat slot only).

---

## 7. DM UI (Audio panel)

One rail icon (new `IconName`), one popover, registered via `panels.ts`:

- **Now playing**: music slot (track picker, play/stop, fade), combat track
  slot, weather-audio toggle, STOP ALL (panic).
- **Soundboard**: grid of cue buttons (pack + uploaded), click = broadcast.
- **Rooms**: room list → ambience assignment.
- **Mixer** (all roles see this part): master + music/ambient/sfx sliders,
  mute — local only.

Full design-review pass on the panel per the standing UI rule.

---

## 8. Phases

| # | Deliverable | Touches |
|---|---|---|
| P1 | audio module + protocol bump + AudioEngine mount + panel (music/combat slots, soundboard, mixer, unlock, stop-all) + pack audio kind + starter pack | mechanics/audio, server boot, protocol.ts, client modules/audio, assetPackManager + vault-engine schema, packs |
| P2 | entity cues (doors, reveal, initiative) + ducking | client-only |
| P3 | room ambience + adjacency bleed + door muffling (`blocksSound`) | client engine + panel rooms tab + AudioState.roomAmbience |
| P4 | weather layer (rain/storm/lightning) off the environment dial | client-only + weatherAudio flag |
| P5 | DM cue uploads | http.ts asset route + panel |
| P6 | stretch: audio trigger action | prep.ts + triggers module |

Each phase lands in the ongoing PR branch (no unapproved PRs); gate = Docker
deploy + a live in-browser walkthrough on a dressed demo map, zero
console/network errors, per the standing sprint-verification rule.
Audio-specific gate checks: late-join seek correctness, two-seat cue sync,
autoplay unlock on both join paths, room-transition ramps, limiter under
stacked cues.

## 9. Risks / open questions

- **PCM memory** on low-end machines — mitigated by media-element music +
  loop budget; verify in gate walk with the mixer maxed.
- **iOS Safari** quirks (context suspension on tab switch) — out of gate
  scope, desktop Chrome is the supported surface today.
- **Thunder desync** across clients — accepted (remote play).
- Open: does the DM want to *preview* room ambience without broadcasting?
  Proposed: defer; DM hears the same mix as their camera room, which is
  effectively preview.

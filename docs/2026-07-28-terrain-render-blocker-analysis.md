# Terrain render blocker — root cause analysis

**Date:** 2026-07-28
**Branch:** `sprint-3-the-dark-is-real`
**Status:** root cause proven, fix verified at runtime, no source changed by this investigation
**Blocks:** the §2.6 pixel rows in `session/client/e2e/sprint3-fog.spec.ts` (`RENDER_BLOCKED`)

---

## 1. Verdict up front

The defect is **not** the fixture, **not** an async race, and **not** a runner-only problem.

It is a plain lifecycle bug in `packages/core/src/engine/terrain/TerrainRenderer.ts`: `loadPalette()`
destroys the previous palette tile `RenderTexture` **while it is still bound to the terrain shader**,
and then rebinds. In PixiJS 8, destroying a bound `TextureSource` makes the shader's `BindGroup`
delete its own resource map (`this.resources = null`). Every later read of that map throws, including
the one the very next line performs, and including the one every frame performs.

The trigger is **any palette change after a first successful palette load**. Emberhold Crypt only
looks special because it is the only fixture that ships a non-default `mapSettings.terrain.palette`.

Both apps are affected. The editor is affected *worse*, because its own terrain palette picker
reaches the bug with no map load at all.

---

## 2. Reproduction

Both reproductions run headless Chromium against a real GPU stack
(`--use-angle=default --ignore-gpu-blocklist`), 1280×720.

### 2.1 Runner (session client)

```
GAME_SERVER_DATA=<tmp> PORT=8790 pnpm --filter @dnd/game-server start
E2E_SERVER_PORT=8790 E2E_DEV_PORT=5178 pnpm --filter @dnd/session-client dev -- --port 5178
```

Host a table through the runner's own UI on `session/testdata/emberhold-crypt.mapbuilder`
(Landing → Host a game → campaign → upload → Start session → Enter table), then probe the DM canvas:

| probe | value |
| --- | --- |
| `terrainMesh` found in stage | `true` |
| `terrainMesh.shader.groups[99].resources === null` | **`true`** |
| forced `app.render()` | **`THREW: Cannot read properties of null (reading '0')`** |
| canvas mean luminance | **14.16 / 255** |
| canvas pixels above luminance 32 | **0.00 %** |
| `mapSettings.name` in the core store | `Emberhold Crypt` |
| dungeon layer rooms in the core store | `13` |

Console/page errors, verbatim:

```
PAGEERROR: Cannot read properties of null (reading '0')
PAGEERROR: Cannot read properties of null (reading '3')
ERROR: [terrain] splatmap restore failed: TypeError: Cannot read properties of null (reading '1')
          at BindGroup.setResource
```

This matches the numbers already recorded in the spec header (DM mean 14.1/255, 0.06 % drawn).

### 2.2 Editor (canvas)

```
pnpm --filter map-builder dev   # :5173
```

Then, in the page, through the editor's own loader — the same call `MapsSidePanel` makes:

```js
window.__store.getState().loadFromFile(<emberhold-crypt.mapbuilder>)
```

| probe | before load | after load |
| --- | --- | --- |
| `terrainMesh.shader.groups[99].resources === null` | `false` (9 resources) | **`true`** (0) |
| ticker still advancing 1.2 s later | — | **`false`** |
| canvas mean luminance | — | **14.16 / 255**, 0.00 % lit |
| store scene | — | 13 rooms, 84 children |

Same three errors, same indices, same luminance as the runner — to two decimal places.

Note: `loadFromFile` itself **does not throw to its caller** (`threw: false`). See §5.2.

### 2.3 Isolation matrix (editor, fresh browser context per row)

| variant | bind group nulled | ticker advancing | mean / % lit |
| --- | --- | --- | --- |
| fixture as-is | **yes** | no | 14.16 / 0.00 % |
| `mapSettings.terrain` deleted (palette stays default) | no | yes | 5.99 / 4.61 % |
| palette rewritten to the *same* ids as `DEFAULT_TERRAIN_PALETTE` | no | yes | 5.99 / 4.61 % |
| palette set to all-`null` | **yes** | no | 14.16 / 0.00 % |
| pack palette kept, **both splat PNGs deleted** | **yes** | no | 14.16 / 0.00 % |
| **no map load at all** — one palette slot swapped via `setTerrainData` | **yes** | — | — |

Reading of the matrix:

* Splat bitmaps are irrelevant — removing both still corrupts.
* Pack-prefixed (`dungeon-classic:…`) ids are irrelevant — an all-`null` palette corrupts too.
* A palette that is byte-identical to the default is safe, because `loadPalette()` early-returns on
  `key === this.loadedPaletteKey`. That is the *only* reason anything has ever rendered.
* The last row is the important one: **no map, no fixture, no serialization involved.** Changing one
  palette slot in a running editor is enough.

### 2.4 The mechanism, isolated

Run in-page against the live terrain mesh's own `Shader` / `TextureSource` constructors (so these are
the real pixi 8.17.1 classes, not a mock):

```js
// what loadPalette does today
const sh = new Shader({ glProgram, resources: { uTexA: oldSrc } })
oldSrc.destroy()
sh.groups[99].resources === null   // -> true
sh.resources.uTexA = newSrc        // -> TypeError: Cannot read properties of null (reading '0')

// the reorder
const sh2 = new Shader({ glProgram, resources: { uTexA: oldSrc2 } })
sh2.resources.uTexA = newSrc2      // rebind first  -> no throw
oldSrc2.destroy()                  // then destroy
sh2.groups[99].resources === null  // -> false
sh2.groups[99].resources[0] === newSrc2  // -> true

// texture GC is harmless
someSrc.unload()                   // emits 'change' with destroyed === false
sh3.groups[99].resources === null  // -> false
```

---

## 3. Root cause

### 3.1 The exact null value

`BindGroup.resources` — the resource map of the terrain shader's bind group **99**. It is `null`.
Nothing about the map document, the palette ids, the splat PNGs or any texture is null.

`node_modules/.pnpm/pixi.js@8.17.1/…/rendering/renderers/gpu/shader/BindGroup.mjs`:

```js
setResource(resource, index) {
  const currentResource = this.resources[index];   // <-- throws when resources === null
  ...
}
destroy() {
  ...
  this.resources = null;                           // <-- self-destruct
}
onResourceChange(resource) {
  this._dirty = true;
  if (resource.destroyed) {
    this.destroy();                                // <-- a bound resource's death kills the group
  } else {
    this._updateKey();
  }
}
```

`…/rendering/renderers/shared/texture/sources/TextureSource.mjs`:

```js
destroy() {
  this.destroyed = true;   // set BEFORE the emit
  this.unload();           // unload() emits 'change'
  ...
}
unload() {
  this._resourceId = uid("resource");
  this.emit("change", this);   // -> BindGroup.onResourceChange, sees destroyed === true
  ...
}
```

So: **destroying a `TextureSource` that is still registered in a live `BindGroup` permanently
nulls that bind group.** The shader is dead from that instant on; there is no recovery path in pixi.

### 3.2 Why the indices are 3, 1 and 0

`Shader.from({ resources: {...} })` with a WebGL-only program puts every resource in bind group 99
and assigns bindings in declaration order (`Shader.mjs`, the `bindTick` loop). For
`TerrainRenderer.buildMesh()` that is:

| binding | resource |
| --- | --- |
| 0 | `terrainUniforms` (UniformGroup) |
| 1 | `uSplat0` |
| 2 | `uSplat1` |
| **3** | **`uTex0`** |
| 4–8 | `uTex1` … `uTex5` |

Confirmed empirically: `groupKeys: ["99","100","101"]`, `resourceCount: 9` on group 99 before the load.

That maps the three reported errors exactly:

* `loadPalette` → **reading '3'** → `this.shader.resources['uTex0'] = rt.source`
* `splats()` → **reading '1'** → `this.shader.resources.uSplat0 = …`
* `GlShaderSystem.bind` → **reading '0'** → the generated sync function's first statement

`GenerateShaderSyncCode.mjs` emits, per group:

```js
resources = g[99].resources;
ugS.updateUniformGroup(resources[0], p, sD);   // terrainUniforms
tS.bind(resources[3], 0);                      // uTex0 …
```

`resources` is `null`, so `resources[0]` throws inside `GlShaderSystem.bind`, out of
`GlEncoderSystem.draw` → `GlMeshAdaptor.execute` → `MeshPipe.execute` → `WebGLRenderer.render`.

### 3.3 The offending lines

`packages/core/src/engine/terrain/TerrainRenderer.ts` — two sites, both destroy-then-rebind:

```ts
// 243-245 — cleared slot
this.tileRTs[slot]?.destroy(true);      // <-- kills the bind group
this.tileRTs[slot] = null;
if (this.shader) this.shader.resources[`uTex${slot}`] = Texture.WHITE.source;   // <-- throws

// 275-279 — replaced slot
this.tileRTs[slot]?.destroy(true);      // <-- kills the bind group
this.tileRTs[slot] = rt;
if (this.shader) {
  this.shader.resources[`uTex${slot}`] = rt.source;                             // <-- throws
```

`setResource` already does `currentResource?.off?.("change", …)` before storing the new resource, so
**rebinding first and destroying second is safe** — verified in §2.4.

### 3.4 Why it never fired before this sprint

`getPalette()` falls back to `DEFAULT_TERRAIN_PALETTE` (six *legacy* flat ids: `grass-a-01`, …).
Boot order in both apps is `rehydrate() → ensureBundledPack() → buildSceneGraph()`, so by the time
`TerrainRenderer`'s constructor fires its `fireImmediately` palette subscription the bundled pack is
installed, every default id resolves through `resolveLegacyId` → the atlas, and **all six `tileRTs`
get allocated and bound**. From that moment the shader is one palette change away from death.

Nothing before Sprint 3 changed a palette:

* `terrain.test.ts` runs against a hand-rolled fake renderer — no pixi, no `BindGroup`, no coverage
  of `loadPalette` at all.
* Every other fixture (`demo-dungeon.mapbuilder`) has no `mapSettings.terrain`, so the palette key
  never changes and `loadPalette()` early-returns.

The three candidate hypotheses in the brief resolve as: fixture malformation — **no**; async
ordering/race — **no** (the failing sequence is fully synchronous: pack-prefixed ids skip the `await`
in `loadPalette`, so the whole loop runs inside the zustand subscriber); plain core bug — **yes**.

---

## 4. Editor vs runner

### 4.1 Does the editor reproduce it? — **Yes, and it is reachable from the editor UI.**

* Loading Emberhold Crypt through `loadFromFile` in the canvas editor produces byte-identical
  symptoms to the runner (§2.2): same three errors, same bind group nulled, same 14.16 mean.
* More seriously, §2.3's last row: swapping **one palette slot** via `setTerrainData` — exactly what
  `ToolPopover`'s terrain palette picker does — corrupts the shader with no map load in the picture.
  Any DM who picks a second terrain texture in the editor blanks their own canvas.

This means the fixture-vs-engine question is settled without needing an editor-saved terrain map:
a map saved by the editor with a non-default palette would fail identically, and in practice the
editor session that authored it would have died at the moment the palette was picked.

### 4.2 Terrain-relevant boot differences

`session/client/src/renderer/GameRenderer.tsx` vs `canvas/src/canvas/CanvasHost.tsx`:

| step | editor | runner | terrain-relevant? |
| --- | --- | --- | --- |
| `setTimeout(0)` StrictMode yield before `Application.init` | yes | yes | — (both avoid a double `buildSceneGraph`) |
| `pixiEngine.init()` + `initClipper()` in parallel | yes | yes | no |
| renderer preference (`webgl`/`webgpu`) | unset — pixi autodetect | unset — pixi autodetect | no; both landed on WebGL here |
| `packManager.rehydrate()` → `ensureBundledPack()` **before** `buildSceneGraph()` | yes | yes | **no — ordering is correct in both** |
| `store.setInstalledPacks(...)` | **yes** | **no** | no (see below) |
| `buildMergedManifest()` → `store.setManifest(...)` | **yes** | **no** | no (see below) |
| `buildSceneGraph()` → `new TerrainRenderer` → `setTerrainRenderer` | yes | yes | identical |
| `subscribeToStore` / `subscribeToAssets` / `setupRenderLoop` | yes | yes | identical |
| `loadFromFile` entry point | `MapsSidePanel` / autosave | `GameRenderer` effect | identical call |
| teardown: `terrainRenderer.destroy()` | **yes** | **no** | latent leak, see §4.3 |
| teardown: `setTerrainRenderer(null)` | **yes** | **no** | latent leak |
| teardown: `destroyWaterAnimation()` | **yes** | **no** | latent leak |

On the merged manifest: `getTextureEntry()` is a lookup into the *static bundled* manifest only
(`_byId.get(id)`), and pack-prefixed ids are never in it. So `loadPalette`'s
`entry?.naturalWidth ?? tex.width` falls through to the texture dimensions in **both** apps and the
tile scale is the same. The missing `setManifest`/`setInstalledPacks` in the runner is a real
divergence but it does not touch terrain; it is worth a separate note for whoever adds a pack UI to
the runner.

**The runner is not missing an initialization step that would have prevented this.** The defect is
upstream of both hosts, in shared core.

### 4.3 Runner teardown gap (separate latent bug, found on the way)

`GameRenderer`'s `teardown` destroys `toolManager`, `lightingRenderer` and `fogTransition`, but not
the `TerrainRenderer`, and never clears the module singleton or the water ticker. A route change away
from `/table` and back therefore leaves an orphaned `TerrainRenderer` whose two `useStore.subscribe`
callbacks are still live and whose `this.engine` points at a destroyed `Application`. The next map
load would call `renderToTexture` on it. Today the boot-time `setTimeout(0)` guard hides this from
StrictMode, so it is latent — but it is three missing lines against the editor's teardown.

---

## 5. Blast radius and containment

### 5.1 Why one bad bind poisons the whole canvas

The corrupted object is **shared state that outlives the failure**: the `BindGroup` belongs to the
terrain `Shader`, the `Shader` belongs to the `terrainMesh`, and the mesh stays a child of
`worldContainer`. Nothing marks it broken and nothing removes it. So every subsequent render walks
into it:

```
Application.render → WebGLRenderer.render → MeshPipe.execute → GlMeshAdaptor.execute
  → GlEncoderSystem.draw → GlShaderSystem.bind → <generated sync fn>
  → resources = g[99].resources   // null
  → resources[0]                  // TypeError
```

The throw escapes `renderer.render()`, which pixi's `TickerPlugin` registered on the shared ticker at
`UPDATE_PRIORITY.LOW`. `Ticker._tick` only re-arms `requestAnimationFrame` **after** `update()`
returns:

```js
this._tick = (time) => {
  this._requestId = null;
  if (this.started) {
    this.update(time);                                  // throws here
    if (this.started && this._requestId === null && …)  // never reached
      this._requestId = requestAnimationFrame(this._tick);
  }
};
```

So the first throw *stops the frame loop* (measured: `ticker.lastTime` frozen, `ticker.started` still
`true`). The canvas keeps whatever was on it when the exception landed — a partially drawn frame,
mean 14.16/255, 0 % above the black floor. Anything that re-arms the ticker afterwards (a resize, a
new ticker listener, an explicit `ticker.start()`, a manual `engine.render()`) resumes the loop just
long enough to throw again, which is the "every subsequent frame" shape in the original report.

Two amplifiers make this worse than it needed to be:

1. **The failure is silent at the seam that was built to catch it.** `watchStore()` calls
   `void this.loadPalette()`. `loadPalette` is `async`, so its synchronous throw becomes a rejected
   promise, not an exception. `GameRenderer`'s deliberate `try/catch` around `loadFromFile` — the one
   commented "the map is a trust boundary — degrade to a message instead" — never sees it
   (`threw: false` in §2.2). The runner shows no error state, no toast, no overlay: it shows a black
   table and a store full of scene.
2. **The one visible log is the least useful one.** `restoreFromDataUrl`'s `catch` prints
   `[terrain] splatmap restore failed`, pointing the reader at the splat bitmaps — which §2.3 proves
   are not involved at all.

### 5.2 Does pixi offer a hook we are not using?

No. There is no error boundary, no per-pipe validation callback and no `onError` anywhere in
`pixi.js/lib/rendering` (the only `onError` in the tree is `VideoSource`'s media-element handler).
`BindGroup.onResourceChange`'s self-destruct is the closest thing to a validity check pixi has, and
it is the hazard rather than the guard. Containment has to be ours.

### 5.3 Are the sibling subsystems one bad resource away?

Mostly no, and for a reason worth writing down. A repo-wide grep for custom shader resource use:

```
Shader.from | new Shader( | new Filter( | .resources[ | .resources.
```

returns hits in exactly **one** file: `TerrainRenderer.ts`. Everything else draws through pixi's own
batched pipes:

* **Lighting FBO** — `lightFBO` / `perLightRT` are `RenderTexture`s consumed by a `Sprite`
  (`compositingSprite`). Sprite textures are bound per-draw by the batcher, not held in a
  `BindGroup`, so `lightFBO.destroy(true)` on resize (line 255) cannot null anything. Safe today.
* **Fog scrim / player fog** — `Graphics` + masks, no custom shader.
* **Token layer** — sprites.
* **Water** — the one thing with a `BindGroup`: `DisplacementFilter` in `waterAnimation.ts`. Its map
  texture is created once at init and only released via `destroyWaterAnimation()`. Not currently
  reachable while bound — but note the runner never calls `destroyWaterAnimation()` (§4.3), so the
  filter and its ticker outlive the engine there.

So the *specific* bug has one instance. The *containment* gap is general: any throw from any layer,
for any reason, takes the whole frame loop down with it and reports nothing to the UI. That is the
part worth treating as architecture rather than as a bug.

### 5.4 Smallest seam that would degrade instead of die

The frame throw happens inside `Application.render`, which pixi owns as a ticker listener. Neither
`setupRenderLoop`'s callback nor `GameRenderer`'s `try/catch` can wrap it. The smallest honest seam is
therefore: **take the render call away from pixi's ticker and own it.**

```
app.ticker.remove(app.render, app)     // once, in PixiRenderEngine.init
// inside setupRenderLoop's existing ticker callback, after the existing steps:
try { engine.render() }
catch (err) { <log once>; <hide optional layers>; <retry once>; <else stop and surface> }
```

"Optional layers" = terrain, water, fog scrim — the ones whose absence is a degraded map rather than
no map. `container.visible = false` is enough: pixi skips the subtree, so a dead shader is never
bound again. That turns a subsystem failure into a missing layer plus one console line, which is what
a table full of players needs.

---

## 6. Fix options, ranked

### 1. Reorder rebind-before-destroy in `loadPalette` — *minimal unblock, do this now*

**Scope:** core patch, `TerrainRenderer.ts`, two sites (~4 lines moved).
**Risk:** very low. `BindGroup.setResource` removes the old resource's `change` listener before
storing the new one, so the old RT can be destroyed immediately afterwards with no listener left to
fire. Verified against the real pixi classes in §2.4 (`bindGroupNulled: false`, new source bound).
**Effort:** minutes.

```ts
// cleared slot
if (this.shader) this.shader.resources[`uTex${slot}`] = Texture.WHITE.source;
this.tileRTs[slot]?.destroy(true);
this.tileRTs[slot] = null;

// replaced slot
const prev = this.tileRTs[slot];
this.tileRTs[slot] = rt;
if (this.shader) { this.shader.resources[`uTex${slot}`] = rt.source; /* + uTile uniforms */ }
prev?.destroy(true);
```

Apply the same ordering to `destroy()` (shader first, then `splatRTs`/`tileRTs`) for consistency —
that path happens to be harmless today only because `for…in` over `null` is a no-op.

**Regression check:** none of this is reachable from `terrain.test.ts`'s fake renderer. The honest
check is the browser: load a map with a non-default terrain palette and assert the canvas is not
black. The `RENDER_BLOCKED` rows in `sprint3-fog.spec.ts` already measure exactly that — un-`fixme`
them and they become the regression test for free.

### 2. Contain terrain's own failures inside `TerrainRenderer` — *do this with #1*

**Scope:** core patch, same file, ~6 lines.
**Risk:** low.
**Effort:** under an hour.

Replace `void this.loadPalette()` with a `.catch()` that logs once and hides
`this.container`, and wrap the splat subscriber the same way. A terrain subsystem that fails at setup
then costs a missing ground layer instead of a black table, and the failure is *visible* instead of
arriving as an unhandled rejection past `GameRenderer`'s trust boundary.

### 3. Runner teardown parity — *cheap, same PR*

**Scope:** `GameRenderer.tsx`, 3 lines: `sceneGraph.terrainRenderer.destroy()`,
`setTerrainRenderer(null)`, `destroyWaterAnimation()` in `teardown`.
**Risk:** very low (copies the editor's existing teardown).
**Effort:** minutes.
Latent today, guaranteed to bite the first time the table is a route the player leaves and re-enters.

### 4. Render-loop blast door — *architectural, next-sprint scope*

**Scope:** architectural seam — `PixiRenderEngine.init` (stop pixi driving `render`), `renderLoop.ts`
(own the render call, try/catch, degrade), both hosts inherit it.
**Risk:** medium. It changes who owns the frame; FPS metrics (`measureFps`, `metrics.spec.ts`) should
be re-measured, and the "hide optional layers and retry" policy needs one decision about which layers
are optional.
**Effort:** roughly half a day plus an e2e row that injects a broken layer and asserts the rest of the
map still draws.
**Justification:** §5.3 says the current bug class has one instance, so this is not urgent. But §5.1
says *any* future layer failure produces the same total blackout with no UI signal, on a product where
the failure mode is "the table goes dark mid-session". That is worth a blast door, just not today's.

### 5. Change the fixture — *rejected*

Explicitly not an option. §2.3 proves the fixture is innocent: an all-`null` palette and a
splat-free variant fail identically, and the editor fails with no fixture at all. Editing
`emberhold-crypt.mapbuilder` would hide a bug that any DM can hit with two clicks.

---

## 7. Recommendation

Ship **#1 + #2 + #3 as one small PR** against `sprint-3-the-dark-is-real`, and un-`fixme` the
`RENDER_BLOCKED` rows in the same PR so the gate's own pixel assertions become the regression test.
That is under 15 lines of core change, all of it inside one file plus three lines in the runner, and
it clears the sprint gate.

Track **#4** as next-sprint work. It is real, it is architectural, and it is not what is blocking the
gate — the blackout is a symptom of #1, not of the missing blast door.

One thing this analysis could not verify, because it changed no source: that terrain *draws correctly*
on Emberhold once the shader survives. When #1 lands, expect the canvas mean to move well off 14.16
with a non-zero lit fraction, and check the splat blend visually against
`docs/art-style-guide.md` before calling the row green.

---

## Appendix — line-number mapping

The stack frames in the spec header are Vite's post-transform offsets, not source lines. The real
positions in `packages/core/src/engine/terrain/TerrainRenderer.ts`:

| reported | actual | code |
| --- | --- | --- |
| `loadPalette:236` | **279** | `this.shader.resources[\`uTex${slot}\`] = rt.source` |
| `splats:143` | **171** | `this.shader.resources.uSplat0 = this.splatRTs[0].source` |
| `restoreFromDataUrl:516` | **600 / 604** | `renderToTexture(holder, this.splats()[rtIndex], true)` / its `catch` |

The destroy calls that cause all three: **line 243** (cleared slot) and **line 275** (replaced slot).

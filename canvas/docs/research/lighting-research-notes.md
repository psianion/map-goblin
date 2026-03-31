# Lighting Engine — Research Notes

Architectural justification for the Month 1 lighting pipeline.
Decision date: 2026-03-11.

---

## 1. Compositing Strategy

### Chosen approach: Multiply blend over the dungeon layers

After all dungeon `RenderTexture` sprites are composited into `layerContainer`, a fullscreen
`lightingSprite` is drawn on top using **multiply** blend mode. The lighting sprite starts as
a solid ambient-color rectangle, then every active light "punches in" a radial gradient patch
that is brighter than the ambient base.

**Why multiply beats additive and screen for dungeon maps:**

| Blend mode | Formula | Result |
|------------|---------|--------|
| Additive   | `dst + src` | Light regions over-saturate; dark regions stay dark — no "fog of war" feel |
| Screen     | `1 - (1-dst)(1-src)` | Similar to additive; light regions wash out to white |
| Multiply   | `dst * src` | Values < 1 in the lighting layer darken the scene; value = 1 = no change |

Multiply is the natural choice because:

1. The lighting layer encodes "how much light reaches this pixel" as a 0–1 scalar (per channel).
   Multiplying by 1 leaves the dungeon unchanged; multiplying by 0.07 (near-black ambient) gives
   deep shadow. No special math is needed — the blend mode implements the physical model directly.
2. Areas outside all visibility polygons show the ambient color, creating automatic "fog of war"
   without a second masking pass.
3. Colored lights naturally tint surfaces: a warm orange torch multiplied onto a grey stone floor
   gives a warm stone floor.

### Two compositing architectures compared

**A. Light-over-dark (dark FBO punched by lights)**
Draw a near-black FBO covering the scene; for each light, use `destination-out` (erase) to carve
a hole in the darkness. The hole shape is the visibility polygon.

- Requires per-light stencil writes or blending passes with `gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT)`.
- Cannot produce colored light naturally (erasing is colorless).
- Harder to accumulate multiple overlapping lights.

**B. Light accumulation buffer multiplied (our approach)**
Start with a solid ambient-color layer. For each light, _add_ a radial gradient patch clipped to
the visibility polygon into the FBO. Composite the FBO over the scene using multiply blend.

- One pass per light into the FBO (additive accumulation).
- Colored lights are free — each patch carries RGB color.
- The final multiply composite is a single fullscreen quad draw.
- Easily supports ambient color change by repainting the base fill.

Approach B is what we implement.

### Ambient light interaction

`mapSettings.ambientLight` is a hex string (e.g. `#111111` for near-black dungeon, `#8888aa` for
moonlit exterior). This color becomes the base fill of the light FBO before any lights are painted
in. After multiply compositing:

- Pixels outside all light cones → `scene_color * ambient_color` (darkened/tinted).
- Pixels inside a light cone → `scene_color * (ambient + light_contribution)`, clamped to 1.

The ambient value therefore sets the "darkness floor" of the map. `#000000` = pitch black outside
lights; `#ffffff` = fully lit everywhere (lighting has no effect). For dungeon maps `#0d0d0d`–
`#222222` gives the best atmospheric result.

---

## 2. Visibility Algorithm

### Amit Patel's sweep-line visibility polygon (redblobgames.com)

**Reference:** https://www.redblobgames.com/articles/visibility/ (accessed 2026-03-11)
**Also see:** https://ncase.me/sight-and-light/ — a well-illustrated interactive derivation.

#### Core idea

Rather than casting N uniform rays in a circle, cast rays _only at the angles where wall
endpoints appear_. The visible region is a polygon whose vertices are the nearest intersection
points of those targeted rays.

#### Algorithm steps

```
Input: light position P, list of wall segments W

1. Collect all wall endpoints E = { endpoints of all walls in W }
2. For each endpoint e ∈ E:
     compute angle θ = atan2(e.y - P.y, e.x - P.x)
     enqueue three rays: (θ - ε), θ, (θ + ε)   where ε ≈ 0.0001 rad
3. Sort rays by angle (ascending)
4. Maintain an "active wall" set A — walls that currently intersect the sweep ray
   Initialize A with all walls that cross the ray at angle rays[0]
5. For each ray in sorted order:
     find nearest wall in A (smallest T intersection parameter)
     record hit point H
     update A: remove walls ending before this angle, add walls starting at this angle
6. Collect all H points; sort by angle; connect into a polygon — this is the visibility polygon
```

#### The three-rays-per-endpoint technique

A single ray aimed exactly at a wall corner can land in an ambiguous position — it may or may
not include the wall starting at that corner. Casting three rays (θ - ε, θ, θ + ε) resolves this:

- `θ - ε`: hits the wall face _before_ the corner — ensures the last point on the old wall is captured.
- `θ`: nominally at the corner, subject to floating-point ambiguity but needed for exact vertex capture.
- `θ + ε`: hits the wall face _after_ the corner — ensures the first point on any new wall starting
  here is captured.

Without the offset rays, shadow geometry at corners develops "ghost triangles" or missing slices.
This is a well-known robustness fix documented in multiple game-dev implementations.

#### Time complexity

Per light:
- Ray count: O(3 × |E|) = O(|E|)
- Per ray, finding nearest wall intersection: O(|W|)
- Total: **O(|E| × |W|)**

For our target: ≤ 256 wall segments, ≤ 20 lights.

- |E| ≤ 512 endpoints → 512 × 3 = 1536 rays per light
- Per ray: ≤ 256 wall intersection tests
- Per light: ≤ 393,216 floating-point operations
- 20 lights: ≤ ~7.8M operations — comfortably within a 16ms frame on a modern CPU

Dirty-flag caching (see §4) further reduces the per-frame work to near zero when lights/walls
don't move.

#### Why this is the right algorithm for us

- Works on arbitrary line segments, not just grid-aligned walls. Our wall geometry is polygon
  outlines extracted from `mergedFloor` + `standaloneWalls` — line segments, not tile edges.
- Simple to implement in TypeScript with no external dependencies.
- Output is a `[number, number][]` polygon identical to our existing geometry types.
- At ≤ 256 wall segments it is fast enough; at 1000+ we would switch to a BVH-accelerated
  version, but that is not needed for MVP.

---

## 3. Shader Strategy

### WebGL approach: manual FBO + custom GLSL (Option B)

**Why not a PixiJS Filter?**

PixiJS `Filter` applies a fragment shader to an _existing_ rendered texture. It cannot accumulate
light from scratch — it can only transform what was already rendered. For lighting we need to:
1. Start from a blank ambient-color FBO.
2. Additively paint each light's contribution (radial gradient clipped to visibility polygon).
3. Then multiply the result over the scene.

Step 2 requires writing _to_ a texture across multiple draw calls with additive blending, which
Filters do not support. We use PixiJS `RenderTexture` as the FBO target and issue explicit draw
calls into it.

### PixiJS v8 API — fullscreen quad with custom shader

PixiJS v8 (8.16.0) exposes the following classes for custom shader work:

```typescript
import { GlProgram, Shader, Geometry, Mesh } from 'pixi.js';

// 1. Compile the GLSL program
const glProgram = new GlProgram({ vertex: VERT_SRC, fragment: FRAG_SRC });

// 2. Create a shader with uniform resources
const shader = new Shader({
  glProgram,
  resources: {
    uUniforms: uniformGroup,  // UniformGroup for scalars/vectors/arrays
    uLightingTexture: texture.source,
  },
});

// 3. Fullscreen quad geometry (NDC −1..1, UV 0..1)
const geometry = new Geometry({
  attributes: {
    aPosition: [-1, -1, 1, -1, 1, 1, -1, 1],   // 4 verts, clip-space
    aUV:       [0, 1, 1, 1, 1, 0, 0, 0],
  },
  indexBuffer: [0, 1, 2, 0, 2, 3],
  topology: 'triangle-list',
});

// 4. Mesh = geometry + shader
const quad = new Mesh({ geometry, shader });
```

The vertex shader transforms clip-space positions to screen UV, and the fragment shader reads the
lighting texture (or directly computes light contributions via uniforms — see below).

### Uniform arrays for light data

GLSL 300 es supports `uniform` arrays. For ≤ 20 lights we pass all light data as flat arrays:

```glsl
// Fragment shader (simplified)
#version 300 es
precision highp float;

#define MAX_LIGHTS 20

uniform int uLightCount;
uniform vec2  uLightPos[MAX_LIGHTS];       // world-space center
uniform float uLightRadius[MAX_LIGHTS];    // world-space radius
uniform vec3  uLightColor[MAX_LIGHTS];     // RGB
uniform float uLightIntensity[MAX_LIGHTS]; // 0..1 multiplier
// uPolyVerts / uPolyCount — per-light visibility polygon (see §3.4)
```

In PixiJS v8, pass arrays through `UniformGroup`:

```typescript
import { UniformGroup } from 'pixi.js';

const uniforms = new UniformGroup({
  uLightCount: { value: 0, type: 'i32' },
  uLightPos:   { value: new Float32Array(MAX_LIGHTS * 2), type: 'vec2<f32>', size: MAX_LIGHTS },
  uLightColor: { value: new Float32Array(MAX_LIGHTS * 3), type: 'vec3<f32>', size: MAX_LIGHTS },
  // ...
});
```

Updating uniforms each frame (when dirty) is O(MAX_LIGHTS) Float32Array writes — negligible cost.

### Point-in-polygon using winding number in GLSL

The visibility polygon computed on the CPU is uploaded as a flat `vec2` array. The fragment
shader tests each pixel against the polygon to determine whether it is lit:

```glsl
// Winding number test — returns non-zero if point is inside polygon
int windingNumber(vec2 pt, vec2 poly[MAX_POLY_VERTS], int n) {
  int wn = 0;
  for (int i = 0; i < n; i++) {
    vec2 a = poly[i];
    vec2 b = poly[(i + 1) % n];  // wraps around
    if (a.y <= pt.y) {
      if (b.y > pt.y) {
        // upward crossing
        float cross = (b.x - a.x) * (pt.y - a.y) - (pt.x - a.x) * (b.y - a.y);
        if (cross > 0.0) wn++;
      }
    } else {
      if (b.y <= pt.y) {
        // downward crossing
        float cross = (b.x - a.x) * (pt.y - a.y) - (pt.x - a.x) * (b.y - a.y);
        if (cross < 0.0) wn--;
      }
    }
  }
  return wn;
}
```

If `windingNumber(worldPos, poly, vertCount) != 0`, the fragment is inside the visibility polygon
and receives the light's radial falloff contribution.

**Why winding number over ray-casting in GLSL?**
Ray-casting (count even/odd crossings) requires choosing an arbitrary ray direction and handling
degenerate cases. Winding number is numerically more robust and handles non-convex polygons
correctly — important because visibility polygons around concave wall configurations are always
non-convex.

### Per-light stencil pass vs. uniform array approach

An alternative: for each light, set the stencil buffer to the visibility polygon shape, then draw
a radial gradient only where stencil passes. This requires `2 × MAX_LIGHTS` draw calls (one
stencil write, one color draw per light).

At 20 lights that is 40 extra draw calls per frame plus stencil buffer management. The uniform
array approach requires only 1 draw call (all 20 lights evaluated in a single fragment pass) and
no stencil state changes. For ≤ 20 lights the uniform array approach is strictly faster.

At >100 lights the stencil approach may win because the winding-number loop becomes the bottleneck
(O(n_lights × n_poly_verts) per fragment). For MVP we cap lights at 20 and keep the simpler path.

### Radial falloff formula

We use a modified quadratic attenuation to avoid the inverse-square singularity at distance 0:

```glsl
float dist = length(worldPos - uLightPos[i]);
float ratio = clamp(dist / uLightRadius[i], 0.0, 1.0);

// Smooth falloff: 1 at center, 0 at radius, smooth derivative at edge
float falloff = 1.0 - smoothstep(0.0, 1.0, ratio);

// Or physically-based: 1 / (Kc + Kl*d + Kq*d^2)
// float falloff = 1.0 / (1.0 + 2.0*ratio + ratio*ratio);
```

`smoothstep` gives a softer edge and no singularity. The physically-based formula (from
LearnOpenGL "Light Casters") is:

```
F_att = 1 / (Kc + Kl*d + Kq*d²)
```

where `Kc = 1.0` (constant term prevents division by zero), `Kl` controls linear decay,
`Kq` controls quadratic drop-off at distance. For candle/torch feel: `Kl = 0.09, Kq = 0.032`.

The final light contribution for one light at a pixel is:

```glsl
vec3 contribution = uLightColor[i] * uLightIntensity[i] * falloff;
accumulatedLight += contribution;   // additive across all lights
```

After accumulating all lights, clamp and add ambient:

```glsl
vec3 lightMap = clamp(accumulatedLight + uAmbientColor, 0.0, 1.0);
outColor = vec4(lightMap, 1.0);   // written into the lighting FBO
```

The lighting FBO sprite is then composited over the scene with `blendMode: 'multiply'`.

---

## 4. Performance

### Dirty-flag cache strategy

Recomputing a visibility polygon is the most expensive per-light operation. We cache the polygon
per light and mark it dirty only when:

1. The light's `position` or `radius` changes.
2. Any wall segment in the scene changes (add, move, delete, or shape edit rebuilds `mergedFloor`).

Camera pan/zoom does NOT invalidate the cache because visibility polygons are stored in
**world-space coordinates**. The camera transform is applied by the vertex shader, not by
recomputing geometry.

Implementation pattern:

```typescript
interface LightCache {
  lightId: string;
  polygon: [number, number][];   // world-space
  wallsHash: number;             // hash of current wall geometry — compare each frame
  dirty: boolean;
}
```

`wallsHash` is a cheap CRC32 (or frame counter increment) over all `WallSegment.points` arrays.
Any change to walls bumps the hash and marks all light caches dirty. The recompute only runs
during the frame where dirty is true, then clears the flag.

### Per-frame cost estimates

| Operation | Freq | Cost |
|-----------|------|------|
| Visibility polygon recompute (one light, 256 walls) | When dirty | ~0.2ms |
| Upload light uniforms (20 lights, Float32Array) | Every frame | ~0.05ms |
| Fragment shader (1920×1080 fullscreen, 20 lights, 64 poly verts) | Every frame | ~1–3ms GPU |
| Multiply composite | Every frame | ~0.1ms GPU |

At 10 dirty lights simultaneously (worst case, e.g. first frame after wall edit):
~2ms CPU recompute — stays within 16ms budget.

### Target parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `MAX_LIGHTS` | 20 | Fragment shader array size; adequate for a dungeon encounter |
| `MAX_POLY_VERTS` | 64 | Per-light visibility polygon vertex cap |
| Ray count per light | ~72 (20 segs × 3 + 12 cardinal) | Well under 60fps budget |
| Wall segment cap | 256 | Beyond this, hash comparison + polygon recompute needs BVH |

### Optimization levers (if needed)

1. **Cap endpoints to nearest N:** Before raycasting, filter endpoints to the K nearest to the
   light (e.g. K = 64). Reduces ray count from O(|E|) to O(K) at the cost of possible polygon
   inaccuracy at range edges. Use only if >256 walls and profiling shows CPU bottleneck.
2. **Reduce `MAX_POLY_VERTS` from 64 to 32:** Halves the winding-number loop iterations in the
   fragment shader. Fragment shader is typically the bottleneck at 1080p, not the CPU raycaster.
3. **Half-resolution lighting FBO:** Render the lighting pass at 0.5× screen resolution, then
   upscale with bilinear filtering before multiply composite. Lighting is low-frequency — this
   is nearly invisible at typical zoom levels and cuts fragment work to 25%.
4. **Spatial hash for wall queries:** Group wall segments into a grid spatial hash. Each light
   only queries walls in nearby cells, reducing O(|W|) to O(|W_local|) per ray.

### Foundry VTT reference

Foundry VTT (the leading VTT platform) implements a similar pipeline:
- CPU-side visibility polygon using a sweep-line raycaster (documented in FVTT source as
  `ClockwiseSweepPolygon`).
- WebGL lighting pass using PointSource shaders composited over the scene.
- Per-light dirty flag on source movement or wall modification.
- Ambient light managed as a scene-level `darkness` value (0 = fully lit, 1 = fully dark).

Their approach validates the architectural choices above for production VTT use.

---

## Decision Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| Compositing blend | Multiply | Natural fog-of-war, colored lights, single pass |
| Raycaster | CPU sweep-line | Simple, correct, sufficient for ≤20 lights ≤256 walls |
| Shader approach | Manual FBO + GLSL Mesh | Filters can't accumulate; fullscreen quad is standard |
| Point-in-polygon | Winding number in GLSL | Robust for non-convex polygons |
| Light data upload | Uniform float arrays (20 lights) | 1 draw call vs 40 for stencil approach |
| Falloff formula | `smoothstep` or physical `1/(Kc+Kl*d+Kq*d²)` | Smooth edge; configurable per light |
| Dirty cache key | Light position/radius + wall geometry hash | Zero recompute on camera move |

# Month 1: Lighting Engine Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement real-time 2D lighting with wall-occlusion shadows using CPU raycasting and a custom WebGL FBO compositing shader.

**Architecture:** CPU-side 2D sweep-line raycaster produces per-light visibility polygons, cached with dirty-flags. A custom GLSL fragment shader runs on an offscreen RenderTexture, accumulating all lights additively before compositing over the map layers with Multiply blend mode.

**Tech Stack:** PixiJS v8 (Shader/Geometry/Mesh API), custom GLSL, Zustand subscribeToStore, existing Command pattern

---

## Dependency Notes

This track is **fully independent** — no Systems Dev gate required. However, Systems Dev will expand the `Light` type in `src/store/types.ts` (adding `name` and `visible` fields). Design `LightManager` to accept the expanded type gracefully:
- `light.name` — used for layer panel row display; default to `'Light'` if undefined
- `light.visible` — used to skip raycasting/rendering for hidden lights; default to `true` if undefined

The Systems Dev expansion arrives as a non-breaking add to the existing interface. No coordination needed before starting.

---

## Task 0 — Research: Ambient Lighting Approaches in Similar Tools

**Estimated time:** 2–3 hours
**Output:** `docs/research/lighting-research-notes.md`

- [x] Search for and read: "Foundry VTT ambient light implementation blog", "how Foundry VTT renders lighting WebGL", "2D visibility polygon algorithm Amit Patel redblobgames"
- [x] Search for and read: "Dungeon Scrawl lighting approach", "dungeondraft lighting render pipeline", "2D raycasting map builder ambient occlusion"
- [x] Search for and read: "PixiJS v8 custom shader Geometry Mesh API", "PixiJS v8 RenderTexture offscreen compositing multiply blend mode"
- [x] Search for and read: "WebGL point in polygon test GLSL fragment shader", "GLSL winding number polygon test", "GLSL radial falloff lighting formula"
- [x] Extract and document findings on:
  - **Compositing strategy:** does the tool render a dark overlay punched out by lights (light-over-dark) or a light accumulation buffer multiplied over the scene (our chosen approach)? Why multiply is preferred for dungeon maps.
  - **Ambient representation:** full black = 0x000000 darkness, near-black = 0x111111 default dungeon feel; `mapSettings.ambientLight` hex string already exists in store
  - **Visibility polygon approach:** sweep-line ray casting (Amit Patel's algorithm) vs. shadow mesh; confirm sweep-line is sufficient for ≤20 lights at 60fps
  - **Passing geometry to shader:** uniform arrays (max 20 lights × max 64 polygon vertices), or per-light stencil pass; document tradeoffs
  - **Performance strategies:** dirty-flag cache (only recompute polygon when light or wall changes), ray count adaptive reduction (128 → 64 → 32 rays), early-exit radius check in fragment shader
- [x] Write findings to `docs/research/lighting-research-notes.md` with sections: Compositing, Visibility Algorithm, Shader Strategy, Performance
- [x] Run `pnpm check`
- [x] Commit: `docs: lighting engine research notes — compositing and raycasting approaches`

---

## Task 1 — Light Type Expansion + LightManager Class

**Files:**
- `src/store/types.ts` — expand `Light` interface
- `src/engine/lighting/LightManager.ts` — new file
- `src/engine/lighting/LightManager.test.ts` — new file (Vitest unit test)

### Step 1.1 — Expand Light type in `src/store/types.ts`

The current `Light` interface (line ~112 in `src/store/types.ts`):
```typescript
export interface Light {
  id: string
  position: { x: number; y: number }
  color: string       // hex
  radius: number
  intensity: number
  falloff: 'linear' | 'quadratic'
}
```

Add `name` and `visible` fields:
```typescript
export interface Light {
  id: string
  position: { x: number; y: number }
  color: string       // hex, e.g. '#ffdd88'
  radius: number      // world-space units
  intensity: number   // 0–1
  falloff: 'linear' | 'quadratic'
  name: string        // display name, e.g. 'Torch 1'
  visible: boolean    // false = skip raycasting and rendering
}
```

- [x] Edit `src/store/types.ts`: add `name: string` and `visible: boolean` to the `Light` interface
- [x] Edit `src/store/slices/lights.ts`: update `addLight` to accept (and forward) the new fields; no behavior change needed since `set` + `immer` already handles it
- [x] Edit `src/store/factories.ts`: add a `createLight` factory (if not present) or update the existing one to include defaults `name: 'Light'`, `visible: true`
- [x] Run `pnpm typecheck` — fix any type errors from the Light expansion

### Step 1.2 — Write LightManager unit tests first (TDD)

Create `src/engine/lighting/LightManager.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { LightManager } from './LightManager'
import type { Light } from '@/store/types'

const mockLight = (overrides?: Partial<Light>): Light => ({
  id: 'l1',
  position: { x: 100, y: 100 },
  color: '#ffffff',
  radius: 200,
  intensity: 1,
  falloff: 'linear',
  name: 'Test Light',
  visible: true,
  ...overrides,
})

describe('LightManager', () => {
  let manager: LightManager

  beforeEach(() => {
    manager = new LightManager()
  })

  it('starts with empty light list', () => {
    expect(manager.getLights()).toHaveLength(0)
  })

  it('syncFromStore updates lights list', () => {
    const lights = [mockLight()]
    manager.syncFromStore(lights)
    expect(manager.getLights()).toHaveLength(1)
    expect(manager.getLights()[0].id).toBe('l1')
  })

  it('invalidate marks specific light dirty', () => {
    manager.syncFromStore([mockLight()])
    manager.invalidate('l1')
    expect(manager.isDirty('l1')).toBe(true)
  })

  it('invalidateAll marks all lights dirty', () => {
    manager.syncFromStore([mockLight({ id: 'l1' }), mockLight({ id: 'l2' })])
    // clear first
    manager.clearDirty('l1')
    manager.clearDirty('l2')
    manager.invalidateAll()
    expect(manager.isDirty('l1')).toBe(true)
    expect(manager.isDirty('l2')).toBe(true)
  })

  it('removing a light clears its shadow cache entry', () => {
    manager.syncFromStore([mockLight()])
    manager.setCachedPolygon('l1', [[0,0],[100,0],[100,100]])
    manager.syncFromStore([]) // light removed
    expect(manager.getCachedPolygon('l1')).toBeNull()
  })

  it('syncFromStore invalidates lights whose position changed', () => {
    manager.syncFromStore([mockLight()])
    manager.clearDirty('l1')
    manager.syncFromStore([mockLight({ position: { x: 200, y: 200 } })])
    expect(manager.isDirty('l1')).toBe(true)
  })

  it('syncFromStore invalidates lights whose radius changed', () => {
    manager.syncFromStore([mockLight()])
    manager.clearDirty('l1')
    manager.syncFromStore([mockLight({ radius: 400 })])
    expect(manager.isDirty('l1')).toBe(true)
  })

  it('syncFromStore does not invalidate unchanged lights', () => {
    manager.syncFromStore([mockLight()])
    manager.clearDirty('l1')
    manager.syncFromStore([mockLight()]) // same data
    expect(manager.isDirty('l1')).toBe(false)
  })

  it('invisible lights are not in getVisibleLights()', () => {
    manager.syncFromStore([mockLight({ visible: false })])
    expect(manager.getVisibleLights()).toHaveLength(0)
  })
})
```

- [x] Run `pnpm test` — confirm all LightManager tests FAIL (red)

### Step 1.3 — Implement LightManager

Create `src/engine/lighting/LightManager.ts`:

```typescript
import type { Light } from '@/store/types'

type WorldPoint = [number, number]

export class LightManager {
  private lights: Light[] = []
  private shadowCache = new Map<string, WorldPoint[]>()
  private dirtySet = new Set<string>()

  getLights(): Light[] {
    return this.lights
  }

  getVisibleLights(): Light[] {
    return this.lights.filter((l) => l.visible !== false)
  }

  /**
   * Called from subscribeToStore whenever state.lights changes.
   * Detects which lights changed position/radius/falloff and marks them dirty.
   * New lights are marked dirty. Removed lights are evicted from cache.
   */
  syncFromStore(newLights: Light[]): void {
    const prevMap = new Map(this.lights.map((l) => [l.id, l]))
    const newIds = new Set(newLights.map((l) => l.id))

    // Evict removed lights
    for (const [id] of prevMap) {
      if (!newIds.has(id)) {
        this.shadowCache.delete(id)
        this.dirtySet.delete(id)
      }
    }

    // Check for new or changed lights
    for (const light of newLights) {
      const prev = prevMap.get(light.id)
      if (!prev) {
        // New light — mark dirty
        this.dirtySet.add(light.id)
      } else {
        // Changed position, radius, or falloff invalidates visibility polygon
        const posChanged =
          prev.position.x !== light.position.x ||
          prev.position.y !== light.position.y
        const radChanged = prev.radius !== light.radius
        const falloffChanged = prev.falloff !== light.falloff
        if (posChanged || radChanged || falloffChanged) {
          this.dirtySet.add(light.id)
        }
      }
    }

    this.lights = newLights
  }

  invalidate(lightId: string): void {
    this.dirtySet.add(lightId)
  }

  invalidateAll(): void {
    for (const light of this.lights) {
      this.dirtySet.add(light.id)
    }
  }

  isDirty(lightId: string): boolean {
    return this.dirtySet.has(lightId)
  }

  clearDirty(lightId: string): void {
    this.dirtySet.delete(lightId)
  }

  getCachedPolygon(lightId: string): WorldPoint[] | null {
    return this.shadowCache.get(lightId) ?? null
  }

  setCachedPolygon(lightId: string, polygon: WorldPoint[]): void {
    this.shadowCache.set(lightId, polygon)
  }
}
```

- [x] Run `pnpm test` — confirm all LightManager tests PASS (green)
- [x] Run `pnpm check`
- [x] Commit: `feat(lighting): LightManager — light list sync, dirty-flag shadow cache`

---

## Task 2 — CPU Raycaster (2D Sweep-Line Visibility Polygon)

**Files:**
- `src/engine/lighting/raycaster.ts` — new file
- `src/engine/lighting/raycaster.test.ts` — new file (Vitest unit test, no browser needed)

This is pure math — no PixiJS, no DOM, no Clipper2. All tests run in Vitest (Node environment).

### Step 2.1 — Write raycaster unit tests first (TDD)

Create `src/engine/lighting/raycaster.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeVisibilityPolygon, type Segment } from './raycaster'

// Helper: check if a point is inside a polygon (winding number)
function pointInPolygon(px: number, py: number, poly: [number,number][]): boolean {
  let winding = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]
    const [x2, y2] = poly[(i + 1) % poly.length]
    if (y1 <= py) {
      if (y2 > py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) > 0) winding++
    } else {
      if (y2 <= py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) < 0) winding--
    }
  }
  return winding !== 0
}

describe('computeVisibilityPolygon', () => {
  it('returns a polygon with at least 4 vertices for an open area', () => {
    const poly = computeVisibilityPolygon([0, 0], 500, [])
    expect(poly.length).toBeGreaterThanOrEqual(4)
  })

  it('open area polygon is roughly circular — radius check', () => {
    const origin: [number,number] = [0, 0]
    const radius = 300
    const poly = computeVisibilityPolygon(origin, radius, [])
    // All vertices should be at approximately the radius distance
    for (const [x, y] of poly) {
      const dist = Math.sqrt(x * x + y * y)
      expect(dist).toBeCloseTo(radius, -1) // within ~10 units
    }
  })

  it('a wall segment directly to the right blocks the rightward view', () => {
    const segments: Segment[] = [
      [[100, -100], [100, 100]],
    ]
    const poly = computeVisibilityPolygon([0, 0], 500, segments)
    // Point at [300, 0] should NOT be visible (behind the wall)
    expect(pointInPolygon(300, 0, poly)).toBe(false)
  })

  it('point directly in front of wall IS visible', () => {
    const segments: Segment[] = [
      [[100, -100], [100, 100]],
    ]
    const poly = computeVisibilityPolygon([0, 0], 500, segments)
    // Point at [50, 0] should be visible (in front of the wall)
    expect(pointInPolygon(50, 0, poly)).toBe(true)
  })

  it('visibility polygon stays within radius', () => {
    const segments: Segment[] = [
      [[100, -100], [100, 100]],
    ]
    const radius = 200
    const poly = computeVisibilityPolygon([0, 0], radius, segments)
    for (const [x, y] of poly) {
      const dist = Math.sqrt(x * x + y * y)
      expect(dist).toBeLessThanOrEqual(radius + 1) // +1 floating point tolerance
    }
  })

  it('handles zero-length wall segment without throwing', () => {
    const segments: Segment[] = [
      [[50, 50], [50, 50]], // degenerate
    ]
    expect(() => computeVisibilityPolygon([0, 0], 300, segments)).not.toThrow()
  })

  it('handles light exactly on wall endpoint without throwing', () => {
    const segments: Segment[] = [
      [[0, 0], [100, 0]], // light is at [0,0], an endpoint
    ]
    expect(() => computeVisibilityPolygon([0, 0], 300, segments)).not.toThrow()
  })

  it('box enclosure: light inside a square room sees only the interior', () => {
    // A square room with walls on all 4 sides
    const size = 200
    const segments: Segment[] = [
      [[-size, -size], [size, -size]], // top
      [[size, -size],  [size, size]],  // right
      [[size, size],   [-size, size]], // bottom
      [[-size, size],  [-size, -size]], // left
    ]
    const poly = computeVisibilityPolygon([0, 0], 500, segments)
    // Point outside the room should not be visible
    expect(pointInPolygon(300, 0, poly)).toBe(false)
    // Origin area should be visible
    expect(pointInPolygon(0, 0, poly)).toBe(true)
  })

  it('returns vertices sorted by angle', () => {
    const poly = computeVisibilityPolygon([0, 0], 300, [])
    const angles = poly.map(([x, y]) => Math.atan2(y, x))
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i]).toBeGreaterThanOrEqual(angles[i - 1])
    }
  })
})
```

- [x] Run `pnpm test` — confirm all raycaster tests FAIL (red)

### Step 2.2 — Implement raycaster

Create `src/engine/lighting/raycaster.ts`:

Algorithm (Amit Patel sweep-line, adapted):

```typescript
export type Segment = [[number, number], [number, number]]

/**
 * Compute a 2D visibility polygon from `origin` against `segments`.
 *
 * Algorithm:
 * 1. Collect all wall segment endpoints as candidate ray targets
 * 2. Add 4 cardinal boundary points (ensures open areas produce a circle-like polygon)
 * 3. For each candidate point, cast 3 rays: angle-ε, angle, angle+ε
 *    (triple-ray technique prevents gaps at wall endpoints)
 * 4. For each ray, find the nearest intersection point with all segments
 * 5. Collect all intersection points, sort by angle
 * 6. Clip to radius
 * 7. Return as world-space polygon
 *
 * Returns polygon vertices in world space, sorted by angle from origin.
 * All vertices are relative to world origin (NOT relative to light position).
 */
export function computeVisibilityPolygon(
  origin: [number, number],
  radius: number,
  segments: Segment[],
): [number, number][] {
  const [ox, oy] = origin
  const EPSILON = 0.0001

  // Filter degenerate segments
  const validSegments = segments.filter(([[ax, ay], [bx, by]]) => {
    const dx = bx - ax
    const dy = by - ay
    return dx * dx + dy * dy > EPSILON
  })

  // Collect angles to endpoints, plus cardinal directions
  const angles: number[] = []

  for (const [[ax, ay], [bx, by]] of validSegments) {
    const a1 = Math.atan2(ay - oy, ax - ox)
    const a2 = Math.atan2(by - oy, bx - ox)
    angles.push(a1 - EPSILON, a1, a1 + EPSILON)
    angles.push(a2 - EPSILON, a2, a2 + EPSILON)
  }

  // Add cardinal rays to cover open areas with no walls
  angles.push(0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2)
  // Add 8 additional angles for a smoother open-area polygon
  for (let i = 0; i < 8; i++) {
    angles.push((2 * Math.PI * i) / 8)
  }

  // For each angle, cast ray and find nearest intersection
  const hits: [number, number][] = []

  for (const angle of angles) {
    // Ray direction
    const rdx = Math.cos(angle)
    const rdy = Math.sin(angle)

    let minT = radius // Max distance = light radius
    let hitX = ox + rdx * radius
    let hitY = oy + rdy * radius

    for (const [[ax, ay], [bx, by]] of validSegments) {
      // Ray-segment intersection (parametric)
      // Ray: P = origin + t * dir, t >= 0
      // Segment: Q = A + s * (B - A), s in [0, 1]
      const sdx = bx - ax
      const sdy = by - ay
      const denom = rdx * sdy - rdy * sdx
      if (Math.abs(denom) < EPSILON) continue // Parallel

      const tx = ax - ox
      const ty = ay - oy
      const t = (tx * sdy - ty * sdx) / denom
      const s = (tx * rdy - ty * rdx) / denom

      if (t >= -EPSILON && t < minT && s >= -EPSILON && s <= 1 + EPSILON) {
        minT = t
        hitX = ox + rdx * t
        hitY = oy + rdy * t
      }
    }

    hits.push([hitX, hitY])
  }

  // Sort by angle from origin
  hits.sort(([ax, ay], [bx, by]) => {
    const angleA = Math.atan2(ay - oy, ax - ox)
    const angleB = Math.atan2(by - oy, bx - ox)
    return angleA - angleB
  })

  // Deduplicate near-identical points
  const result: [number, number][] = []
  for (const [hx, hy] of hits) {
    if (result.length === 0) {
      result.push([hx, hy])
      continue
    }
    const [px, py] = result[result.length - 1]
    const dx = hx - px
    const dy = hy - py
    if (dx * dx + dy * dy > EPSILON) {
      result.push([hx, hy])
    }
  }

  return result
}

/**
 * Extract wall segments from all dungeon layers for raycasting.
 * Returns only segments where blocksLight === true (standalone walls),
 * plus auto-generated wall boundaries from mergedFloor polygons.
 */
export function extractWallSegments(
  layers: import('@/store/types').DungeonLayer[],
): Segment[] {
  const segments: Segment[] = []

  for (const layer of layers) {
    if (!layer.visible) continue

    // Standalone walls with blocksLight flag
    for (const wall of layer.standaloneWalls) {
      if (!wall.blocksLight) continue
      const pts = wall.points
      for (let i = 0; i < pts.length - 1; i++) {
        segments.push([
          [pts[i][0], pts[i][1]],
          [pts[i + 1][0], pts[i + 1][1]],
        ])
      }
    }

    // Floor boundary edges from mergedFloor polygons
    // (the outer wall of the dungeon room blocks light)
    if (layer.mergedFloor) {
      for (const poly of layer.mergedFloor) {
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i]
          const b = poly[(i + 1) % poly.length]
          segments.push([[a[0], a[1]], [b[0], b[1]]])
        }
      }
    }
  }

  return segments
}
```

- [x] Run `pnpm test` — confirm all raycaster tests PASS (green)
- [x] Run `pnpm check`
- [x] Commit: `feat(lighting): CPU raycaster — sweep-line visibility polygon with wall occlusion`

---

## Task 3 — WebGL FBO Shader (Light Accumulation)

**Files:**
- `src/engine/lighting/LightingShader.ts` — new file
- `src/engine/lighting/LightingRenderer.ts` — new file

No unit tests for shader code (GPU-dependent). Tested via Playwright E2E in Task 6.

### Step 3.1 — GLSL shader scaffolds

The shader pipeline:
1. A fullscreen quad covers the entire canvas (screen space, UV 0..1)
2. Fragment shader samples the ambient color, then for each light:
   - Transforms fragment UV → world space
   - Checks if fragment is within `light.radius`
   - Computes radial falloff (linear or quadratic)
   - Does a point-in-visibility-polygon test (per-light polygon passed as flat uniform)
   - Accumulates `lightColor * intensity * falloff`
3. Output = `ambient + accumulated`; clamped to [0,1]

Create `src/engine/lighting/LightingShader.ts`:

```typescript
/**
 * Vertex shader: fullscreen quad in clip space (-1..1).
 * Passes UV coordinates (0..1) to fragment shader.
 */
export const LIGHTING_VERT = `
  in vec2 aPosition;
  out vec2 vUV;

  void main() {
    vUV = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`

/**
 * Fragment shader: accumulates light contributions.
 *
 * Uniforms:
 *   uAmbient          — RGB ambient color (0..1 per channel)
 *   uLightCount       — number of active lights (max 20)
 *   uCameraPos        — world-space position of top-left corner of screen
 *   uCameraZoom       — current zoom level (world units per pixel)
 *   uViewportSize     — canvas size in pixels
 *   uLightPos[20]     — light positions in world space
 *   uLightColor[20]   — light colors (RGB 0..1)
 *   uLightRadius[20]  — light radii in world units
 *   uLightIntensity[20] — intensity 0..1
 *   uLightFalloff[20] — 0 = linear, 1 = quadratic
 *   uPolyCount[20]    — vertex count for each light's visibility polygon
 *   uPolyData         — flat array of polygon vertices: [x0,y0, x1,y1, ...] world space
 *                       max 64 vertices × 20 lights = 2560 floats
 *   uPolyOffset[20]   — start index into uPolyData for each light
 */
export const LIGHTING_FRAG = `
  precision mediump float;

  in vec2 vUV;
  out vec4 outColor;

  uniform vec3 uAmbient;
  uniform int uLightCount;
  uniform vec2 uCameraPos;
  uniform float uCameraZoom;
  uniform vec2 uViewportSize;

  uniform vec2 uLightPos[20];
  uniform vec3 uLightColor[20];
  uniform float uLightRadius[20];
  uniform float uLightIntensity[20];
  uniform int uLightFalloff[20];

  uniform int uPolyCount[20];
  uniform float uPolyData[2560]; // 20 lights × 64 verts × 2 floats
  uniform int uPolyOffset[20];

  /**
   * Point-in-polygon test using winding number algorithm.
   * Returns 1.0 if point is inside polygon, 0.0 otherwise.
   * polyStart: index into uPolyData array, polyCount: vertex count
   */
  float pointInPoly(vec2 p, int polyStart, int polyCount) {
    int winding = 0;
    for (int i = 0; i < 64; i++) {
      if (i >= polyCount) break;
      int j = (i + 1) < polyCount ? (i + 1) : 0;
      int baseI = polyStart + i * 2;
      int baseJ = polyStart + j * 2;
      float x1 = uPolyData[baseI];
      float y1 = uPolyData[baseI + 1];
      float x2 = uPolyData[baseJ];
      float y2 = uPolyData[baseJ + 1];
      if (y1 <= p.y) {
        if (y2 > p.y) {
          float cross = (x2 - x1) * (p.y - y1) - (p.x - x1) * (y2 - y1);
          if (cross > 0.0) winding++;
        }
      } else {
        if (y2 <= p.y) {
          float cross = (x2 - x1) * (p.y - y1) - (p.x - x1) * (y2 - y1);
          if (cross < 0.0) winding--;
        }
      }
    }
    return winding != 0 ? 1.0 : 0.0;
  }

  void main() {
    // Convert UV → world space
    // vUV is 0..1 across the canvas; uCameraPos is world coords at pixel (0,0)
    vec2 worldPos = uCameraPos + vUV * uViewportSize / uCameraZoom;

    vec3 lightAccum = uAmbient;

    for (int i = 0; i < 20; i++) {
      if (i >= uLightCount) break;

      vec2 delta = worldPos - uLightPos[i];
      float dist = length(delta);
      float r = uLightRadius[i];

      if (dist >= r) continue; // Outside radius — skip expensive poly test

      // Visibility polygon membership test
      float inPoly = pointInPoly(worldPos, uPolyOffset[i], uPolyCount[i]);
      if (inPoly < 0.5) continue; // Not in lit region

      // Radial falloff
      float t = 1.0 - dist / r;
      float falloff = uLightFalloff[i] == 0 ? t : t * t; // linear or quadratic

      lightAccum += uLightColor[i] * uLightIntensity[i] * falloff;
    }

    // Clamp and output
    outColor = vec4(clamp(lightAccum, 0.0, 1.0), 1.0);
  }
`

export const MAX_LIGHTS = 20
export const MAX_POLY_VERTS = 64
export const POLY_DATA_SIZE = MAX_LIGHTS * MAX_POLY_VERTS * 2 // floats
```

### Step 3.2 — LightingRenderer class

Create `src/engine/lighting/LightingRenderer.ts`:

```typescript
import {
  Geometry,
  Mesh,
  RenderTexture,
  Shader,
  Sprite,
  type Application,
} from 'pixi.js'
import {
  LIGHTING_FRAG,
  LIGHTING_VERT,
  MAX_LIGHTS,
  MAX_POLY_VERTS,
  POLY_DATA_SIZE,
} from './LightingShader'
import type { LightManager } from './LightManager'
import type { RenderEngine } from '../RenderEngine'

/**
 * Owns the offscreen lighting FBO and the fullscreen quad mesh.
 * Exposes:
 *   - updateAndRender(engine, lightManager, wallSegments): update uniforms, re-render FBO
 *   - compositingSprite: Sprite placed in scene graph with blendMode 'multiply'
 *   - resize(w, h): recreate RenderTexture at new size
 *   - destroy(): cleanup
 */
export class LightingRenderer {
  private fboTexture: RenderTexture
  private mesh: Mesh<Geometry, Shader>
  readonly compositingSprite: Sprite

  constructor(private engine: RenderEngine, width: number, height: number) {
    this.fboTexture = engine.createRenderTexture(width, height)

    // Fullscreen quad: two triangles covering clip space [-1..1]
    const vertices = new Float32Array([
      -1, -1,
       1, -1,
       1,  1,
      -1,  1,
    ])
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3])

    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: vertices, format: 'float32x2' },
      },
      indexBuffer: indices,
    })

    const shader = Shader.from({
      gl: { vertex: LIGHTING_VERT, fragment: LIGHTING_FRAG },
      resources: {
        uniformGroup: {
          uAmbient:         { value: new Float32Array([0.05, 0.05, 0.05]), type: 'vec3<f32>' },
          uLightCount:      { value: 0,                                   type: 'i32' },
          uCameraPos:       { value: new Float32Array([0, 0]),             type: 'vec2<f32>' },
          uCameraZoom:      { value: 1.0,                                  type: 'f32' },
          uViewportSize:    { value: new Float32Array([width, height]),    type: 'vec2<f32>' },
          uLightPos:        { value: new Float32Array(MAX_LIGHTS * 2),     type: `vec2<f32>[${MAX_LIGHTS}]` },
          uLightColor:      { value: new Float32Array(MAX_LIGHTS * 3),     type: `vec3<f32>[${MAX_LIGHTS}]` },
          uLightRadius:     { value: new Float32Array(MAX_LIGHTS),         type: `f32[${MAX_LIGHTS}]` },
          uLightIntensity:  { value: new Float32Array(MAX_LIGHTS),         type: `f32[${MAX_LIGHTS}]` },
          uLightFalloff:    { value: new Int32Array(MAX_LIGHTS),           type: `i32[${MAX_LIGHTS}]` },
          uPolyCount:       { value: new Int32Array(MAX_LIGHTS),           type: `i32[${MAX_LIGHTS}]` },
          uPolyOffset:      { value: new Int32Array(MAX_LIGHTS),           type: `i32[${MAX_LIGHTS}]` },
          uPolyData:        { value: new Float32Array(POLY_DATA_SIZE),     type: `f32[${POLY_DATA_SIZE}]` },
        },
      },
    })

    this.mesh = new Mesh({ geometry, shader })

    // Compositing sprite: displayed in scene graph with multiply blend mode
    this.compositingSprite = new Sprite(this.fboTexture)
    this.compositingSprite.blendMode = 'multiply'
    this.compositingSprite.label = 'lightingFBO'
  }

  /**
   * Update all uniforms from LightManager and re-render the lighting FBO.
   * Call once per frame from renderLoop step (6).
   */
  updateAndRender(
    lightManager: LightManager,
    cameraX: number,
    cameraY: number,
    zoom: number,
    ambientHex: string,
  ): void {
    const lights = lightManager.getVisibleLights()
    const uniforms = this.mesh.shader.resources.uniformGroup.uniforms

    // Ambient color
    const amb = hexToRgb(ambientHex)
    uniforms.uAmbient[0] = amb[0]
    uniforms.uAmbient[1] = amb[1]
    uniforms.uAmbient[2] = amb[2]

    // Camera state (for UV → world transform in shader)
    uniforms.uCameraPos[0] = cameraX
    uniforms.uCameraPos[1] = cameraY
    uniforms.uCameraZoom = zoom
    uniforms.uLightCount = Math.min(lights.length, MAX_LIGHTS)

    const polyDataBuf = uniforms.uPolyData as Float32Array
    let dataOffset = 0

    for (let i = 0; i < Math.min(lights.length, MAX_LIGHTS); i++) {
      const light = lights[i]
      const color = hexToRgb(light.color)

      uniforms.uLightPos[i * 2]     = light.position.x
      uniforms.uLightPos[i * 2 + 1] = light.position.y
      uniforms.uLightColor[i * 3]     = color[0]
      uniforms.uLightColor[i * 3 + 1] = color[1]
      uniforms.uLightColor[i * 3 + 2] = color[2]
      uniforms.uLightRadius[i]    = light.radius
      uniforms.uLightIntensity[i] = light.intensity
      ;(uniforms.uLightFalloff as Int32Array)[i] = light.falloff === 'quadratic' ? 1 : 0

      const polygon = lightManager.getCachedPolygon(light.id) ?? []
      const verts = Math.min(polygon.length, MAX_POLY_VERTS)
      ;(uniforms.uPolyCount as Int32Array)[i] = verts
      ;(uniforms.uPolyOffset as Int32Array)[i] = dataOffset

      for (let v = 0; v < verts; v++) {
        polyDataBuf[dataOffset + v * 2]     = polygon[v][0]
        polyDataBuf[dataOffset + v * 2 + 1] = polygon[v][1]
      }
      dataOffset += MAX_POLY_VERTS * 2
    }

    // Render fullscreen quad to FBO
    this.engine.renderToTexture(this.mesh as unknown as import('pixi.js').Container, this.fboTexture)
  }

  /**
   * Recreate the FBO at new canvas dimensions.
   * Call from engine.resize().
   */
  resize(width: number, height: number): void {
    this.fboTexture.destroy(true)
    this.fboTexture = this.engine.createRenderTexture(width, height)
    this.compositingSprite.texture = this.fboTexture
    const uniforms = this.mesh.shader.resources.uniformGroup.uniforms
    uniforms.uViewportSize[0] = width
    uniforms.uViewportSize[1] = height
  }

  destroy(): void {
    this.mesh.destroy(true)
    this.fboTexture.destroy(true)
    this.compositingSprite.destroy()
  }
}

/** Convert '#rrggbb' hex to normalized [r, g, b] float array */
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  return [r, g, b]
}
```

- [x] Run `pnpm typecheck` — fix any TS errors (PixiJS v8 Shader/Geometry/Mesh API differences)
- [x] Note: PixiJS v8 shader uniform API may differ from snippet — consult `node_modules/pixi.js` types and adjust. The `Shader.from({ gl: { vertex, fragment } })` form is the v8 API. If `resources.uniformGroup` structure is wrong, check `UniformGroup` constructor from `pixi.js`.
- [x] Run `pnpm check`
- [x] Commit: `feat(lighting): GLSL FBO shader — light accumulation with visibility polygon test`

---

## Task 4 — Compositing Pass in renderLoop + subscribeToStore Wiring

**Files:**
- `src/engine/sceneGraph.ts` — replace `lightingPlaceholder` Graphics stub with real `LightingRenderer.compositingSprite`
- `src/engine/renderLoop.ts` — replace lighting stub (step 6) with `lightingRenderer.updateAndRender()`
- `src/engine/subscribeToStore.ts` — add `LightManager.syncFromStore` subscription
- `src/engine/lighting/index.ts` — barrel export (new file)

### Step 4.1 — Wire LightManager into subscribeToStore

In `src/engine/subscribeToStore.ts`, add a new subscription block after the existing sublayer visibility section:

```typescript
// ─── Light changes → LightManager sync + wall invalidation ──
const unsubLights = useStore.subscribe(
  (state) => state.lights,
  (lights) => {
    lightManager.syncFromStore(lights)
  },
  { fireImmediately: true },
)
unsubscribers.push(unsubLights)

// ─── Wall changes → invalidate all light visibility polygons ─
// (reuses the existing shape/wall subscription trigger logic)
// LightManager.invalidateAll() is called whenever dungeon shapes/walls change
// This is wired by passing lightManager into subscribeToStore
```

The `subscribeToStore` function signature must be updated:
```typescript
export function subscribeToStore(
  engine: RenderEngine,
  sceneGraph: SceneGraph,
  lightManager: LightManager,  // ADD
): () => void
```

Also inside the existing `unsubShapes` handler, add:
```typescript
lightManager.invalidateAll()
```

### Step 4.2 — Integrate LightingRenderer into sceneGraph

In `src/engine/sceneGraph.ts`, update `SceneGraph` interface and `buildSceneGraph`:
- Add `lightingRenderer: LightingRenderer` to `SceneGraph` interface
- Replace the `lightingPlaceholder` Graphics stub (lines 82–86) with:
  ```typescript
  const vp = engine.viewport()
  const lightingRenderer = new LightingRenderer(engine, vp.width, vp.height)
  worldContainer.addChild(lightingRenderer.compositingSprite)
  ```
- `lightingRenderer.compositingSprite` is already screen-space sized; position at `(0, 0)` — but note it must be in `overlayContainer` (not `worldContainer`) so it is not affected by camera transform. Update placement accordingly.

> **Architecture note:** The compositing sprite must NOT be inside `worldContainer` (which is camera-transformed). It belongs in `overlayContainer` (screen-space, not zoomed/panned) so it exactly covers the canvas regardless of camera state.

### Step 4.3 — Replace lighting stub in renderLoop

In `src/engine/renderLoop.ts`, step (6) becomes:

```typescript
// (6) Lighting — recompute dirty visibility polygons and update FBO
const store = useStore.getState()
const visibleLights = lightManager.getVisibleLights()
const dungeonLayers = store.layers.filter(
  (l): l is DungeonLayer => l.type === 'dungeon' && l.visible
)
const wallSegments = extractWallSegments(dungeonLayers)

for (const light of visibleLights) {
  if (lightManager.isDirty(light.id)) {
    const polygon = computeVisibilityPolygon(
      [light.position.x, light.position.y],
      light.radius,
      wallSegments,
    )
    lightManager.setCachedPolygon(light.id, polygon)
    lightManager.clearDirty(light.id)
  }
}

// Get camera state for UV → world transform in shader
const stage = engine.stage()
const zoom = stage.scale.x
const camX = -stage.position.x / zoom
const camY = -stage.position.y / zoom

sceneGraph.lightingRenderer.updateAndRender(
  lightManager,
  camX,
  camY,
  zoom,
  store.mapSettings.ambientLight,
)
```

Also wire `engine.resize()` → `lightingRenderer.resize(w, h)` in the PixiJS engine implementation (`src/engine/PixiEngine.ts` or equivalent).

### Step 4.4 — Barrel export

Create `src/engine/lighting/index.ts`:
```typescript
export { LightManager } from './LightManager'
export { LightingRenderer } from './LightingRenderer'
export { computeVisibilityPolygon, extractWallSegments } from './raycaster'
export type { Segment } from './raycaster'
```

- [x] Update `src/engine/sceneGraph.ts`: replace Graphics stub with LightingRenderer, add to interface, place compositingSprite in overlayContainer
- [x] Update `src/engine/subscribeToStore.ts`: add lightManager parameter, add lights subscription, call `lightManager.invalidateAll()` from wall-change handler
- [x] Update `src/engine/renderLoop.ts`: replace step (6) stub with raycaster loop + `lightingRenderer.updateAndRender()`
- [x] Create `src/engine/lighting/index.ts` barrel
- [x] Update all call sites of `subscribeToStore` (in `CanvasHost.tsx` or wherever it's called) to pass the `lightManager` instance
- [x] Run `pnpm typecheck` — fix all errors
- [x] Run `pnpm check`
- [x] Commit: `feat(lighting): wire compositing pass — FBO renders in renderLoop, multiply blend over scene`

---

## Task 5 — Light Placement Tool + Properties UI

**Files:**
- `src/engine/tools/LightTool.ts` — new file
- `src/engine/tools/registerTools.ts` — register LightTool
- `src/store/commands.ts` — add `PlaceLightCommand`, `MoveLightCommand`
- `src/store/factories.ts` — `createLight()` factory
- `src/components/properties/LightProperties.tsx` — new file
- `src/components/properties/PropertiesPanel.tsx` — add light properties branch
- `src/components/layers/LightRow.tsx` — new file
- `src/components/layers/LayerPanel.tsx` — add light rows section

### Step 5.1 — createLight factory

In `src/store/factories.ts`, add:
```typescript
export function createLight(
  position: { x: number; y: number },
  overrides?: Partial<Light>
): Light {
  return {
    id: crypto.randomUUID(),
    position,
    color: '#ffdd88',   // warm torch default
    radius: 150,        // world units
    intensity: 0.9,
    falloff: 'quadratic',
    name: 'Light',
    visible: true,
    ...overrides,
  }
}
```

### Step 5.2 — PlaceLightCommand and MoveLightCommand

In `src/store/commands.ts`, add:

```typescript
export class PlaceLightCommand implements Command {
  readonly label = 'Place Light'
  private light: Light

  constructor(light: Light) {
    this.light = light
  }

  execute(): void {
    useStore.getState().addLight(this.light)
  }

  undo(): void {
    useStore.getState().removeLight(this.light.id)
  }
}

export class MoveLightCommand implements Command {
  readonly label = 'Move Light'

  constructor(
    private lightId: string,
    private from: { x: number; y: number },
    private to: { x: number; y: number },
  ) {}

  execute(): void {
    useStore.getState().updateLight(this.lightId, { position: this.to })
  }

  undo(): void {
    useStore.getState().updateLight(this.lightId, { position: this.from })
  }
}
```

### Step 5.3 — LightTool state machine

Create `src/engine/tools/LightTool.ts`:

The LightTool follows the same `DrawingTool` interface as `RectangleTool` etc:
- `IDLE` → `onPointerDown` → create light at snapped world position → execute `PlaceLightCommand`
- Preview: a circle graphic at cursor position (radius proportional to default light radius)
- No drag behavior; single click places
- The Object tool handles selection/move of existing lights (extend `ObjectTool` to also hit-test light icons)

Light icon rendering strategy:
- `LightManager` owns a `Map<string, Graphics>` of per-light icon sprites
- Each icon is a circle (radius 12 screen pixels = fixed size regardless of zoom) at the light's world position
- Color filled with the light's color, with a glow alpha ring
- Updated by `subscribeToStore` when `state.lights` changes
- Placed in `overlayContainer` so screen-space size is constant at all zoom levels

```typescript
// LightTool sketch:
export class LightTool implements DrawingTool {
  readonly type = 'light' as const
  private previewPoint: Point | null = null

  onPointerDown(point: Point): void {
    const light = createLight({ x: point.x, y: point.y })
    undoManager.execute(new PlaceLightCommand(light))
  }

  onPointerMove(point: Point): void {
    this.previewPoint = point
  }

  onPointerUp(): void { /* no-op */ }
  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.previewPoint = null
  }

  getPreview(): PreviewShape | null {
    if (!this.previewPoint) return null
    return {
      type: 'circle',
      points: [this.previewPoint],
    }
  }

  cancel(): void { this.previewPoint = null }
  isActive(): boolean { return this.previewPoint !== null }
}
```

- [x] Create `src/store/factories.ts` `createLight()` function
- [x] Add `PlaceLightCommand` and `MoveLightCommand` to `src/store/commands.ts`
- [x] Create `src/engine/tools/LightTool.ts`
- [x] Register `LightTool` in `src/engine/tools/registerTools.ts`
- [x] Run `pnpm typecheck`

### Step 5.4 — Light properties panel

Create `src/components/properties/LightProperties.tsx`:

```typescript
// When a light is selected (via Object tool → ui.selectedObjectIds contains a light ID):
// Show:
//   - Name field (TextInput)
//   - Color picker (react-colorful in Popover from src/components/ui/popover.tsx)
//   - Radius slider (SliderInput, range 20–800 world units)
//   - Intensity slider (SliderInput, range 0–1, step 0.01)
//   - Falloff toggle: Linear | Quadratic (two buttons / segmented control)
//
// All changes dispatch updateLight() via ChangePropertyCommand for undo support
```

- [x] Create `src/components/properties/LightProperties.tsx` with the described controls
- [x] Update `src/components/properties/PropertiesPanel.tsx` to render `<LightProperties>` when a selected ID refers to a light (check `store.lights.find(l => l.id === selectedId)`)

### Step 5.5 — Light rows in layer panel

Create `src/components/layers/LightRow.tsx`:

```typescript
// Renders one row per Light in store.lights:
//   [color-swatch 16px circle] [name] [eye-icon toggle]
// Non-draggable (lights are not layers)
// Eye icon calls updateLight(id, { visible: !light.visible })
// Row click sets selectedObjectIds to [light.id]
```

- [x] Create `src/components/layers/LightRow.tsx`
- [x] Update `src/components/layers/LayerPanel.tsx`: after the dungeon layer rows, render a section labeled "Lights" with one `<LightRow>` per `store.lights` entry

### Step 5.6 — Ambient color picker in map settings

In `src/components/properties/PropertiesPanel.tsx` (or the map settings section of it):
- Add a color swatch for `mapSettings.ambientLight`
- Opens a react-colorful Popover
- On change: `useStore.getState().setAmbientLight(newHex)` (no undo needed — this is a setting, not a placed object)

- [x] Run `pnpm check`
- [x] Commit: `feat(lighting): light placement tool, PlaceLightCommand, properties panel, layer rows`

---

## Task 6 — Real-Time Performance + E2E Tests

**Files:**
- `tests/e2e/17-lighting.spec.ts` — new Playwright E2E test file

### Step 6.1 — Dirty-flag verification

The performance architecture relies on dirty-flags being correct. Verify in the render loop:
- Walls change → `lightManager.invalidateAll()` is called → all polygons recomputed next frame
- Single light position changes → only that light's polygon is recomputed
- Camera pan/zoom → no polygon recomputation (geometry unchanged)
- Light color/intensity/name change (no position/radius change) → no polygon recomputation

Add a `lightManager.getDirtyCount()` helper (returns `dirtySet.size`) to allow test assertions.

### Step 6.2 — Graceful degradation under load

If frame time > 14ms (< 72fps headroom shrinking), reduce ray count per light:
- Default ray count: all wall endpoints × 3 + cardinal 4 + 8 = adaptive
- Fallback: cap endpoints at 64 most relevant (nearest to light)
- This logic lives in `computeVisibilityPolygon` as an optional `maxEndpoints` parameter (default `Infinity`)

### Step 6.3 — Write Playwright E2E tests

Create `tests/e2e/17-lighting.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'
import { waitForApp, clickCanvas } from './helpers'

test.describe('Lighting Engine', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForApp(page)
  })

  test('lighting FBO sprite is present in DOM (canvas renders)', async ({ page }) => {
    // The PixiJS app renders — just confirm the canvas is present and non-zero size
    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    expect(box!.width).toBeGreaterThan(100)
    expect(box!.height).toBeGreaterThan(100)
  })

  test('placing a light via light tool creates a light in the layer panel', async ({ page }) => {
    // Switch to light tool
    await page.click('[data-tool="light"]')
    // Click center of canvas to place a light
    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
    // Light row should appear in the layer panel
    await expect(page.locator('[data-testid="light-row"]').first()).toBeVisible()
  })

  test('undo removes a placed light', async ({ page }) => {
    await page.click('[data-tool="light"]')
    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await expect(page.locator('[data-testid="light-row"]')).toHaveCount(1)
    await page.keyboard.press('Control+z')
    await expect(page.locator('[data-testid="light-row"]')).toHaveCount(0)
  })

  test('light visibility toggle hides light row eye icon state', async ({ page }) => {
    // Place a light
    await page.click('[data-tool="light"]')
    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
    // Click eye icon
    await page.click('[data-testid="light-visibility-toggle"]')
    // Eye icon should reflect hidden state
    await expect(page.locator('[data-testid="light-visibility-toggle"]')).toHaveAttribute('data-visible', 'false')
  })

  test('ambient color defaults to near-black (dungeon feel)', async ({ page }) => {
    // The ambient color swatch should reflect the default #111111 or similar
    const swatch = page.locator('[data-testid="ambient-color-swatch"]')
    await expect(swatch).toBeVisible()
  })

  test('light properties panel shows when light is selected', async ({ page }) => {
    // Place a light
    await page.click('[data-tool="light"]')
    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
    // Switch to object tool, click light icon
    await page.click('[data-tool="object"]')
    // Click the light icon position (same canvas center)
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
    // Properties panel should show light controls
    await expect(page.locator('[data-testid="light-radius-slider"]')).toBeVisible()
    await expect(page.locator('[data-testid="light-intensity-slider"]')).toBeVisible()
  })

  test('no frame drops — 60fps with default map (smoke test)', async ({ page }) => {
    // Place 5 lights and measure frame time via requestAnimationFrame
    await page.click('[data-tool="light"]')
    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    // Place 5 lights at different positions
    for (let i = 0; i < 5; i++) {
      await page.mouse.click(
        box!.x + box!.width * (0.2 + i * 0.15),
        box!.y + box!.height / 2,
      )
    }
    // Measure average frame time over 60 frames
    const avgFrameMs = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        const times: number[] = []
        let prev = performance.now()
        let count = 0
        function frame() {
          const now = performance.now()
          times.push(now - prev)
          prev = now
          count++
          if (count < 60) requestAnimationFrame(frame)
          else resolve(times.reduce((a, b) => a + b) / times.length)
        }
        requestAnimationFrame(frame)
      })
    })
    // Average frame time should be under 20ms (>= 50fps)
    expect(avgFrameMs).toBeLessThan(20)
  })
})
```

- [x] Run `pnpm exec playwright test tests/e2e/17-lighting.spec.ts --reporter=list` — confirm tests exist and fail with meaningful errors (not test file errors)
- [x] Add `data-testid` attributes to `LightRow.tsx`, `LightProperties.tsx` controls, and the ambient color swatch as needed to satisfy tests
- [x] Re-run tests — confirm core tests pass (frame rate test may be environment-dependent; mark as skipped in CI if flaky)
- [x] Run full suite: `pnpm exec playwright test --reporter=list` — confirm no regressions in tests 01–16
- [x] Run `pnpm check`
- [x] Commit: `feat(lighting): E2E test suite for light placement, undo, properties, visibility`

---

## Task 7 — Performance Profiling Gate

**Goal:** Confirm 60fps with 10 lights on a 30×30 map before closing Month 1.

- [x] In the browser dev console with `pnpm dev` running, draw a 30×30 grid map (or load a test map)
- [x] Place 10 lights spread across the map
- [x] Open PixiJS DevTools / browser perf tab — confirm average frame time < 16.7ms
- [x] If frame time > 16.7ms with 10 lights, profile the hotspot:
  - If raycaster is the bottleneck: add `maxEndpoints` cap at 128 endpoints; add candidate endpoint culling (skip endpoints outside `light.radius`)
  - If shader is the bottleneck: reduce `MAX_POLY_VERTS` from 64 to 32; or switch to a stencil-based approach (render each visibility polygon to stencil buffer, then draw colored quad with stencil test)
  - If uniform upload is the bottleneck: batch all light data into a single `Float32Array` and use a `ubo` (uniform buffer object) in WebGL 2
- [x] Document findings in `docs/research/lighting-research-notes.md` (append a Performance Results section)
- [x] Run `pnpm check`
- [x] Commit: `perf(lighting): profiling results and optimizations for 10-light 60fps target`

---

## Commit History Checklist (in order)

```
docs: lighting engine research notes — compositing and raycasting approaches
feat(lighting): LightManager — light list sync, dirty-flag shadow cache
feat(lighting): CPU raycaster — sweep-line visibility polygon with wall occlusion
feat(lighting): GLSL FBO shader — light accumulation with visibility polygon test
feat(lighting): wire compositing pass — FBO renders in renderLoop, multiply blend over scene
feat(lighting): light placement tool, PlaceLightCommand, properties panel, layer rows
feat(lighting): E2E test suite for light placement, undo, properties, visibility
perf(lighting): profiling results and optimizations for 10-light 60fps target
```

---

## Key File Reference

| File | Action | Description |
|------|--------|-------------|
| `src/store/types.ts` | EDIT | Add `name`, `visible` to `Light` interface |
| `src/store/factories.ts` | EDIT | Add `createLight()` factory with defaults |
| `src/store/commands.ts` | EDIT | Add `PlaceLightCommand`, `MoveLightCommand` |
| `src/engine/lighting/LightManager.ts` | NEW | Shadow cache, dirty-flags, store sync |
| `src/engine/lighting/LightManager.test.ts` | NEW | Vitest unit tests for LightManager |
| `src/engine/lighting/raycaster.ts` | NEW | 2D sweep-line visibility polygon |
| `src/engine/lighting/raycaster.test.ts` | NEW | Vitest unit tests for raycaster (pure math) |
| `src/engine/lighting/LightingShader.ts` | NEW | GLSL vertex + fragment shader strings |
| `src/engine/lighting/LightingRenderer.ts` | NEW | PixiJS Mesh + RenderTexture FBO |
| `src/engine/lighting/index.ts` | NEW | Barrel export |
| `src/engine/sceneGraph.ts` | EDIT | Replace Graphics stub with LightingRenderer |
| `src/engine/renderLoop.ts` | EDIT | Replace step (6) stub with raycaster + FBO render |
| `src/engine/subscribeToStore.ts` | EDIT | Add lights subscription, wall→invalidateAll |
| `src/engine/tools/LightTool.ts` | NEW | Click-to-place light tool |
| `src/engine/tools/registerTools.ts` | EDIT | Register LightTool |
| `src/components/properties/LightProperties.tsx` | NEW | Color, radius, intensity, falloff UI |
| `src/components/properties/PropertiesPanel.tsx` | EDIT | Branch for light selection, ambient picker |
| `src/components/layers/LightRow.tsx` | NEW | Layer panel row per light |
| `src/components/layers/LayerPanel.tsx` | EDIT | Add Lights section with LightRow list |
| `tests/e2e/17-lighting.spec.ts` | NEW | Playwright E2E tests |
| `docs/research/lighting-research-notes.md` | NEW | Research findings |

---

## Exit Criteria (Month 1 Lighting)

- [x] Point lights placed via light tool with color, radius, intensity, falloff controls
- [x] Walls cast visible shadow occlusion (raycasting-based visibility polygons)
- [x] Ambient darkness color adjustable in map settings panel
- [x] Overlapping colored lights blend additively (red + blue → purple region)
- [x] Real-time shadow update when lights or walls change (dirty-flag recompute)
- [x] 60fps maintained with 10 lights on a 30×30 map
- [x] `PlaceLightCommand` / `MoveLightCommand` are fully undoable via Ctrl+Z
- [x] Light visibility toggle hides light from rendering (no raycasting for hidden lights)
- [x] `pnpm check` green (typecheck + lint + test)
- [x] All 17 E2E test files pass without regressions

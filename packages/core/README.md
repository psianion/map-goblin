# @dnd/core

Shared engine extracted from the canvas map builder. Provides the rendering engine, state management, geometry pipeline, and tool system used by **canvas** (standalone map builder) and the future **session** (Game Runner).

- **Package:** `@dnd/core`
- **Private:** yes (workspace-only)
- **Module:** ESM-only (`"type": "module"`)
- **Version:** 0.0.1

---

## Architecture

```
src/
├── types/        # Geometry types (Point, Polygon, Viewport)
├── shared/       # Wall segments, door/shape/light children, occlusion
├── geometry/     # Clipper2 WASM, catmull-rom, poisson disk, simplify
├── store/        # Zustand store, slices, commands, undo, migration
├── engine/       # PixiJS render engine, scene graph, camera, render loop
│   ├── lighting/ # ClockwiseSweep raycaster, LightManager, shadows
│   └── tools/    # Drawing tool state machines, transform math
├── canvas/       # Input handling, grid snap, wall snap (not CanvasHost)
├── assets/       # Texture loader, content-hashed CDN assets
└── config/       # CDN configuration
```

### Key layers

| Layer | What it does |
|-------|-------------|
| **types + shared** | Geometry primitives (`Point`, `Polygon`, `Viewport`), wall segments, door/shape/light child types, occlusion math |
| **geometry** | Clipper2 WASM polygon booleans, catmull-rom interpolation, Poisson-disk sampling, path simplification, coordinate conversion |
| **store** | Zustand store with immer middleware, 8 slices (mapSettings, grid, layers, lights, tools, ui, assets, maps), Command-pattern undo/redo, migration system |
| **engine** | PixiJS v8 render engine, camera (pan/zoom/pinch), scene graph with RenderTexture-per-layer isolation, dirty-flag render cache, render loop |
| **engine/lighting** | ClockwiseSweep raycaster, SegmentQuadtree acceleration, LightManager, LightingRenderer with FBO compositing |
| **engine/tools** | Drawing tool state machines (rectangle, polygon, path, wall, door, stamp, etc.), TransformGizmo, transform math |
| **canvas** | Input handling pipeline, grid snap, wall endpoint snap (not React CanvasHost) |
| **assets** | Texture loader with checksum verification, asset pack manager, IndexedDB cache, CDN manifest bridge |

---

## Injectable Patterns

Core does not depend on React or browser globals directly. Consumers wire platform-specific implementations:

| Injection | Purpose |
|-----------|---------|
| `setNotify(fn)` | Error/success toast notifications |
| `setMapDBFactory(fn)` | IndexedDB persistence for multi-map storage |
| `setMapSerializer(fn)` | File save/load (.mapbuilder format) |
| `setPackManagerFactory(fn)` | Asset pack management and CDN fetching |

This allows core to run in different contexts (standalone editor, game session, tests) without hard-coding browser APIs.

---

## Commands

```bash
pnpm test        # vitest run
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint src/ --max-warnings 0
pnpm check       # all three (typecheck + lint + test)
```

---

## Testing

- **36 test files**, **318 tests**
- Environment: `jsdom` (no browser required for unit tests)
- Uses `fake-indexeddb` for IndexedDB-dependent tests
- Co-located: `foo.ts` -> `foo.test.ts` in the same folder

---

## Constraints

- **TypeScript strict mode**, zero `any`
- **ESM-only** — all imports/exports use ES modules
- **Browser-only code must be lazy-loaded** — Clipper2 WASM and PixiJS only initialize at runtime in a browser context, not at import time
- **Store is one-way** — `subscribeToStore.ts` pushes Zustand state into PixiJS. Never read PixiJS state back into the store
- **Camera lives in the engine** — not in Zustand. Query `engine.viewport()` or `engine.screenToWorld()` directly
- **RenderTexture per dungeon layer** — PixiJS multiply blend mode bleeds through siblings; each layer renders to an intermediate RenderTexture

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `pixi.js` ^8.17 | WebGL 2 rendering engine |
| `zustand` ^5 | State management |
| `immer` ^11 | Immutable state updates |
| `clipper2-wasm` ^0.2.1 | Polygon boolean operations (WASM) |
| `p-limit` ^7 | Concurrency control for async operations |

# Asset Style Bible — "Hand-Painted" (v0.2)

v0.2 2026-07-23: rewritten from evidence — the curated references in `forge/examples/`
(user picks `user-01..04` are the strongest signal). `forge/examples/` is the style
authority; when in doubt, open those files, not this prose. Style ships as our own pack;
other styles (FA-ish dungeon-classic) coexist as separate packs.

## Core look (derived from the examples)

- **Hand-painted, visible brushwork** — confident painterly strokes; texture is painted,
  not photographic. Think classic hand-painted RPG textures / painted VTT asset packs.
- **Element definition by dark seams** — every stone, plank, leaf-cluster is its own
  readable shape: dark crevice/edge between elements, painted highlight on top. Not heavy
  comic outlines — structural dark seams.
- **Warm earthy saturated palette** — browns, mossy greens, warm greys; saturated but
  natural. Light parchment-friendly neutrals for architecture.
- **Soft top-light** — highlights read from above, gentle contrast, soft occlusion in
  crevices. No hard directional cast shadows.
- **Chunky readable forms** — must read instantly at 200px/cell map zoom.

## Hard technical rules (every asset, non-negotiable)

1. Orthographic top-down ("viewed directly from above, flat lay"). No isometric, no 3/4.
2. Objects: exactly one subject (or one deliberate cluster), centered, empty flat
   background, nothing else in frame. Textures: edge-to-edge, seamless-tileable.
3. **Soft ambient-occlusion contact shadow only. Never a directional cast shadow** — the
   canvas lighting engine casts shadows dynamically.
4. Sized to grid after approval: gridSize × 200px.

## Prompt kit

**Positive base — objects** (constraints in the POSITIVE; low-cfg ignores negatives):

> exactly one {subject}, centered alone on an empty plain background, nothing else in
> frame, viewed directly from above, orthographic top-down flat lay, hand-painted RPG
> game asset style, painterly visible brush strokes, warm earthy colors, defined by dark
> crevices and painted top highlights, soft ambient occlusion contact shadow only, no
> cast shadow, crisp readable silhouette

**Positive base — textures/floors:** swap the first clause for
"seamless tileable top-down ground texture of {subject}, edge to edge, no border".

**Negative base:**

> multiple unrelated objects, scene, border, frame, isometric, 3/4 view, side view,
> cast shadow, photorealistic, photo, 3d render, flat cartoon, cel shading, blurry,
> watermark, text, logo

## Planned sets (one style across all)

rocks · wood · grass · trees · walls (rock / stone / wood) · general dnd map graphics.
Every set calibrates against approved assets from earlier sets (img2img) before batch runs.

## Process

- Explore on `txt2img-fast.json` (minutes/round), finalist re-rendered on `txt2img.json`
  (full quality), then `forge approve` into the pack source.
- Approved assets = style bible = eventual LoRA training set. All self-generated → owned.
- References in `forge/examples/` are copyrighted study material: private, never trained
  on, never img2img'd from, never shipped.

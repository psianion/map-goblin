import { Container, Graphics } from 'pixi.js';
import type { RenderEngine } from '../RenderEngine';
import { useStore } from '../../store/store';

/**
 * The edge of a fixed-size map, drawn as a single hairline rectangle.
 *
 * Nothing is drawn for an expanding map (`fixedSize == null`) — it has no edge
 * to show. Drawing outside the frame stays legal; this is a guide, not a fence.
 *
 * Lives in the OVERLAY container (screen space, a sibling of worldContainer
 * under app.stage), not in the world, for two reasons:
 *   - Export renders `sceneGraph.worldContainer` and nothing else
 *     (exportPipeline.renderToTexture), so an editor guide can never be baked
 *     into a DM's battlemap. Structural, not a save/restore dance.
 *   - A stroke measured in screen pixels stays a hairline at every zoom
 *     instead of thickening into a slab when zoomed in.
 *
 * Editor only. The table (session GameRenderer) builds this same core scene
 * graph, so the gate is at construction: `buildSceneGraph` makes one of these
 * only when passed `editorGuides`, which the canvas sets and the table does not.
 */

/** Chrome ink token used for structure (panel frames, map frame). */
const INK_TOKEN = '--border-structure';
/** Night value of that token (77 84 74) — used where the CSS var is unreadable. */
const INK_FALLBACK = 0x4d544a;

function inkColor(): number {
  if (typeof document === 'undefined') return INK_FALLBACK;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(INK_TOKEN);
  const [r, g, b] = raw.trim().split(/[\s,]+/).map(Number);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return INK_FALLBACK;
  return (r << 16) | (g << 8) | b;
}

export class MapBoundaryRenderer {
  readonly container: Container;
  private graphics: Graphics;
  /** Screen rect + colour last drawn; redraw only when it actually changes. */
  private lastKey = '';

  constructor() {
    this.container = new Container();
    this.container.label = 'mapBoundary';
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
  }

  update(engine: RenderEngine): void {
    const fixedSize = useStore.getState().mapSettings.fixedSize ?? null;
    this.container.visible = fixedSize != null;
    if (!fixedSize) return;

    // The frame of a pinned map is (0,0)–(width,height) in cells; 1 world unit
    // is 1 cell, so the corners convert straight through the camera.
    const tl = engine.worldToScreen(0, 0);
    const br = engine.worldToScreen(fixedSize.width, fixedSize.height);
    // Round to whole device-independent pixels so the 1px stroke stays crisp
    // (and so sub-pixel camera drift doesn't churn the redraw).
    const x = Math.round(tl.x);
    const y = Math.round(tl.y);
    const w = Math.round(br.x) - x;
    const h = Math.round(br.y) - y;

    const color = inkColor();
    const key = `${x},${y},${w},${h},${color}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.graphics.clear();
    this.graphics.rect(x, y, w, h);
    this.graphics.stroke({ width: 1, color, alpha: 0.9 });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

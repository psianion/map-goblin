import { Container, Sprite, Graphics, Texture, Assets } from 'pixi.js';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import type { Point } from '../../types/geometry';
import type { AssetChild, DungeonLayer, ScatterBrushSettings } from '../../store/types';
import { useStore } from '../../store/store';
import { notify } from '../../shared/notify';
import { getTextureEntry, GRID_CELL_PX } from '../../assets/textureManifest';
import { resolveTexture } from '../../assets/textureLoader';
import { poissonDiskSample } from '../../geometry/poissonDisk';
import { mulberry32, hashPosition } from '../../geometry/seededRng';
import { AddChildCommand, RemoveChildCommand, CompositeCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';

/** Max items per scatter click */
const MAX_SCATTER_COUNT = 30;

/** Quantize step for position hashing (in world units / cells). Controls preview stability zone. */
const POSITION_QUANTIZE = 0.5;

interface PlacementPoint {
  position: Point;
  assetId: string;
  rotation: number;
  scale: number;
  width: number;
  height: number;
}

export class StampScatterTool implements DrawingTool {
  readonly type = 'scatterBrush' as const;

  private previewContainer: Container;
  private previewSprites: Sprite[] = [];
  private brushCircle: Graphics;
  private lastCursorWorld: Point | null = null;
  private pendingPlacements: PlacementPoint[] = [];
  private textureCache = new Map<string, Texture>();
  private unsubSettings: (() => void) | null = null;
  private unsubErase: (() => void) | null = null;
  private destroyed = false;
  /** Quantized cursor position — used to skip redundant preview rebuilds */
  private lastQuantizedX = NaN;
  private lastQuantizedY = NaN;

  constructor(previewContainer: Container) {
    this.previewContainer = previewContainer;
    this.brushCircle = new Graphics();
    this.previewContainer.addChild(this.brushCircle);

    // Subscribe to settings changes for live preview refresh
    this.unsubSettings = useStore.subscribe(
      (state) => state.tools.settings.scatterBrush,
      () => {
        // Settings changed — force rebuild even if cursor hasn't moved
        this.lastQuantizedX = NaN;
        this.lastQuantizedY = NaN;
        if (this.lastCursorWorld) {
          this.updatePreview(this.lastCursorWorld);
        }
      },
    );

    // Subscribe to eraseMode changes
    this.unsubErase = useStore.subscribe(
      (state) => state.tools.eraseMode,
      () => {
        this.lastQuantizedX = NaN;
        this.lastQuantizedY = NaN;
        if (this.lastCursorWorld) {
          this.updatePreview(this.lastCursorWorld);
        }
      },
    );
  }

  private getSettings(): ScatterBrushSettings {
    return useStore.getState().tools.settings.scatterBrush;
  }

  /**
   * Natural size in grid cells for any asset id. Legacy manifest entries carry
   * naturalWidth/Height; pack entries (id contains ':') have no manifest entry,
   * so derive the size from the resolved texture's pixel dimensions.
   */
  private getAssetSize(assetId: string): { width: number; height: number } | null {
    const entry = getTextureEntry(assetId);
    if (entry) {
      return {
        width: entry.naturalWidth / GRID_CELL_PX,
        height: entry.naturalHeight / GRID_CELL_PX,
      };
    }
    const tex = resolveTexture(assetId);
    if (tex.width <= 1) return null;
    return { width: tex.width / GRID_CELL_PX, height: tex.height / GRID_CELL_PX };
  }

  private getActiveLayerId(): string {
    return useStore.getState().ui.activeLayerId;
  }

  private isEraseMode(): boolean {
    return useStore.getState().tools.eraseMode;
  }

  private showLayerWarning(message: string): void {
    notify.warning(message);
  }

  // ─── Preview ───

  /** Called on every pointer move and when settings change */
  updatePreview(worldPoint: Point): void {
    this.lastCursorWorld = worldPoint;

    // Performance: skip rebuild if cursor is in the same quantized zone
    const qx = Math.round(worldPoint.x / POSITION_QUANTIZE);
    const qy = Math.round(worldPoint.y / POSITION_QUANTIZE);
    if (qx === this.lastQuantizedX && qy === this.lastQuantizedY) return;
    this.lastQuantizedX = qx;
    this.lastQuantizedY = qy;

    this.clearPreview();

    const settings = this.getSettings();
    if (settings.assetIds.length === 0) return;

    if (this.isEraseMode()) {
      this.showErasePreview(worldPoint, settings);
      return;
    }

    if (settings.stampMode) {
      this.showStampPreview(worldPoint, settings);
    } else {
      this.showScatterPreview(worldPoint, settings);
    }
  }

  private showStampPreview(worldPoint: Point, settings: ScatterBrushSettings): void {
    const assetId = settings.assetIds[0];
    const placement = this.computeStampPlacement(worldPoint, assetId);
    if (!placement) return;

    this.pendingPlacements = [placement];
    this.renderPreviewSprite(placement);
  }

  private showScatterPreview(worldPoint: Point, settings: ScatterBrushSettings): void {
    const radiusWorld = settings.brushRadius;
    const minSpacingWorld = settings.minSpacing;

    // Seeded RNG from quantized position
    const seed = hashPosition(this.lastQuantizedX, this.lastQuantizedY);
    const rng = mulberry32(seed);

    // Generate sample points
    const count = Math.min(settings.count, MAX_SCATTER_COUNT);
    const samplePoints = poissonDiskSample(
      worldPoint,
      radiusWorld,
      minSpacingWorld,
      count,
      rng,
    );

    // Compute placements for each sample
    this.pendingPlacements = [];
    for (const pt of samplePoints) {
      const assetId = settings.assetIds[Math.floor(rng() * settings.assetIds.length)];
      const rotation =
        settings.rotationRange[0] +
        rng() * (settings.rotationRange[1] - settings.rotationRange[0]);
      const scaleMul =
        settings.scaleRange[0] +
        rng() * (settings.scaleRange[1] - settings.scaleRange[0]);

      const size = this.getAssetSize(assetId);
      if (!size) continue;

      this.pendingPlacements.push({
        position: pt,
        assetId,
        rotation,
        scale: scaleMul,
        width: size.width * scaleMul,
        height: size.height * scaleMul,
      });
    }

    // Render all preview sprites
    for (const placement of this.pendingPlacements) {
      this.renderPreviewSprite(placement);
    }

    // Draw brush circle (stroke width in screen pixels, not world units)
    const zoom = this.previewContainer.parent?.scale.x ?? 1;
    const strokeWidth = 2 / zoom;
    this.brushCircle.clear();
    this.brushCircle.circle(worldPoint.x, worldPoint.y, radiusWorld);
    this.brushCircle.stroke({ width: strokeWidth, color: 0x4a9eff, alpha: 0.6 });
  }

  private showErasePreview(worldPoint: Point, settings: ScatterBrushSettings): void {
    const radius = settings.stampMode ? 0.5 : settings.brushRadius;
    const zoom = this.previewContainer.parent?.scale.x ?? 1;
    const strokeWidth = 2 / zoom;

    this.brushCircle.clear();
    // Fill first, then stroke (PixiJS v8 flushes path on each operation)
    this.brushCircle.circle(worldPoint.x, worldPoint.y, radius);
    this.brushCircle.fill({ color: 0xff4444, alpha: 0.1 });
    this.brushCircle.circle(worldPoint.x, worldPoint.y, radius);
    this.brushCircle.stroke({ width: strokeWidth, color: 0xff4444, alpha: 0.6 });
  }

  private computeStampPlacement(worldPoint: Point, assetId: string): PlacementPoint | null {
    const size = this.getAssetSize(assetId);
    if (!size) return null;

    const snapped = this.snapToCell(worldPoint);

    return {
      position: snapped,
      assetId,
      rotation: 0,
      scale: 1,
      width: size.width,
      height: size.height,
    };
  }

  private snapToCell(point: Point): Point {
    const snapEnabled = useStore.getState().grid.snapEnabled;
    if (!snapEnabled) return point;
    return {
      x: Math.round(point.x),
      y: Math.round(point.y),
    };
  }

  private renderPreviewSprite(placement: PlacementPoint): void {
    let tex = this.textureCache.get(placement.assetId);
    if (!tex) {
      // Unified resolver first — covers pack + legacy-mapped textures synchronously
      const resolved = resolveTexture(placement.assetId);
      if (resolved.width > 1) {
        tex = resolved;
        this.textureCache.set(placement.assetId, tex);
      }
    }
    if (!tex) {
      // Legacy bundled path: load from the manifest entry's file URL
      const entry = getTextureEntry(placement.assetId);
      if (!entry) return;
      const maybeTex = Assets.get<Texture>(entry.path);
      if (maybeTex) {
        tex = maybeTex;
        this.textureCache.set(placement.assetId, tex);
      } else {
        // Not cached yet — trigger async load with error handling and destroyed guard
        void Assets.load(entry.path)
          .then((loaded: Texture) => {
            if (this.destroyed) return;
            this.textureCache.set(placement.assetId, loaded);
            this.refreshPreview();
          })
          .catch(() => {
            // Texture failed to load — silently use placeholder, user sees white rect
            // which is acceptable since textures load on next hover
          });
        tex = Texture.WHITE;
      }
    }

    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5);
    sprite.alpha = 0.5;
    sprite.position.set(placement.position.x, placement.position.y);
    sprite.width = placement.width;
    sprite.height = placement.height;
    sprite.rotation = placement.rotation;

    this.previewSprites.push(sprite);
    this.previewContainer.addChild(sprite);
  }

  private clearPreview(): void {
    for (const sprite of this.previewSprites) {
      sprite.removeFromParent();
      sprite.destroy();
    }
    this.previewSprites = [];
    this.pendingPlacements = [];
    this.brushCircle.clear();
  }

  // ─── Placement ───

  private commitPlacements(): void {
    const layerId = this.getActiveLayerId();
    if (!layerId) return;

    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer || layer.type !== 'dungeon') {
      this.showLayerWarning('Select a dungeon layer to place assets');
      return;
    }
    if (layer.locked) {
      this.showLayerWarning('Layer is locked');
      return;
    }

    if (this.pendingPlacements.length === 0) return;

    const commands = this.pendingPlacements.map((p) => {
      const child: AssetChild = {
        id: crypto.randomUUID(),
        name: 'Asset',
        childType: 'asset',
        visible: true,
        objectType: 'asset',
        assetId: p.assetId,
        position: { x: p.position.x, y: p.position.y },
        rotation: p.rotation,
        scale: p.scale,
        width: p.width,
        height: p.height,
        tint: '#ffffff',
        flipX: false,
        flipY: false,
      };
      return new AddChildCommand('Place asset', layerId, child);
    });

    if (commands.length === 1) {
      undoManager.execute(commands[0]);
    } else {
      undoManager.execute(new CompositeCommand('Scatter assets', commands));
    }

    // Track recent assets
    const store = useStore.getState();
    for (const p of this.pendingPlacements) {
      store.addRecentAsset(p.assetId);
    }

    // After stamp: return to select if not continuous
    const settings = this.getSettings();
    if (settings.stampMode && !store.tools.settings.continuousPlacement) {
      store.setActiveTool('select');
    }
  }

  private commitErase(worldPoint: Point): void {
    const layerId = this.getActiveLayerId();
    if (!layerId) return;

    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer || layer.type !== 'dungeon') {
      this.showLayerWarning('Select a dungeon layer to erase assets');
      return;
    }
    if (layer.locked) {
      this.showLayerWarning('Layer is locked');
      return;
    }

    const settings = this.getSettings();
    const radius = settings.stampMode ? 0.5 : settings.brushRadius;

    // Find asset children within radius (AABB-to-circle intersection)
    const dungeonLayer = layer as DungeonLayer;
    const radiusSq = radius * radius;
    const children = dungeonLayer.children.filter((c): c is AssetChild => {
      if (c.childType !== 'asset') return false;
      const ac = c as AssetChild;
      const halfW = ac.width / 2;
      const halfH = ac.height / 2;
      const closestX = Math.max(ac.position.x - halfW, Math.min(worldPoint.x, ac.position.x + halfW));
      const closestY = Math.max(ac.position.y - halfH, Math.min(worldPoint.y, ac.position.y + halfH));
      const dx = closestX - worldPoint.x;
      const dy = closestY - worldPoint.y;
      return dx * dx + dy * dy <= radiusSq;
    });

    if (children.length === 0) return;

    const commands = children.map(
      (c) => new RemoveChildCommand('Remove asset', layerId, c.id),
    );
    if (commands.length === 1) {
      undoManager.execute(commands[0]);
    } else {
      undoManager.execute(new CompositeCommand('Erase assets', commands));
    }
  }

  // ─── DrawingTool Interface ───

  onPointerDown(point: Point): void {
    if (this.isEraseMode()) {
      this.commitErase(point);
    } else {
      this.commitPlacements();
    }
  }

  onPointerMove(point: Point): void {
    this.updatePreview(point);
  }

  onPointerUp(): void {
    // Click-to-place — all work done in onPointerDown
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
      useStore.getState().setActiveTool('select');
    }
  }

  getPreview(): PreviewShape | null {
    return null; // Preview managed via direct Sprites
  }

  cancel(): void {
    this.clearPreview();
    this.lastCursorWorld = null;
    this.lastQuantizedX = NaN;
    this.lastQuantizedY = NaN;
  }

  isActive(): boolean {
    return this.previewSprites.length > 0 || this.lastCursorWorld !== null;
  }

  getHoverCursor(_sx: number, _sy: number): string | null {
    return 'crosshair';
  }

  refreshPreview(): void {
    if (this.lastCursorWorld) {
      // Force rebuild by invalidating quantized position
      this.lastQuantizedX = NaN;
      this.lastQuantizedY = NaN;
      this.updatePreview(this.lastCursorWorld);
    }
  }

  destroy(): void {
    this.destroyed = true;
    // Unsubscribe BEFORE destroying PixiJS objects to prevent race conditions
    this.unsubSettings?.();
    this.unsubErase?.();
    this.clearPreview();
    this.brushCircle.destroy();
  }
}

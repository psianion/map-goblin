import { Assets, Container, Sprite } from 'pixi.js';
import { toast } from 'sonner';
import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { AddChildCommand } from '@/store/commands';
import type { AssetChild, DungeonLayer } from '@/store/types';

type PlacementState = 'IDLE' | 'PREVIEWING';

/**
 * Snap a world-space point to the nearest full grid cell boundary.
 * Asset placement always snaps at cell resolution (snapDivision = 1).
 */
function snapToCell(point: Point): Point {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
  };
}

/**
 * Tool that shows a 50%-opacity preview sprite following the cursor,
 * snapped to cell boundaries. Click places the asset via AddChildCommand.
 *
 * Activated by calling `activateForAsset(assetId)` from the asset browser.
 * Escape or single placement (when continuousPlacement=false) returns to select.
 */
export class AssetPlacementTool implements DrawingTool {
  readonly type = 'assetPlacement' as const;

  private state: PlacementState = 'IDLE';
  private previewSprite: Sprite | null = null;
  private selectedAssetId: string | null = null;
  private worldContainer: Container;

  constructor(worldContainer: Container) {
    this.worldContainer = worldContainer;
  }

  /**
   * Called by the asset browser when the user clicks an asset thumbnail.
   * Switches the active tool and activates the preview sprite.
   */
  activateForAsset(assetId: string): void {
    this.selectedAssetId = assetId;
    this.state = 'PREVIEWING';
    this.createPreviewSprite(assetId);
    useStore.getState().setActiveTool('assetPlacement');
  }

  onPointerDown(point: Point): void {
    if (this.state !== 'PREVIEWING' || !this.selectedAssetId) return;
    this.placeAsset(point);
  }

  onPointerMove(point: Point): void {
    if (this.state !== 'PREVIEWING' || !this.previewSprite) return;
    const snapped = snapToCell(point);
    this.previewSprite.position.set(snapped.x, snapped.y);
  }

  onPointerUp(_point: Point): void {
    // No-op: placement happens on pointerdown
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
    }
  }

  getPreview(): PreviewShape | null {
    // Preview is a PixiJS sprite managed directly — not a vector PreviewShape
    return null;
  }

  cancel(): void {
    this.deactivate();
    useStore.getState().setActiveTool('select');
  }

  isActive(): boolean {
    return this.state !== 'IDLE';
  }

  private placeAsset(point: Point): void {
    const store = useStore.getState();
    const layerId = store.ui.activeLayerId;
    const layer = store.layers.find(
      (l): l is DungeonLayer => l.id === layerId && l.type === 'dungeon',
    );

    if (!layer) {
      toast.error('Switch to a dungeon layer to place assets');
      return;
    }

    const snapped = snapToCell(point);
    const assetTexture = Assets.get(this.selectedAssetId!) as { width?: number; height?: number } | undefined;

    const child: AssetChild = {
      id: crypto.randomUUID(),
      name: `Asset`,
      childType: 'asset',
      visible: true,
      objectType: 'asset',
      assetId: this.selectedAssetId!,
      position: snapped,
      rotation: 0,
      scale: this.computeScaleFromAsset(this.selectedAssetId!),
      width: (assetTexture?.width ?? 256) / 256,
      height: (assetTexture?.height ?? 256) / 256,
      tint: '#ffffff',
      flipX: false,
      flipY: false,
    };

    undoManager.execute(new AddChildCommand('Place asset', layerId, child));

    if (!store.tools.settings.continuousPlacement) {
      this.cancel();
    }
    // If continuousPlacement: remain in PREVIEWING, same sprite follows cursor
  }

  /**
   * Derive cell width from texture dimensions.
   * 1 world unit = 1 grid cell = 256px at export resolution.
   */
  private computeScaleFromAsset(assetId: string): number {
    const texture = Assets.get(assetId) as { width?: number } | undefined;
    if (!texture?.width) return 1;
    return texture.width / 256;
  }

  /**
   * Create a 50%-opacity preview sprite in world space.
   *
   * Scaling: sprite.scale.set(1/256) maps each texture pixel to 1/256 world unit,
   * so a W-pixel-wide texture spans W/256 world units (= W/256 grid cells).
   */
  private createPreviewSprite(assetId: string): void {
    this.destroyPreviewSprite();
    const texture = Assets.get(assetId);
    if (!texture) return;

    const sprite = new Sprite(texture);
    sprite.alpha = 0.5;
    sprite.anchor.set(0.5);
    sprite.scale.set(1 / 256);
    this.worldContainer.addChild(sprite);
    this.previewSprite = sprite;
  }

  private destroyPreviewSprite(): void {
    if (this.previewSprite) {
      this.worldContainer.removeChild(this.previewSprite);
      this.previewSprite.destroy({ texture: false });
      this.previewSprite = null;
    }
  }

  private deactivate(): void {
    this.state = 'IDLE';
    this.selectedAssetId = null;
    this.destroyPreviewSprite();
  }
}

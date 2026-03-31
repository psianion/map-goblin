import { Graphics } from 'pixi.js';
import type { ToolType, DungeonStyle, LightDefaults } from '../store/types';

export interface PreviewSettings {
  tool: ToolType;
  style?: DungeonStyle;
  sides?: number;
  lightDefaults?: LightDefaults;
}

let previewGraphics: Graphics | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentSettings: PreviewSettings | null = null;
let visible = false;

const DEBOUNCE_MS = 500;
const SCREEN_SIZE_PX = 200;

export function initToolPreview(graphics: Graphics): void {
  previewGraphics = graphics;
  previewGraphics.label = 'toolSettingsPreview';
  previewGraphics.alpha = 0.6;
}

export function showToolPreview(settings: PreviewSettings): void {
  currentSettings = settings;
  visible = true;

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    visible = false;
    currentSettings = null;
    previewGraphics?.clear();
  }, DEBOUNCE_MS);
}

export function hideToolPreview(): void {
  visible = false;
  currentSettings = null;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  previewGraphics?.clear();
}

export function renderToolPreview(
  centerX: number,
  centerY: number,
  zoom: number,
): void {
  if (!previewGraphics || !visible || !currentSettings) {
    previewGraphics?.clear();
    return;
  }

  previewGraphics.clear();
  const s = currentSettings;
  const worldSize = SCREEN_SIZE_PX / zoom;

  if (s.tool === 'light' && s.lightDefaults) {
    renderLightPreview(previewGraphics, centerX, centerY, s.lightDefaults);
  } else if (s.tool === 'wall' && s.style) {
    renderWallPreview(previewGraphics, centerX, centerY, worldSize, s.style);
  } else if (s.style) {
    renderShapePreview(previewGraphics, centerX, centerY, worldSize, s.tool, s.style, s.sides);
  }
}

function renderShapePreview(
  g: Graphics,
  cx: number,
  cy: number,
  size: number,
  tool: ToolType,
  style: DungeonStyle,
  sides?: number,
): void {
  const floorColor = parseInt(style.floorColor.replace('#', ''), 16);
  const wallColor = parseInt(style.wallColor.replace('#', ''), 16);

  if (tool === 'regularPolygon' && sides && sides >= 3) {
    const radius = size / 2;
    const points: [number, number][] = [];
    for (let i = 0; i < sides; i++) {
      const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
      points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
    }
    g.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      g.lineTo(points[i][0], points[i][1]);
    }
    g.closePath();
  } else if (tool === 'polygon') {
    const r = size / 2;
    const offsets = [0, 0.9, 1.5, 2.3, 3.1, 4.0, 5.0];
    for (let i = 0; i < offsets.length; i++) {
      const angle = offsets[i] - Math.PI / 2;
      const vary = r * (0.7 + 0.3 * Math.sin(i * 2.1));
      const px = cx + Math.cos(angle) * vary;
      const py = cy + Math.sin(angle) * vary;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
  } else if (tool === 'path') {
    const halfW = size / 2;
    const halfH = size / 4;
    g.moveTo(cx - halfW, cy);
    g.lineTo(cx - halfW * 0.3, cy - halfH);
    g.lineTo(cx + halfW * 0.3, cy + halfH);
    g.lineTo(cx + halfW, cy);
    g.setStrokeStyle({ color: wallColor, width: style.wallWidth });
    g.stroke();
    return;
  } else {
    const w = size;
    const h = size * 0.6;
    g.rect(cx - w / 2, cy - h / 2, w, h);
  }

  g.fill(floorColor);
  if (style.shadowEnabled) {
    g.setStrokeStyle({ color: wallColor, width: style.wallWidth * 1.5 });
  } else {
    g.setStrokeStyle({ color: wallColor, width: style.wallWidth });
  }
  g.stroke();
}

function renderWallPreview(
  g: Graphics,
  cx: number,
  cy: number,
  size: number,
  style: DungeonStyle,
): void {
  const wallColor = parseInt(style.wallColor.replace('#', ''), 16);
  const halfW = size / 2;
  g.moveTo(cx - halfW, cy);
  g.lineTo(cx + halfW, cy);
  g.setStrokeStyle({ color: wallColor, width: style.wallWidth });
  g.stroke();
}

function renderLightPreview(
  g: Graphics,
  cx: number,
  cy: number,
  defaults: LightDefaults,
): void {
  const color = parseInt(defaults.color.replace('#', ''), 16);
  const radius = defaults.radius;

  g.circle(cx, cy, radius);
  g.fill({ color, alpha: defaults.intensity * 0.3 });

  if (defaults.featherRadius > 0) {
    g.circle(cx, cy, defaults.featherRadius);
    g.fill({ color, alpha: defaults.intensity * 0.6 });
  }

  g.circle(cx, cy, radius * 0.05);
  g.fill({ color, alpha: 0.9 });
}

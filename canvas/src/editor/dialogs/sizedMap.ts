// What a sized map is made with: the standard grid sizes, and the base ground choices. The
// New map and Map settings dialogs both read these (their fields are in MapSizeGround.tsx),
// and the map made at first boot takes the defaults with no dialog to ask.

import { defaultGroundId, groundTextureIds, materialLabel } from '@dnd/core/src/assets/materialKit';
import type { BaseGround } from '@dnd/core/src/shared/types';
import { useStore } from '@/store/store';
import { startAssetBoot } from '@/canvas/assetLoading';
import type { Swatch } from '@/editor/SwatchPicker';

/** The standard sizes, in squares; `custom` types its own. */
export const SIZE_PRESETS = [
  { value: '20x20', width: 20, height: 20 },
  { value: '25x25', width: 25, height: 25 },
  { value: '30x30', width: 30, height: 30 },
  { value: '30x20', width: 30, height: 20 },
  { value: '40x30', width: 40, height: 30 },
] as const;
export const SIZE_CUSTOM = 'custom';
export const DEFAULT_SIZE_PRESET = '30x30';

/** The preset a size is, or Custom. */
export function presetOf(size: { width: number; height: number } | null | undefined): string {
  return SIZE_PRESETS.find((p) => p.width === size?.width && p.height === size?.height)?.value ?? SIZE_CUSTOM;
}

/** The size a preset names; null for Custom. */
export function presetSize(preset: string): { width: number; height: number } | null {
  const p = SIZE_PRESETS.find((x) => x.value === preset);
  return p ? { width: p.width, height: p.height } : null;
}

/** The ground choices that are not a texture. */
export const GROUND_PLAIN = 'plain';
export const GROUND_NONE = 'none';
const PLAIN_COLOR = '#ffffff';

/** Every ground a map can start covered by: the pack's outdoor ground textures, then Plain (white) and None. */
export function groundSwatches(): Swatch[] {
  return [
    ...groundTextureIds().map((id) => ({ value: id, label: materialLabel(id), art: id })),
    { value: GROUND_PLAIN, label: 'Plain' },
    { value: GROUND_NONE, label: 'None' },
  ];
}

/** The choice a new map starts on: grass, or Plain while no pack has a ground texture. */
export function defaultGroundChoice(): string {
  return defaultGroundId() ?? GROUND_PLAIN;
}

export function groundToChoice(ground: BaseGround | null | undefined): string {
  if (!ground) return GROUND_NONE;
  return ground.textureId ?? (ground.color ? GROUND_PLAIN : GROUND_NONE);
}

export function choiceToGround(choice: string): BaseGround | null {
  if (choice === GROUND_NONE) return null;
  return choice === GROUND_PLAIN ? { color: PLAIN_COLOR } : { textureId: choice };
}

/**
 * What the map made at first boot takes, with no dialog to ask: the default size, kept, and
 * grass. The packs may not be in yet on a first boot; the map then starts on Plain and takes
 * the grass once they land, if nothing else was picked meanwhile.
 */
export function applyBlankMapDefaults(): void {
  const store = useStore.getState();
  const size = presetSize(DEFAULT_SIZE_PRESET);
  if (size) store.setFixedSize({ ...size, locked: true });
  const choice = defaultGroundChoice();
  store.setMapGround(choiceToGround(choice));
  if (choice !== GROUND_PLAIN) return;
  const mapId = store.activeMapId;
  void startAssetBoot().then(() => {
    const now = useStore.getState();
    const grass = defaultGroundId();
    if (!grass || now.activeMapId !== mapId || groundToChoice(now.mapSettings.ground) !== GROUND_PLAIN) return;
    now.setMapGround({ textureId: grass });
    void now.saveCurrentMap();
  });
}

// The DM's sight preview, as the two DM surfaces that toggle it see it: the Tokens popover's
// detail footer and the on-map `TokenMenu`. One reading of "can this token's sight be
// previewed right now, and why not", so the two buttons cannot disagree.
//
// The preview is local to the DM's tab (`useTokenInteraction.previewSight`) and draws on the
// DM's own fog layer (`fogScene`); a player's seat never reads the flag and is sent nothing
// for it.

import { fogModeOf, type FogState } from '@dnd/mechanics/fog';
import type { Token } from '@dnd/mechanics/tokens';
import { useSessionStore } from '../../session/store';
import { useTokenInteraction } from './drag';

export interface SightPreview {
  /** The preview is on. It only draws anything while `reason` is null. */
  on: boolean;
  /** Why the preview would draw nothing for this token — the button's title, and disabled. */
  reason: string | null;
  toggle: () => void;
}

export function useSightPreview(token: Token | undefined): SightPreview {
  const on = useTokenInteraction((s) => s.previewSight);
  const setPreviewSight = useTokenInteraction((s) => s.setPreviewSight);
  const visionMode = useSessionStore((s) => {
    const sceneId = s.session?.activeSceneId;
    const fog = s.session?.modules?.fog as FogState | undefined;
    const scene = sceneId ? fog?.byScene?.[sceneId] : undefined;
    return scene ? fogModeOf(scene) === 'vision' : false;
  });
  const reason = !visionMode
    ? 'Fog is in Rooms mode — switch it to Vision to preview sight'
    : token && token.sight == null
      ? `${token.name} has no sight to preview`
      : null;
  return { on, reason, toggle: () => setPreviewSight(!on) };
}

// Table fix pass §4.2 (F21): arming a token placement, a fog tool or a template used to change
// nothing on screen, so the next map click surprised the DM (a second Bram). The dock folds to
// its tab row and one chip above it names the tool and the way out.

import type { TokensState } from '@dnd/mechanics/tokens';
import { useTokenInteraction } from '../../modules/tokens/drag';
import { useModuleState } from '../../session/store';
import { useActiveTool } from '../../session/tools';

/** The armed tool's chip text, or null when nothing is armed that the chip speaks for. */
export function armedLabel(
  placingName: string | null,
  activeTool: string | null,
  toolDetail: string | null,
): string | null {
  if (placingName !== null) return `Placing ${placingName}, click the map, Esc cancels`;
  if (activeTool === 'fog') return toolDetail === 'Fog' ? 'Painting fog' : 'Clearing fog';
  if (activeTool === 'template') return 'Template';
  return null;
}

/** The chip text, live. */
export function useArmedLabel(): string | null {
  const placingDefId = useTokenInteraction((s) => s.placingDefId);
  const tokens = useModuleState<TokensState>('tokens');
  const activeTool = useActiveTool((s) => s.activeTool);
  const toolDetail = useActiveTool((s) => s.toolDetail);
  const placingName = placingDefId ? (tokens?.library?.[placingDefId]?.name ?? 'a token') : null;
  return armedLabel(placingName, activeTool, toolDetail);
}

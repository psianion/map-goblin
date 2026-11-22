import { useMemo } from 'react';
import { autoExploreOn, fogOn, type FogBrushOp, type FogState } from '@dnd/mechanics/fog';
import { useStore } from '@dnd/core/src/store/store';
import { SecondaryButton, SliderRow } from '@dnd/ui';
import { Ban, Cloud, CloudFog, CloudOff, Compass, Eraser } from '@dnd/ui/icons';
import { useModuleState, useSessionStore } from '../../session/store';
import { UNDO_TOAST_MS, showToast } from '../../session/toasts';
import { useActiveTool } from '../../session/tools';
import { armBrush, toggleBrush, useFogBrush } from './brush';
import { fogFrame, sceneFog } from './fog';
import { FogCard, FogZone, ZoneRule } from './FogCard';
import { foggedShare, groundOfMap } from './ground';

const send = (action: string, payload: unknown): void => useSessionStore.getState().sendCommand('fog', action, payload);

function useSceneFog() {
  const fogState = useModuleState<FogState>('fog');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  return sceneFog(fogState, sceneId);
}

/** "71% of the map": the share of the ground the players still have under fog. */
function useFoggedCaption(cleared: Parameters<typeof foggedShare>[1]): string {
  const mapData = useSessionStore((s) => s.mapData);
  const layers = useStore((s) => s.layers);
  const levels = useStore((s) => s.levels);
  const mapSettings = useStore((s) => s.mapSettings);
  const frame = useMemo(() => fogFrame(mapData), [mapData]);
  const ground = useMemo(() => (frame ? groundOfMap({ layers, levels, mapSettings }, frame) : null), [frame, layers, levels, mapSettings]);
  if (!frame || !ground) return 'Covers the map';
  return `${Math.round(foggedShare(ground, cleared, frame) * 100)}% of the map`;
}

/**
 * The Fog tab, across the whole dock: the switch, the two brushes with their size and the two
 * bulk acts, and Auto-explore. With fog off only the switch shows, with one line on what it does.
 */
export function FogBody() {
  const fog = useSceneFog();
  const on = fogOn(fog);
  const caption = useFoggedCaption(fog.cleared);
  const tool = useActiveTool((s) => s.activeTool);
  const op = useFogBrush((s) => s.op);
  const size = useFogBrush((s) => s.size);
  const armed = (which: FogBrushOp): boolean => tool === 'fog' && op === which;

  const switchFog = (): void => {
    send('set-on', { on: !on });
    // Turning it on hands the DM the brush, so the next act is clearing where the party starts.
    if (!on) armBrush('clear');
    else if (tool === 'fog') useActiveTool.getState().setActiveTool(null);
  };

  const bulk = (action: 'clear-all' | 'fog-all', message: string): void => {
    const before = fog.cleared ?? {};
    send(action, {});
    showToast({ message, durationMs: UNDO_TOAST_MS, action: { label: 'Undo', onAction: () => send('restore', { cleared: before }) } });
  };

  const fogCard = (
    <FogZone label="Fog">
      <FogCard
        title="Fog"
        caption={on ? caption : 'Nothing is hidden'}
        on={on}
        icon={CloudOff}
        onIcon={Cloud}
        className="w-[118px] flex-1"
        onClick={switchFog}
        data-testid="fog-switch"
      />
    </FogZone>
  );

  if (!on) {
    return (
      <div className="flex h-full items-stretch gap-3.5" data-testid="fog-body" data-fog="off">
        {fogCard}
        <ZoneRule />
        <div className="flex max-w-[520px] flex-col justify-center gap-1 pl-1.5">
          <p className="text-[13px] font-medium text-text">Turn fog on to cover the map.</p>
          <p className="text-xs leading-snug text-text-2">
            The brush arms itself on Clear, so the next thing you do is paint the ground where the party starts. Brush, Auto-explore and Look appear here once fog is on.
          </p>
        </div>
      </div>
    );
  }

  const exploring = autoExploreOn(fog);
  return (
    <div className="flex h-full items-stretch gap-3.5" data-testid="fog-body" data-fog="on">
      {fogCard}
      <ZoneRule />
      <FogZone label="Brush">
        <div className="flex flex-1 gap-2">
          <FogCard
            title="Clear"
            caption="Uncover ground"
            on={armed('clear')}
            icon={Eraser}
            shortcut="W"
            quiet
            className="w-[104px]"
            onClick={() => toggleBrush('clear')}
            data-testid="fog-brush-clear"
          />
          <FogCard
            title="Fog"
            caption="Cover it again"
            on={armed('fog')}
            icon={CloudFog}
            shortcut="⇧W"
            quiet
            className="w-[104px]"
            onClick={() => toggleBrush('fog')}
            data-testid="fog-brush-fog"
          />
          <div className="flex w-[190px] flex-col justify-between">
            <div className="flex flex-col gap-1">
              <SliderRow
                label="Size"
                value={size}
                min={1}
                max={5}
                step={1}
                format={(v) => (v === 1 ? '1 cell' : `${v} cells`)}
                onValueChange={(v) => useFogBrush.getState().setSize(v)}
                className="w-full"
              />
              <span className="text-[11px] text-text-3">Hold Alt to paint the other way.</span>
            </div>
            <div className="flex gap-1.5">
              <SecondaryButton data-testid="fog-clear-all" onClick={() => bulk('clear-all', 'Cleared the fog from the whole map.')}>
                Clear all
              </SecondaryButton>
              <SecondaryButton data-testid="fog-fog-all" onClick={() => bulk('fog-all', 'Fogged the whole map.')}>
                Fog all
              </SecondaryButton>
            </div>
          </div>
        </div>
      </FogZone>
      <ZoneRule />
      <FogZone label="Party">
        <FogCard
          title="Auto-explore"
          caption={exploring ? 'Tokens clear what they see' : 'Only your brush clears'}
          on={exploring}
          icon={Ban}
          onIcon={Compass}
          className="w-[148px] flex-1"
          onClick={() => send('set-auto-explore', { autoExplore: !exploring })}
          data-testid="fog-auto-explore"
        />
      </FogZone>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Button, Input, PrimaryButton, cn } from '@dnd/ui';
import { usePreparedScenes, prepareScene, switchScene } from '../../modules/scene/prepared';
import { SceneThumb } from '../../modules/scene/SceneThumb';
import { useSceneLibrary } from '../../modules/scene/store';
import { useSessionStore } from '../../session/store';

/**
 * The title card's scene switcher (DM): search, every scene as a thumbnail row, Switch now
 * and Prepare. The library comes over REST; the wire's own list stands in until it lands.
 */
export function SceneSwitcher({ onDone }: { onDone?: () => void }) {
  const library = useSceneLibrary((s) => s.scenes);
  const wire = useSessionStore((s) => s.session?.scenes ?? []);
  const activeId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const ready = usePreparedScenes((s) => s.ready);
  const pending = usePreparedScenes((s) => s.pending);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void useSceneLibrary.getState().refresh();
  }, []);

  const scenes = (library.length > 0 ? library : wire).filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="flex flex-col gap-2" data-testid="scene-switcher">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a scene"
        aria-label="Find a scene"
        data-testid="scene-search"
      />
      <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
        {scenes.length === 0 && <li className="px-1 py-2 text-xs text-text-3">No scenes match.</li>}
        {scenes.map((s) => {
          const live = s.id === activeId;
          const isReady = ready[s.id] === s.mapId;
          return (
            <li key={s.id} className="flex items-center gap-2 rounded-control px-1 py-1 hover:bg-panel-2" data-testid="scene-row">
              <SceneThumb scene={s} className="flex h-9 w-12 shrink-0 items-center justify-center rounded-key border border-line bg-panel-2 text-xs text-text-3" />
              <span className="min-w-0 flex-1 truncate text-xs text-text">{s.name}</span>
              {live ? (
                <span className="rounded-pill border border-ink px-2 text-xs text-text" data-testid="scene-live">
                  Live
                </span>
              ) : (
                <>
                  {isReady && (
                    <span className="rounded-pill border border-line px-2 text-xs text-text-2" data-testid="scene-ready">
                      Ready
                    </span>
                  )}
                  {!isReady && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!pending[s.id]}
                      className={cn(pending[s.id] && 'opacity-60')}
                      data-testid="scene-prepare"
                      onClick={() => void prepareScene(s.id, s.mapId)}
                    >
                      Prepare
                    </Button>
                  )}
                  <PrimaryButton
                    className="h-6 px-2.5 text-xs"
                    data-testid="scene-switch"
                    onClick={() => {
                      switchScene(s.id);
                      onDone?.();
                    }}
                  >
                    Switch now
                  </PrimaryButton>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { MAP_FILE_ACCEPT } from '@dnd/core/src/shared/mapFile';
import { Button, Caption, Input, PrimaryButton, SwitchRow, cn } from '@dnd/ui';
import { useSessionStore } from '../../session/store';
import { prepareScene, switchScene, usePreparedScenes } from './prepared';
import { SceneThumb } from './SceneThumb';
import { useSceneLibrary } from './store';

/** The scene the Scenes tab has picked, for its Rename / Replace / Delete. */
const usePickedScene = create<{ id: string | null }>()(() => ({ id: null }));

function FilePick({ label, testId, onFile }: { label: string; testId: string; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button variant="outline" size="sm" data-testid={testId} onClick={() => input.current?.click()}>
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        accept={MAP_FILE_ACCEPT}
        className="hidden"
        data-testid={`${testId}-input`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
    </>
  );
}

/** Board 19, left: import a map, and the picked scene's Rename, Replace, visibility and Delete. */
export function ScenesBody() {
  const scenes = useSceneLibrary((s) => s.scenes);
  const busy = useSceneLibrary((s) => s.busy);
  const error = useSceneLibrary((s) => s.error);
  const pickedId = usePickedScene((s) => s.id);
  const picked = scenes.find((s) => s.id === pickedId) ?? null;
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void useSceneLibrary.getState().refresh();
  }, []);

  const lib = useSceneLibrary.getState;
  return (
    <div className="flex flex-col gap-2" data-testid="scenes-body">
      <div className="flex gap-1">
        <FilePick label="Import file" testId="scene-import" onFile={(f) => void lib().upload(f)} />
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {picked ? (
        <div className="flex flex-col gap-2" data-testid="scene-picked">
          <Caption>{picked.name}</Caption>
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void lib().rename(picked.id, name);
              setName('');
            }}
          >
            <Input value={name} placeholder="New name" aria-label="Rename the scene" data-testid="scene-rename" onChange={(e) => setName(e.target.value)} />
            <Button type="submit" variant="outline" size="sm" disabled={busy || !name.trim()}>
              Rename
            </Button>
          </form>
          <div className="flex gap-1">
            <FilePick label="Replace map" testId="scene-replace" onFile={(f) => void lib().republish(picked.id, f)} />
          </div>
          <SwitchRow label="Players can see it" className="w-full" checked={picked.visibleToPlayers} onCheckedChange={() => void lib().toggleVisible(picked)} />
          {confirmDelete ? (
            <div className="flex flex-col gap-1" data-testid="scene-delete-confirm">
              <p className="text-xs text-text-2">Fog, tokens and notes go too.</p>
              <div className="flex gap-1">
                <Button
                  variant="destructive"
                  size="sm"
                  data-testid="scene-delete-yes"
                  onClick={() => {
                    void lib().remove(picked.id);
                    usePickedScene.setState({ id: null });
                    setConfirmDelete(false);
                  }}
                >
                  Delete {picked.name}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="destructive" size="sm" className="self-start" data-testid="scene-delete" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-text-3">Pick a scene to rename, replace or delete it.</p>
      )}
    </div>
  );
}

/** Board 19, right: every scene, Live or Ready, with Switch now and Prepare. */
export function ScenesStrip() {
  const library = useSceneLibrary((s) => s.scenes);
  const activeId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const ready = usePreparedScenes((s) => s.ready);
  const pending = usePreparedScenes((s) => s.pending);
  const pickedId = usePickedScene((s) => s.id);
  if (library.length === 0) return <p className="text-xs text-text-3">No scenes yet. Import a map file.</p>;
  return (
    <ul className="flex gap-2" data-testid="scenes-strip">
      {library.map((s) => {
        const live = s.id === activeId;
        const isReady = ready[s.id] === s.mapId;
        return (
          <li
            key={s.id}
            data-testid="scene-card"
            data-scene-id={s.id}
            className={cn('flex w-40 shrink-0 flex-col gap-1 rounded-control border border-line p-1.5', pickedId === s.id && 'ring-1 ring-inset ring-ink')}
          >
            <button type="button" className="flex flex-col gap-1 text-left" onClick={() => usePickedScene.setState({ id: s.id })}>
              <SceneThumb scene={s} className="flex h-14 items-center justify-center rounded-key border border-line bg-panel-2 text-sm text-text-3" />
              <span className="truncate text-xs text-text">{s.name}</span>
            </button>
            <div className="flex flex-wrap items-center gap-1">
              {live && (
                <span className="rounded-pill border border-ink px-2 text-xs text-text" data-testid="scene-live">
                  Live
                </span>
              )}
              {!live && isReady && (
                <span className="rounded-pill border border-line px-2 text-xs text-text-2" data-testid="scene-ready">
                  Ready
                </span>
              )}
              {!s.visibleToPlayers && <span className="text-xs text-text-3">Hidden</span>}
            </div>
            {!live && (
              <div className="flex gap-1">
                <PrimaryButton className="h-6 px-2 text-xs" data-testid="scene-switch" onClick={() => switchScene(s.id)}>
                  Switch now
                </PrimaryButton>
                {!isReady && (
                  <Button variant="outline" size="xs" disabled={!!pending[s.id]} data-testid="scene-prepare" onClick={() => void prepareScene(s.id, s.mapId)}>
                    Prepare
                  </Button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

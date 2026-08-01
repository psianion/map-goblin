import { useSessionStore } from '../session/store';
import { registerPanel } from '../session/panels';

/**
 * #47 D5 — what the DM has published *and* made visible, before a scene loads. Read-only:
 * only the DM switches scenes (`SessionControls`'s `scenes:activate`), so there is no
 * button here to press — this is a preview of what is coming, not a picker.
 *
 * The list itself is already the server's redacted answer (`SessionManager.snapshot`
 * filters `session.scenes` to `visibleToPlayers` before it reaches this viewer at all —
 * a scene the DM has not opted in never arrives on this socket), so there is nothing left
 * to hide client-side.
 */
export function PlayerScenes() {
  const scenes = useSessionStore((s) => s.session?.scenes);
  const activeSceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);

  if (!scenes || scenes.length === 0) {
    return <p className="text-sm text-neutral-500">The DM hasn’t published a scene yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-1" data-testid="player-scene-list">
      {scenes.map((scene) => (
        <li
          key={scene.id}
          aria-current={scene.id === activeSceneId}
          className={`flex items-center gap-2 truncate rounded px-2 py-1 text-sm ${
            scene.id === activeSceneId ? 'text-neutral-100' : 'text-neutral-500'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              scene.id === activeSceneId ? 'bg-emerald-400' : 'bg-neutral-700'
            }`}
            aria-hidden
          />
          <span className="truncate">{scene.name}</span>
          {scene.id === activeSceneId && <span className="ml-auto text-xs text-neutral-500">now playing</span>}
        </li>
      ))}
    </ul>
  );
}

registerPanel({
  id: 'player-scenes',
  title: 'Scenes',
  roles: ['player'],
  order: 5,
  component: PlayerScenes,
});

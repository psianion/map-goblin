import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { WEATHERS, vocabLabel, type Weather } from '@dnd/core/src/shared/prep';
import type { TriggersState } from '@dnd/mechanics/triggers';
import { sceneTriggersOf } from '@dnd/mechanics/triggers';
import type { SceneMeta } from '../../session/auth';
import { registerPanel } from '../../session/panels';
import { useModuleState, useSessionStore } from '../../session/store';
import { Icon } from '../../shell/icons';
import { Portal } from '../../shell/Portal';
import { useSceneLibrary } from './store';

/**
 * §2.4.2 — the DM's corner of the table: the scene library (activate, visibility, rename,
 * reorder, replace, delete — the last four behind the row's own `⋯` menu) and, for whichever
 * scene is live, its weather. Invite code and roster moved into the Session popover (M1);
 * map import moved into this popover's footer (M3 §Scene).
 */

// No-scroll ledger (docs/2026-08-22-table-shell-plan.md): 8 rows at 32px fit with the
// weather row, header and footer. Past that the rows compact to 28px.
const DENSE_AT = 9;

const textInput =
  'h-6 min-w-0 flex-1 rounded border border-border-default bg-surface-0 px-1.5 text-[13px] text-text-primary focus:border-border-focus focus:outline-none';
const selectInput =
  'h-7 min-w-0 flex-1 rounded border border-border-default bg-surface-0 px-2 text-[13px] text-text-primary focus:border-border-focus focus:outline-none';
const rowIconBtn =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-secondary transition-colors duration-150 ease-settle hover:bg-surface-3 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';
const menuItem =
  'flex h-7 w-full shrink-0 items-center rounded px-2 text-left text-xs text-text-secondary transition-colors duration-150 ease-settle hover:bg-surface-2 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';

/** Raw module state, read outside React — what `subtitle` needs. */
function sceneSubtitle(): string {
  return `${useSceneLibrary.getState().scenes.length} in this campaign`;
}

/** Fallback width — jsdom lays nothing out, and the very first paint, so `offsetWidth` isn't
 *  trustworthy yet. `w-44` below. */
const MENU_FALLBACK_WIDTH = 176;
const MENU_GAP = 4;

/** Below-right of `btn` (right edges aligned, matching the old `absolute right-0 top-full`);
 *  flips above when the menu would cross the viewport's bottom edge (M3 review finding 1). */
function placeRowMenu(btn: HTMLElement, menu: HTMLElement | null): { top: number; left: number } {
  const rect = btn.getBoundingClientRect();
  const width = menu?.offsetWidth || MENU_FALLBACK_WIDTH;
  const height = menu?.offsetHeight ?? 0;
  const openUp = rect.bottom + MENU_GAP + height > window.innerHeight;
  return {
    left: Math.max(4, rect.right - width),
    top: openUp ? Math.max(4, rect.top - MENU_GAP - height) : rect.bottom + MENU_GAP,
  };
}

/**
 * The `⋯` button and its dropdown: Rename, Move up/down, Replace map, Delete (with an
 * in-popover confirm, never `window.confirm`).
 *
 * The visible menu renders through a `Portal` to `document.body` (M3 review finding 1) —
 * `scene-list`, `popover-body` and `popover` all clip with `overflow-hidden`, so a menu
 * positioned inside the row was never reachable past the third or fourth row. `Portal` keeps
 * it a React descendant of this component in every way that isn't the physical DOM (context,
 * event bubbling through the React tree), which is why `Popover`'s own "click outside closes
 * it" listener still treats a click in here as inside; the `stopPropagation` below is belt
 * and braces for that, matching every other on-map/overlay menu's own convention.
 *
 * The hidden "Replace map" file input stays mounted in the row itself, never inside the
 * portal — `scene-switch.spec.ts` drives it directly with `setInputFiles` without ever
 * opening this menu, so it must be attached (if invisible) start to finish, menu open or
 * not. The portal's own "Replace map" item just forwards a click to it.
 */
function SceneRowMenu({
  scene,
  busy,
  canMoveUp,
  canMoveDown,
  onRename,
  onMoveUp,
  onMoveDown,
  onReplace,
  onDelete,
}: {
  scene: SceneMeta;
  busy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onReplace: (file: File) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const close = () => {
    setOpen(false);
    setConfirming(false);
  };

  // Measured after the portal has committed (same render, before paint), and again whenever
  // the confirm row changes the menu's own height, or the window resizes under it.
  useLayoutEffect(() => {
    if (!open) return;
    const recalc = () => {
      if (btnRef.current) setPos(placeRowMenu(btnRef.current, menuRef.current));
    };
    recalc();
    window.addEventListener('resize', recalc);
    return () => window.removeEventListener('resize', recalc);
  }, [open, confirming]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // This menu's own Escape, not the popover's — without this, the popover's bubble-phase
      // listener (which only backs off when `defaultPrevented`) would take the whole popover
      // down too. Capture runs ahead of that bubble-phase listener regardless of DOM position.
      e.preventDefault();
      close();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);

  return (
    <div className="shrink-0">
      <button
        ref={btnRef}
        type="button"
        aria-label={`More actions for ${scene.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={`scene-more-${scene.id}`}
        onClick={() => (open ? close() : setOpen(true))}
        className={rowIconBtn}
      >
        <Icon name="more" size={15} />
      </button>

      <label className="hidden">
        Replace map
        <input
          ref={fileInputRef}
          type="file"
          accept=".mapbuilder,.json,application/json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onReplace(file);
          }}
        />
      </label>

      {open && (
        <Portal>
          <div
            ref={menuRef}
            role="menu"
            data-testid={`scene-menu-${scene.id}`}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className="fixed z-toolbar flex w-44 flex-col gap-0.5 rounded border border-border-structure bg-surface-1 p-1 shadow-panel motion-safe:animate-panel-in"
          >
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                close();
                onRename();
              }}
              className={menuItem}
            >
              Rename
            </button>
            <button
              type="button"
              aria-label="Move up"
              disabled={busy || !canMoveUp}
              onClick={() => {
                close();
                onMoveUp();
              }}
              className={menuItem}
            >
              Move up
            </button>
            <button
              type="button"
              aria-label="Move down"
              disabled={busy || !canMoveDown}
              onClick={() => {
                close();
                onMoveDown();
              }}
              className={menuItem}
            >
              Move down
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                close();
                fileInputRef.current?.click();
              }}
              className={menuItem}
            >
              Replace map
            </button>
            {confirming ? (
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    close();
                    onDelete();
                  }}
                  className={`${menuItem} flex-1 text-danger`}
                >
                  Delete {scene.name}?
                </button>
                <button type="button" onClick={() => setConfirming(false)} className={menuItem}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(true)}
                className={`${menuItem} text-danger`}
              >
                Delete
              </button>
            )}
          </div>
        </Portal>
      )}
    </div>
  );
}

function SceneRow({
  scene,
  index,
  total,
  dense,
  active,
  busy,
  renaming,
  renameValue,
  setRenameValue,
  onActivate,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onToggleVisible,
  onMoveUp,
  onMoveDown,
  onReplace,
  onDelete,
}: {
  scene: SceneMeta;
  index: number;
  total: number;
  dense: boolean;
  active: boolean;
  busy: boolean;
  renaming: boolean;
  renameValue: string;
  setRenameValue: (value: string) => void;
  onActivate: () => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onToggleVisible: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onReplace: (file: File) => void;
  onDelete: () => void;
}) {
  return (
    <li
      data-testid={`scene-row-${scene.id}`}
      className={`flex items-center gap-2 px-1.5 ${dense ? 'h-7' : 'h-8'} ${
        active ? 'rounded bg-surface-3' : 'border-b border-border-subtle last:border-b-0'
      }`}
    >
      {/* Radio disc — purely a visual echo of `aria-current` on the name button below;
          the button is what carries the real activation semantics (and what the e2e specs
          click by accessible name), same as before this became a popover. */}
      <span
        aria-hidden
        className={`flex h-3 w-3 shrink-0 items-center justify-center rounded-full border ${
          active ? 'border-accent-active' : 'border-text-muted'
        }`}
      >
        {active && <span className="h-1.5 w-1.5 rounded-full bg-accent-active" />}
      </span>

      {renaming ? (
        <input
          autoFocus
          className={textInput}
          value={renameValue}
          disabled={busy}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitRename();
            if (e.key === 'Escape') onCancelRename();
          }}
          onBlur={onCommitRename}
        />
      ) : (
        <button
          type="button"
          data-scene-id={scene.id}
          aria-current={active}
          onClick={onActivate}
          className={`min-w-0 flex-1 truncate rounded text-left text-[13px] ${
            active ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {scene.name}
        </button>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          data-testid={`scene-visible-${scene.id}`}
          aria-label={scene.visibleToPlayers ? 'Hide from players' : 'Show to players'}
          aria-pressed={scene.visibleToPlayers}
          disabled={busy}
          onClick={onToggleVisible}
          className={rowIconBtn}
        >
          <Icon name={scene.visibleToPlayers ? 'reveal' : 'hide'} size={15} />
        </button>
        <SceneRowMenu
          scene={scene}
          busy={busy}
          canMoveUp={index > 0}
          canMoveDown={index < total - 1}
          onRename={onStartRename}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onReplace={onReplace}
          onDelete={onDelete}
        />
      </div>
    </li>
  );
}

export function ScenePanel() {
  const activeSceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  // The wire's own thin scene list already resends live on any scene mutation in this
  // campaign (`refreshScenes`, server-side) — including a publish from the map editor in
  // another tab. Its identity only changes when that happens (or on the join snapshot), so
  // keying the refetch off it covers "library changed elsewhere" for free, no poll needed.
  const wireScenes = useSessionStore((s) => s.session?.scenes);
  const scenes = useSceneLibrary((s) => s.scenes);
  const busy = useSceneLibrary((s) => s.busy);
  const refresh = useSceneLibrary((s) => s.refresh);
  const rename = useSceneLibrary((s) => s.rename);
  const toggleVisible = useSceneLibrary((s) => s.toggleVisible);
  const move = useSceneLibrary((s) => s.move);
  const remove = useSceneLibrary((s) => s.remove);
  const republish = useSceneLibrary((s) => s.republish);

  // One fetch on mount, plus one whenever the wire's own scene list changes underneath —
  // every mutation *this panel* makes also refetches itself (via the store's `run`), so this
  // only ever fires again for a change nobody at this table clicked. `refresh` is a zustand
  // action (stable identity), so listing it here never adds an extra run.
  useEffect(() => void refresh(), [wireScenes, refresh]);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const activate = (sceneId: string) => {
    if (sceneId === activeSceneId) return;
    useSessionStore.getState().sendCommand('scenes', 'activate', { sceneId });
  };

  const commitRename = (sceneId: string) => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (name) void rename(sceneId, name);
  };

  // P2 — weather is what is left of the environment triad here. The hour is the campaign's
  // world clock and the light level is the vision gate's override, and both of those live in
  // the World block now: one clock for the world beats a per-scene narration dial that said a
  // different time than the sky did.
  const triggersState = useModuleState<TriggersState>('triggers');
  const env = activeSceneId && triggersState ? sceneTriggersOf(triggersState, activeSceneId).env : {};

  // Optimistic echo: the select shows its own pending pick the instant it's clicked rather
  // than snapping back to `env` until the server's broadcast round-trips. Cleared once `env`
  // catches up, and on scene switch — a pending pick from the scene you just left has no
  // business showing on the one you switched to.
  //
  // Both resets are adjusted during render (React's own "reset state when a value changes"
  // idiom — see the docs on "You Might Not Need An Effect") rather than in a `useEffect`:
  // landing in the same commit as the change it reacts to instead of one paint later, and it
  // sidesteps `react-hooks/set-state-in-effect` honestly instead of suppressing it. The ref
  // itself stays out of the render body (`react-hooks/refs` — reading a ref during render is
  // its own lint error) and is only ever touched from the effect below or the event handler.
  const PENDING_TIMEOUT_MS = 4000;
  const [pending, setPending] = useState<Weather | undefined>();
  const pendingTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [prevSceneId, setPrevSceneId] = useState(activeSceneId);
  if (prevSceneId !== activeSceneId) {
    setPrevSceneId(activeSceneId);
    setPending(undefined);
  }

  const [prevEnvWeather, setPrevEnvWeather] = useState(env.weather);
  if (prevEnvWeather !== env.weather) {
    setPrevEnvWeather(env.weather);
    setPending((p) => (p === env.weather ? undefined : p));
  }

  // The cleanup (not the body) is the point: it fires both when `activeSceneId` is about to
  // change (clearing the outgoing scene's timeout) and on unmount — one effect covers what
  // used to be two.
  useEffect(() => () => clearTimeout(pendingTimeout.current), [activeSceneId]);

  const weather = pending ?? env.weather;

  const setWeather = (value: Weather) => {
    setPending(value);
    clearTimeout(pendingTimeout.current);
    pendingTimeout.current = setTimeout(() => setPending(undefined), PENDING_TIMEOUT_MS);
    useSessionStore.getState().sendCommand('triggers', 'set-environment', { weather: value });
  };

  const dense = scenes.length >= DENSE_AT;

  return (
    <div data-testid="scene-panel" className="flex flex-col gap-2 text-sm">
      {scenes.length === 0 ? (
        <p className="text-sm text-text-muted">No maps published yet.</p>
      ) : (
        <ul data-testid="scene-list" className="flex flex-col overflow-hidden">
          {scenes.map((scene, index) => (
            <SceneRow
              key={scene.id}
              scene={scene}
              index={index}
              total={scenes.length}
              dense={dense}
              active={scene.id === activeSceneId}
              busy={busy}
              renaming={renamingId === scene.id}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              onActivate={() => activate(scene.id)}
              onStartRename={() => {
                setRenamingId(scene.id);
                setRenameValue(scene.name);
              }}
              onCommitRename={() => commitRename(scene.id)}
              onCancelRename={() => setRenamingId(null)}
              onToggleVisible={() => void toggleVisible(scene)}
              onMoveUp={() => void move(index, -1)}
              onMoveDown={() => void move(index, 1)}
              onReplace={(file) => void republish(scene.id, file)}
              onDelete={() => void remove(scene.id)}
            />
          ))}
        </ul>
      )}

      {activeSceneId ? (
        <div className="flex items-center gap-2">
          <label htmlFor="env-weather-select" className="w-16 shrink-0 text-xs text-text-muted">
            Weather
          </label>
          <select
            id="env-weather-select"
            value={weather ?? ''}
            aria-label="Weather"
            data-testid="env-weather"
            onChange={(e) => e.target.value && setWeather(e.target.value as Weather)}
            className={selectInput}
          >
            {/* Off the table once set: the module only ever sets weather, never clears it. */}
            <option value="" disabled={weather !== undefined}>
              Not set
            </option>
            {WEATHERS.map((v) => (
              <option key={v} value={v}>
                {vocabLabel(v)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="text-sm text-text-muted">Activate a scene to set its environment.</p>
      )}
    </div>
  );
}

/**
 * The map editor's own publish is the primary way a scene gets here now (M3) — "Import map
 * file" here is the backup path for a file that never went through it, plus the working/error
 * state every mutation in this popover shares (M3 §Scene footer).
 */
export function SceneFooter() {
  const busy = useSceneLibrary((s) => s.busy);
  const error = useSceneLibrary((s) => s.error);
  const upload = useSceneLibrary((s) => s.upload);

  return (
    <>
      <label
        className={`flex h-7 shrink-0 items-center rounded border border-border-default bg-surface-2 px-2.5 text-xs text-text-primary transition-colors duration-150 ease-settle hover:bg-surface-3 motion-reduce:transition-none ${
          busy ? 'pointer-events-none opacity-40' : 'cursor-pointer'
        }`}
      >
        {busy ? 'Working…' : 'Import map file'}
        <input
          type="file"
          accept=".mapbuilder,.json,application/json"
          disabled={busy}
          aria-label="Import a map file"
          data-testid="scene-upload"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ''; // so re-picking the same file fires again
            if (file) void upload(file);
          }}
          className="hidden"
        />
      </label>
      <span className="flex-1" />
      <span className="text-[11px] text-text-muted">Rename · Replace · Delete under ⋯</span>
      {error && (
        <p role="alert" className="basis-full rounded border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger">
          {error}
        </p>
      )}
    </>
  );
}

registerPanel({
  id: 'session-controls',
  title: 'Scene',
  icon: 'scene',
  key: 'S',
  group: 'prep',
  roles: ['dm'],
  order: 50,
  component: ScenePanel,
  footer: SceneFooter,
  subtitle: sceneSubtitle,
});

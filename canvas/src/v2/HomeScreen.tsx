import { useCallback, useEffect, useRef, useState } from 'react';
import { Ellipsis, Moon, Plus, Sun, Trash2 } from 'lucide-react';
import { restoreLastDeletedMap } from '@dnd/core/src/store/slices/maps';
import { useStore } from '@/store/store';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ContextMenu, useContextMenu, type MenuRow } from '@/components/ui/context-menu';
import type { MapMeta } from '@/store/types';
import { NewMapModal } from './NewMapModal';
import { openMap } from './openMap';
import { timeAgo } from './format';
import { useTheme } from './theme';

/** How the editor comes up when the home page hands over to it. */
export interface EnterOptions {
  /** With the open map's settings dialog showing over it. */
  settings?: boolean;
}

interface HomeScreenProps {
  /** A map is open on the canvas and the DM wants to edit it. */
  onEnter: (options?: EnterOptions) => void;
}

/**
 * The v2 landing page: every saved map as a card, newest first, with a "+" card that
 * founds a new one. Sits over the editor rather than replacing it, so the canvas boots
 * underneath exactly as it does on the v1 route and is ready the moment a card is picked.
 */
export function HomeScreen({ onEnter }: HomeScreenProps) {
  const mapIndex = useStore((s) => s.mapIndex);
  const activeMapId = useStore((s) => s.activeMapId);
  const deleteMap = useStore((s) => s.deleteMap);
  const duplicateMap = useStore((s) => s.duplicateMap);
  const renameMap = useStore((s) => s.renameMap);
  const [theme, toggleTheme] = useTheme();

  const [newOpen, setNewOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuMapId, setMenuMapId] = useState<string | null>(null);
  const menu = useContextMenu();

  // The canvas listens for tool shortcuts on the document. While the home page is up,
  // a key pressed with nothing focused must not pick a tool underneath it; keys typed
  // into the page's own fields still get through to React. The card menu is portaled
  // out of the page, and hears its keys in the capture phase, ahead of this stop.
  useEffect(() => {
    const shield = (e: KeyboardEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.('[data-v2-home]')) return;
      e.stopPropagation();
    };
    document.addEventListener('keydown', shield, true);
    return () => document.removeEventListener('keydown', shield, true);
  }, []);

  const handleOpen = useCallback(
    async (id: string, options?: EnterOptions) => {
      if (opening) return;
      setOpening(id);
      try {
        if (await openMap(id)) onEnter(options);
      } finally {
        setOpening(null);
      }
    },
    [opening, onEnter],
  );

  const handleDuplicate = useCallback(
    async (id: string) => {
      try {
        const newId = await duplicateMap(id);
        const name = useStore.getState().mapIndex.find((m) => m.id === newId)?.name;
        notify.success(name ? `Duplicated as ${name}` : 'Duplicated');
      } catch (err) {
        console.error('[v2/HomeScreen] duplicate failed:', err);
        notify.error('Failed to duplicate map');
      }
    },
    [duplicateMap],
  );

  const handleRename = useCallback(
    async (id: string, next: string) => {
      setRenamingId(null);
      const trimmed = next.trim();
      const current = useStore.getState().mapIndex.find((m) => m.id === id)?.name;
      if (!trimmed || trimmed === current) return;
      try {
        await renameMap(id, trimmed);
        notify.success('Renamed');
      } catch (err) {
        console.error('[v2/HomeScreen] rename failed:', err);
        notify.error('Failed to rename map');
      }
    },
    [renameMap],
  );

  // `deleteMap` stashed the whole record; this puts exactly that back. Its contract: flush
  // the open map first (when the delete took the last map, the blank it made is only
  // removed if its stored record shows nothing was drawn in it), then patch the index here.
  const undoDelete = useCallback(async (wasActive: boolean) => {
    try {
      await useStore.getState().saveCurrentMap();
      const restored = await restoreLastDeletedMap();
      if (!restored) {
        notify.error('That map can no longer be restored');
        return;
      }
      const { meta, removedBlankId } = restored;
      useStore.setState((s) => {
        if (removedBlankId) s.mapIndex = s.mapIndex.filter((m) => m.id !== removedBlankId);
        s.mapIndex.push(meta);
      });
      // It was the open map: open it again, so the badge is back where it was.
      if (wasActive) await openMap(meta.id);
      notify.success('Map restored');
    } catch (err) {
      console.error('[v2/HomeScreen] restore failed:', err);
      notify.error('Failed to restore map');
    }
  }, []);

  const confirmDelete = useCallback(async () => {
    const id = pendingDeleteId;
    if (!id) return;
    setPendingDeleteId(null);
    const wasActive = useStore.getState().activeMapId === id;
    try {
      await deleteMap(id);
      notify.action('Map deleted', {
        label: 'Undo',
        onClick: () => void undoDelete(wasActive),
        icon: 'trash',
      });
    } catch (err) {
      console.error('[v2/HomeScreen] delete failed:', err);
      notify.error('Failed to delete map');
    }
  }, [pendingDeleteId, deleteMap, undoDelete]);

  const { openAt: openMenuAt, close: closeMenu } = menu;
  const showMenu = useCallback(
    (id: string, x: number, y: number) => {
      setMenuMapId(id);
      openMenuAt(x, y);
    },
    [openMenuAt],
  );

  const menuItems: MenuRow[] = menuMapId
    ? [
        { label: 'Open', onSelect: () => void handleOpen(menuMapId) },
        { label: 'Rename', onSelect: () => setRenamingId(menuMapId) },
        { label: 'Duplicate', onSelect: () => void handleDuplicate(menuMapId) },
        // Size and scale live in the document, so settings edit the open map: the card's map
        // is opened in the editor, and the editor's own dialog comes up over it.
        { label: 'Map settings…', onSelect: () => void handleOpen(menuMapId, { settings: true }) },
        { label: 'Delete', danger: true, separatorBefore: true, onSelect: () => setPendingDeleteId(menuMapId) },
      ]
    : [];

  const sorted = [...mapIndex].sort((a, b) => b.updatedAt - a.updatedAt);
  const pendingName = mapIndex.find((m) => m.id === pendingDeleteId)?.name ?? 'this map';

  return (
    <div className="v2-home v2-dots" data-v2-home="" data-testid="v2-home" onKeyDown={(e) => e.stopPropagation()}>
      <div className="v2-home__inner">
        <header className="v2-head">
          <div>
            <h1 className="v2-title">
              Good Goblin <em>Canvas</em>
            </h1>
            <p className="v2-sub">Pick up a map you were working on, or start a new one.</p>
          </div>
          <button
            type="button"
            className="v2-icon-btn"
            data-testid="v2-theme-toggle"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />}
          </button>
        </header>

        <section aria-labelledby="v2-recent">
          <div className="v2-section">
            <h2 id="v2-recent">Recent maps</h2>
            <span className="v2-count">
              {sorted.length} {sorted.length === 1 ? 'map' : 'maps'}
            </span>
          </div>

          <div className="v2-grid">
            <button
              type="button"
              className="v2-card v2-card--new"
              data-testid="v2-new-map-card"
              onClick={() => setNewOpen(true)}
            >
              <span className="v2-plus">
                <Plus size={16} strokeWidth={1.75} />
              </span>
              <strong>New map</strong>
              <span>Blank, image or VTT</span>
            </button>

            {sorted.map((map) => (
              <MapTile
                key={map.id}
                map={map}
                active={map.id === activeMapId}
                busy={opening === map.id}
                menuOpen={menu.pos !== null && menuMapId === map.id}
                renaming={renamingId === map.id}
                onOpen={() => void handleOpen(map.id)}
                onDelete={() => setPendingDeleteId(map.id)}
                onMenu={(x, y) => showMenu(map.id, x, y)}
                onStartRename={() => setRenamingId(map.id)}
                onRename={(next) => void handleRename(map.id, next)}
                onCancelRename={() => setRenamingId(null)}
              />
            ))}
          </div>
        </section>
      </div>

      <ContextMenu pos={menu.pos} onClose={closeMenu} items={menuItems} className="v2-ctx" captureKeys />

      <NewMapModal open={newOpen} onOpenChange={setNewOpen} onEnter={onEnter} />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title="Delete map?"
        message={`This will delete "${pendingName}" and everything on it.`}
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}

/**
 * A stored thumbnail on screen. The object URL is made and revoked inside one effect, so
 * every URL the image is pointed at is alive for as long as it is shown. Making it in a
 * render-time memo and revoking it in an effect cleanup broke under StrictMode: the dev
 * double-run revoked the memo's URL straight after mount and kept rendering it, so a card
 * whose image had not loaded by then came up broken after a reload.
 */
function Thumbnail({ blob }: { blob: Blob }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (!img) return;
    const url = URL.createObjectURL(blob);
    img.src = url;
    return () => {
      img.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
  }, [blob]);
  return <img ref={ref} alt="" draggable={false} />;
}

/** How long a click on a card's name waits to see whether it is the first of a double-click. */
const NAME_CLICK_DELAY_MS = 220;

/** Matches `.v2-ctx` min-width, so a menu opened from "…" lines up with the button's right edge. */
const MENU_WIDTH = 176;

interface MapTileProps {
  map: MapMeta;
  active: boolean;
  busy: boolean;
  menuOpen: boolean;
  renaming: boolean;
  onOpen: () => void;
  onDelete: () => void;
  /** Open the card menu with its top-left at this viewport point. */
  onMenu: (x: number, y: number) => void;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
}

function MapTile({
  map,
  active,
  busy,
  menuOpen,
  renaming,
  onOpen,
  onDelete,
  onMenu,
  onStartRename,
  onRename,
  onCancelRename,
}: MapTileProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const clickTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    },
    [],
  );

  // The menu hangs from the "…" button, right edges aligned, whichever way it was asked for.
  const menuFromButton = () => {
    const rect = moreRef.current?.getBoundingClientRect();
    if (rect) onMenu(rect.right - MENU_WIDTH, rect.bottom + 4);
  };

  const finishRename = (commit: boolean, value: string, refocus: boolean) => {
    if (commit) onRename(value);
    else onCancelRename();
    if (refocus) cardRef.current?.focus();
  };

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      aria-label={`Open ${map.name}`}
      aria-busy={busy || undefined}
      data-testid="v2-map-card"
      className={cn('v2-card', active && 'v2-card--active', menuOpen && 'v2-card--menu')}
      onClick={() => {
        if (!renaming) onOpen();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!renaming) onMenu(e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        // Keys pressed on the buttons inside the card are theirs.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault();
          menuFromButton();
        } else if (e.key === 'F2') {
          e.preventDefault();
          onStartRename();
        }
      }}
    >
      <div className="v2-card__preview v2-dots">
        {map.thumbnail ? <Thumbnail blob={map.thumbnail} /> : <span className="v2-card__empty">Empty</span>}
        {active && <span className="v2-card__badge">Open</span>}
      </div>
      <div className="v2-card__body">
        {renaming ? (
          <div className="v2-card__name v2-card__name--editing">
            <RenameField
              initial={map.name}
              onDone={(commit, value, viaKey) => finishRename(commit, value, viaKey)}
            />
          </div>
        ) : (
          <div
            className="v2-card__name"
            onClick={(e) => {
              // A double-click renames; give the first click a moment before it opens.
              e.stopPropagation();
              if (e.detail > 1) return;
              clickTimer.current = window.setTimeout(() => {
                clickTimer.current = null;
                onOpen();
              }, NAME_CLICK_DELAY_MS);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
              clickTimer.current = null;
              onStartRename();
            }}
          >
            {map.name}
          </div>
        )}
        <div className="v2-card__meta">Updated {timeAgo(map.updatedAt)}</div>
      </div>
      <button
        ref={moreRef}
        type="button"
        className="v2-card__more"
        aria-label={`More for ${map.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(e) => {
          e.stopPropagation();
          menuFromButton();
        }}
      >
        <Ellipsis size={14} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className="v2-card__delete"
        aria-label={`Delete ${map.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 size={13} strokeWidth={1.75} />
      </button>
    </div>
  );
}


/**
 * The card name, editable in place. Enter or leaving the field keeps the name, Escape
 * puts the old one back. Its keys and clicks stop here, so the card around it does not
 * open the map on Enter, Space or a click into the text.
 */
function RenameField({
  initial,
  onDone,
}: {
  initial: string;
  /** `viaKey`: ended from the keyboard, so focus goes back to the card. */
  onDone: (commit: boolean, value: string, viaKey: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (commit: boolean, viaKey: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(commit, value, viaKey);
  };

  return (
    <input
      ref={ref}
      className="v2-card__rename"
      aria-label="Map name"
      data-testid="v2-card-rename"
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true, true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false, true);
        }
      }}
      onBlur={() => finish(true, false)}
    />
  );
}

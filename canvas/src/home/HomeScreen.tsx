import { useCallback, useEffect, useRef, useState } from 'react';
import { Ellipsis, Moon, Plus, Sun, Trash2 } from 'lucide-react';
import { restoreLastDeletedMap } from '@dnd/core/src/store/slices/maps';
import { useStore } from '@/store/store';
import { notify } from '@dnd/ui/toast';
import { cn, timeAgo, Button, Input, useTheme } from '@dnd/ui';
import { ConfirmDialog } from '@/editor/ConfirmDialog';
import { ContextMenu, useContextMenu, type MenuRow } from '@/editor/RowMenu';
import { NewMapModal } from '@/editor/dialogs/NewMapModal';
import type { MapMeta } from '@/store/types';
import { getMapDB } from '@/store/slices/maps';
import type { MapIndexDB } from '@/io/mapIndexDB';
import { downloadAllMaps } from '@/io/downloadAll';
import { lastPublishedTo } from '@/io/publish';
import { openMap } from './openMap';

/** How the editor comes up when the home page hands over to it. */
export interface EnterOptions {
  /** With the open map's settings dialog showing over it. */
  settings?: boolean;
}

interface HomeScreenProps {
  /** A map is open on the canvas and the DM wants to edit it. */
  onEnter: (options?: EnterOptions) => void;
}

/** The desk's dot grid: 1px dots every 20px, offset half a step. */
const DOTS = 'bg-bg bg-[radial-gradient(circle,var(--dot)_1px,transparent_1.6px)] bg-[length:20px_20px] bg-[position:10px_10px]';

/** The home page's own focus ring: 2px of ink, 2 off the edge. */
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

/** One curve for every colour and movement change on the page. */
const EASE = 'ease-[cubic-bezier(0.2,0,0,1)]';

/** The card menu's skin: 176 to 240 wide, 30px rows at 13. */
const MENU_SKIN = cn(
  'min-w-[176px] max-w-[240px] rounded-control border border-line bg-panel p-1 font-sans text-text shadow antialiased',
  'animate-in fade-in-0 slide-in-from-top-[2px] duration-[120ms] motion-reduce:animate-none',
  '[&_[data-menu-focusable]]:h-[30px] [&_[data-menu-focusable]]:rounded-key [&_[data-menu-focusable]]:px-2.5 [&_[data-menu-focusable]]:text-[13px] [&_[data-menu-focusable]]:leading-none [&_[data-menu-focusable]]:text-text',
  '[&_[data-menu-focusable]:hover]:bg-panel-3 [&_[data-menu-focusable]:focus-visible]:bg-panel-3 [&_[data-menu-focusable]:focus-visible]:outline-none [&_[data-menu-focusable]:active]:bg-line',
  '[&_.text-danger]:text-danger [&_[role=separator]]:mx-1.5 [&_[role=separator]]:my-1 [&_[role=separator]]:bg-line',
);

/**
 * The landing page: every saved map as a card, newest first, with a "+" card that
 * founds a new one. Sits over the editor rather than replacing it, so the canvas boots
 * underneath and is ready the moment a card is picked.
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
  // Each map's "Published · <campaign>" chip, read from its publish record.
  const [publishedTo, setPublishedTo] = useState<Record<string, string>>({});
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = (await getMapDB()) as unknown as MapIndexDB;
      const entries = await Promise.all(
        mapIndex.map(async (m) => [m.id, lastPublishedTo(await db.getPublishState(m.id))] as const),
      );
      if (cancelled) return;
      setPublishedTo(Object.fromEntries(entries.filter((e): e is readonly [string, string] => e[1] !== null)));
    })().catch((err) => console.warn('[HomeScreen] publish records unreadable:', err));
    return () => {
      cancelled = true;
    };
  }, [mapIndex]);

  const handleDownloadAll = useCallback(async () => {
    setDownloading(true);
    try {
      const count = await downloadAllMaps();
      if (count === 0) notify.info('No maps to download yet');
      else notify.success(count === 1 ? 'Downloaded 1 map' : `Downloaded ${count} maps`);
    } catch (err) {
      console.error('[HomeScreen] download all failed:', err);
      notify.error('Failed to download the maps');
    } finally {
      setDownloading(false);
    }
  }, []);

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
        console.error('[HomeScreen] duplicate failed:', err);
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
        console.error('[HomeScreen] rename failed:', err);
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
      console.error('[HomeScreen] restore failed:', err);
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
      console.error('[HomeScreen] delete failed:', err);
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
    <div
      className={cn('fixed inset-0 z-40 overflow-y-auto font-sans text-text antialiased', DOTS)}
      data-v2-home=""
      data-testid="v2-home"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="mx-auto max-w-[1120px] px-8 pt-[72px] pb-[112px] max-sm:px-4 max-sm:pt-10 max-sm:pb-16">
        <header className="flex items-start justify-between gap-6">
          <div>
            <h1 className="m-0 text-[length:clamp(44px,4.4vw_+_16px,68px)] leading-[1.02] font-normal tracking-[-0.025em] text-balance text-text">
              Good Goblin <em className="tracking-[-0.015em]">Canvas</em>
            </h1>
            <p className="mt-4 mb-0 max-w-[44ch] text-[15px] leading-[1.55] text-pretty text-text-2">
              Pick up a map you were working on, or start a new one.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'border border-transparent text-text-2 transition-colors duration-[120ms] hover:border-line hover:bg-panel hover:text-text active:scale-[0.96] motion-reduce:active:scale-100 [&_svg:not([class*=size-])]:size-4',
              EASE,
              FOCUS,
            )}
            data-testid="v2-theme-toggle"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <Sun aria-hidden strokeWidth={1.75} /> : <Moon aria-hidden strokeWidth={1.75} />}
          </Button>
        </header>

        <section aria-labelledby="v2-recent">
          <div className="mt-14 flex items-baseline justify-between gap-4 border-t border-line pt-4 max-sm:mt-10">
            <h2 id="v2-recent" className="m-0 text-[13px] font-medium text-text">
              Recent maps
            </h2>
            <span className="font-mono text-[11px] text-text-3 tabular-nums">
              {sorted.length} {sorted.length === 1 ? 'map' : 'maps'}
            </span>
          </div>

          <div
            data-testid="v2-home-notice"
            className="mt-4 flex items-center justify-between gap-3 rounded-control border border-line bg-panel px-3 py-2 text-[12px] leading-[1.4] text-text-2"
          >
            <span>Maps live in this browser. Publish to a campaign or download them to keep them safe.</span>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              data-testid="v2-download-all"
              disabled={downloading || sorted.length === 0}
              onClick={() => void handleDownloadAll()}
            >
              {downloading ? 'Downloading…' : 'Download all'}
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(152px,1fr))] gap-4 max-sm:grid-cols-[repeat(auto-fill,minmax(136px,1fr))] max-sm:gap-3">
            <Button
              variant="outline"
              className={cn(
                'group/new aspect-[3/4] h-auto flex-col gap-1 rounded-float border-dashed border-line-strong bg-transparent p-0 text-text-2 transition-[border-color,background-color] duration-[120ms] hover:border-solid hover:border-ink hover:bg-panel hover:text-text',
                EASE,
                FOCUS,
              )}
              data-testid="v2-new-map-card"
              onClick={() => setNewOpen(true)}
            >
              <span
                className={cn(
                  'mb-2 flex size-8 items-center justify-center rounded-control border border-line-strong bg-panel text-text transition-colors duration-[120ms] group-hover/new:border-ink group-hover/new:bg-ink group-hover/new:text-on-ink [&_svg]:size-4',
                  EASE,
                )}
              >
                <Plus aria-hidden strokeWidth={1.75} />
              </span>
              <strong className="text-[13px] font-medium text-text">New map</strong>
              <span className="text-[11px] text-text-3">Blank, image or VTT</span>
            </Button>

            {sorted.map((map) => (
              <MapTile
                key={map.id}
                map={map}
                active={map.id === activeMapId}
                publishedTo={publishedTo[map.id] ?? null}
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

      <ContextMenu pos={menu.pos} onClose={closeMenu} items={menuItems} className={MENU_SKIN} captureKeys />

      <NewMapModal open={newOpen} onOpenChange={setNewOpen} onEnter={onEnter} />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title="Delete map?"
        message={`This will delete "${pendingName}" and everything on it.`}
        confirmLabel="Delete"
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
  return (
    <img
      ref={ref}
      alt=""
      draggable={false}
      className="block max-h-full max-w-full rounded-key object-contain shadow-[0_0_0_1px_var(--line),var(--shadow-sm)] select-none"
    />
  );
}

/** How long a click on a card's name waits to see whether it is the first of a double-click. */
const NAME_CLICK_DELAY_MS = 220;

/** The card menu's minimum width, so a menu opened from "…" lines up with the button's right edge. */
const MENU_WIDTH = 176;

/** The card's corner buttons show on hover, on focus and while the menu is up. */
const CORNER = cn(
  'absolute size-6 rounded-control opacity-0 transition-[opacity,color,background-color,border-color] duration-[120ms] group-hover/card:opacity-100 group-focus-visible/card:opacity-100 focus-visible:opacity-100 focus-visible:outline-offset-0',
  EASE,
  FOCUS,
);

interface MapTileProps {
  map: MapMeta;
  active: boolean;
  /** The campaign it was last published to, for the card's chip; null if never. */
  publishedTo: string | null;
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
  publishedTo,
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
      className={cn(
        'group/card relative flex aspect-[3/4] cursor-pointer flex-col overflow-hidden rounded-float border border-line bg-panel p-0 text-left shadow-sm',
        'transition-[border-color,transform,box-shadow] duration-[160ms] hover:-translate-y-0.5 hover:border-line-strong hover:shadow active:translate-y-0 active:scale-[0.99] active:shadow-sm',
        'motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 aria-busy:cursor-progress aria-busy:opacity-70',
        EASE,
        FOCUS,
        active && 'border-ink hover:border-ink',
      )}
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
      <div className={cn('relative flex min-h-0 flex-1 items-center justify-center overflow-hidden border-b border-line p-2.5', DOTS)}>
        {map.thumbnail ? (
          <Thumbnail blob={map.thumbnail} />
        ) : (
          <span data-testid="v2-card-empty" className="bg-bg px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-text-3 uppercase">
            Empty
          </span>
        )}
        {active && (
          <span
            data-testid="v2-card-badge"
            className="absolute top-1.5 left-1.5 rounded-key border border-line bg-panel px-[5px] py-[3px] font-mono text-[9px] leading-none tracking-[0.08em] text-text-2 uppercase"
          >
            Open
          </span>
        )}
        {publishedTo && (
          <span
            data-testid="v2-card-published"
            title={`Published · ${publishedTo}`}
            className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-12px)] truncate rounded-key border border-line bg-panel px-[5px] py-[3px] font-mono text-[9px] leading-none tracking-[0.04em] text-text-2"
          >
            Published · {publishedTo}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-2.5 pt-[9px] pb-2.5">
        {renaming ? (
          <div className="overflow-visible pr-[22px] text-[13px] leading-[1.35] font-medium">
            <RenameField initial={map.name} onDone={(commit, value, viaKey) => finishRename(commit, value, viaKey)} />
          </div>
        ) : (
          <div
            data-testid="v2-card-name"
            className="truncate pr-[22px] text-[13px] leading-[1.35] font-medium"
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
        <div className="font-mono text-[10.5px] text-text-3 tabular-nums">Updated {timeAgo(map.updatedAt)}</div>
      </div>
      <Button
        ref={moreRef}
        variant="outline"
        size="icon-xs"
        className={cn(
          CORNER,
          'top-1.5 right-1.5 border-line bg-panel text-text-2 shadow-sm hover:border-line-strong hover:bg-panel hover:text-text',
          menuOpen && 'border-line-strong text-text opacity-100',
        )}
        aria-label={`More for ${map.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(e) => {
          e.stopPropagation();
          menuFromButton();
        }}
      >
        <Ellipsis aria-hidden strokeWidth={1.75} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className={cn(CORNER, 'right-1.5 bottom-[9px] text-text-3 hover:bg-panel-3 hover:text-text [&_svg:not([class*=size-])]:size-[13px]')}
        aria-label={`Delete ${map.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 aria-hidden strokeWidth={1.75} />
      </Button>
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
    <Input
      ref={ref}
      className="block h-[calc(13px*1.35)] w-full min-w-0 cursor-text rounded-[2px] border-0 bg-panel p-0 font-sans text-[13px] leading-[1.35] font-medium text-text outline outline-1 outline-offset-2 outline-ink selection:bg-ink selection:text-on-ink focus-visible:border-0 focus-visible:outline-1 focus-visible:outline-ink"
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

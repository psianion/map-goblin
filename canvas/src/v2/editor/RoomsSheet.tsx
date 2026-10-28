import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal, Search, Star, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import {
  AssignRoomsToAreaCommand,
  CompositeCommand,
  RemoveAreaCommand,
  RenameAreaCommand,
  RenameRoomCommand,
  RenumberByReadingOrderCommand,
  ReorderRoomsCommand,
  SetStartingRoomCommand,
} from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { roomKeyOf } from '@dnd/core/src/shared/prep';
import type { Command, DungeonLayer, Room, RoomArea, ScenePrep } from '@/store/types';
import { cn } from '@/lib/utils';
import { FloatMenu, type FloatMenuEntry } from './FloatMenu';
import { SlideOver } from './SlideOver';
import { RoomKeyEditor } from './RoomKeyEditor';
import { EncounterIcon, GripIcon, KeyDocIcon, NewAreaIcon, RenumberIcon } from './roomIcons';
import {
  areaPinLabel,
  byNumber,
  hasEncounter,
  isKeyEmpty,
  levelDungeons,
  reorderIds,
  roomCountLabel,
  roomMatches,
  sheetGroups,
} from './roomModel';
import { newAreaFromSelection, openRoomKey, selectArea, selectRoom } from './roomActions';
import './rooms.css';

/*
 * The rooms sheet (boards 5, 6 and 7): the level on show's rooms, numbered, grouped by
 * area when there are any. Click selects and brings the room into view, Shift-click adds
 * the run of rows to the last one clicked, Ctrl/Cmd-click adds or drops one row,
 * double-click renames, drag reorders (and, onto another area's rows or header, moves it
 * there). A row's key icon opens that room's key, written or not. The second page is one
 * room's key.
 *
 * The drag is a pointer drag, not the browser's drag and drop: pressing a row and moving
 * a few px picks it up, the row or area header under the pointer shows where it would land,
 * and the release drops it. It works the same with a mouse, a pen and a synthetic pointer
 * (an automation tool's, a test's), which the HTML drag events do not all serve.
 */

/** Pointer travel (px) after which a press on a row is a drag rather than a click. */
const DRAG_START_PX = 4;

function closeSheet() {
  const s = useStore.getState();
  s.setRoomsSheetOpen(false);
  s.setRoomsSheetRoomId(null);
}

export function RoomsSheet() {
  const open = useStore((s) => s.ui.roomsSheetOpen);
  const keyRoomId = useStore((s) => s.ui.roomsSheetRoomId);
  const keyRoom = useStore(
    useShallow((s) => {
      if (!keyRoomId) return null;
      for (const l of s.layers) {
        if (l.type !== 'dungeon') continue;
        const room = (l as DungeonLayer).rooms?.find((r) => r.id === keyRoomId);
        if (room) return { name: room.name, number: room.number };
      }
      return null;
    }),
  );

  if (keyRoomId && keyRoom) {
    return (
      <SlideOver
        title="Room key"
        open={open}
        onClose={closeSheet}
        testId="v2-rooms-sheet"
        legacy={false}
        header={
          <header className="v2-sheet__head v2-rsheet__head v2-rsheet__head--key">
            <button
              type="button"
              className="v2-ib"
              aria-label="Back to rooms"
              data-testid="v2-key-back"
              onClick={() => useStore.getState().setRoomsSheetRoomId(null)}
            >
              <ChevronLeft size={15} strokeWidth={1.75} />
            </button>
            {keyRoom.number !== undefined && <span className="v2-rnum v2-rnum--on">{keyRoom.number}</span>}
            <h2 className="v2-rsheet__title">{keyRoom.name || 'Room'}</h2>
            <span className="v2-rsheet__kind">Key</span>
            <button type="button" className="v2-ib" aria-label="Close" onClick={closeSheet}>
              <X size={15} strokeWidth={1.75} />
            </button>
          </header>
        }
      >
        <RoomKeyEditor roomId={keyRoomId} />
        <footer className="v2-rsheet__foot">Shown to you when the room is revealed at the table.</footer>
      </SlideOver>
    );
  }
  return <RoomsListSheet open={open} />;
}

interface Drag {
  roomId: string;
  layerId: string;
  /** Where the press went down, until the pointer travels far enough to start the drag. */
  x: number;
  y: number;
  started: boolean;
}

type DropHint = { kind: 'row'; roomId: string; place: 'before' | 'after' } | { kind: 'area'; key: string } | null;

function RoomsListSheet({ open }: { open: boolean }) {
  const layers = useStore((s) => s.layers);
  const levels = useStore((s) => s.levels);
  const activeLevelId = useStore((s) => s.ui.activeLevelId);
  const prep = useStore((s) => s.prep);
  const selectedIds = useStore(useShallow((s) => s.selection.selectedIds));
  const startId = useStore((s) => s.mapSettings.startingRoomId);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; entries: FloatMenuEntry[]; label: string } | null>(null);
  const [hint, setHint] = useState<DropHint>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  /** A drag just ended on its own row: the click that follows the release is not a click. */
  const swallowClick = useRef(false);
  /** The row a plain or Ctrl click last landed on: where a Shift-click's run starts. */
  const lastClicked = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // A release anywhere else (off the list, outside the sheet) puts the row back down.
  useEffect(() => {
    const end = () => {
      if (!drag.current) return;
      if (drag.current.started) swallowClick.current = true;
      drag.current = null;
      setDragging(null);
      setHint(null);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  /** The live drag, once it has travelled far enough to be one (and is on `layerId`). */
  const liveDrag = (layerId: string, e: { clientX: number; clientY: number }): Drag | null => {
    const d = drag.current;
    if (!d || d.layerId !== layerId) return null;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_START_PX) return null;
      d.started = true;
      setDragging(d.roomId);
    }
    return d;
  };

  /** Ends the drag (after a drop handled it); the release that ends it is no click. */
  const endDrag = () => {
    if (drag.current?.started) swallowClick.current = true;
    drag.current = null;
    setDragging(null);
    setHint(null);
  };

  const dungeons = useMemo(() => levelDungeons(layers, levels, activeLevelId), [layers, levels, activeLevelId]);
  const total = dungeons.reduce((n, l) => n + (l.rooms?.length ?? 0), 0);
  const areaCount = dungeons.reduce((n, l) => n + (l.areas?.length ?? 0), 0);
  const withRooms = dungeons.filter((l) => (l.rooms?.length ?? 0) > 0 || (l.areas?.length ?? 0) > 0);
  const keep = useCallback((room: Room) => roomMatches(room, roomKeyOf(prep, room.id), query), [prep, query]);
  const selectedRooms = dungeons.some((l) => (l.rooms ?? []).some((r) => selectedIds.includes(r.id)));
  const selectedCount = dungeons.reduce((n, l) => n + (l.rooms ?? []).filter((r) => selectedIds.includes(r.id)).length, 0);

  const sheet = () => bodyRef.current?.closest('.v2-sheet') ?? null;

  const renumber = () => {
    const targets = dungeons.filter((l) => (l.rooms?.length ?? 0) > 0);
    if (targets.length === 0) return;
    const cmds = targets.map((l) => new RenumberByReadingOrderCommand(l.id));
    undoManager.execute(cmds.length === 1 ? cmds[0] : new CompositeCommand('Renumber rooms', cmds));
  };

  const newArea = () => {
    const id = newAreaFromSelection();
    if (id) setRenaming(id);
  };

  /** Drop the dragged room before or after `target`, joining the target's area. */
  const dropOnRow = (layer: DungeonLayer, target: Room, place: 'before' | 'after') => {
    const d = drag.current;
    endDrag();
    if (!d || !d.started || d.layerId !== layer.id) return;
    const moving = layer.rooms?.find((r) => r.id === d.roomId);
    if (!moving) return;
    const cmds: Command[] = [];
    const ordered = byNumber(layer.rooms ?? []).map((r) => r.id);
    const next = reorderIds(ordered, d.roomId, target.id, place);
    if (next) cmds.push(new ReorderRoomsCommand(layer.id, next));
    const areaId = layer.areas?.length ? (target.areaId ?? null) : null;
    if ((layer.areas?.length ?? 0) > 0 && (moving.areaId ?? null) !== areaId) {
      cmds.push(new AssignRoomsToAreaCommand(layer.id, [moving.id], areaId));
    }
    if (cmds.length > 0) undoManager.execute(cmds.length === 1 ? cmds[0] : new CompositeCommand('Move room', cmds));
  };

  /** Drop the dragged room on an area header (or the "No area" header: `areaId` null). */
  const dropOnArea = (layer: DungeonLayer, areaId: string | null) => {
    const d = drag.current;
    endDrag();
    if (!d || !d.started || d.layerId !== layer.id) return;
    const moving = layer.rooms?.find((r) => r.id === d.roomId);
    if (!moving || (moving.areaId ?? null) === areaId) return;
    undoManager.execute(new AssignRoomsToAreaCommand(layer.id, [moving.id], areaId));
  };

  /** Every row on show, top to bottom: what a Shift-click's run is read along. */
  const visibleIds = useMemo(
    () =>
      withRooms.flatMap((layer) =>
        sheetGroups(layer, keep).flatMap((g) => (folded.has(g.area?.id ?? `${layer.id}:none`) ? [] : g.rooms.map((r) => r.id))),
      ),
    [withRooms, keep, folded],
  );

  /** A row click: plain selects the one room; Shift adds the run from the last click; Ctrl/Cmd toggles one. */
  const clickRow = (e: ReactMouseEvent, room: Room, layer: DungeonLayer) => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    const s = useStore.getState();
    const roomIds = new Set(dungeons.flatMap((l) => (l.rooms ?? []).map((r) => r.id)));
    const current = s.selection.selectedIds.filter((id) => roomIds.has(id));
    if (e.shiftKey && lastClicked.current && visibleIds.includes(lastClicked.current)) {
      const a = visibleIds.indexOf(lastClicked.current);
      const b = visibleIds.indexOf(room.id);
      const run = visibleIds.slice(Math.min(a, b), Math.max(a, b) + 1);
      s.setSelectedIds([...current.filter((id) => !run.includes(id)), ...run]);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      lastClicked.current = room.id;
      s.setSelectedIds(current.includes(room.id) ? current.filter((id) => id !== room.id) : [...current, room.id]);
      return;
    }
    lastClicked.current = room.id;
    selectRoom(room, layer.id, sheet());
  };

  const roomMenu = (e: React.MouseEvent, room: Room) => {
    e.preventDefault();
    const isStart = startId === room.id;
    setMenu({
      at: { x: e.clientX, y: e.clientY },
      label: `${room.name} menu`,
      entries: [
        { label: 'Open room key', onSelect: () => openRoomKey(room.id) },
        { label: 'Rename', onSelect: () => setRenaming(room.id) },
        'divider',
        {
          label: isStart ? 'Stop starting the table here' : 'Start the table here',
          testId: 'v2-room-start',
          onSelect: () => undoManager.execute(new SetStartingRoomCommand(isStart ? null : room.id)),
        },
      ],
    });
  };

  const areaMenu = (anchor: DOMRect, layer: DungeonLayer, area: RoomArea) => {
    setMenu({
      at: { x: anchor.left, y: anchor.bottom + 4 },
      label: `${area.name} menu`,
      entries: [
        { label: 'Rename', onSelect: () => setRenaming(area.id) },
        { label: 'Remove area', testId: 'v2-area-remove', onSelect: () => undoManager.execute(new RemoveAreaCommand(layer.id, area.id)) },
      ],
    });
  };

  const header = (
    <header className="v2-sheet__head v2-rsheet__head">
      <h2>
        Rooms <span className="v2-num v2-rsheet__count">{roomCountLabel(total, areaCount)}</span>
        {selectedCount > 1 && (
          <span className="v2-num v2-rsheet__count" data-testid="v2-rsheet-selected">
            {' · '}
            {selectedCount} selected
          </span>
        )}
      </h2>
      <div className="v2-rsheet__actions">
        <button
          type="button"
          className="v2-ib"
          aria-label="New area from selection"
          data-tip={selectedRooms ? 'New area from the selected rooms' : 'Select rooms to group them'}
          data-testid="v2-new-area"
          disabled={!selectedRooms}
          onClick={newArea}
        >
          <NewAreaIcon size={15} />
        </button>
        <button
          type="button"
          className="v2-ib"
          aria-label="Renumber by reading order"
          data-tip="Renumber top-left to bottom-right"
          data-testid="v2-renumber"
          onClick={renumber}
        >
          <RenumberIcon size={15} />
        </button>
        <button type="button" className="v2-ib" aria-label="Close" onClick={closeSheet}>
          <X size={15} strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );

  return (
    <SlideOver title="Rooms" open={open} onClose={closeSheet} testId="v2-rooms-sheet" legacy={false} header={header}>
      <div className={cn('v2-rsheet', dragging && 'v2-rsheet--dragging')} ref={bodyRef}>
        <div className="v2-rsheet__filter">
          <label className="v2-rfilter">
            <Search size={14} strokeWidth={1.75} aria-hidden />
            <input
              placeholder="Filter by name, number or key"
              aria-label="Filter rooms"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') setQuery('');
              }}
            />
          </label>
        </div>
        <div className="v2-rsheet__cols">
          <span>{areaCount > 0 ? 'Drag to reorder or into an area' : 'Drag to reorder'}</span>
          <span>sq</span>
          <span className="v2-rsheet__keycol">key</span>
        </div>
        <div className="v2-rsheet__list" data-testid="v2-rooms-list">
          {total === 0 && areaCount === 0 && (
            <p className="v2-rsheet__empty">
              No rooms on this level yet. Draw one from the Rooms tab, or Suggest rooms.
            </p>
          )}
          {withRooms.map((layer) => (
            <div key={layer.id} className="v2-rsheet__layer">
              {withRooms.length > 1 && <p className="v2-rsheet__layername">{layer.name || 'Unnamed layer'}</p>}
              {sheetGroups(layer, keep).map((g) => {
                const groupKey = g.area?.id ?? `${layer.id}:none`;
                const isFolded = folded.has(groupKey);
                const showHead = g.area !== null || (layer.areas?.length ?? 0) > 0;
                return (
                  <div key={groupKey} className="v2-rgroup">
                    {showHead && (
                      <AreaHead
                        layer={layer}
                        area={g.area}
                        count={g.rooms.length}
                        folded={isFolded}
                        on={!!g.area && selectedIds.includes(g.area.id)}
                        dropping={hint?.kind === 'area' && hint.key === groupKey}
                        renaming={!!g.area && renaming === g.area.id}
                        onFold={() =>
                          setFolded((f) => {
                            const next = new Set(f);
                            if (next.has(groupKey)) next.delete(groupKey);
                            else next.add(groupKey);
                            return next;
                          })
                        }
                        onRenameDone={() => setRenaming(null)}
                        onMenu={(box) => g.area && areaMenu(box, layer, g.area)}
                        onDragOver={(e) => {
                          if (!liveDrag(layer.id, e)) return;
                          setHint((h) => (h?.kind === 'area' && h.key === groupKey ? h : { kind: 'area', key: groupKey }));
                        }}
                        onDrop={(e) => {
                          if (!liveDrag(layer.id, e)) return;
                          dropOnArea(layer, g.area?.id ?? null);
                        }}
                      />
                    )}
                    {!isFolded && (
                      <ul className="v2-rlist">
                        {g.rooms.map((room) => (
                          <RoomRow
                            key={room.id}
                            room={room}
                            layer={layer}
                            prep={prep}
                            on={selectedIds.includes(room.id)}
                            start={startId === room.id}
                            renaming={renaming === room.id}
                            lifted={dragging === room.id}
                            dropHint={hint?.kind === 'row' && hint.roomId === room.id ? hint.place : null}
                            onClick={(e) => clickRow(e, room, layer)}
                            onDoubleClick={() => setRenaming(room.id)}
                            onRenameDone={() => setRenaming(null)}
                            onContextMenu={(e) => roomMenu(e, room)}
                            onOpenKey={() => openRoomKey(room.id)}
                            onDragStart={(e) => {
                              if (e.button !== 0) return;
                              // Moves go to whatever is under the pointer (not this row), so the
                              // rows and headers it passes can say where the drop would land.
                              if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                              swallowClick.current = false;
                              drag.current = { roomId: room.id, layerId: layer.id, x: e.clientX, y: e.clientY, started: false };
                            }}
                            onDragOver={(e) => {
                              if (!liveDrag(layer.id, e)) return;
                              const box = e.currentTarget.getBoundingClientRect();
                              const place = e.clientY > box.top + box.height / 2 ? 'after' : 'before';
                              setHint((h) =>
                                h?.kind === 'row' && h.roomId === room.id && h.place === place
                                  ? h
                                  : { kind: 'row', roomId: room.id, place },
                              );
                            }}
                            onDrop={(e) => {
                              if (!liveDrag(layer.id, e)) return;
                              const box = e.currentTarget.getBoundingClientRect();
                              const place = e.clientY > box.top + box.height / 2 ? 'after' : 'before';
                              dropOnRow(layer, room, place);
                            }}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <footer className="v2-rsheet__foot">
        {areaCount > 0
          ? 'Click a room selects it on the map; click an area header selects the area and shows its card.'
          : 'Click selects on the map. Double-click renames.'}
      </footer>
      <FloatMenu
        open={!!menu}
        onClose={() => setMenu(null)}
        label={menu?.label ?? 'Menu'}
        entries={menu?.entries ?? []}
        at={menu?.at}
        width={200}
      />
    </SlideOver>
  );
}

/* ── Rows ───────────────────────────────────────────────── */

/** An inline rename: Enter or blur commits, Escape leaves the name as it was. */
function InlineName({ value, label, onCommit, onDone }: { value: string; label: string; onCommit: (v: string) => void; onDone: () => void }) {
  const [text, setText] = useState(value);
  const cancelled = useRef(false);
  return (
    <input
      className="v2-rinline"
      aria-label={label}
      value={text}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => {
        const next = text.trim();
        if (!cancelled.current && next && next !== value) onCommit(next);
        onDone();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function RoomRow({
  room,
  layer,
  prep,
  on,
  start,
  renaming,
  lifted,
  dropHint,
  onClick,
  onDoubleClick,
  onRenameDone,
  onContextMenu,
  onOpenKey,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  room: Room;
  layer: DungeonLayer;
  prep: ScenePrep | null | undefined;
  on: boolean;
  start: boolean;
  renaming: boolean;
  /** This row is the one being dragged. */
  lifted: boolean;
  dropHint: 'before' | 'after' | null;
  onClick: (e: ReactMouseEvent) => void;
  onDoubleClick: () => void;
  onRenameDone: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onOpenKey: () => void;
  /** A press on the row: the drag starts once the pointer has travelled. */
  onDragStart: (e: ReactPointerEvent<HTMLElement>) => void;
  /** The pointer moving over this row (during a drag: where it would land). */
  onDragOver: (e: ReactPointerEvent<HTMLElement>) => void;
  /** The pointer released over this row. */
  onDrop: (e: ReactPointerEvent<HTMLElement>) => void;
}) {
  const key = roomKeyOf(prep, room.id);
  const keyed = !isKeyEmpty(key);
  const fight = hasEncounter(key);
  const inner: ReactNode = (
    <>
      <span className="v2-rrow2__grip" aria-hidden>
        <GripIcon size={14} />
      </span>
      <span className={cn('v2-rnum', on && 'v2-rnum--on')}>{room.number ?? '·'}</span>
      {renaming ? (
        <InlineName
          value={room.name}
          label="Room name"
          onCommit={(next) => undoManager.execute(new RenameRoomCommand(layer.id, room.id, room.name, next))}
          onDone={onRenameDone}
        />
      ) : (
        <span className="v2-rrow2__name">
          {room.name || 'Unnamed room'}
          {start && <Star size={11} strokeWidth={2} className="v2-rrow2__star" aria-label="The table starts here" />}
        </span>
      )}
      <span className="v2-rrow2__sq v2-num">{room.area !== undefined ? Math.round(room.area) : ''}</span>
      {/* Room for the icons, which sit over the row's end as their own controls. */}
      <span className="v2-rrow2__icgap" aria-hidden />
    </>
  );
  const label = room.name || 'this room';
  return (
    <li
      className={cn('v2-rli', dropHint && `v2-rli--drop-${dropHint}`, lifted && 'v2-rli--lifted')}
      data-drop-room={room.id}
      onPointerMove={onDragOver}
      onPointerUp={onDrop}
      onPointerEnter={() => useStore.getState().setHighlightedRoomId(room.id)}
      onPointerLeave={() => {
        if (useStore.getState().ui.highlightedRoomId === room.id) useStore.getState().setHighlightedRoomId(null);
      }}
    >
      {renaming ? (
        <div className={cn('v2-rrow2', on && 'v2-rrow2--on')}>{inner}</div>
      ) : (
        <button
          type="button"
          className={cn('v2-rrow2', on && 'v2-rrow2--on')}
          aria-pressed={on}
          data-testid="v2-room-row"
          data-room-id={room.id}
          onPointerDown={onDragStart}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
          onKeyDown={(e) => {
            if (e.key === 'F2') {
              e.preventDefault();
              e.stopPropagation();
              onDoubleClick();
            }
          }}
        >
          {inner}
        </button>
      )}
      <span className="v2-rrow2__icons">
        <button
          type="button"
          className={cn('v2-rrow2__ic v2-rrow2__key', !keyed && 'v2-rrow2__ic--off')}
          aria-label={keyed ? `Open the key of ${label}` : `Write a key for ${label}`}
          data-tip={keyed ? 'Open room key' : 'Write a room key'}
          data-testid="v2-room-key-open"
          data-keyed={keyed ? 'true' : 'false'}
          onClick={onOpenKey}
        >
          <KeyDocIcon size={14} />
        </button>
        <span className={cn('v2-rrow2__ic', !fight && 'v2-rrow2__ic--off')} aria-label={fight ? 'Has an encounter' : 'No encounter'} role="img">
          <EncounterIcon size={14} />
        </span>
      </span>
    </li>
  );
}

function AreaHead({
  layer,
  area,
  count,
  folded,
  on,
  dropping,
  renaming,
  onFold,
  onRenameDone,
  onMenu,
  onDragOver,
  onDrop,
}: {
  layer: DungeonLayer;
  area: RoomArea | null;
  count: number;
  folded: boolean;
  on: boolean;
  dropping: boolean;
  renaming: boolean;
  onFold: () => void;
  onRenameDone: () => void;
  onMenu: (box: DOMRect) => void;
  onDragOver: (e: ReactPointerEvent<HTMLElement>) => void;
  onDrop: (e: ReactPointerEvent<HTMLElement>) => void;
}) {
  return (
    <div
      className={cn('v2-rarea', on && 'v2-rarea--on', dropping && 'v2-rarea--drop', !area && 'v2-rarea--none')}
      data-testid={area ? 'v2-area-head' : 'v2-area-none'}
      data-area-id={area?.id}
      onPointerMove={onDragOver}
      onPointerUp={onDrop}
    >
      <button
        type="button"
        className="v2-rarea__fold"
        aria-label={folded ? 'Show rooms' : 'Hide rooms'}
        aria-expanded={!folded}
        onClick={(e) => {
          e.stopPropagation();
          onFold();
        }}
      >
        <ChevronRight size={12} strokeWidth={2} />
      </button>
      {area && renaming ? (
        <InlineName
          value={area.name}
          label="Area name"
          onCommit={(next) => undoManager.execute(new RenameAreaCommand(layer.id, area.id, next))}
          onDone={onRenameDone}
        />
      ) : (
        <button
          type="button"
          className="v2-rarea__name"
          disabled={!area}
          aria-pressed={area ? on : undefined}
          onClick={(e) => {
            e.stopPropagation();
            if (area) selectArea(area.id, layer.id);
          }}
        >
          {area ? area.name || 'Unnamed area' : 'No area'}
        </button>
      )}
      <span className="v2-rarea__cnt v2-num">{count}</span>
      {area && <span className="v2-rarea__q">{areaPinLabel(area)}</span>}
      {area && (
        <button
          type="button"
          className="v2-ib v2-rarea__menu"
          aria-label="Area menu"
          onClick={(e) => {
            e.stopPropagation();
            onMenu(e.currentTarget.getBoundingClientRect());
          }}
        >
          <MoreHorizontal size={14} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

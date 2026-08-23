// §2.4.2 / D11 — the fog popover (table-shell M3 item 2). A mode, not a dialog: arming a
// tool changes what a click on the map means and says so in the shell, instead of covering
// the map with a panel that has to be dismissed before play continues.
//
// The room grid is not decoration. It is the keyboard path to every room the canvas hover
// reaches with a pointer, and — since P5's redesign — it is where the fog state is spelled
// out as a *shape* (filled/hollow/half disc, a lock glyph) rather than a word, so it reads on
// a bad panel and without colour (see the mockup's "status as shape" callout).
//
// Three slots make up the popover (`PanelDef`): `FogHeaderActions` (mode segment + the
// settings menu), `FogTool` itself (tool row, hint, room grid ↔ brush controls), and
// `FogFooter` (bulk ops, the conceal line). Each reads the session/tool stores independently
// — `Popover` mounts them as three separate component trees, so there is no prop channel
// between them and none is needed; the stores are the shared state.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Room } from '@dnd/core/src/shared/types';
import {
  autoExploreOn,
  fogModeOf,
  regionOf,
  type FogMode,
  type FogState,
  type RoomFog,
  type RoomFogStatus,
  type VisionShare,
} from '@dnd/mechanics/fog';
import { Segmented, Switch } from '../../components/controls';
import { registerPanel } from '../../session/panels';
import { useModuleState, useSessionStore } from '../../session/store';
import { UNDO_TOAST_MS, showToast } from '../../session/toasts';
import { useActiveTool } from '../../session/tools';
import { Icon } from '../../shell/icons';
import {
  armFogBrush,
  armFogHide,
  armFogReveal,
  useFogBrush,
  type BrushOp,
  type BrushShape,
} from './brush';
import {
  FOG_STATUS_LABEL,
  fogActionFor,
  fogFrame,
  hideAllRooms,
  lockedRooms,
  partlySeenRooms,
  revealAllRooms,
  roomFog,
  sceneFog,
  serverLayers,
  serverRooms,
} from './fog';
import { mountFogOverlayWhenReady, setHighlightedRoom } from './FogOverlay';

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('fog', action, payload);

// ── The panel's own vocabulary ─────────────────────────────────────────────
// `Segmented` and `Switch` started here and now live in `components/controls.tsx`, because
// the World block reaches for the same two shapes (see that file's header).

const MODES: readonly { value: FogMode; label: string }[] = [
  { value: 'rooms', label: 'Rooms' },
  { value: 'vision', label: 'Vision' },
];

const SHARES: readonly { value: VisionShare; label: string }[] = [
  { value: 'party', label: 'Party' },
  { value: 'individual', label: 'Individual' },
];

const BRUSH_OPS: readonly { value: BrushOp; label: string }[] = [
  { value: 'reveal', label: 'Reveal' },
  { value: 'hide', label: 'Hide' },
];

const BRUSH_SHAPES: readonly { value: BrushShape; label: string }[] = [
  { value: 'stroke', label: 'Stroke' },
  { value: 'box', label: 'Box' },
];

/** 24 chips (12 rows of 2) is the ledger's fit-without-scroll ceiling for the room grid. */
const ROOM_CEILING = 24;

/** The tool row's own `<kbd>` — the mockup's "blend into the armed button" treatment. */
function ToolKbd({ armed, children }: { armed: boolean; children: ReactNode }) {
  return (
    <kbd
      className={
        armed
          ? 'rounded border border-current px-1 font-mono text-[10px] opacity-70'
          : 'rounded border border-border-default bg-surface-2 px-1 font-mono text-[10px] text-text-dim'
      }
    >
      {children}
    </kbd>
  );
}

const toolButtonClass = (armedNow: boolean): string =>
  `flex h-7 flex-1 items-center justify-center gap-1.5 rounded border px-2 text-xs transition-colors duration-150 ease-settle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none ${
    armedNow
      ? 'border-accent-active bg-surface-3 text-accent-active'
      : 'border-border-default bg-surface-2 text-text-secondary enabled:hover:bg-surface-3 enabled:hover:text-text-primary enabled:active:bg-surface-1'
  }`;

/** Status as shape (item 7 of the mockup): filled = revealed, hollow = unrevealed, half =
 *  explored/partly seen. No colour carries the state — the shape is the whole encoding. */
function StatusDot({ status }: { status: RoomFogStatus }) {
  const base = 'h-2 w-2 shrink-0 rounded-full';
  if (status === 'revealed') return <i aria-hidden className={`${base} bg-text-dim`} />;
  if (status === 'never_revealed') {
    return <i aria-hidden className={`${base} border-[1.5px] border-text-muted`} />;
  }
  return (
    <i
      aria-hidden
      className={`${base} border-[1.5px] border-text-muted bg-[linear-gradient(90deg,rgb(var(--text-dim))_50%,transparent_50%)]`}
    />
  );
}

const chipClass =
  'flex h-7 min-w-0 items-center gap-1.5 rounded border border-border-default bg-surface-2 px-2 text-left text-xs text-text-primary transition-colors duration-150 ease-settle hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:bg-surface-1 motion-reduce:transition-none';

// ── The settings menu (header) ──────────────────────────────────────────────

export function FogHeaderActions() {
  const fogState = useModuleState<FogState>('fog');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const fog = sceneFog(fogState, sceneId);
  const mode = fogModeOf(fog);
  const vision = mode === 'vision';

  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    // Capture, so this beats the shell's own bubble-phase Escape (close-popover-first) —
    // Esc here closes the small menu on its own press rather than taking the popover with it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menuOpen]);

  return (
    <div ref={rootRef} className="relative flex items-center gap-1">
      <div
        role="radiogroup"
        aria-label="Fog mode"
        data-testid="fog-mode"
        data-value={mode}
        className="flex w-[140px] gap-0.5 rounded border border-border-default bg-surface-1 p-0.5"
      >
        {MODES.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === mode}
            onClick={() => o.value !== mode && send('set-mode', { mode: o.value })}
            className={`min-w-0 flex-1 truncate rounded px-1 py-0.5 text-[11px] transition-colors duration-150 ease-settle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none ${
              o.value === mode
                ? 'bg-surface-3 font-medium text-text-primary'
                : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        aria-label="Fog settings"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded text-text-muted transition-colors duration-150 ease-settle hover:bg-surface-2 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none"
      >
        <Icon name="more" size={14} />
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-[30px] z-toolbar flex w-56 flex-col gap-1.5 rounded border border-border-structure bg-surface-1 p-2 shadow-panel">
          <Switch
            testId="fog-conceal"
            checked={fog.concealBehindDoors}
            onToggle={() => send('set-conceal', { concealBehindDoors: !fog.concealBehindDoors })}
          >
            Conceal behind doors
          </Switch>
          {vision && (
            <>
              <Switch
                testId="fog-auto-explore"
                checked={autoExploreOn(fog)}
                onToggle={() => send('set-auto-explore', { autoExplore: !autoExploreOn(fog) })}
              >
                Auto-explore as the party moves
              </Switch>
              <Segmented
                label="Vision share"
                testId="fog-share"
                value={fog.visionShare ?? 'party'}
                options={SHARES}
                onPick={(visionShare) => send('set-share', { visionShare })}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── The tool row, hint, and room grid ↔ brush controls ──────────────────────

export function FogTool() {
  const fogState = useModuleState<FogState>('fog');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const mapData = useSessionStore((s) => s.mapData);
  const activeTool = useActiveTool((s) => s.activeTool);
  const toolDetail = useActiveTool((s) => s.toolDetail);
  const setToolDetail = useActiveTool((s) => s.setToolDetail);
  const brushOn = useFogBrush((s) => s.on);
  const brushOp = useFogBrush((s) => s.op);
  const brushSize = useFogBrush((s) => s.size);
  const brushShape = useFogBrush((s) => s.shape);
  const setBrushOp = useFogBrush((s) => s.setOp);
  const setBrushSize = useFogBrush((s) => s.setSize);
  const setBrushShape = useFogBrush((s) => s.setShape);

  // Mount for as long as the table is on screen; the helper handles the engine appearing
  // late and going away again.

  // The server's rooms, not core's re-detected ones — same rule as FogOverlay: core invents
  // rooms on unzoned maps that no fog command can name.
  const rooms = useMemo(() => serverRooms(mapData), [mapData]);
  const fog = sceneFog(fogState, sceneId);
  const armed = activeTool === 'fog';
  const mode = fogModeOf(fog);
  const vision = mode === 'vision';

  // The indicator that answers "what will this click do" tracks the brush's own shape while
  // the brush is on; it never overwrites a Reveal/Hide arm (those set it directly, above).
  useEffect(() => {
    if (armed && brushOn) setToolDetail(brushShape === 'box' ? 'Box' : 'Brush');
  }, [armed, brushOn, brushShape, setToolDetail]);

  const partly = useMemo(() => partlySeenRooms(rooms, fog.region), [rooms, fog.region]);
  const locked = useMemo(() => lockedRooms(rooms, serverLayers(mapData)), [rooms, mapData]);
  const brushable = useMemo(() => {
    const frame = fogFrame(mapData);
    return frame !== null && regionOf(frame) !== undefined;
  }, [mapData]);

  const revealArmed = armed && !brushOn && toolDetail === 'Reveal';
  const hideArmed = armed && !brushOn && toolDetail === 'Hide';
  const brushArmed = armed && brushOn && vision;

  const statusOf = (room: Room): RoomFogStatus => roomFog(fog, room.id).status;

  /** What a chip's own click does — the direction the armed button chose, or the old
   *  toggle when neither Reveal nor Hide is armed (Brush armed, or nothing at all). A map
   *  click always toggles (FogOverlay's own behaviour, untouched by this pass). */
  const chipAction = (status: RoomFogStatus): 'reveal' | 'hide' =>
    revealArmed ? 'reveal' : hideArmed ? 'hide' : fogActionFor(status);

  // ponytail: no reset-on-drop-below-ceiling effect. `filter` is only ever read in the
  // overCeiling branch below, so a stale value sitting unused in state while the grid is
  // grouped costs nothing — and it's exactly what a DM wants back if the count climbs again.
  const [filter, setFilter] = useState('');
  const overCeiling = rooms.length > ROOM_CEILING;

  const renderChip = (room: Room) => {
    const status = statusOf(room);
    const label = status === 're_hidden' && partly.has(room.id) ? 'Partly seen' : FOG_STATUS_LABEL[status];
    const isLocked = locked.has(room.id);
    const action = chipAction(status);
    return (
      <button
        key={room.id}
        type="button"
        data-room-id={room.id}
        data-fog-status={status}
        data-fog-label={label}
        data-locked={isLocked || undefined}
        title={room.name}
        aria-label={`${action === 'reveal' ? 'Reveal' : 'Hide'} ${room.name} · ${label}${isLocked ? ' · locked against auto-explore' : ''}`}
        onClick={() => send(action, { roomId: room.id })}
        onMouseEnter={() => setHighlightedRoom(room.id)}
        onMouseLeave={() => setHighlightedRoom(null)}
        className={chipClass}
      >
        <StatusDot status={status} />
        <span className="min-w-0 flex-1 truncate">{room.name}</span>
        {isLocked && (
          <Icon
            name="lock"
            size={12}
            className="shrink-0 text-text-muted"
            title="The party's own sight will never open this room"
          />
        )}
      </button>
    );
  };

  let grid: ReactNode;
  if (rooms.length === 0) {
    grid = <p className="text-xs text-text-secondary">This map has no rooms zoned yet.</p>;
  } else if (overCeiling) {
    // §7 — 25+: unrevealed first, a filter narrows it, at most 24 chips show at once.
    const rank = (s: RoomFogStatus) => (s === 'never_revealed' ? 0 : s === 're_hidden' ? 1 : 2);
    const q = filter.trim().toLowerCase();
    const matching = rooms
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => rank(statusOf(a)) - rank(statusOf(b)));
    const shown = matching.slice(0, ROOM_CEILING);
    const more = matching.length - shown.length;
    grid = (
      <div className="flex flex-col gap-1.5">
        <input
          type="text"
          data-testid="fog-filter"
          placeholder="Filter rooms"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-7 rounded border border-border-default bg-surface-0 px-2 text-[13px] text-text-primary placeholder:text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        />
        <div data-testid="fog-rooms" className="grid grid-cols-2 gap-1">
          {shown.map(renderChip)}
        </div>
        {more > 0 && <p className="text-[11px] text-text-muted">+{more} more, keep typing</p>}
      </div>
    );
  } else {
    const unrevealed = rooms.filter((r) => statusOf(r) === 'never_revealed');
    const revealed = rooms.filter((r) => statusOf(r) !== 'never_revealed');
    grid = (
      <div data-testid="fog-rooms" className="flex flex-col gap-1.5">
        {unrevealed.length > 0 && (
          <>
            <p className="text-[11px] text-text-muted">Unrevealed · {unrevealed.length}</p>
            <div className="grid grid-cols-2 gap-1">{unrevealed.map(renderChip)}</div>
          </>
        )}
        {revealed.length > 0 && (
          <>
            <p className="text-[11px] text-text-muted">Revealed · {revealed.length}</p>
            <div className="grid grid-cols-2 gap-1">{revealed.map(renderChip)}</div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 text-sm">
      <div data-testid="fog-bar" className="flex gap-1">
        <button
          type="button"
          data-testid="fog-tool-toggle"
          aria-pressed={revealArmed}
          onClick={armFogReveal}
          className={toolButtonClass(revealArmed)}
        >
          <Icon name="reveal" size={15} />
          Reveal
          <ToolKbd armed={revealArmed}>R</ToolKbd>
        </button>
        <button
          type="button"
          data-testid="fog-hide-toggle"
          aria-pressed={hideArmed}
          onClick={armFogHide}
          className={toolButtonClass(hideArmed)}
        >
          <Icon name="hide" size={15} />
          Hide
          <ToolKbd armed={hideArmed}>H</ToolKbd>
        </button>
        <button
          type="button"
          data-testid="fog-brush"
          aria-pressed={brushArmed}
          disabled={!vision || !brushable}
          title={!vision ? 'Switch to Vision mode to use the brush' : undefined}
          onClick={armFogBrush}
          className={toolButtonClass(brushArmed)}
        >
          <Icon name="brush" size={15} />
          Brush
          <ToolKbd armed={brushArmed}>B</ToolKbd>
        </button>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        <Icon name="frame" size={15} />
        Click a room on the map. Shift-click frames it.
      </div>

      {vision && !brushable && (
        // Said once, where the click would have been: without it the brush paints into a
        // void and the referee refuses the stroke after the fact.
        <p data-testid="fog-brush-unavailable" className="text-xs text-text-secondary">
          This map is too large to keep cell memory — reveal by room here.
        </p>
      )}

      {brushArmed ? (
        <div className="flex flex-col gap-1.5">
          <Segmented
            label="Brush paints"
            testId="fog-brush-op"
            value={brushOp}
            options={BRUSH_OPS}
            onPick={setBrushOp}
          />
          <Segmented
            label="Shape"
            testId="fog-brush-shape"
            value={brushShape}
            options={BRUSH_SHAPES}
            onPick={setBrushShape}
          />
          {brushShape === 'stroke' && (
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <span>Size</span>
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={brushSize}
                data-testid="fog-brush-size"
                aria-label="Brush size in cells"
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="min-w-0 flex-1"
              />
              <span className="w-3 text-right tabular-nums text-text-primary">{brushSize}</span>
            </label>
          )}
          <p className="text-xs text-text-secondary">
            {brushShape === 'box'
              ? 'Drag a box on the map to reveal the area at once. Alt paints the other way. Esc leaves the tool.'
              : 'Paint on the map to reveal less than a room. Alt paints the other way. Esc leaves the tool.'}
          </p>
        </div>
      ) : (
        grid
      )}
    </div>
  );
}

// ── The footer: bulk ops, and the conceal line ──────────────────────────────

export function FogFooter() {
  const fogState = useModuleState<FogState>('fog');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const mapData = useSessionStore((s) => s.mapData);
  const fog = sceneFog(fogState, sceneId);
  const rooms = useMemo(() => serverRooms(mapData), [mapData]);

  /**
   * D9 — the bulk ops land instantly and hand back a way out, instead of stopping to ask.
   * The record captured here is the scene's fog *before* the change, and undo replays it
   * verbatim through `set-bulk`.
   */
  const bulk = (next: Record<string, RoomFog>, message: string) => {
    const before = fog.rooms;
    send('set-bulk', { rooms: next });
    showToast({
      message,
      durationMs: UNDO_TOAST_MS,
      action: { label: 'Undo', onAction: () => send('set-bulk', { rooms: before }) },
    });
  };

  const ghostClass =
    'h-7 shrink-0 whitespace-nowrap rounded border border-transparent bg-transparent px-2.5 text-xs text-text-secondary transition-colors duration-150 ease-settle hover:bg-surface-2 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';

  return (
    <>
      <button
        type="button"
        data-testid="fog-reveal-all"
        disabled={rooms.length === 0}
        onClick={() => bulk(revealAllRooms(rooms), 'Revealed every room.')}
        className={ghostClass}
      >
        Reveal all
      </button>
      <button
        type="button"
        data-testid="fog-hide-all"
        disabled={rooms.length === 0}
        onClick={() => bulk(hideAllRooms(fog.rooms), 'Hid every explored room.')}
        className={ghostClass}
      >
        Hide all
      </button>
      <span className="flex-1" />
      <span className="min-w-0 truncate text-xs text-text-muted">
        Conceal behind doors · {fog.concealBehindDoors ? 'on' : 'off'}
      </span>
    </>
  );
}

registerPanel({
  id: 'fog',
  title: 'Fog',
  icon: 'fog',
  key: 'F',
  group: 'play',
  roles: ['dm'],
  order: 20,
  component: FogTool,
  mount: mountFogOverlayWhenReady,
  headerActions: FogHeaderActions,
  footer: FogFooter,
});

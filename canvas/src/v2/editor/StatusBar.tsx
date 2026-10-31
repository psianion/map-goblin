import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type Ref } from 'react';
import { Check, ChevronDown, Grid3x3, Minus, Plus, Sun, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { unionChildBounds } from '@dnd/core/src/engine/hitTest';
import { cursorWorldPosition } from '@/canvas/cursorPosition';
import { fpsMetrics } from '@/engine/fpsMetrics';
import { rulerMeasurement } from '@/engine/rulerMeasurement';
import { strokeStatus, subscribeStrokeStatus } from '@dnd/core/src/engine/tools/StampScatterTool';
import { labelMiss, subscribeLabelMiss } from '@dnd/core/src/engine/tools/TextTool';
import { computeMapWorldBounds } from '@/engine/export/exportPipeline';
import { useStore } from '@/store/store';
import { selectActiveLayer, selectChildById } from '@/store/selectors';
import { LayerStyleChangeCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type { AnyChild, DungeonLayer, GridConfig } from '@/store/types';
import {
  currentZoom,
  fitToContent,
  setZoomAtCentre,
  sliderToZoom,
  zoomToSlider,
  zoomPercent,
  DEFAULT_ZOOM,
} from '@/components/toolbar/zoomControl';
import { editHint, type EditHint } from '@/components/layout/statusHints';
import { cn } from '@/lib/utils';
import { DockPopover } from './DockControls';
import { ColorCtl } from './controls';
import { hintText, roomHintFor, type ToolHint } from './roomModel';
import { propHintFor } from './propModel';
import { lightHintFor } from './lightModel';
import { SELECT_LOCKED_TEXT, selectHintFor } from './selectHint';
import { useDropTarget } from './dropToLayer';
import { isStripFocused, subscribeStripFocus } from './layerActions';
import { setLitPreview, useLitPreview } from '../viewPrefs';
import './selection-actions.css';

const ZOOM_STEP = 1.25;

/** The filmstrip's keys, while a tile has focus. */
const STRIP_HINT: ToolHint = {
  label: 'Layers',
  segments: [
    { text: '← →', key: true },
    { text: 'layers' },
    { text: 'Enter', key: true },
    { text: 'activate' },
    { text: 'F2', key: true },
    { text: 'rename' },
    { text: 'Alt+eye', key: true },
    { text: 'solo' },
  ],
};

/** The Label tool's line: placing, typing in the card, and the two keys the card answers. */
const LABEL_TOOL_HINT: ToolHint = {
  label: 'Label',
  segments: [
    { text: 'Click to place · type in the card' },
    { text: 'Enter', key: true },
    { text: 'done' },
    { text: 'Esc', key: true },
    { text: 'removes an empty label' },
  ],
};

/** The frame rate, for the performance checks: dev builds, or any build opened with `?fps`. */
const SHOW_FPS = import.meta.env.DEV || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('fps'));

type SnapDivision = GridConfig['snapDivision'];
const SNAP_DIVISIONS: readonly SnapDivision[] = [1, 2, 3, 4, 6, 8];
/** The chip's short form of the snap step. */
const SNAP_FRACTION: Record<SnapDivision, string> = { 1: '1', 2: '½', 3: '⅓', 4: '¼', 6: '⅙', 8: '⅛' };

function PopSwitch({
  label,
  checked,
  onChange,
  buttonRef,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <label className="v2-gridpop__row">
      <span>{label}</span>
      <button
        ref={buttonRef}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={cn('v2-switch', checked && 'v2-switch--on')}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </label>
  );
}

/**
 * The colour of the grid lines drawn over the active layer's floors. The layer style keeps
 * it as `wallColor`, an older name: it never coloured the walls. Unlike the view toggles
 * around it this is a map edit, so a visit to the picker is one undo step.
 */
function GridLinesColor() {
  const layer = useStore(useShallow(selectActiveLayer));
  if (!layer || layer.type !== 'dungeon') return null;
  const dungeon = layer as DungeonLayer;
  return (
    <div className="v2-gridpop__color" data-testid="v2-grid-lines">
      <ColorCtl
        label="Grid lines"
        tip="Colour of the grid lines over this layer's floors"
        placement="beside"
        value={dungeon.style.wallColor}
        onChange={(c) =>
          useStore
            .getState()
            .updateLayer(dungeon.id, { style: { ...dungeon.style, wallColor: c } } as Partial<DungeonLayer>)
        }
        onCommit={(c, start) => {
          if (c === start) return;
          undoManager.execute(new LayerStyleChangeCommand('Change grid lines colour', dungeon.id, 'wallColor', start, c));
        }}
      />
    </div>
  );
}

/**
 * The grid chip and its popover: show the grid, snap to it, and how finely. These are
 * view toggles, not map edits, so none of them goes through undo (as in v1). The one map
 * edit here is the colour of the active layer's grid lines.
 */
function GridControl() {
  const { visible, snapEnabled, snapDivision } = useStore(useShallow((s) => s.grid));
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) firstRef.current?.focus();
  }, [open]);

  const close = useCallback(() => {
    // Escape from inside hands focus back to the chip; a press elsewhere keeps its own.
    const active = document.activeElement;
    if (active !== chipRef.current && wrapRef.current?.contains(active)) chipRef.current?.focus();
    setOpen(false);
  }, []);

  const state = snapEnabled ? SNAP_FRACTION[snapDivision] : 'off';
  return (
    <span className="v2-status__grid" ref={wrapRef}>
      <button
        ref={chipRef}
        type="button"
        className={cn(
          'v2-status__gridchip',
          !visible && 'v2-status__gridchip--hidden',
          open && 'v2-status__gridchip--open',
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Grid ${visible ? 'shown' : 'hidden'}, snap ${snapEnabled ? `to 1/${snapDivision}` : 'off'}`}
        data-testid="v2-grid-chip"
        data-tip={open ? undefined : 'Grid and snap'}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Grid3x3 size={12} aria-hidden />
        <span>Grid</span>
        <span className="v2-status__gridstate">· {state}</span>
      </button>
      <DockPopover open={open} onClose={close} className="v2-pop--grid" label="Grid">
        <PopSwitch
          label="Show grid"
          checked={visible}
          onChange={(v) => useStore.getState().setGridVisible(v)}
          buttonRef={firstRef}
        />
        <GridLinesColor />
        <PopSwitch label="Snap" checked={snapEnabled} onChange={(v) => useStore.getState().setSnapEnabled(v)} />
        <div className={cn('v2-gridpop__field', !snapEnabled && 'v2-gridpop__field--off')}>
          <span>Snap to</span>
          <span className="v2-seg" role="group" aria-label="Snap to">
            {SNAP_DIVISIONS.map((d) => (
              <button
                key={d}
                type="button"
                className="v2-num"
                aria-pressed={snapDivision === d}
                onClick={() => useStore.getState().setSnapDivision(d)}
              >
                1/{d}
              </button>
            ))}
          </span>
        </div>
      </DockPopover>
    </span>
  );
}

/** "Lit · on/off": the lit preview, one click to flip it (also I, and the … menu row). */
function LitChip() {
  const lit = useLitPreview();
  return (
    <span className="v2-status__grid">
      <button
        type="button"
        className={cn('v2-status__gridchip', !lit && 'v2-status__gridchip--hidden')}
        aria-pressed={lit}
        aria-label={`Lit preview ${lit ? 'on' : 'off'}`}
        data-testid="v2-lit-chip"
        data-tip="Lit preview"
        data-tip-key="I"
        onClick={() => setLitPreview(!lit)}
      >
        <Sun size={12} aria-hidden />
        <span>Lit</span>
        <span className="v2-status__gridstate">· {lit ? 'on' : 'off'}</span>
      </button>
    </span>
  );
}

const MARQUEE_CHOICES: { value: 'all' | 'tab'; label: string; sub: string }[] = [
  { value: 'all', label: 'Everything', sub: 'every kind on the level on show' },
  { value: 'tab', label: 'This tab’s kind', sub: 'only what the dock tab up now draws' },
];

/**
 * "Select: Everything ▾": what a marquee picks, every kind or only the dock tab's. A view
 * preference (remembered per browser), never a map edit.
 */
function MarqueeChip() {
  const filter = useStore((s) => s.ui.marqueeFilter);
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const current = MARQUEE_CHOICES.find((c) => c.value === filter) ?? MARQUEE_CHOICES[0];
  return (
    <span className="v2-status__grid">
      <button
        ref={chipRef}
        type="button"
        className={cn('v2-status__gridchip', open && 'v2-status__gridchip--open')}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="v2-marquee-chip"
        data-tip={open ? undefined : 'What a marquee picks'}
        onClick={() => setOpen((o) => !o)}
      >
        <span>Select: {current.label}</span>
        <ChevronDown size={11} aria-hidden />
      </button>
      <DockPopover open={open} onClose={close} className="v2-pop--grid v2-pop--marquee" label="Marquee picks">
        <div role="menu" aria-label="Marquee picks" className="v2-marquee__menu">
          {MARQUEE_CHOICES.map((c) => (
            <button
              key={c.value}
              type="button"
              role="menuitemradio"
              aria-checked={filter === c.value}
              className="v2-menu__item v2-menu__item--check"
              onClick={() => {
                useStore.getState().setMarqueeFilter(c.value);
                close();
              }}
            >
              <span className="v2-menu__mark">{filter === c.value ? <Check size={14} strokeWidth={2} /> : null}</span>
              <span className="v2-menu__label">
                {c.label}
                <small className="v2-status__muted"> · {c.sub}</small>
              </span>
            </button>
          ))}
        </div>
      </DockPopover>
    </span>
  );
}

/** Which node editor is open and its key map, keys drawn as keycaps. */
function HintLine({ hint }: { hint: EditHint }) {
  return (
    <span className="v2-status__hint" data-testid="v2-status-hint" title={`${hint.label} · ${hint.text}`}>
      <span className="v2-status__hintlabel">{hint.label}</span>
      {' · '}
      {hint.segments.map((seg, i) => (seg.key ? <kbd key={i}>{seg.text}</kbd> : <span key={i}>{seg.text}</span>))}
    </span>
  );
}

/** A room or prop tool's, or a room or prop selection's, line: what it is, then words and keycaps. */
function ToolHintLine({ hint }: { hint: ToolHint }) {
  return (
    <span className="v2-status__hint v2-status__toolhint" data-testid="v2-status-hint" title={`${hint.label} · ${hintText(hint)}`}>
      <span className="v2-status__hintlabel">{hint.label}</span>
      {hint.segments.map((seg, i) => (seg.key ? <kbd key={i}>{seg.text}</kbd> : <span key={i}>{seg.text}</span>))}
    </span>
  );
}

/**
 * Bottom bar: where the cursor is, how big things are, and the view controls.
 * `skyOpen` says the Sky & mood sheet is up, which has a line of its own.
 */
export function StatusBar({ skyOpen = false }: { skyOpen?: boolean } = {}) {
  const [cursor, setCursor] = useState('x —  y —');
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [ruler, setRuler] = useState('');
  const [fps, setFps] = useState('—');
  const cellScale = useStore((s) => s.mapSettings.cellScale);
  const layers = useStore((s) => s.layers);
  const terrainBounds = useStore((s) => s.mapSettings.terrain?.bounds ?? null);
  const fixedSize = useStore((s) => s.mapSettings.fixedSize ?? null);
  const selected = useStore(
    useShallow((s) =>
      s.selection.selectedIds
        .map((id) => selectChildById(s, id))
        .filter((c): c is AnyChild => c !== undefined),
    ),
  );
  const soloName = useStore((s) => {
    const layer = s.layers.find((l) => l.id === s.ui.solo?.layerId);
    return layer ? layer.name || 'Unnamed layer' : null;
  });
  const hintTools = useStore(
    useShallow((s) => ({
      nodeEditWallId: s.tools.nodeEditWallId,
      shapeNodeEditId: s.tools.shapeNodeEditId,
      selectedNodeT: s.tools.selectedNodeT,
      selectedNodeTs: s.tools.selectedNodeTs,
    })),
  );
  const hint = useMemo(() => editHint(hintTools), [hintTools]);
  // Built from store state into one of a few shapes; the label string keys it so the
  // selector hands back the same value while nothing it says has moved.
  const roomHintKey = useStore((s) => {
    const h = roomHintFor(s);
    return h ? JSON.stringify(h) : '';
  });
  const roomHint = useMemo(() => (roomHintKey ? (JSON.parse(roomHintKey) as ToolHint) : null), [roomHintKey]);
  // The Props tool's line and the selected props' line; a scatter stroke's counts live in the tool.
  const stroke = useSyncExternalStore(subscribeStrokeStatus, strokeStatus);
  const propHintKey = useStore((s) => {
    const h = propHintFor(s, stroke);
    return h ? JSON.stringify(h) : '';
  });
  const propHint = useMemo(() => (propHintKey ? (JSON.parse(propHintKey) as ToolHint) : null), [propHintKey]);
  // The Sky & mood sheet, the Light tool, or the one selected light.
  const lightHintKey = useStore((s) => {
    const h = lightHintFor(s, skyOpen);
    return h ? JSON.stringify(h) : '';
  });
  const lightHint = useMemo(() => (lightHintKey ? (JSON.parse(lightHintKey) as ToolHint) : null), [lightHintKey]);
  // The Select tool's own line: its gestures with nothing selected, its verbs with something.
  const selectHintKey = useStore((s) => {
    const h = selectHintFor(s);
    return h ? JSON.stringify(h) : '';
  });
  const selectHint = useMemo(() => (selectHintKey ? (JSON.parse(selectHintKey) as ToolHint) : null), [selectHintKey]);
  // A locked selection says so ahead of its kind's own line (a prop's, a light's keys).
  const selectLocked = selectHint?.segments[0]?.text === SELECT_LOCKED_TEXT ? selectHint : null;
  const labelTool = useStore((s) => s.tools.activeTool === 'text');
  // Why the Label tool's last click placed nothing, for a moment.
  const labelMissText = useSyncExternalStore(subscribeLabelMiss, labelMiss, () => null);
  // A canvas drag over a filmstrip tile, and the strip's keys while a tile has focus.
  const dropTarget = useDropTarget();
  const stripFocused = useSyncExternalStore(subscribeStripFocus, isStripFocused, () => false);

  const cellScaleRef = useRef(cellScale);
  useEffect(() => {
    cellScaleRef.current = cellScale;
  }, [cellScale]);

  // One frame loop polls everything that lives outside the store.
  useEffect(() => {
    let raf = 0;
    let frame = 0;
    const tick = () => {
      const pos = cursorWorldPosition.current;
      const nextCursor = pos ? `x ${pos.x.toFixed(1)}  y ${pos.y.toFixed(1)}` : 'x —  y —';
      setCursor((p) => (p !== nextCursor ? nextCursor : p));

      const z = currentZoom();
      if (z !== null) setZoom((p) => (Math.abs(p - z) > 0.01 ? z : p));

      const m = rulerMeasurement.current;
      const { value, unit } = cellScaleRef.current;
      const nextRuler = m ? `${(m.cells * value).toFixed(1)}${unit} · ${m.cells.toFixed(1)} sq` : '';
      setRuler((p) => (p !== nextRuler ? nextRuler : p));

      if (SHOW_FPS && ++frame % 15 === 0) {
        const f = fpsMetrics.current;
        const next = f ? String(Math.round(f.fps)) : '—';
        setFps((p) => (p !== next ? next : p));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const map = useMemo(() => computeMapWorldBounds(layers, terrainBounds, fixedSize), [layers, terrainBounds, fixedSize]);
  const mapW = Math.ceil(map.maxX - map.minX);
  const mapH = Math.ceil(map.maxY - map.minY);
  const gridPx = Math.round(zoom);

  const sel = selected.length ? unionChildBounds(selected) : null;
  const sliderVal = zoomToSlider(zoom);
  const pct = zoomPercent(zoom);

  return (
    <footer className="v2-status" data-testid="v2-status" data-keys="canvas">
      <span className="v2-status__cursor">{cursor}</span>
      {sel && (
        <span data-testid="v2-status-selection">
          {sel.width.toFixed(1)} × {sel.height.toFixed(1)} sq selected
        </span>
      )}
      <span className="v2-status__muted">
        {mapW} × {mapH} sq · {mapW * gridPx} × {mapH * gridPx} px · {gridPx}px grid
      </span>
      {SHOW_FPS && (
        <span className="v2-status__muted" data-testid="v2-status-fps">
          {fps} fps
        </span>
      )}

      {/* One slot, most transient first: a drop target, a live ruler, then the node editor's
          key map, then the tool's or the selection's line. */}
      <span className="v2-status__mid">
        {dropTarget ? (
          <span className="v2-status__hint" data-testid="v2-status-hint">
            Release to move to <b>{dropTarget.name}</b>
          </span>
        ) : ruler ? (
          <span>{ruler}</span>
        ) : hint ? (
          <HintLine hint={hint} />
        ) : selectLocked ? (
          <ToolHintLine hint={selectLocked} />
        ) : skyOpen && lightHint ? (
          <ToolHintLine hint={lightHint} />
        ) : roomHint ? (
          <ToolHintLine hint={roomHint} />
        ) : propHint ? (
          <ToolHintLine hint={propHint} />
        ) : lightHint ? (
          <ToolHintLine hint={lightHint} />
        ) : labelTool && labelMissText ? (
          <ToolHintLine hint={{ label: 'Label', segments: [{ text: labelMissText }] }} />
        ) : labelTool ? (
          <ToolHintLine hint={LABEL_TOOL_HINT} />
        ) : stripFocused ? (
          <ToolHintLine hint={STRIP_HINT} />
        ) : selectHint ? (
          <ToolHintLine hint={selectHint} />
        ) : null}
      </span>

      {/* The way out of solo is a chip of its own, so no hint line ever hides it. */}
      {soloName && (
        <button type="button" className="v2-status__chip" data-testid="v2-solo-chip" onClick={() => useStore.getState().clearSolo()}>
          Soloing {soloName}
          <X size={11} />
        </button>
      )}
      <MarqueeChip />
      <GridControl />
      <LitChip />
      <span className="v2-status__sep" />
      <div className="v2-status__zoom">
        <button
          type="button"
          className="v2-ib"
          aria-label="Zoom out"
          onClick={() => setZoomAtCentre(Math.max(sliderToZoom(0), zoom / ZOOM_STEP))}
        >
          <Minus size={12} />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={sliderVal}
          aria-label="Zoom"
          className="v2-range"
          style={{ '--v2-fill': `${pct}%` } as CSSProperties}
          onChange={(e) => setZoomAtCentre(sliderToZoom(parseFloat(e.target.value)))}
        />
        <button
          type="button"
          className="v2-ib"
          aria-label="Zoom in"
          onClick={() => setZoomAtCentre(Math.min(sliderToZoom(1), zoom * ZOOM_STEP))}
        >
          <Plus size={12} />
        </button>
        <span className="v2-status__pct" data-testid="v2-zoom-pct">
          {pct}%
        </span>
      </div>
      <span className="v2-status__sep" />
      <button type="button" className="v2-status__fit" onClick={fitToContent} data-tip="Fit to content" data-tip-key="Ctrl 0">
        Fit
      </button>
    </footer>
  );
}

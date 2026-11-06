import { useEffect, useMemo, useState } from 'react';
import { CircleHelp, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { IconKeyButton, StatusChip } from '@/editor/components';
import { Button } from '@/ui/button';
import { Kbd } from '@/ui/kbd';
import { useStore } from '@/store/store';
import { rulerMeasurement } from '@/engine/rulerMeasurement';
import { editHint } from '@/editor/statusHints';
import { currentZoom, DEFAULT_ZOOM, fitToContent, zoomPercent } from '@/editor/zoomControl';
import { useDropTarget } from '@/v2/editor/dropToLayer';
import { toggleSolo } from '@/v2/editor/layerActions';
import { setLitPreview, useLitPreview } from '@/v2/viewPrefs';
import type { HintLine } from '@/editor/registry';
import { useShell } from '@/editor/shell/shellStore';
import { useActiveTool } from './hooks';

const SNAP_FRACTION: Record<number, string> = { 1: '1', 2: '½', 3: '⅓', 4: '¼', 6: '⅙', 8: '⅛' };

const chipButton = 'h-7 rounded-none px-0 font-mono text-[11px] font-normal text-text-3 hover:bg-transparent hover:text-text';

function Hint({ line }: { line: HintLine }) {
  return (
    <StatusChip className="gap-1.5 text-text-2" data-testid="shell-status-hint">
      {line.segments.map((seg, i) => (seg.key ? <Kbd key={i}>{seg.text}</Kbd> : <span key={i}>{seg.text}</span>))}
    </StatusChip>
  );
}

/** The live zoom and ruler, which live outside the store: polled once a frame. */
function useLiveView(): { zoom: number; ruler: string } {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [ruler, setRuler] = useState('');
  const cellScale = useStore((s) => s.mapSettings.cellScale);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const z = currentZoom();
      if (z !== null) setZoom((p) => (Math.abs(p - z) > 0.01 ? z : p));
      const m = rulerMeasurement.current;
      const next = m ? `${(m.cells * cellScale.value).toFixed(1)}${cellScale.unit} · ${m.cells.toFixed(1)} sq` : '';
      setRuler((p) => (p !== next ? next : p));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cellScale]);
  return { zoom, ruler };
}

/**
 * The bottom bar, 28 tall in mono 11: grid, snap and lit, then one hint slot (a drop
 * target, a live ruler, the node editor's keys, else the tool in hand's own line), the
 * solo chip, zoom with Fit, and help last.
 */
export function StatusBar() {
  const grid = useStore(useShallow((s) => ({ visible: s.grid.visible, snap: s.grid.snapEnabled, division: s.grid.snapDivision })));
  const cellScale = useStore((s) => s.mapSettings.cellScale);
  const lit = useLitPreview();
  const solo = useStore((s) => {
    const id = s.ui.solo?.layerId;
    const layer = id ? s.layers.find((l) => l.id === id) : undefined;
    return layer ? { id: layer.id, name: layer.name || 'Unnamed layer' } : null;
  });
  const tool = useActiveTool();
  const toolHintKey = useStore((s) => (tool ? JSON.stringify(tool.hint(s)) : ''));
  const toolHint = useMemo(() => (toolHintKey ? (JSON.parse(toolHintKey) as HintLine) : null), [toolHintKey]);
  const nodeTools = useStore(
    useShallow((s) => ({
      nodeEditWallId: s.tools.nodeEditWallId,
      shapeNodeEditId: s.tools.shapeNodeEditId,
      selectedNodeT: s.tools.selectedNodeT,
      selectedNodeTs: s.tools.selectedNodeTs,
    })),
  );
  const node = useMemo(() => editHint(nodeTools), [nodeTools]);
  const drop = useDropTarget();
  const flyout = useShell((s) => s.flyout !== null);
  const { zoom, ruler } = useLiveView();

  let hint: HintLine | null = toolHint;
  if (drop) hint = { label: 'Move', segments: [{ text: `Release to move to ${drop.name}` }] };
  else if (ruler) hint = { label: 'Measure', segments: [{ text: ruler }] };
  else if (node) hint = { label: node.label, segments: [{ text: `${node.label} ·` }, ...node.segments] };
  else if (!tool || flyout) hint = { label: '', segments: [{ text: 'Pick a tool' }] };

  return (
    <footer
      className="absolute right-0 bottom-0 left-14 z-10 flex h-7 items-center gap-4 border-t border-line bg-panel pr-2 pl-3"
      data-testid="shell-status"
      data-chrome
      data-keys="canvas"
    >
      <Button variant="ghost" className={chipButton} aria-pressed={grid.visible} data-tip="Show grid" onClick={() => useStore.getState().setGridVisible(!grid.visible)}>
        Grid {cellScale.value} {cellScale.unit}
      </Button>
      <Button variant="ghost" className={chipButton} aria-pressed={grid.snap} data-tip="Snap to grid" onClick={() => useStore.getState().setSnapEnabled(!grid.snap)}>
        Snap {grid.snap ? SNAP_FRACTION[grid.division] : 'off'}
      </Button>
      <Button variant="ghost" className={chipButton} aria-pressed={lit} data-tip="Lit preview" data-tip-key="I" onClick={() => setLitPreview(!lit)}>
        Lit · {lit ? 'on' : 'off'}
      </Button>
      {hint && <Hint line={hint} />}
      <span className="flex-1" />
      {solo && (
        <Button variant="ghost" className={`${chipButton} gap-1.5 text-text-2`} data-testid="shell-solo" onClick={() => toggleSolo(solo.id)}>
          Solo {solo.name}
          <X aria-hidden strokeWidth={1.75} className="size-3" />
        </Button>
      )}
      <StatusChip>
        <Button variant="ghost" className={`${chipButton} gap-2`} data-tip="Fit to content" onClick={() => fitToContent()}>
          Fit <Kbd>0</Kbd>
        </Button>
        · {zoomPercent(zoom)}%
      </StatusChip>
      <IconKeyButton
        icon={CircleHelp}
        label="Keyboard shortcuts"
        shortcut="?"
        iconSize={14}
        data-testid="shell-help"
        data-tip="Keyboard shortcuts"
        onClick={() => useShell.getState().openSheet('shortcuts')}
      />
    </footer>
  );
}

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '@/store/store';
import { TERRAIN_PANEL_ID, type DungeonLayer, type Layer, type SublayerVisibility } from '@/store/types';
import { LayerStyleChangeCommand, PropertyCommand, TerrainAppearanceCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { cn } from '@/lib/utils';
import { Slider, Switch } from './controls';
import { SlideOver } from './SlideOver';
import { checkRename, sheetSections, showRows } from './layerSheetModel';
import './layer-sheet.css';

const pct = (v: number) => `${Math.round(v)}%`;
const cells = (v: number) => `${v.toFixed(2)} cells`;

/** `headless` for a section whose one control already says what it is (Opacity). */
function Section({ title, headless, children }: { title: string; headless?: boolean; children: ReactNode }) {
  return (
    <section className="v2-lsheet__sec" aria-label={title}>
      {!headless && <h3 className="v2-lsheet__head">{title}</h3>}
      {children}
    </section>
  );
}

/** A text field that commits on Enter or blur, reverts on Escape, and refuses blank. */
function NameInput({
  value,
  label,
  emptyNote,
  autoFocus,
  onCommit,
  onDone,
}: {
  value: string;
  label: string;
  emptyNote: string;
  autoFocus?: boolean;
  onCommit: (name: string) => void;
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const cancel = useRef(false);

  // Follow renames made elsewhere (undo, the layer list) while the field is idle:
  // adjusted during render, so the field never paints one frame with the old name.
  const [seen, setSeen] = useState(value);
  if (!focused && seen !== value) {
    setSeen(value);
    setDraft(value);
  }

  const finish = () => {
    setFocused(false);
    if (cancel.current) {
      cancel.current = false;
      setDraft(value);
    } else {
      const out = checkRename(draft, value);
      if (out.kind === 'commit') onCommit(out.name);
      setDraft(out.kind === 'commit' ? out.name : value);
    }
    onDone?.();
  };

  const empty = focused && draft.trim() === '';
  return (
    <>
      <input
        className="v2-field v2-lsheet__input"
        value={draft}
        aria-label={label}
        aria-invalid={empty || undefined}
        spellCheck={false}
        autoFocus={autoFocus}
        onFocus={(e) => {
          setFocused(true);
          if (autoFocus) e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            cancel.current = true;
            e.currentTarget.blur();
          }
        }}
      />
      {empty && <p className="v2-lsheet__note">{emptyNote}</p>}
    </>
  );
}

function NameSection({ layer }: { layer: Layer }) {
  return (
    <Section title="Name">
      <NameInput
        value={layer.name}
        label="Layer name"
        emptyNote="A layer needs a name. Leave the field to keep the old one."
        onCommit={(name) =>
          undoManager.execute(
            new PropertyCommand('Rename layer', { type: 'layer', layerId: layer.id }, { name: layer.name }, { name }),
          )
        }
      />
    </Section>
  );
}

function OpacitySection({ layer }: { layer: Layer }) {
  return (
    <Section title="Opacity" headless>
      <Slider
        label="Opacity"
        value={layer.opacity * 100}
        min={0}
        max={100}
        step={1}
        format={pct}
        onChange={(v) => useStore.getState().updateLayer(layer.id, { opacity: v / 100 })}
        onCommit={(v, start) => {
          if (v === start) return;
          undoManager.execute(
            new PropertyCommand(
              'Layer opacity',
              { type: 'layer', layerId: layer.id },
              { opacity: start / 100 },
              { opacity: v / 100 },
            ),
          );
        }}
      />
    </Section>
  );
}

function ShowSection({ layer }: { layer: Layer }) {
  const gridOn = useStore((s) => s.grid.visible);
  const vis = (layer as DungeonLayer).sublayerVisibility;
  const set = (key: keyof SublayerVisibility, label: string, v: boolean) =>
    undoManager.execute(
      new PropertyCommand(
        `${v ? 'Show' : 'Hide'} ${label.toLowerCase()}`,
        { type: 'layer', layerId: layer.id },
        { sublayerVisibility: { ...vis } },
        { sublayerVisibility: { ...vis, [key]: v } },
      ),
    );
  return (
    <Section title="Show">
      {showRows(layer).map(({ key, label }) => (
        <div key={key} className={cn('v2-lsheet__row', key === 'grid' && !gridOn && 'v2-lsheet__row--muted')}>
          <Switch label={label} checked={vis[key]} onChange={(v) => set(key, label, v)} />
          {key === 'grid' && !gridOn && <p className="v2-lsheet__note">Grid is hidden for the whole map</p>}
        </div>
      ))}
    </Section>
  );
}

function EdgesSection({ layer }: { layer: DungeonLayer }) {
  const on = layer.style.showEdgeTransitions;
  const width = layer.style.edgeTransitionWidth ?? 0.5;
  const patchWidth = (v: number) => {
    const live = useStore.getState().layers.find((l) => l.id === layer.id);
    if (live?.type !== 'dungeon') return;
    useStore.getState().updateLayer(layer.id, { style: { ...live.style, edgeTransitionWidth: v } } as Partial<Layer>);
  };
  return (
    <Section title="Edges">
      <div className="v2-lsheet__row">
        <Switch
          label="Blend textures where floors meet"
          checked={on}
          onChange={(v) =>
            undoManager.execute(
              new LayerStyleChangeCommand(
                v ? 'Blend floor edges' : 'Hard floor edges',
                layer.id,
                'showEdgeTransitions',
                on,
                v,
              ),
            )
          }
        />
      </div>
      {on && (
        <Slider
          label="Width"
          value={width}
          min={0.05}
          max={2}
          step={0.05}
          format={cells}
          onChange={patchWidth}
          onCommit={(v, start) => {
            if (v === start) return;
            undoManager.execute(new LayerStyleChangeCommand('Edge width', layer.id, 'edgeTransitionWidth', start, v));
          }}
        />
      )}
    </Section>
  );
}

function TerrainBody() {
  const visible = useStore((s) => s.mapSettings.terrain?.visible ?? true);
  const opacity = useStore((s) => s.mapSettings.terrain?.opacity ?? 1);
  return (
    <Section title="Appearance">
      <div className="v2-lsheet__row">
        <Switch
          label="Visible"
          checked={visible}
          onChange={(v) => undoManager.execute(new TerrainAppearanceCommand({ visible }, { visible: v }))}
        />
      </div>
      <Slider
        label="Opacity"
        value={opacity * 100}
        min={0}
        max={100}
        step={1}
        format={pct}
        onChange={(v) => useStore.getState().setTerrainData({ opacity: v / 100 })}
        onCommit={(v, start) => {
          if (v === start) return;
          undoManager.execute(new TerrainAppearanceCommand({ opacity: start / 100 }, { opacity: v / 100 }));
        }}
      />
    </Section>
  );
}

/**
 * Per-layer settings the dock has no room for: name, opacity, which parts show, floor
 * edges and rooms. `target` is a layer id or the terrain pseudo-layer; null is closed.
 */
export function LayerSheet({ target, onClose }: { target: string | null; onClose: () => void }) {
  const layer = useStore((s) =>
    target && target !== TERRAIN_PANEL_ID ? s.layers.find((l) => l.id === target) : undefined,
  );
  const terrain = target === TERRAIN_PANEL_ID;
  const open = terrain || !!layer;

  // The layer went away under the sheet (deleted, undone): close rather than show nothing.
  useEffect(() => {
    if (target && !open) onClose();
  }, [target, open, onClose]);

  const sections = terrain ? sheetSections('terrain') : layer ? sheetSections(layer) : [];
  const title = terrain ? 'Terrain' : layer?.name || 'Unnamed layer';

  return (
    <SlideOver title={title} open={open} onClose={onClose} testId="v2-layer-sheet">
      <div className="v2-lsheet">
        {terrain && <TerrainBody />}
        {layer && (
          <Fragment key={layer.id}>
            {sections.includes('name') && <NameSection layer={layer} />}
            {sections.includes('opacity') && <OpacitySection layer={layer} />}
            {sections.includes('show') && <ShowSection layer={layer} />}
            {layer.type === 'dungeon' && sections.includes('edges') && <EdgesSection layer={layer} />}
          </Fragment>
        )}
      </div>
    </SlideOver>
  );
}

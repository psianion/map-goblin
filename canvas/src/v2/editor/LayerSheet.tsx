import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, FolderInput, Trash2 } from 'lucide-react';
import { useStore } from '@/store/store';
import { isOnShownLevel } from '@/store/selectors';
import { TERRAIN_PANEL_ID, type BackgroundLayer, type DungeonLayer, type Layer, type SublayerVisibility } from '@/store/types';
import { PackThumbnailCanvas } from '@/components/shared/PackThumbnailCanvas';
import { LayerStyleChangeCommand, PropertyCommand, TerrainAppearanceCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { cn } from '@/lib/utils';
import { ColorCtl, Slider, Switch } from './controls';
import { SlideOver } from './SlideOver';
import { checkRename, rowShown, sheetSections, showRows } from './layerSheetModel';
import { FloatMenu, type FloatMenuEntry } from './FloatMenu';
import { deleteLayer, duplicateLayer, moveLayerToLevel, toggleLayerLocked, toggleSolo } from './layerActions';
import { layerDeleteBlock } from '@dnd/core/src/store/layerCommands';
import { getEntriesByType } from '@dnd/core/src/assets/packCatalog';
import './rooms.css';
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
          <Switch label={label} checked={rowShown(vis, key)} onChange={(v) => set(key, label, v)} />
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

/** The layer verbs that used to need the v1 panel (board L5): Lock, Solo, Duplicate, Move, Delete. */
function ActionsSection({ layer }: { layer: DungeonLayer }) {
  const soloed = useStore((s) => s.ui.solo?.layerId === layer.id);
  const levels = useStore((s) => s.levels);
  const deleteBlock = useStore((s) => layerDeleteBlock(s, layer.id));
  const [moveOpen, setMoveOpen] = useState(false);
  const moveRef = useRef<HTMLButtonElement>(null);
  const moveEntries: FloatMenuEntry[] = levels
    .filter((l) => l.id !== layer.levelId)
    .map((l) => ({ label: l.name || 'Unnamed level', onSelect: () => moveLayerToLevel(layer.id, l.id) }));
  return (
    <Section title="Layer">
      <div className="v2-lsheet__row">
        <Switch label="Lock" checked={layer.locked} onChange={() => toggleLayerLocked(layer)} />
      </div>
      <div className="v2-lsheet__row">
        <Switch label="Solo" checked={soloed} onChange={() => toggleSolo(layer.id)} />
      </div>
      <div className="v2-lsheet__btnrow">
        <button type="button" className="v2-rbtn" data-testid="v2-lsheet-duplicate" onClick={() => duplicateLayer(layer.id)}>
          <Copy size={14} strokeWidth={1.75} />
          Duplicate
        </button>
        <button
          ref={moveRef}
          type="button"
          className="v2-rbtn"
          disabled={levels.length < 2}
          data-testid="v2-lsheet-move"
          onClick={() => setMoveOpen((o) => !o)}
        >
          <FolderInput size={14} strokeWidth={1.75} />
          Move to level
        </button>
        <button
          type="button"
          className="v2-rbtn"
          disabled={deleteBlock !== null}
          data-tip={deleteBlock ?? undefined}
          data-testid="v2-lsheet-delete"
          onClick={() => deleteLayer(layer.id)}
        >
          <Trash2 size={14} strokeWidth={1.75} />
          Delete
        </button>
      </div>
      <FloatMenu open={moveOpen} onClose={() => setMoveOpen(false)} label="Move to level" entries={moveEntries} anchor={moveRef} />
    </Section>
  );
}

/** A #rrggbb from what was typed (with or without #, three or six digits), or null. */
function parseHex(raw: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

/** One undoable field write on the background. */
function setBackground(layer: BackgroundLayer, label: string, before: Partial<BackgroundLayer>, after: Partial<BackgroundLayer>) {
  undoManager.execute(new PropertyCommand(label, { type: 'layer', layerId: layer.id }, before, after));
}

/** The background under every level (board L5): colour, a floor texture, its scale and tint. */
function BackgroundSection({ layer }: { layer: BackgroundLayer }) {
  // Pack thumbnails arrive after boot; re-read the catalogue when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  const textures = getEntriesByType('floor');
  const [hex, setHex] = useState(layer.backgroundColor);
  const [seenColour, setSeenColour] = useState(layer.backgroundColor);
  if (seenColour !== layer.backgroundColor) {
    setSeenColour(layer.backgroundColor);
    setHex(layer.backgroundColor);
  }
  const live = (patch: Partial<BackgroundLayer>) => useStore.getState().updateLayer(layer.id, patch as Partial<Layer>);
  const submitHex = () => {
    const next = parseHex(hex);
    if (next && next !== layer.backgroundColor) setBackground(layer, 'Background colour', { backgroundColor: layer.backgroundColor }, { backgroundColor: next });
    else setHex(layer.backgroundColor);
  };
  const pickTexture = (id: string | null) => {
    if (id === layer.backgroundTexture) return;
    setBackground(layer, 'Background texture', { backgroundTexture: layer.backgroundTexture }, { backgroundTexture: id });
  };
  return (
    <>
      <Section title="Colour">
        <div className="v2-lsheet__colour">
          <ColorCtl
            label="Background"
            value={layer.backgroundColor}
            placement="beside"
            onChange={(c) => live({ backgroundColor: c })}
            onCommit={(c, start) => {
              if (c !== start) setBackground(layer, 'Background colour', { backgroundColor: start }, { backgroundColor: c });
            }}
          />
          <input
            className="v2-field v2-lsheet__input v2-lsheet__hex v2-num"
            aria-label="Background hex"
            value={hex}
            maxLength={7}
            spellCheck={false}
            onChange={(e) => setHex(e.target.value)}
            onBlur={submitHex}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitHex();
              else if (e.key === 'Escape') setHex(layer.backgroundColor);
            }}
          />
          <span className="v2-lsheet__note">Under every level</span>
        </div>
      </Section>
      <Section title="Texture">
        <div className="v2-lsheet__texgrid" role="group" aria-label="Background texture">
          <button
            type="button"
            className={cn('v2-lsheet__tex', !layer.backgroundTexture && 'v2-lsheet__tex--on')}
            aria-pressed={!layer.backgroundTexture}
            aria-label="None"
            onClick={() => pickTexture(null)}
          >
            <span className="v2-lsheet__texnone" style={{ background: layer.backgroundColor }} />
            <span className="v2-lsheet__texname">None</span>
          </button>
          {textures.map((t) => (
            <button
              key={t.id}
              type="button"
              className={cn('v2-lsheet__tex', layer.backgroundTexture === t.id && 'v2-lsheet__tex--on')}
              aria-pressed={layer.backgroundTexture === t.id}
              aria-label={t.label}
              data-tip={t.label}
              onClick={() => pickTexture(t.id)}
            >
              <PackThumbnailCanvas textureId={t.id} fit="cover" />
              <span className="v2-lsheet__texname">{t.label}</span>
            </button>
          ))}
        </div>
        {layer.backgroundTexture && (
          <>
            <Slider
              label="Texture scale"
              value={layer.textureScale}
              min={0.1}
              max={4}
              step={0.05}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(v) => live({ textureScale: v })}
              onCommit={(v, start) => {
                if (v !== start) setBackground(layer, 'Texture scale', { textureScale: start }, { textureScale: v });
              }}
            />
            <ColorCtl
              label="Tint"
              value={layer.textureTint}
              placement="beside"
              onChange={(c) => live({ textureTint: c })}
              onCommit={(c, start) => {
                if (c !== start) setBackground(layer, 'Texture tint', { textureTint: start }, { textureTint: c });
              }}
            />
          </>
        )}
      </Section>
    </>
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
  const layer = useStore((s) => {
    if (!target || target === TERRAIN_PANEL_ID) return undefined;
    const found = s.layers.find((l) => l.id === target);
    // A layer the level on show does not hold has no sheet here (moved away, level switched).
    return found && isOnShownLevel(s, found) ? found : undefined;
  });
  const terrain = target === TERRAIN_PANEL_ID;
  const open = terrain || !!layer;

  // The layer went away under the sheet (deleted, undone, moved to another level, or the
  // level on show changed): close rather than show nothing.
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
            {layer.type === 'background' && sections.includes('background') && <BackgroundSection layer={layer} />}
            {sections.includes('opacity') && <OpacitySection layer={layer} />}
            {sections.includes('show') && <ShowSection layer={layer} />}
            {layer.type === 'dungeon' && sections.includes('edges') && <EdgesSection layer={layer} />}
            {layer.type === 'dungeon' && sections.includes('actions') && <ActionsSection layer={layer} />}
          </Fragment>
        )}
      </div>
    </SlideOver>
  );
}

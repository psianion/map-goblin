import { useEffect, useState, type ReactNode } from 'react';
import { Copy, FolderInput, Trash2 } from 'lucide-react';
import { Caption, ColourRow, InputRow, SecondaryButton, SliderRow, SwitchRow, Tile } from '@/editor/components';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { useStore } from '@/store/store';
import { isOnShownLevel } from '@/store/selectors';
import { TERRAIN_PANEL_ID, type BackgroundLayer, type DungeonLayer, type Layer, type SublayerVisibility } from '@/store/types';
import { LayerStyleChangeCommand, PropertyCommand, TerrainAppearanceCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { PackThumbnailCanvas } from '@/editor/PackThumbnailCanvas';
import { getEntriesByType } from '@dnd/core/src/assets/packCatalog';
import { layerDeleteBlock } from '@dnd/core/src/store/layerCommands';
import { checkRename, rowShown, sheetSections, showRows } from '@/editor/models/layerSheetModel';
import { deleteLayer, duplicateLayer, moveLayerToLevel, toggleLayerLocked, toggleSolo } from '@/editor/models/layerActions';
import { SheetFrame } from './SheetFrame';
import { useLiveEdit } from './liveEdit';

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-px" data-section={title ?? ''}>
      {title && <Caption className="mb-1.5">{title}</Caption>}
      {children}
    </section>
  );
}

const note = 'text-[11px] leading-snug text-text-3';
const layerTarget = (layer: Layer) => ({ type: 'layer' as const, layerId: layer.id });

/** The layer, live: what the sheet reads at the end of a gesture. */
const liveLayer = <T extends Layer>(id: string) => useStore.getState().layers.find((l) => l.id === id) as T | undefined;

/** A name that commits on Enter or leaving the field, reverts on Escape, and refuses blank. */
function NameSection({ layer }: { layer: Layer }) {
  const [draft, setDraft] = useState(layer.name);
  const [seen, setSeen] = useState(layer.name);
  // A rename from elsewhere (undo, the layer list) shows at once.
  if (seen !== layer.name) {
    setSeen(layer.name);
    setDraft(layer.name);
  }
  const commit = () => {
    const out = checkRename(draft, layer.name);
    if (out.kind === 'commit') undoManager.execute(new PropertyCommand('Rename layer', layerTarget(layer), { name: layer.name }, { name: out.name }));
    else setDraft(layer.name);
  };
  return (
    <Section title="Name">
      <InputRow
        label="Layer name"
        value={draft}
        spellCheck={false}
        aria-invalid={draft.trim() === '' || undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            setDraft(layer.name);
            e.stopPropagation();
          }
        }}
      />
      {draft.trim() === '' && <p className={note}>A layer needs a name. Leave the field to keep the old one.</p>}
    </Section>
  );
}

function OpacitySection({ layer }: { layer: Layer }) {
  const edit = useLiveEdit(
    () => liveLayer(layer.id)?.opacity ?? layer.opacity,
    (v: number) => useStore.getState().updateLayer(layer.id, { opacity: v }),
    (start, end) => undoManager.execute(new PropertyCommand('Layer opacity', layerTarget(layer), { opacity: start }, { opacity: end })),
  );
  return (
    <Section>
      <div {...edit.wrap}>
        <SliderRow label="Opacity" value={layer.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onValueChange={edit.change} />
      </div>
    </Section>
  );
}

function ShowSection({ layer }: { layer: Layer }) {
  const gridOn = useStore((s) => s.grid.visible);
  const vis = (layer as DungeonLayer).sublayerVisibility;
  const set = (key: keyof SublayerVisibility, label: string, v: boolean) =>
    undoManager.execute(
      new PropertyCommand(`${v ? 'Show' : 'Hide'} ${label.toLowerCase()}`, layerTarget(layer), { sublayerVisibility: { ...vis } }, { sublayerVisibility: { ...vis, [key]: v } }),
    );
  return (
    <Section title="Show">
      {showRows(layer).map(({ key, label }) => (
        <div key={key} className={key === 'grid' && !gridOn ? 'opacity-60' : undefined}>
          <SwitchRow label={label} checked={rowShown(vis, key)} onCheckedChange={(v) => set(key, label, v)} />
          {key === 'grid' && !gridOn && <p className={note}>Grid is hidden for the whole map</p>}
        </div>
      ))}
    </Section>
  );
}

function EdgesSection({ layer }: { layer: DungeonLayer }) {
  const on = layer.style.showEdgeTransitions;
  const width = layer.style.edgeTransitionWidth ?? 0.5;
  const edit = useLiveEdit(
    () => liveLayer<DungeonLayer>(layer.id)?.style.edgeTransitionWidth ?? 0.5,
    (v: number) => {
      const live = liveLayer<DungeonLayer>(layer.id);
      if (live) useStore.getState().updateLayer(layer.id, { style: { ...live.style, edgeTransitionWidth: v } } as Partial<Layer>);
    },
    (start, end) => undoManager.execute(new LayerStyleChangeCommand('Edge width', layer.id, 'edgeTransitionWidth', start, end)),
  );
  return (
    <Section title="Edges">
      <SwitchRow
        label="Blend textures where floors meet"
        checked={on}
        onCheckedChange={(v) =>
          undoManager.execute(new LayerStyleChangeCommand(v ? 'Blend floor edges' : 'Hard floor edges', layer.id, 'showEdgeTransitions', on, v))
        }
      />
      {on && (
        <div {...edit.wrap}>
          <SliderRow label="Width" value={width} min={0.05} max={2} step={0.05} format={(v) => `${v.toFixed(2)} cells`} onValueChange={edit.change} />
        </div>
      )}
    </Section>
  );
}

/** The layer verbs: Lock, Solo, Duplicate, Move to level, Delete. */
function ActionsSection({ layer }: { layer: DungeonLayer }) {
  const soloed = useStore((s) => s.ui.solo?.layerId === layer.id);
  const levels = useStore((s) => s.levels);
  const deleteBlock = useStore((s) => layerDeleteBlock(s, layer.id));
  return (
    <Section title="Layer">
      <SwitchRow label="Lock" checked={layer.locked} onCheckedChange={() => toggleLayerLocked(layer)} />
      <SwitchRow label="Solo" checked={soloed} onCheckedChange={() => toggleSolo(layer.id)} />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <SecondaryButton icon={Copy} data-testid="shell-lsheet-duplicate" onClick={() => duplicateLayer(layer.id)}>
          Duplicate
        </SecondaryButton>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={levels.length < 2}
            render={
              <SecondaryButton icon={FolderInput} data-testid="shell-lsheet-move">
                Move to level
              </SecondaryButton>
            }
          />
          <DropdownMenuContent align="start">
            {levels
              .filter((l) => l.id !== layer.levelId)
              .map((l) => (
                <DropdownMenuItem key={l.id} onClick={() => moveLayerToLevel(layer.id, l.id)}>
                  {l.name || 'Unnamed level'}
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <SecondaryButton
          icon={Trash2}
          disabled={deleteBlock !== null}
          data-tip={deleteBlock ?? undefined}
          data-testid="shell-lsheet-delete"
          onClick={() => deleteLayer(layer.id)}
        >
          Delete
        </SecondaryButton>
      </div>
    </Section>
  );
}

/** One undoable write on the background. */
function setBackground(layer: BackgroundLayer, label: string, before: Partial<BackgroundLayer>, after: Partial<BackgroundLayer>) {
  undoManager.execute(new PropertyCommand(label, layerTarget(layer), before, after));
}

/** The background under every level: colour, a floor texture, its scale and tint. */
function BackgroundSection({ layer }: { layer: BackgroundLayer }) {
  // Pack thumbnails arrive after boot; re-read the catalogue when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  const textures = getEntriesByType('floor');
  const live = (patch: Partial<BackgroundLayer>) => useStore.getState().updateLayer(layer.id, patch as Partial<Layer>);
  const read = <K extends keyof BackgroundLayer>(key: K) => () => (liveLayer<BackgroundLayer>(layer.id) ?? layer)[key];
  const colour = useLiveEdit(read('backgroundColor'), (c: string) => live({ backgroundColor: c }), (start, end) =>
    setBackground(layer, 'Background colour', { backgroundColor: start }, { backgroundColor: end }),
  );
  const scale = useLiveEdit(read('textureScale'), (v: number) => live({ textureScale: v }), (start, end) =>
    setBackground(layer, 'Texture scale', { textureScale: start }, { textureScale: end }),
  );
  const tint = useLiveEdit(read('textureTint'), (c: string) => live({ textureTint: c }), (start, end) =>
    setBackground(layer, 'Texture tint', { textureTint: start }, { textureTint: end }),
  );
  const pickTexture = (id: string | null) => {
    if (id !== layer.backgroundTexture) setBackground(layer, 'Background texture', { backgroundTexture: layer.backgroundTexture }, { backgroundTexture: id });
  };
  return (
    <>
      <Section title="Colour">
        <div {...colour.wrap}>
          <ColourRow label="Background" value={layer.backgroundColor} onValueChange={colour.change} />
        </div>
        <p className={note}>Under every level</p>
      </Section>
      <Section title="Texture">
        <div className="grid grid-cols-4 justify-between gap-y-2" role="group" aria-label="Background texture">
          <Tile name="None" color={layer.backgroundColor} active={!layer.backgroundTexture} onClick={() => pickTexture(null)} />
          {textures.map((t) => (
            <Tile key={t.id} name={t.label} title={t.label} active={layer.backgroundTexture === t.id} onClick={() => pickTexture(t.id)}>
              <PackThumbnailCanvas textureId={t.id} fit="cover" />
            </Tile>
          ))}
        </div>
        {layer.backgroundTexture && (
          <div className="mt-2 flex flex-col gap-px">
            <div {...scale.wrap}>
              <SliderRow label="Texture scale" value={layer.textureScale} min={0.1} max={4} step={0.05} format={(v) => `${v.toFixed(2)}×`} onValueChange={scale.change} />
            </div>
            <div {...tint.wrap}>
              <ColourRow label="Tint" value={layer.textureTint} onValueChange={tint.change} />
            </div>
          </div>
        )}
      </Section>
    </>
  );
}

function TerrainBody() {
  const visible = useStore((s) => s.mapSettings.terrain?.visible ?? true);
  const opacity = useStore((s) => s.mapSettings.terrain?.opacity ?? 1);
  const edit = useLiveEdit(
    () => useStore.getState().mapSettings.terrain?.opacity ?? 1,
    (v: number) => useStore.getState().setTerrainData({ opacity: v }),
    (start, end) => undoManager.execute(new TerrainAppearanceCommand({ opacity: start }, { opacity: end })),
  );
  return (
    <Section title="Appearance">
      <SwitchRow label="Visible" checked={visible} onCheckedChange={(v) => undoManager.execute(new TerrainAppearanceCommand({ visible }, { visible: v }))} />
      <div {...edit.wrap}>
        <SliderRow label="Opacity" value={opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onValueChange={edit.change} />
      </div>
    </Section>
  );
}

/**
 * One layer's settings: name, opacity, which parts show, floor edges and the layer verbs;
 * the background's colour and texture; the terrain's look. `target` is a layer id or the
 * terrain pseudo-layer.
 */
export function LayerSheet({ target, onClose }: { target: string; onClose: () => void }) {
  const layer = useStore((s) => {
    if (target === TERRAIN_PANEL_ID) return undefined;
    const found = s.layers.find((l) => l.id === target);
    // A layer the level on show does not hold has no sheet here (moved away, level switched).
    return found && isOnShownLevel(s, found) ? found : undefined;
  });
  const terrain = target === TERRAIN_PANEL_ID;
  const open = terrain || !!layer;

  // The layer went away under the sheet (deleted, undone, moved, level switched): close.
  useEffect(() => {
    if (!open) onClose();
  }, [open, onClose]);

  if (!open) return null;
  const sections = terrain ? sheetSections('terrain') : layer ? sheetSections(layer) : [];
  return (
    <SheetFrame title={terrain ? 'Terrain' : layer?.name || 'Unnamed layer'} onClose={onClose} testId="shell-layer-sheet">
      <div className="flex flex-col gap-2.5 px-3 pt-2.5 pb-3" key={layer?.id ?? 'terrain'}>
        {terrain && <TerrainBody />}
        {layer && (
          <>
            {sections.includes('name') && <NameSection layer={layer} />}
            {layer.type === 'background' && sections.includes('background') && <BackgroundSection layer={layer} />}
            {sections.includes('opacity') && <OpacitySection layer={layer} />}
            {sections.includes('show') && <ShowSection layer={layer} />}
            {layer.type === 'dungeon' && sections.includes('edges') && <EdgesSection layer={layer} />}
            {layer.type === 'dungeon' && sections.includes('actions') && <ActionsSection layer={layer} />}
          </>
        )}
      </div>
    </SheetFrame>
  );
}

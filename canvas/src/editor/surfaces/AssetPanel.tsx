import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Caption, Chip, FloatBox, IconKeyButton, PanelHeader, SecondaryButton, Tile } from '@/editor/components';
import { Input } from '@/ui/input';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { createSwapPropCommand } from '@dnd/core/src/store/propEdits';
import { PackThumbnailCanvas } from '@/editor/PackThumbnailCanvas';
import { pickAssetForTool } from '@/editor/models/assetStrip';
import { useShell } from '@/editor/shell/shellStore';
import { ASSET_CHIPS, assetTiles, byPack, usedIds, type AssetChip } from './assetModel';

/** Tiles drawn before "Show more": every tile draws its own thumbnail. */
const PAGE = 96;

/** A pick from the library: replaces the props a card asked to replace, else goes to the tool in hand. */
function pick(id: string): void {
  const replace = useStore.getState().ui.propReplaceIds;
  if (replace) {
    const cmd = createSwapPropCommand(replace, id, 'natural');
    if (cmd) undoManager.execute(cmd);
    useStore.getState().setPropReplaceIds(null);
    return;
  }
  pickAssetForTool(id);
}

/**
 * The asset library, on demand at the right: right 12, top 68, 320 wide, its bottom 12
 * above the dock so it never covers it. Search, a chip per kind of art, Used, then each
 * pack's tiles in four columns. A pick applies as the old browser's did: a texture to the
 * look of what the tool or the selection targets, a prop to the stamp.
 */
function AssetPanelBody({ chip }: { chip: AssetChip }) {
  const packs = useStore(useShallow((s) => s.packs.installedPacks));
  const layers = useStore((s) => s.layers);
  const [query, setQuery] = useState('');
  const [used, setUsed] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const openAssets = useShell((s) => s.openAssets);
  const close = useShell((s) => s.closeAssets);

  // The catalogue changes when packs install; the pack list is the signal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => assetTiles(chip, query), [chip, query, packs]);
  const onMap = useMemo(() => usedIds(layers), [layers]);
  const tiles = used ? all.filter((t) => onMap.has(t.id)) : all;
  const groups = byPack(tiles.slice(0, limit));
  const packName = (id: string) => packs.find((p) => p.packId === id)?.name ?? id;

  return (
    <FloatBox
      className="absolute top-[68px] right-3 bottom-[164px] z-20 flex w-[320px] flex-col overflow-hidden p-0"
      data-testid="shell-assets"
      data-chip={chip}
      data-chrome
      role="complementary"
      aria-label="Assets"
    >
      <PanelHeader title="Assets">
        <span className="font-mono text-[11px] text-text-3 tabular-nums" data-testid="shell-assets-count">
          {tiles.length}
        </span>
        <IconKeyButton size={26} icon={X} label="Close assets" onClick={close} />
      </PanelHeader>
      <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-1.5">
        <label className="relative block min-w-0 flex-1">
          <Search aria-hidden strokeWidth={1.75} className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-text-3" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Search"
            aria-label="Search assets"
            className="pl-7"
          />
        </label>
          <Chip pressed={used} onPressedChange={setUsed}>
            Used
          </Chip>
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Kind">
          {ASSET_CHIPS.map((c) => (
            <Chip key={c.id} pressed={c.id === chip} onPressedChange={() => openAssets(c.id)}>
              {c.label}
            </Chip>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2.5 pb-3">
        {groups.length === 0 && (
          <p className="py-6 text-center text-[12px] text-text-3" data-testid="shell-assets-empty">
            {query.trim()
              ? `Nothing matches “${query.trim()}”.`
              : used
                ? 'Nothing of this kind is on the map yet.'
                : chip === 'lights'
                  ? 'No pack has light art yet.'
                  : 'No pack installed has this kind of art.'}
          </p>
        )}
        {groups.map((g) => (
          <section key={g.packId} className="mb-3 flex flex-col gap-1.5 last:mb-0" data-pack={g.packId}>
            <Caption>{packName(g.packId)}</Caption>
            <div className="grid grid-cols-4 justify-between gap-y-2">
              {g.tiles.map((t) => (
                <Tile key={t.key} name={t.name} title={t.name} data-asset={t.id} onClick={() => pick(t.id)}>
                  <PackThumbnailCanvas textureId={t.id} />
                </Tile>
              ))}
            </div>
          </section>
        ))}
        {tiles.length > limit && (
          <SecondaryButton className="mt-2 w-full justify-center" onClick={() => setLimit((n) => n + PAGE)}>
            Show more
          </SecondaryButton>
        )}
      </div>
    </FloatBox>
  );
}

export function AssetPanel() {
  const chip = useShell((s) => s.assets);
  if (!chip) return null;
  // A new chip starts the search afresh.
  return <AssetPanelBody key={chip} chip={chip} />;
}

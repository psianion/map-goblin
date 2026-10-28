import { useMemo, useState, type ReactNode } from 'react';
import { ChevronUp, Search, Star, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { selectChildById } from '@/store/selectors';
import { familyMembers, getCatalogEntry, propEntries, type CatalogEntry } from '@dnd/core/src/assets/packCatalog';
import { createSwapPropCommand } from '@dnd/core/src/store/propEdits';
import { PackThumbnailCanvas } from '@/components/shared/PackThumbnailCanvas';
import { cn } from '@/lib/utils';
import { pickAssetForTool } from './assetStrip';
import { familyTiles, favouriteTiles, propCategories, searchProps, usedOnMap, type FamilyTile } from './propLibrary';
import './props.css';

/*
 * The props browser (Library board): search, the four views, the pack's categories, one
 * tile per family with its members a click away, and stars. A click picks for the tool in
 * hand (Stamp takes the prop, Scatter toggles it in the pool), or, while replacing, swaps
 * the replaced props for it.
 */

type View = 'all' | 'favourites' | 'used' | 'recent';

/** Tiles drawn at first; more come as the grid scrolls, so the sheet opens at once. */
const PAGE = 60;

/** Every prop the packs offer, re-read when the packs move. */
function useProps(): CatalogEntry[] {
  const packs = useStore((s) => s.packs.installedPacks);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => propEntries(), [packs]);
}

/** The sheet's header: "Props 825" and the close button. */
export function PropBrowserHead({ onClose }: { onClose: () => void }) {
  const count = useProps().length;
  return (
    <header className="v2-sheet__head">
      <h2>
        Props <span className="v2-pbrowse__total v2-num">{count}</span>
      </h2>
      <button type="button" className="v2-ib" aria-label="Close Props" onClick={onClose}>
        <X size={15} strokeWidth={1.75} />
      </button>
    </header>
  );
}

/** A small tile for a bar (the pool, the replace bar): the thumbnail and, maybe, a ×. */
function BarTile({ id, onRemove }: { id: string; onRemove?: () => void }) {
  const label = getCatalogEntry(id)?.label ?? id;
  return (
    <span className="v2-strip__slot">
      <span className="v2-swatch v2-pbrowse__bartile" role="img" aria-label={label} data-tip={label}>
        <PackThumbnailCanvas textureId={id} />
      </span>
      {onRemove && (
        <button type="button" className="v2-pbrowse__x" aria-label={`Remove ${label} from the pool`} onClick={onRemove}>
          <X size={8} strokeWidth={2.5} />
        </button>
      )}
    </span>
  );
}

/** Scatter mode: what the brush draws from, each removable, and Clear. */
function PoolBar() {
  const ids = useStore(useShallow((s) => s.tools.settings.scatterBrush.assetIds));
  const set = (assetIds: string[]) => useStore.getState().updateScatterBrushSettings({ assetIds });
  return (
    <div className="v2-pbrowse__bar" data-testid="v2-props-pool">
      <span className="v2-pbrowse__barlbl">Scatter pool</span>
      <div className="v2-pbrowse__pool">
        {ids.length === 0 ? (
          <span className="v2-rquiet v2-pbrowse__poolempty">Click props to add them</span>
        ) : (
          ids.map((id) => <BarTile key={id} id={id} onRemove={() => set(ids.filter((x) => x !== id))} />)
        )}
      </div>
      <button type="button" className="v2-link v2-pbrowse__end" disabled={ids.length === 0} onClick={() => set([])}>
        Clear
      </button>
    </div>
  );
}

/** Replace mode: what is being replaced, and the way out. */
function ReplaceBar({ ids }: { ids: string[] }) {
  const name = useStore((s) => {
    if (ids.length !== 1) return `${ids.length} props`;
    const child = selectChildById(s, ids[0]);
    return child?.name || 'the prop';
  });
  return (
    <div className="v2-pbrowse__bar" data-testid="v2-props-replace">
      <span className="v2-pbrowse__barlbl">Click a prop to replace {name}</span>
      <button type="button" className="v2-link v2-pbrowse__end" onClick={() => useStore.getState().setPropReplaceIds(null)}>
        Cancel
      </button>
    </div>
  );
}

/** One tile: the art, a star, how often the map uses it, and the ×N that opens its family. */
function Tile({
  tile,
  small,
  used,
  open,
  onOpen,
  onPick,
}: {
  tile: FamilyTile<CatalogEntry>;
  small?: boolean;
  used: number;
  open?: boolean;
  onOpen?: () => void;
  onPick: (id: string) => void;
}) {
  const ids = tile.members.map((m) => m.id);
  // A family tile's star keeps the family (its key); a member's, in an open family, that member.
  const star = small ? tile.rep.id : tile.key;
  const starred = useStore((s) => s.assets.favourites.includes(star));
  const picked = useStore((s) => s.tools.settings.scatterBrush.assetIds.some((id) => ids.includes(id)));
  const count = onOpen ? familyMembers(tile.rep.id).length || tile.members.length : 1;
  const toggleStar = () => useStore.getState().toggleFavourite(star);
  return (
    <div className={cn('v2-ptile', small && 'v2-ptile--sm', picked && 'v2-ptile--on')} data-testid="v2-prop-tile">
      <div className="v2-ptile__box">
        <button
          type="button"
          className="v2-ptile__pk"
          aria-pressed={picked}
          aria-label={count > 1 ? `${tile.label}, ${count} in family` : tile.label}
          onClick={() => onPick(tile.rep.id)}
        >
          <PackThumbnailCanvas textureId={tile.rep.id} />
        </button>
        {used > 0 && (
          <span className="v2-ptile__used v2-num" aria-label={`Used ${used} times on this map`} data-tip={`Used ${used} times on this map`}>
            {used}
          </span>
        )}
        <button
          type="button"
          className={cn('v2-ptile__star', !starred && 'v2-ptile__star--off')}
          aria-label={starred ? 'Remove from favourites' : 'Add to favourites'}
          aria-pressed={starred}
          onClick={toggleStar}
        >
          <Star size={12} strokeWidth={2} />
        </button>
        {count > 1 && onOpen && (
          <button
            type="button"
            className={cn('v2-ptile__cnt v2-num', open && 'v2-ptile__cnt--open')}
            aria-label={open ? `Close ${tile.label} family` : `Open ${tile.label} family, ${count} variants`}
            aria-expanded={open}
            onClick={onOpen}
          >
            ×{count}
          </button>
        )}
      </div>
      <span className="v2-ptile__nm">{small ? tile.rep.label : tile.label}</span>
    </div>
  );
}

const single = (e: CatalogEntry): FamilyTile<CatalogEntry> => ({ key: e.id, rep: e, members: [e], label: e.label });

/** The members of an open family, under its tile's row. */
function FamilyBand({ tile, used, onPick, onClose }: { tile: FamilyTile<CatalogEntry>; used: Map<string, number>; onPick: (id: string) => void; onClose: () => void }) {
  const members = familyMembers(tile.rep.id);
  const list = members.length > 0 ? members : tile.members;
  const sizes = [...new Set(list.map((m) => m.gridSize))].join(', ');
  return (
    <div className="v2-pband" aria-label={`${tile.label} family`} role="group" data-testid="v2-prop-family">
      <div className="v2-pband__head">
        <span>
          {tile.label} · {list.length} variants, {sizes}
        </span>
        <button type="button" className="v2-ib v2-pband__close" aria-label="Close family" onClick={onClose}>
          <ChevronUp size={12} strokeWidth={1.75} />
        </button>
      </div>
      <div className="v2-pband__tiles">
        {list.map((m) => (
          <Tile key={m.id} tile={single(m)} small used={used.get(m.id) ?? 0} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="v2-pbrowse__empty">{children}</p>;
}

/** The props browser's body. */
export function PropBrowser() {
  const props = useProps();
  const layers = useStore((s) => s.layers);
  const favourites = useStore((s) => s.assets.favourites);
  const recent = useStore((s) => s.assets.recentlyUsed);
  const scatterInHand = useStore((s) => s.tools.activeTool === 'scatterBrush' && !s.tools.settings.scatterBrush.stampMode);
  const replaceIds = useStore(useShallow((s) => s.ui.propReplaceIds));

  const [view, setView] = useState<View>('all');
  const [category, setCategory] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const byId = useMemo(() => new Map(props.map((e) => [e.id, e])), [props]);
  const categories = useMemo(() => propCategories(props), [props]);
  const used = useMemo(() => usedOnMap(layers), [layers]);
  const usedProps = useMemo(
    () => [...used].filter(([id]) => byId.has(id)).sort((a, b) => b[1] - a[1]),
    [used, byId],
  );
  const searching = query.trim() !== '';

  const tiles = useMemo((): FamilyTile<CatalogEntry>[] => {
    const of = (ids: readonly string[]) => ids.map((id) => byId.get(id)).filter((e): e is CatalogEntry => !!e);
    if (view === 'favourites') {
      const starred = favouriteTiles(favourites, props);
      return searching ? starred.filter((t) => searchProps(t.members, query).length > 0) : starred;
    }
    if (view === 'recent') return searchProps(of(recent), query).map(single);
    if (view === 'used') return searchProps(of(usedProps.map(([id]) => id)), query).map(single);
    // Typing searches every prop whatever the category.
    const scope = searching
      ? props
      : props.filter((e) => (!category || (e.set ?? '') === category) && (!tag || e.tags.includes(tag)));
    return familyTiles(searchProps(scope, query));
  }, [view, favourites, recent, usedProps, props, byId, query, searching, category, tag]);

  const pick = (id: string) => {
    if (replaceIds) {
      const cmd = createSwapPropCommand(replaceIds, id, 'natural');
      if (cmd) undoManager.execute(cmd);
      useStore.getState().setPropReplaceIds(null);
      return;
    }
    pickAssetForTool(id);
  };
  const usedOf = (t: FamilyTile<CatalogEntry>) => t.members.reduce((n, m) => n + (used.get(m.id) ?? 0), 0);
  const chosen = categories.find((c) => c.id === category);
  const shown = tiles.slice(0, limit);

  const views: { id: View; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'favourites', label: 'Favourites' },
    { id: 'used', label: `Used on this map (${usedProps.length})` },
    { id: 'recent', label: 'Recent' },
  ];

  const empty =
    tiles.length > 0 ? null : searching ? (
      <Empty>No props match “{query.trim()}”.</Empty>
    ) : view === 'favourites' ? (
      <Empty>Star a prop to keep it here. Favourites are kept in this browser.</Empty>
    ) : view === 'used' ? (
      <Empty>Nothing from the library is on this map yet.</Empty>
    ) : view === 'recent' ? (
      <Empty>Props you pick show here.</Empty>
    ) : props.length === 0 ? (
      <Empty>No packs installed.</Empty>
    ) : null;

  return (
    <div className="v2-pbrowse" data-testid="v2-props-browser">
      {replaceIds ? <ReplaceBar ids={replaceIds} /> : scatterInHand && <PoolBar />}
      <div className="v2-pbrowse__top">
        <label className="v2-rfilter">
          <Search size={14} strokeWidth={1.75} aria-hidden />
          <input
            value={query}
            placeholder="Search props"
            aria-label="Search props"
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            onKeyDown={(e) => {
              // Keys typed here are not canvas shortcuts; Escape empties the field first.
              e.stopPropagation();
              if (e.key === 'Escape' && query) setQuery('');
            }}
          />
          {query && (
            <button type="button" className="v2-ib v2-pbrowse__clear" aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={12} strokeWidth={1.75} />
            </button>
          )}
        </label>
        <span className="v2-seg v2-pbrowse__views" role="group" aria-label="View">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => {
                setView(v.id);
                setOpenKey(null);
                setLimit(PAGE);
              }}
            >
              {v.label}
            </button>
          ))}
        </span>
      </div>

      <div className="v2-pbrowse__main">
        {view === 'all' && (
          <ul className="v2-pbrowse__cats" aria-label="Categories">
            <li>
              <button
                type="button"
                className={cn('v2-pcat', !category && 'v2-pcat--on')}
                aria-pressed={!category}
                onClick={() => {
                  setCategory(null);
                  setTag(null);
                  setLimit(PAGE);
                }}
              >
                <span>All</span>
                <span className="v2-pcat__n v2-num">{props.length}</span>
              </button>
            </li>
            {categories.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={cn('v2-pcat', category === c.id && 'v2-pcat--on')}
                  aria-pressed={category === c.id}
                  onClick={() => {
                    setCategory(c.id);
                    setTag(null);
                    setLimit(PAGE);
                  }}
                >
                  <span>{c.label}</span>
                  <span className="v2-pcat__n v2-num">{c.count}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div
          className="v2-pbrowse__grid"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (limit < tiles.length && el.scrollTop + el.clientHeight > el.scrollHeight - 200) setLimit((n) => n + PAGE);
          }}
        >
          {searching && (
            <div className="v2-pbrowse__note">
              <span>
                {tiles.length} {view === 'all' ? (tiles.length === 1 ? 'family matches' : 'families match') : tiles.length === 1 ? 'prop matches' : 'props match'} “{query.trim()}”
              </span>
              <span>best first</span>
            </div>
          )}
          {view === 'all' && !searching && chosen && chosen.tags.length > 1 && (
            <div className="v2-pbrowse__tags" role="group" aria-label="Tags">
              {chosen.tags.map((t) => (
                <button key={t} type="button" className="v2-rtag v2-pbrowse__tag" aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>
                  {t}
                </button>
              ))}
            </div>
          )}
          {empty}
          <div className="v2-pbrowse__tiles">
            {shown.map((t) => {
              // Favourites holds whole families too, so their ×N opens there as well.
              const families = view === 'all' || view === 'favourites';
              const open = families && openKey === t.key;
              return [
                <Tile
                  key={t.key}
                  tile={t}
                  used={usedOf(t)}
                  open={open}
                  onOpen={families ? () => setOpenKey(open ? null : t.key) : undefined}
                  onPick={pick}
                />,
                open && <FamilyBand key={`${t.key}-band`} tile={t} used={used} onPick={pick} onClose={() => setOpenKey(null)} />,
              ];
            })}
          </div>
        </div>
      </div>

      <div className="v2-pbrowse__foot">
        {replaceIds
          ? 'Click a prop to swap it in at its own size.'
          : scatterInHand
            ? 'Click adds to the pool. ×N opens the family.'
            : 'Click picks the prop to stamp. ×N opens the family.'}
      </div>
    </div>
  );
}

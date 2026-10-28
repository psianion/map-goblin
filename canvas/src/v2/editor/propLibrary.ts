// The props browser's model: categories from the packs' sets, one tile per family, what
// the map already uses, and a fuzzy search of our own (no dependency). Pure: no store, no
// React, no catalogue reads, so the sheet and its tests share it.
import type { Layer } from '@/store/types';

/** The catalogue fields the browser reads (a `CatalogEntry` has them all). */
export interface PropEntryLike {
  id: string;
  packId: string;
  set?: string;
  material: string;
  gridSize: string;
  label: string;
  tags: readonly string[];
  /** The pack's variant family; absent, the entry is a family of one. */
  family?: string;
}

/* ── Categories ─────────────────────────────────────────── */

export interface PropCategory {
  /** The pack set the category is made of. */
  id: string;
  label: string;
  count: number;
  /** The tags its entries carry, most used first: chips when there is more than one. */
  tags: string[];
}

/** A set's name as a DM reads it: `demo-door-props` → Door Props, `GG_Cave_Ink` → Cave Ink. */
export function categoryLabel(set: string): string {
  return set
    .replace(/^demo-/i, '')
    .replace(/^GG_/, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** One category per set, biggest first (ties by label). Entries with no set share "Other". */
export function propCategories(entries: readonly PropEntryLike[]): PropCategory[] {
  const bySet = new Map<string, { count: number; tags: Map<string, number> }>();
  for (const e of entries) {
    const set = e.set ?? '';
    const cat = bySet.get(set) ?? { count: 0, tags: new Map<string, number>() };
    cat.count += 1;
    for (const t of e.tags) cat.tags.set(t, (cat.tags.get(t) ?? 0) + 1);
    bySet.set(set, cat);
  }
  return [...bySet]
    .map(([id, c]) => ({
      id,
      label: id ? categoryLabel(id) : 'Other',
      count: c.count,
      tags: [...c.tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/* ── Families ───────────────────────────────────────────── */

/** The key one family shares: pack, set and family name; an entry with no family is its own. */
export function entryFamilyKey(e: PropEntryLike): string {
  return e.family ? `${e.packId}:${e.set ?? ''}:${e.family}` : e.id;
}

export interface FamilyTile<E extends PropEntryLike = PropEntryLike> {
  key: string;
  /** What a click on the tile picks: the family's first member here. */
  rep: E;
  members: E[];
  /** The family's name, or the entry's own label for a family of one. */
  label: string;
}

/** One tile per family, in the order each family first appears in `entries`. */
export function familyTiles<E extends PropEntryLike>(entries: readonly E[]): FamilyTile<E>[] {
  const byKey = new Map<string, FamilyTile<E>>();
  for (const e of entries) {
    const key = entryFamilyKey(e);
    const tile = byKey.get(key);
    if (tile) tile.members.push(e);
    else byKey.set(key, { key, rep: e, members: [e], label: e.label });
  }
  for (const tile of byKey.values()) {
    if (tile.members.length > 1 && tile.rep.family) tile.label = tile.rep.family.replace(/_/g, ' ');
  }
  return [...byKey.values()];
}

/**
 * The Favourites view's tiles, in starring order. A star holds a family key (a family tile
 * was starred: the whole family, with its ×N) or one entry's id (a member starred inside
 * its open family). Stars naming nothing installed are skipped.
 */
export function favouriteTiles<E extends PropEntryLike>(favourites: readonly string[], entries: readonly E[]): FamilyTile<E>[] {
  const families = new Map(familyTiles(entries).map((t) => [t.key, t]));
  const byId = new Map(entries.map((e) => [e.id, e]));
  const out: FamilyTile<E>[] = [];
  for (const star of favourites) {
    const family = families.get(star);
    const e = byId.get(star);
    if (family) out.push(family);
    else if (e) out.push({ key: e.id, rep: e, members: [e], label: e.label });
  }
  return out;
}

/* ── Used on this map ───────────────────────────────────── */

/** How many times each pack asset is placed on the map, over every layer. Imported images are not props. */
export function usedOnMap(layers: readonly Layer[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const c of layer.children) {
      if (c.childType !== 'asset' || c.objectType !== 'asset') continue;
      out.set(c.assetId, (out.get(c.assetId) ?? 0) + 1);
    }
  }
  return out;
}

/* ── Search ─────────────────────────────────────────────── */

const CONTIGUOUS = 3;
/** The token starts a word ("brl" on "barrel", not on "umbrella"). */
const WORD_START = 2;
/** The token ends a word: an abbreviation like "brl" ends where "barrel" does. */
const WORD_END = 3;
/** The match starts the text itself. */
const TEXT_START = 1;
/** Per letter skipped between two matched ones. */
const GAP = 1;
/** A token's letters must fall within this many times its length. */
const MAX_SPAN = 2;
/** A token found only outside the label (family, set, tags) scores this much less. */
const OFF_LABEL = 3;

const isWordChar = (ch: string) => /[a-z0-9]/.test(ch);

/** The best score of one token as a subsequence of `text` (both lower case), or null. */
function tokenScore(token: string, text: string): number | null {
  let best: number | null = null;
  for (let start = text.indexOf(token[0]); start !== -1; start = text.indexOf(token[0], start + 1)) {
    let score = start === 0 ? TEXT_START : 0;
    if (start === 0 || !isWordChar(text[start - 1])) score += WORD_START;
    let prev = -1;
    let at = start;
    let ok = true;
    for (let k = 0; k < token.length; k++) {
      const j = k === 0 ? start : text.indexOf(token[k], at);
      if (j === -1) {
        ok = false;
        break;
      }
      score += 1;
      if (k > 0) score += j === prev + 1 ? CONTIGUOUS : -(j - prev - 1) * GAP;
      prev = j;
      at = j + 1;
    }
    // Letters strewn far apart are not a match: the run may be at most twice the token.
    if (!ok || prev - start + 1 > token.length * MAX_SPAN) continue;
    if (prev === text.length - 1 || !isWordChar(text[prev + 1])) score += WORD_END;
    if (best === null || score > best) best = score;
  }
  return best;
}

/**
 * How well `query` matches `text`: every space-separated token must appear in order as a
 * subsequence; runs of contiguous letters and whole words score up, skipped letters score down.
 * 0 when any token is missing. `label` (the start of `text`) is preferred over the rest.
 */
export function fuzzyScore(query: string, text: string, label = text): number {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const lowLabel = label.toLowerCase();
  const lowText = text.toLowerCase();
  let total = 0;
  for (const t of tokens) {
    const inLabel = tokenScore(t, lowLabel);
    const inText = inLabel === null ? tokenScore(t, lowText) : null;
    if (inLabel === null && inText === null) return 0;
    total += inLabel ?? (inText as number) - OFF_LABEL;
  }
  return Math.max(total, 0.01);
}

/** What a search reads of an entry: its label first, then family, set and tags. */
export function searchText(e: PropEntryLike): string {
  return [e.label, e.family?.replace(/_/g, ' ') ?? '', e.set ?? '', ...e.tags].join(' ');
}

/** The entries matching `query`, best first; ties go to the shorter label. */
export function searchProps<E extends PropEntryLike>(entries: readonly E[], query: string): E[] {
  if (!query.trim()) return [...entries];
  const scored: { e: E; score: number }[] = [];
  for (const e of entries) {
    const score = fuzzyScore(query, searchText(e), e.label);
    if (score > 0) scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.e.label.length - b.e.label.length).map((x) => x.e);
}

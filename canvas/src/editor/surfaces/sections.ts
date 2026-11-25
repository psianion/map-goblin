// Grouping settings under their captions, in the order the registry lists them: a section
// sits where its first setting does, and every later setting with the same caption joins it.

export interface Section<D> {
  /** Null for settings listed without a caption. */
  title: string | null;
  items: D[];
}

export function groupBySection<D extends { section?: string }>(items: readonly D[]): Section<D>[] {
  const out: Section<D>[] = [];
  const byTitle = new Map<string, Section<D>>();
  for (const item of items) {
    const title = item.section ?? null;
    // Uncaptioned settings in a row share one group; a caption between them splits it.
    const last = out.at(-1);
    const known = title !== null ? byTitle.get(title) : last?.title === null ? last : undefined;
    if (known) {
      known.items.push(item);
      continue;
    }
    const section: Section<D> = { title, items: [item] };
    if (title !== null) byTitle.set(title, section);
    out.push(section);
  }
  return out;
}

/**
 * The scrolling body of every 272 wide panel (the cards, the tool panels): never sideways. The
 * scrollbar keeps its own gutter whether or not it shows, and every row composite fits the width
 * left beside it, so a right-aligned readout stays whole. A fieldset (the mixed card groups its
 * sections in them, to disable them while something is locked) is held to the body's width too:
 * a browser gives it `min-inline-size: min-content`, so without `min-w-0` it grows to its 248 px
 * rows and the body clips their right edge.
 */
export const PANEL_BODY =
  'flex min-h-0 flex-col gap-2.5 overflow-x-hidden overflow-y-auto px-3 pt-2.5 pb-3 [scrollbar-gutter:stable] [&_[data-composite]]:max-w-full [&_fieldset]:min-w-0';

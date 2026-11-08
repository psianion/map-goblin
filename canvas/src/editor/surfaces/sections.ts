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

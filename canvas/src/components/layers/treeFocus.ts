// H1: rows that delete themselves need to hand focus to a neighbor instead
// of letting it drop to <body> when the row unmounts. Capture the neighbor
// BEFORE the delete runs (the row is still in the DOM to query against), and
// call the returned closure AFTER — same [role="treeitem"] query LayerPanel's
// own arrow-key handler (handleTreeKeyDown) uses, scoped to the nearest
// role="tree" ancestor so a layer's delete doesn't jump into a different
// tree instance.
export function captureNeighborFocus(rowEl: HTMLElement | null): () => void {
  const tree = rowEl?.closest('[role="tree"]') ?? null
  if (!rowEl || !tree) return () => {}
  const items = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'))
  const idx = items.indexOf(rowEl)
  if (idx < 0) return () => {}
  const neighbor = items[idx + 1] ?? items[idx - 1] ?? null
  return () => neighbor?.focus()
}

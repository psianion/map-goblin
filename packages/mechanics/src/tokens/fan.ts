// Where a group of tokens lands around one point: the anchor cell, then each ring of cells
// around it in turn. Shared by the triggers module's encounter spawn and the tokens module's
// `gather`, so a fanned-out party and a fanned-out ambush stand the same way.

/** The anchor plus every cell offset in `rings` square rings around it, inner rings first. */
export function ringOffsets(rings: number): [number, number][] {
  const cells: [number, number][] = [[0, 0]]
  for (let r = 1; r <= rings; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r) cells.push([dx, dy])
      }
    }
  }
  return cells
}

/** `count` points fanned out from `at`, one cell apart; enough rings for all of them. */
export function fanAround(at: { x: number; y: number }, count: number): { x: number; y: number }[] {
  let rings = 0
  while ((2 * rings + 1) ** 2 < count) rings++
  return ringOffsets(rings)
    .slice(0, count)
    .map(([dx, dy]) => ({ x: at.x + dx, y: at.y + dy }))
}

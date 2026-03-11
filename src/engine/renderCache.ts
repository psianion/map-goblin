const dirtySet = new Set<string>();

export function markDirty(layerId: string): void {
  dirtySet.add(layerId);
}

export function isDirty(layerId: string): boolean {
  return dirtySet.has(layerId);
}

export function clearDirty(layerId: string): void {
  dirtySet.delete(layerId);
}

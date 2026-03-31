export interface SwitchMapDeps {
  getActiveMapId: () => string | null;
  getIsMapSwitching: () => boolean;
  setIsMapSwitching: (val: boolean) => void;
  saveCurrentMap: () => Promise<void>;
  loadMap: (id: string) => Promise<void>;
  clearUndo: () => void;
  fogIn: () => Promise<void>;
  fogOut: () => Promise<void>;
  addToast: (msg: string, type?: 'error' | 'info') => void;
}

export async function switchMap(targetId: string, deps: SwitchMapDeps): Promise<void> {
  // Guards
  if (targetId === deps.getActiveMapId()) return;
  if (deps.getIsMapSwitching()) return;

  deps.setIsMapSwitching(true);

  // SAVE phase
  try {
    await deps.saveCurrentMap();
  } catch (err) {
    deps.addToast(`Failed to save current map: ${(err as Error).message}`, 'error');
    deps.setIsMapSwitching(false);
    return;
  }

  // FOG IN
  await deps.fogIn();

  // TEARDOWN + LOAD (try/finally guarantees fog-out + unlock)
  try {
    deps.clearUndo();
    await deps.loadMap(targetId);
  } catch (err) {
    deps.addToast(`Failed to load map: ${(err as Error).message}`, 'error');
  } finally {
    await deps.fogOut();
    deps.setIsMapSwitching(false);
  }
}

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
const mockSaveCurrentMap = vi.fn().mockResolvedValue(undefined);
const mockLoadMap = vi.fn().mockResolvedValue(undefined);
const mockUndoClear = vi.fn();
const mockFogIn = vi.fn().mockResolvedValue(undefined);
const mockFogOut = vi.fn().mockResolvedValue(undefined);
const mockAddToast = vi.fn();

describe('switchMap', () => {
  let switchMap: (typeof import('./mapSwitcher'))['switchMap'];

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./mapSwitcher');
    switchMap = mod.switchMap;
  });

  const makeDeps = (overrides: Record<string, unknown> = {}) => ({
    getActiveMapId: () => 'current-id' as string | null,
    getIsMapSwitching: () => false,
    setIsMapSwitching: vi.fn(),
    saveCurrentMap: mockSaveCurrentMap,
    loadMap: mockLoadMap,
    clearUndo: mockUndoClear,
    fogIn: mockFogIn,
    fogOut: mockFogOut,
    addToast: mockAddToast,
    ...overrides,
  });

  it('no-op when targetId === activeMapId', async () => {
    const deps = makeDeps();
    await switchMap('current-id', deps);
    expect(mockSaveCurrentMap).not.toHaveBeenCalled();
  });

  it('no-op when isMapSwitching is true', async () => {
    const deps = makeDeps({ getIsMapSwitching: () => true });
    await switchMap('other-id', deps);
    expect(mockSaveCurrentMap).not.toHaveBeenCalled();
  });

  it('sets isMapSwitching true at start, false at end', async () => {
    const deps = makeDeps();
    await switchMap('other-id', deps);
    expect(deps.setIsMapSwitching).toHaveBeenNthCalledWith(1, true);
    expect(deps.setIsMapSwitching).toHaveBeenLastCalledWith(false);
  });

  it('calls save before load', async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      saveCurrentMap: vi.fn().mockImplementation(async () => { callOrder.push('save'); }),
      loadMap: vi.fn().mockImplementation(async () => { callOrder.push('load'); }),
    });
    await switchMap('other-id', deps);
    expect(callOrder).toEqual(['save', 'load']);
  });

  it('clears undo/redo history', async () => {
    const deps = makeDeps();
    await switchMap('other-id', deps);
    expect(mockUndoClear).toHaveBeenCalled();
  });

  it('dispatches fog-in before teardown, fog-out after load', async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      fogIn: vi.fn().mockImplementation(async () => { callOrder.push('fog-in'); }),
      clearUndo: vi.fn().mockImplementation(() => { callOrder.push('clear'); }),
      loadMap: vi.fn().mockImplementation(async () => { callOrder.push('load'); }),
      fogOut: vi.fn().mockImplementation(async () => { callOrder.push('fog-out'); }),
    });
    await switchMap('other-id', deps);
    expect(callOrder).toEqual(['fog-in', 'clear', 'load', 'fog-out']);
  });

  it('on save failure: shows toast, aborts switch', async () => {
    const deps = makeDeps({
      saveCurrentMap: vi.fn().mockRejectedValue(new Error('IDB full')),
    });
    await switchMap('other-id', deps);
    expect(mockAddToast).toHaveBeenCalled();
    expect(mockLoadMap).not.toHaveBeenCalled();
    expect(deps.setIsMapSwitching).toHaveBeenLastCalledWith(false);
  });

  it('on load failure: fog-out still fires, isMapSwitching resets', async () => {
    const deps = makeDeps({
      loadMap: vi.fn().mockRejectedValue(new Error('corrupt')),
    });
    await switchMap('other-id', deps);
    expect(mockFogOut).toHaveBeenCalled();
    expect(deps.setIsMapSwitching).toHaveBeenLastCalledWith(false);
    expect(mockAddToast).toHaveBeenCalled();
  });

  it('sequential rapid calls only execute one switch', async () => {
    let switching = false;
    const deps = makeDeps({
      getIsMapSwitching: () => switching,
      setIsMapSwitching: vi.fn().mockImplementation((val: boolean) => { switching = val; }),
      loadMap: vi.fn().mockImplementation(() => new Promise((r) => setTimeout(r, 50))),
    });
    const p1 = switchMap('other-id', deps);
    const p2 = switchMap('another-id', deps);
    await Promise.all([p1, p2]);
    expect(deps.saveCurrentMap).toHaveBeenCalledTimes(1);
  });
});

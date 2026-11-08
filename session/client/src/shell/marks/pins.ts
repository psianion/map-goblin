import { create } from 'zustand';
import type { PinsState } from '@dnd/mechanics/pins';
import { useSessionStore } from '../../session/store';
import { useTableShell } from '../tableShell';

/** A pin on the map (4.3 `pins`, persisted per scene by the server). */
export interface Pin {
  id: string;
  x: number;
  y: number;
  text: string;
  dmOnly: boolean;
}

interface PinsStore {
  pins: Pin[];
  /** Where a pin was just dropped, so its card opens once the server hands it back with an id. */
  pendingAt: { x: number; y: number } | null;
  add: (pin: Pin) => void;
  update: (id: string, patch: Partial<Omit<Pin, 'id'>>) => void;
  remove: (id: string) => void;
}

/** This seat's own pins, for a server without the `pins` module. */
export const useLocalPins = create<PinsStore>()((set, get) => ({
  pins: [],
  pendingAt: null,
  add: (pin) => set({ pins: [...get().pins, pin] }),
  update: (id, patch) => set({ pins: get().pins.map((p) => (p.id === id ? { ...p, ...patch } : p)) }),
  remove: (id) => set({ pins: get().pins.filter((p) => p.id !== id) }),
}));

const pinsModule = (): PinsState | undefined => useSessionStore.getState().session?.modules.pins as PinsState | undefined;

/** The live scene's pins: the module's when the server has it, else this seat's own. */
export function usePins(): Pin[] {
  const module = useSessionStore((s) => s.session?.modules.pins as PinsState | undefined);
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const local = useLocalPins((s) => s.pins);
  if (!module) return local;
  return (sceneId ? module.byScene[sceneId] : undefined) ?? EMPTY;
}
const EMPTY: Pin[] = [];

let counter = 0;

/** Drop a pin and open its card to write on it. */
export function addPin(x: number, y: number, dmOnly: boolean): void {
  if (pinsModule()) {
    useLocalPins.setState({ pendingAt: { x, y } });
    useSessionStore.getState().sendCommand('pins', 'add', { x, y, text: '', dmOnly });
    return;
  }
  const id = `pin-${Date.now()}-${++counter}`;
  useLocalPins.getState().add({ id, x, y, text: '', dmOnly });
  useTableShell.getState().openCard(`pin:${id}`);
}

export function updatePin(id: string, patch: Partial<Omit<Pin, 'id'>>): void {
  if (pinsModule()) useSessionStore.getState().sendCommand('pins', 'update', { id, ...patch });
  else useLocalPins.getState().update(id, patch);
}

export function deletePin(id: string): void {
  if (pinsModule()) useSessionStore.getState().sendCommand('pins', 'delete', { id });
  else useLocalPins.getState().remove(id);
  if (useTableShell.getState().card === `pin:${id}`) useTableShell.getState().closeCard();
}

/** The pin under a world point (a pin's own click target is about half a cell). */
export function pinAt(pins: readonly Pin[], x: number, y: number): Pin | undefined {
  return pins.find((p) => Math.hypot(p.x - x, p.y - y) <= 0.5);
}

/** Pins on the live scene right now, outside React. */
export function pinsNow(): Pin[] {
  const module = pinsModule();
  if (!module) return useLocalPins.getState().pins;
  const sceneId = useSessionStore.getState().session?.activeSceneId;
  return (sceneId ? module.byScene[sceneId] : undefined) ?? EMPTY;
}

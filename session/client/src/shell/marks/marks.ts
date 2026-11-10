import { create } from 'zustand';
import { useSessionStore } from '../../session/store';

export interface Pt {
  x: number;
  y: number;
}

export type TemplateShape = 'circle' | 'cone' | 'line' | 'square';

/** One message on the ephemeral `mark` channel (4.3): never module state, dropped after its TTL. */
export type MarkMsg =
  | { kind: 'ping'; x: number; y: number; pull?: boolean }
  | { kind: 'ruler'; from: Pt; to: Pt }
  | { kind: 'template'; shape: TemplateShape; origin: Pt; size: number; toward?: Pt }
  | { kind: 'draw'; points: [number, number][]; ttl: number };

/** How long each kind stays on the map, in ms. A ruler lives as long as its seat keeps sending it. */
export const MARK_TTL_MS = { ping: 3000, ruler: 1500, template: 30_000, draw: 10_000 } as const;

/** Hand a mark to the session's `mark` channel. */
export function sendMark(msg: MarkMsg): void {
  useSessionStore.getState().sendMark(msg);
}

export interface LiveMark {
  /** Per seat: one ruler per seat, replaced as it moves. */
  id: string;
  /** Identity that made it; the seat's colour comes from it. */
  by: string;
  msg: MarkMsg;
  /** Epoch ms after which it is dropped; Infinity while a gesture holds it. */
  expiresAt: number;
}

interface MarksStore {
  marks: LiveMark[];
  put: (mark: LiveMark) => void;
  drop: (id: string) => void;
  prune: (now: number) => void;
}

export const useMarks = create<MarksStore>()((set, get) => ({
  marks: [],
  put: (mark) => set({ marks: [...get().marks.filter((m) => m.id !== mark.id), mark] }),
  drop: (id) => set({ marks: get().marks.filter((m) => m.id !== id) }),
  prune: (now) => {
    const marks = get().marks;
    const kept = marks.filter((m) => m.expiresAt > now);
    if (kept.length !== marks.length) set({ marks: kept });
  },
}));

const ttlOf = (msg: MarkMsg): number => (msg.kind === 'draw' ? msg.ttl : MARK_TTL_MS[msg.kind]);

let counter = 0;

/**
 * A mark from another seat, for the store to call once the channel lands. A ruler replaces
 * that seat's previous ruler; everything else stacks until its TTL runs out.
 */
export function receiveMark(msg: MarkMsg, by: string, now = Date.now()): void {
  const id = msg.kind === 'ruler' ? `ruler:${by}` : `${msg.kind}:${by}:${++counter}`;
  useMarks.getState().put({ id, by, msg, expiresAt: now + ttlOf(msg) });
}

/**
 * Keep a mark this seat made, and send it. `hold` keeps it until `useMarks.drop(id)` (a ruler
 * or a template while its drag is still going); `id` replaces an earlier one in place.
 */
export function placeMark(msg: MarkMsg, opts: { id?: string; hold?: boolean } = {}, now = Date.now()): string {
  const by = useSessionStore.getState().you?.identityId ?? 'me';
  const key = opts.id ?? `${msg.kind}:${by}:${++counter}`;
  useMarks.getState().put({ id: key, by, msg, expiresAt: opts.hold ? Infinity : now + ttlOf(msg) });
  sendMark(msg);
  return key;
}

/** "15 ft" for a world distance, on the map's own cell scale (one world unit is one cell). */
export function distanceLabel(cells: number, scale: { value: number; unit: string }): string {
  const value = Math.round(cells * (scale.value || 5));
  return `${value} ${scale.unit || 'ft'}`;
}

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

/**
 * How long each kind stays on the map, in ms. A ruler lives as long as its seat keeps sending it.
 * A template's 0 is "stands until the DM clears it" (table fix pass, decision d), as the server says.
 */
export const MARK_TTL_MS = { ping: 3000, ruler: 1500, template: 0, draw: 10_000 } as const;

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

/** When a mark made `now` with this TTL is dropped; a TTL of 0 stands. */
const expiry = (ttl: number, now: number): number => (ttl === 0 ? Infinity : now + ttl);

let counter = 0;

/**
 * A mark from another seat, for the store to call once the channel lands. A ruler replaces
 * that seat's previous ruler; everything else stacks until its TTL runs out. A template is kept
 * under the id the server relayed it with, which is what a later `clear` names.
 */
export function receiveMark(
  msg: MarkMsg,
  by: string,
  now = Date.now(),
  relayed: { id?: string; ttlMs?: number } = {},
): void {
  const id =
    msg.kind === 'ruler'
      ? `ruler:${by}`
      : msg.kind === 'template' && relayed.id
        ? relayed.id
        : `${msg.kind}:${by}:${++counter}`;
  useMarks.getState().put({ id, by, msg, expiresAt: expiry(relayed.ttlMs ?? ttlOf(msg), now) });
}

const sameTemplate = (a: MarkMsg, b: MarkMsg): boolean =>
  a.kind === 'template' &&
  b.kind === 'template' &&
  a.shape === b.shape &&
  a.size === b.size &&
  a.origin.x === b.origin.x &&
  a.origin.y === b.origin.y;

/**
 * This seat's own template, echoed back with the server's id: the local copy is re-keyed to
 * it so a `clear` finds it, and a template replayed on a rejoin (no local copy) is drawn.
 */
export function adoptOwnTemplate(msg: MarkMsg, by: string, relayedId: string): void {
  const { marks } = useMarks.getState();
  if (marks.some((m) => m.id === relayedId)) return;
  const local = marks.find((m) => m.by === by && m.id.startsWith('template:') && sameTemplate(m.msg, msg));
  useMarks.setState({
    marks: [...marks.filter((m) => m !== local), { id: relayedId, by, msg, expiresAt: Infinity }],
  });
}

/** DM only (the server refuses anyone else): take a standing template off the table. */
export function clearTemplate(id: string): void {
  useMarks.getState().drop(id);
  useSessionStore.getState().sendMark({ kind: 'clear', id });
}

/** The template under a world point, newest first: what a DM's click on the map clears. */
export function templateAt(marks: readonly LiveMark[], x: number, y: number): LiveMark | undefined {
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i]!;
    if (m.msg.kind !== 'template' || m.expiresAt !== Infinity) continue;
    if (Math.hypot(x - m.msg.origin.x, y - m.msg.origin.y) <= Math.max(m.msg.size, 0.5)) return m;
  }
  return undefined;
}

/**
 * Keep a mark this seat made, and send it. `hold` keeps it until `useMarks.drop(id)` (a ruler
 * or a template while its drag is still going); `id` replaces an earlier one in place.
 */
export function placeMark(msg: MarkMsg, opts: { id?: string; hold?: boolean } = {}, now = Date.now()): string {
  const by = useSessionStore.getState().you?.identityId ?? 'me';
  const key = opts.id ?? `${msg.kind}:${by}:${++counter}`;
  useMarks.getState().put({ id: key, by, msg, expiresAt: opts.hold ? Infinity : expiry(ttlOf(msg), now) });
  sendMark(msg);
  return key;
}

/** Keep a mark this seat is still drawing without sending it yet (a template until release). */
export function holdMark(msg: MarkMsg): string {
  const by = useSessionStore.getState().you?.identityId ?? 'me';
  const key = `${msg.kind}:${by}:${++counter}`;
  useMarks.getState().put({ id: key, by, msg, expiresAt: Infinity });
  return key;
}

/** "15 ft" for a world distance, on the map's own cell scale (one world unit is one cell). */
export function distanceLabel(cells: number, scale: { value: number; unit: string }): string {
  const value = Math.round(cells * (scale.value || 5));
  return `${value} ${scale.unit || 'ft'}`;
}

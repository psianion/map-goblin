/**
 * Main-thread handle on the splat worker. Lazy singleton — a session that
 * never touches terrain never spawns the worker.
 */
import type { SplatRect, TerrainBounds } from './terrainShared';

export interface SplatFlushResult {
  bounds: TerrainBounds | null;
  pngs: { rtIndex: 0 | 1; png: ArrayBuffer }[];
}

type Reply = { id: number; error?: string } & Partial<SplatFlushResult> & { ok?: boolean };

export class SplatWorkerClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('./splatWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<Reply>) => {
      const entry = this.pending.get(e.data.id);
      if (!entry) return;
      this.pending.delete(e.data.id);
      if (e.data.error) entry.reject(new Error(e.data.error));
      else entry.resolve(e.data);
    };
  }

  private call(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<Reply> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...msg }, transfer);
    });
  }

  async seed(rtIndex: 0 | 1, png: ArrayBuffer | null): Promise<void> {
    await this.call({ op: 'seed', rtIndex, png }, png ? [png] : []);
  }

  /** Fire-and-forget: patches are ordered ahead of any later flush by the worker's message queue. */
  patch(rtIndex: 0 | 1, rect: SplatRect, pixels: Uint8Array): void {
    // Copy — the caller's buffer belongs to the undo snapshot.
    const buf = pixels.slice().buffer;
    this.worker.postMessage({ id: 0, op: 'patch', rtIndex, rect, pixels: buf }, [buf]);
  }

  async flush(): Promise<SplatFlushResult> {
    const r = await this.call({ op: 'flush' });
    return { bounds: r.bounds ?? null, pngs: r.pngs ?? [] };
  }

  async reset(): Promise<void> {
    await this.call({ op: 'reset' });
  }

  destroy(): void {
    this.worker.terminate();
    for (const { reject } of this.pending.values()) reject(new Error('worker destroyed'));
    this.pending.clear();
  }
}

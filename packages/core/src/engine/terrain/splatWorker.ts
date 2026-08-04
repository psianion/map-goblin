/**
 * Splat worker shell: message plumbing + PNG encode/decode around the pure
 * ops in splatWorkerOps.ts. Runs as a Vite module worker — no pixi, no DOM.
 *
 * Protocol (all requests carry an `id`; replies echo it):
 *   seed    {rtIndex, png: ArrayBuffer|null}      → {ok}
 *   patch   {rtIndex, rect, pixels: ArrayBuffer}  → (no reply — fire and forget)
 *   flush   {}                                    → {bounds, pngs: {rtIndex, png}[]}
 *   reset   {}                                    → {ok}
 */
import { SPLAT_SIZE, type SplatRect } from './terrainShared';
import { createSplatState, flush, patch, reset, seed } from './splatWorkerOps';

const state = createSplatState();

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

function ensureCanvas(): OffscreenCanvasRenderingContext2D {
  if (!ctx) {
    canvas = new OffscreenCanvas(SPLAT_SIZE, SPLAT_SIZE);
    // willReadFrequently keeps the canvas CPU-side — we only ever putImageData
    // and encode, so a GPU-backed canvas would just add transfer round-trips.
    ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  }
  return ctx;
}

async function encodePng(pixels: Uint8Array): Promise<ArrayBuffer> {
  const c = ensureCanvas();
  // Copy: ImageData wants a Uint8ClampedArray over its own buffer.
  const image = new ImageData(new Uint8ClampedArray(pixels), SPLAT_SIZE, SPLAT_SIZE);
  c.putImageData(image, 0, 0);
  const blob = await canvas!.convertToBlob({ type: 'image/png' });
  return blob.arrayBuffer();
}

async function decodePng(png: ArrayBuffer): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }), {
    premultiplyAlpha: 'none',
  });
  const c = ensureCanvas();
  c.clearRect(0, 0, SPLAT_SIZE, SPLAT_SIZE);
  c.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = c.getImageData(0, 0, SPLAT_SIZE, SPLAT_SIZE).data;
  return new Uint8Array(data.buffer, 0, SPLAT_SIZE * SPLAT_SIZE * 4);
}

interface Request {
  id: number;
  op: 'seed' | 'patch' | 'flush' | 'reset';
  rtIndex?: 0 | 1;
  rect?: SplatRect;
  pixels?: ArrayBuffer;
  png?: ArrayBuffer | null;
}

self.onmessage = (e: MessageEvent<Request>) => {
  void handle(e.data).catch((err) => {
    self.postMessage({ id: e.data.id, error: String(err) });
  });
};

async function handle(req: Request): Promise<void> {
  switch (req.op) {
    case 'seed': {
      const pixels = req.png ? await decodePng(req.png) : null;
      seed(state, req.rtIndex!, pixels);
      self.postMessage({ id: req.id, ok: true });
      return;
    }
    case 'patch': {
      patch(state, req.rtIndex!, req.rect!, new Uint8Array(req.pixels!));
      return; // fire-and-forget
    }
    case 'flush': {
      const { bounds, dirtyIndices } = flush(state);
      const pngs: { rtIndex: 0 | 1; png: ArrayBuffer }[] = [];
      for (const rtIndex of dirtyIndices) {
        pngs.push({ rtIndex, png: await encodePng(state.splats[rtIndex]!) });
      }
      self.postMessage({ id: req.id, bounds, pngs }, { transfer: pngs.map((p) => p.png) });
      return;
    }
    case 'reset': {
      reset(state);
      self.postMessage({ id: req.id, ok: true });
      return;
    }
  }
}

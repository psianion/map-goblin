/**
 * Non-blocking GPU → CPU pixel readback for WebGL2.
 *
 * `extract.pixels` stalls the whole pipeline: it forces the GPU to drain every
 * pending command, then copies synchronously. Here the copy goes into a
 * PIXEL_PACK_BUFFER (returns immediately), a fence tells us when the GPU is
 * done, and `getBufferSubData` after the fence is a plain memcpy. The main
 * thread never waits on the GPU.
 *
 * Row order: `extract.pixels` returns rows visual-top-first; raw `readPixels`
 * from an FBO may come out bottom-first depending on how the render target
 * was projected. Rather than hardcode an assumption, the first call renders a
 * two-pixel probe and compares raw readback against `extract.pixels`
 * (ponytail: calibration probe, not a flag table — drivers disagree and the
 * probe is ground truth by construction).
 *
 * Falls back to synchronous `extract.pixels` when the context isn't WebGL2.
 */
import { Container, Graphics, RenderTexture, type Renderer } from 'pixi.js';

let flipCache: WeakMap<Renderer, boolean | Promise<boolean>> = new WeakMap();

/** Test hook. */
export function resetReadbackCalibration(): void {
  flipCache = new WeakMap();
}

function getGl(renderer: Renderer): WebGL2RenderingContext | null {
  const gl = (renderer as unknown as { gl?: WebGLRenderingContext | WebGL2RenderingContext }).gl;
  return gl && 'fenceSync' in gl ? (gl as WebGL2RenderingContext) : null;
}

function waitFence(gl: WebGL2RenderingContext, sync: WebGLSync): Promise<void> {
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (gl.isContextLost()) {
        reject(new Error('WebGL context lost during readback'));
        return;
      }
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
        resolve();
      } else if (status === gl.WAIT_FAILED) {
        reject(new Error('clientWaitSync failed'));
      } else {
        setTimeout(poll, 2);
      }
    };
    // First check next tick — a small region is often already done.
    setTimeout(poll, 0);
  });
}

/** Raw async read of the currently relevant RT, no orientation correction. */
async function readRaw(
  gl: WebGL2RenderingContext,
  renderer: Renderer,
  rt: RenderTexture,
  width: number,
  height: number,
): Promise<Uint8Array> {
  renderer.renderTarget.bind(rt);
  const buf = gl.createBuffer();
  if (!buf) throw new Error('createBuffer failed');
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, width * height * 4, gl.STREAM_READ);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) {
    gl.deleteBuffer(buf);
    throw new Error('fenceSync failed');
  }
  gl.flush();
  try {
    await waitFence(gl, sync);
    const out = new Uint8Array(width * height * 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return out;
  } finally {
    gl.deleteSync(sync);
    gl.deleteBuffer(buf);
  }
}

function flipRows(pixels: Uint8Array, width: number, height: number): void {
  const rowBytes = width * 4;
  const tmp = new Uint8Array(rowBytes);
  for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
    const a = top * rowBytes;
    const b = bottom * rowBytes;
    tmp.set(pixels.subarray(a, a + rowBytes));
    pixels.copyWithin(a, b, b + rowBytes);
    pixels.set(tmp, b);
  }
}

/** Render a 1×2 probe (distinct rows), compare raw readback vs extract.pixels. */
async function calibrate(gl: WebGL2RenderingContext, renderer: Renderer): Promise<boolean> {
  const rt = RenderTexture.create({ width: 1, height: 2, resolution: 1 });
  const g = new Graphics().rect(0, 0, 1, 1).fill(0xff0000).rect(0, 1, 1, 1).fill(0x00ff00);
  const holder = new Container();
  holder.addChild(g);
  renderer.render({ container: holder, target: rt, clear: true });
  holder.destroy({ children: true });

  const truth = renderer.extract.pixels({ target: rt }).pixels;
  const raw = await readRaw(gl, renderer, rt, 1, 2);
  rt.destroy(true);
  // Compare red channel of the first row.
  const flip = raw[0] !== truth[0];
  return flip;
}

/**
 * Read an RT's pixels without stalling the pipeline. Row order matches
 * `extract.pixels`. `frame` defaults to the full texture.
 */
export async function readPixelsAsync(
  renderer: Renderer,
  rt: RenderTexture,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const gl = getGl(renderer);
  if (!gl) {
    // Not WebGL2 (WebGPU/GL1) — synchronous fallback, correct but stalling.
    const { pixels } = renderer.extract.pixels({ target: rt });
    const out = new Uint8Array(width * height * 4);
    out.set(pixels.subarray(0, out.length));
    return out;
  }

  let flip = flipCache.get(renderer);
  if (flip === undefined) {
    // Store the promise immediately so concurrent first calls share one probe.
    const probing = calibrate(gl, renderer);
    flipCache.set(renderer, probing);
    flip = await probing;
    flipCache.set(renderer, flip);
  } else if (typeof flip !== 'boolean') {
    flip = await flip;
  }

  const out = await readRaw(gl, renderer, rt, width, height);
  if (flip) flipRows(out, width, height);
  return out;
}

/**
 * Run the orientation probe ahead of time (e.g. at renderer construction) so
 * the first real readback issues its GPU commands synchronously — callers
 * that snapshot a texture about to be overwritten rely on that.
 */
export function warmupReadback(renderer: Renderer): void {
  const gl = getGl(renderer);
  if (!gl || flipCache.has(renderer)) return;
  const probing = calibrate(gl, renderer);
  flipCache.set(renderer, probing);
  void probing.then((flip) => flipCache.set(renderer, flip)).catch(() => flipCache.delete(renderer));
}

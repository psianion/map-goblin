import type { Clipper2ZFactoryFunction, MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from './Clipper2Engine';
// Vite resolves ?url imports to the correct served path for static assets
import clipper2WasmUrl from 'clipper2-wasm/dist/es/clipper2z.wasm?url';

/**
 * Initialize the Clipper2 WASM module.
 * Must be called once before any geometry operations (e.g. in CanvasHost).
 */
export async function initClipper(): Promise<void> {
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const factory: Clipper2ZFactoryFunction = mod.default;
  const clipper: MainModule = await factory({
    locateFile: (path: string) => {
      if (path.endsWith('.wasm')) return clipper2WasmUrl;
      return path;
    },
  });
  setClipperModule(clipper);
}

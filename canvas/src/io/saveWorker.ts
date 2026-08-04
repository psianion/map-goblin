// Save worker shell: .mapbuilder encode/decode off the main thread.
// The heavy parts — JSON.stringify of a multi-MB document, splat base64,
// gzip — all run here. Logic lives in mapFormat.ts (pure, tested directly).

import { encodeMapFile, decodeMapFile } from './mapFormat';
import type { SerializedMapData } from '@/store/types';

interface Request {
  id: number;
  op: 'encode' | 'decode';
  data?: SerializedMapData;
  splats?: (ArrayBuffer | null)[];
  bytes?: ArrayBuffer;
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, op } = e.data;
  try {
    if (op === 'encode') {
      const splats = (e.data.splats ?? []).map((b) => (b ? new Uint8Array(b) : null));
      const bytes = encodeMapFile(e.data.data!, splats);
      self.postMessage({ id, bytes: bytes.buffer }, { transfer: [bytes.buffer] });
    } else {
      const data = decodeMapFile(new Uint8Array(e.data.bytes!));
      self.postMessage({ id, data });
    }
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};

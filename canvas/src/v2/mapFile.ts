import { hasMagicHeader, parsePlainMapJson } from '@/io/mapFormat';

/**
 * The editor's own map file. It is being renamed from .mapbuilder to .ggvtt; both open.
 * What makes a file one is its content, not its name — the extensions only steer the picker:
 * the container header, or (older .mapbuilder files) a plain JSON map document.
 */
export const MAP_FILE_ACCEPT = '.ggvtt,.mapbuilder';

/** Whether the file is one of the editor's map files. Unreadable files (a dropped folder) are not. */
export async function isMapFile(file: Blob): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (hasMagicHeader(head)) return true;
    // Only a file that could be JSON is read whole.
    const first = head.find((b) => b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0xef && b !== 0xbb && b !== 0xbf);
    if (first !== 0x7b) return false;
    return parsePlainMapJson(new Uint8Array(await file.arrayBuffer())) !== null;
  } catch {
    return false;
  }
}

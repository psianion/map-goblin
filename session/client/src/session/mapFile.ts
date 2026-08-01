// What a `.mapbuilder` file actually is, on the two screens that accept one.
//
// The editor saves it as `MPBLD\0` + gzip(UTF-8 JSON) — see canvas/src/io/saveLoad.ts, which
// owns the format. The fixtures in session/testdata are that same schema stored as plain
// JSON, and a DM may hand the table either one. Reading the file with `file.text()` was the
// bug: UTF-8-decoding gzip bytes replaces every invalid sequence with U+FFFD, so the editor's
// own save arrived at the server as mojibake and was refused as "not valid JSON" — no map
// authored in the editor had ever been loadable at the table.

/** Magic bytes the editor stamps on a compressed container. */
const MAGIC = [0x4d, 0x50, 0x42, 0x4c, 0x44, 0x00]; // "MPBLD\0"

const hasMagic = (bytes: Uint8Array): boolean =>
  bytes.length >= MAGIC.length && MAGIC.every((byte, i) => bytes[i] === byte);

/**
 * The JSON inside a `.mapbuilder`, whichever way it was written.
 *
 * ponytail: `DecompressionStream` is native in every browser this app targets, so the gzip
 * half costs an import of nothing. Reach for a library only if a non-gzip container appears.
 * Fed by hand rather than by `Blob.stream()`, which jsdom does not implement.
 */
export async function readMapFile(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasMagic(bytes)) return new TextDecoder().decode(bytes);

  const gunzip = new DecompressionStream('gzip');
  const writer = gunzip.writable.getWriter();
  void writer.write(bytes.subarray(MAGIC.length));
  void writer.close();
  return new Response(gunzip.readable).text();
}

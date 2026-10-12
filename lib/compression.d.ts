/// <reference types="node" />
/** gzip a buffer (Node `zlib`). `level` defaults to `zlib.constants.Z_DEFAULT_COMPRESSION`. */
export function compressObject(buffer: Uint8Array, level?: number): Promise<Buffer>;

/** gunzip a buffer (Node `zlib`). No size limit; use the `./browser`
 * `fromArchive()` for untrusted input. */
export function deCompressObject(buffer: Uint8Array): Promise<Buffer>;

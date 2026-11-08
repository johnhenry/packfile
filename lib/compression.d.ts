/// <reference types="node" />
/** The level `compressObject()` uses when none is given. */
export const DEFAULT_COMPRESSION_LEVEL: 6;

/** gzip a buffer (Node `zlib`). `level` defaults to 6 (zlib's default,
 * pinned). The header's OS byte is always 3 (Unix), so output does not
 * depend on the platform zlib was built for. */
export function compressObject(buffer: Uint8Array, level?: number): Promise<Buffer>;

/** gunzip a buffer (Node `zlib`). No size limit; use the `./browser`
 * `fromArchive()` for untrusted input. */
export function deCompressObject(buffer: Uint8Array): Promise<Buffer>;

/**
 * Helpers that make `toArchive()` output depend only on the files, not on
 * the machine that wrote it (#27). Pure, browser-safe (no Node APIs);
 * shared by the Node (`lib/web-bundle.mjs`, `lib/compression.mjs`) and
 * browser (`browser.mjs`, `lib/compression.browser.mjs`) writers.
 */

/** Byte offset of the OS field in a gzip header (RFC 1952 §2.3). */
const GZIP_OS_OFFSET = 9;
/** The OS value written into every gzip header: 3 = Unix. zlib picks this
 * at build time (`OS_CODE` in zutil.h: 19 on macOS, 3 on Linux, 10 on
 * Windows), so without this the same input gzips differently per platform. */
export const GZIP_OS_UNIX = 3;

/** Code-unit order, not `localeCompare`: identical on every machine and locale. */
export const comparePaths = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A `Map`'s entries sorted by key, so insertion order (e.g. `readdir`
 * order, which differs per file system) never reaches the bundle. */
export const sortedEntries = (map) => [...map].sort(([a], [b]) => comparePaths(a, b));

/** Overwrite the gzip header's OS byte in place (MTIME is already 0: zlib
 * and `CompressionStream` write no timestamp for in-memory data). */
export const normalizeGzipHeader = (bytes) => {
  if (bytes.length > GZIP_OS_OFFSET && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes[GZIP_OS_OFFSET] = GZIP_OS_UNIX;
  }
  return bytes;
};

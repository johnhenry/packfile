import {
  FileEntry,
  FilesMap,
  RouterOptions,
  RouteHandler,
  Files,
  ToFilesOptions,
  InvalidPathReason,
} from "./types.js";

export {
  FileEntry,
  FilesMap,
  RouterOptions,
  RouteHandler,
  Files,
  ToFilesOptions,
  InvalidPathReason,
};
export {
  PackfileError,
  InvalidPathError,
  ArchiveLimitError,
  InvalidArchiveError,
} from "./types.js";

// Note: `browser.d.ts` describes the `./browser` entry point (`browser.mjs`),
// not the main `.` entry (see `types.d.ts` for that). `createRouter` is the
// exact same implementation as the `.` entry's. `toArchive` and
// `fromArchive` are a *separate* implementation from the Node entry's (same
// wire format; Web Streams + Web Crypto instead of `zlib`/`node:crypto`),
// so their runtime types differ:
//
// - Option names: `compress` is canonical for `toArchive()`, `compressed`
//   for `fromArchive()`, and each accepts the other as an alias (as does the
//   Node entry). Passing both with different values throws a `TypeError`.
//   There is no `compressionLevel` here (`CompressionStream` has none).
// - `toArchive()` resolves to a plain `Uint8Array` (compressed or not). The
//   Node entry resolves to a `Buffer`, which is a `Uint8Array` subclass, so
//   code typed against `Uint8Array` works with both. (Before 0.1.0 this
//   returned an `ArrayBuffer` when compressing.)
// - `fromArchive()` is hardened for untrusted input and accepts
//   `ArrayBuffer | Uint8Array` (there is no `Buffer` in a browser build).

export type BrowserToArchiveOptions = {
  /** Default `true`. Canonical name. */
  compress?: boolean;
  /** Alias of `compress`. */
  compressed?: boolean;
};

/** Default limits applied by `fromArchive()`. */
export const DEFAULT_LIMITS: Readonly<{
  /** 10,000 */
  maxEntries: number;
  /** 256 MiB (decompressed bytes) */
  maxTotalSize: number;
}>;

export type BrowserFromArchiveOptions = {
  /** Default `true`. Set `false` if `buffer` is an uncompressed Web Bundle. Canonical name. */
  compressed?: boolean;
  /** Alias of `compressed`. */
  compress?: boolean;
  /** Reject archives with more entries than this (`ArchiveLimitError`,
   * `limit: "entries"`). Default `DEFAULT_LIMITS.maxEntries`. */
  maxEntries?: number;
  /** Abort once decompression would exceed this many bytes
   * (`ArchiveLimitError`, `limit: "totalSize"`); also bounds uncompressed
   * input. Enforced while streaming, so a decompression bomb is never fully
   * inflated. Default `DEFAULT_LIMITS.maxTotalSize`. */
  maxTotalSize?: number;
  /** What to do with an unsafe entry path (`..` segments, absolute, backslash,
   * NUL/control characters, empty segments, foreign origin, query/fragment,
   * duplicates after percent-decoding). `"throw"` (default) raises
   * `InvalidPathError`; `"skip"` silently drops the entry (first duplicate wins). */
  unsafePaths?: "throw" | "skip";
};

/** Serializes a file Map to a (by default gzip-compressed) Web Bundle. */
export function toArchive(
  map: Map<string, FileEntry>,
  options?: BrowserToArchiveOptions
): Promise<Uint8Array>;

/**
 * Deserializes a (by default gzip-compressed) Web Bundle back into a
 * `Map<string, FileEntry>`, safe to call on untrusted bytes. Rejects with
 * `InvalidPathError`, `ArchiveLimitError` or `InvalidArchiveError` (all
 * `PackfileError`s with a stable `code`).
 */
export function fromArchive(
  buffer: ArrayBuffer | Uint8Array,
  options?: BrowserFromArchiveOptions
): Promise<Map<string, FileEntry>>;

/**
 * Hashes (SHA-256, Web Crypto) a plain `{ path: string | Uint8Array }`
 * object into a `Map<string, FileEntry>`. Strings are UTF-8 encoded;
 * `Uint8Array` values are used as-is. Throws `InvalidPathError` for an
 * unsafe key and `TypeError` for a bad value.
 */
export function fromFiles(files: Files): Promise<Map<string, FileEntry>>;

/** Inverse of `fromFiles()`. Values are `Uint8Array` unless `decodeText`. */
export function toFiles(
  map: Map<string, FileEntry>,
  options?: ToFilesOptions
): Record<string, string | Uint8Array>;

/**
 * Returns a `(input, ctx?) => Promise<Response>` handler that serves files
 * from a `Map`/`LazyFileMap`. Identical implementation to the `.` entry's.
 */
export function createRouter(
  files: FilesMap,
  options?: RouterOptions
): RouteHandler;

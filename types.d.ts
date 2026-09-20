import {
  FileEntry,
  FilesMap,
  FromDirectoryOptions,
  FromDirectoryLazyOptions,
  ToArchiveOptions,
  FromArchiveOptions,
  RouterOptions,
  RouteHandler,
  RouteContext,
  FallbackHandler,
  CompileOptions,
} from "./types";

export {
  FileEntry,
  FilesMap,
  FromDirectoryOptions,
  FromDirectoryLazyOptions,
  ToArchiveOptions,
  FromArchiveOptions,
  RouterOptions,
  RouteHandler,
  RouteContext,
  FallbackHandler,
  CompileOptions,
};

// Note: `types.d.ts` describes the main `.` entry point (`index.mjs`).
// `withCache` (from the `@johnhenry/packfile/cache` subpath) is documented in the README
// but not re-declared here, since it is not part of `index.mjs`'s exports.

/** Reads all files from a directory into a `Map<string, FileEntry>`. */
export function fromDirectory(
  directoryPath: string,
  options?: FromDirectoryOptions
): Promise<Map<string, FileEntry>>;

/** Returns a `LazyFileMap` that reads files from disk on demand. */
export function fromDirectoryLazy(
  directoryPath: string,
  options?: FromDirectoryLazyOptions
): Promise<FilesMap>;

/** Serializes a file Map to a (by default gzip-compressed) CBOR archive buffer. */
export function toArchive(
  map: Map<string, FileEntry>,
  options?: ToArchiveOptions
): Promise<Buffer>;

/** Deserializes a CBOR archive back into a `Map<string, FileEntry>`. */
export function fromArchive(
  buffer: Buffer | ArrayBuffer | Uint8Array,
  options?: FromArchiveOptions
): Promise<Map<string, FileEntry>>;

/**
 * Returns a `(input, ctx?) => Promise<Response>` handler that serves files
 * from a `Map`/`LazyFileMap`. `input` may be a path string or a `Request`.
 * The returned function also has itself assigned to `.fetch`.
 */
export function createRouter(
  files: FilesMap,
  options?: RouterOptions
): RouteHandler;

/** SHA-256 hex digest of a Buffer/Uint8Array. */
export function hashBuffer(buffer: Buffer | Uint8Array): string;

/** SHA-256 hex digest of a Node.js Readable stream. */
export function hashStream(stream: NodeJS.ReadableStream): Promise<string>;

/** Convenience wrapper: `fromDirectory` -> `toArchive`. */
export function compileDirectory(
  directoryPath: string,
  options?: CompileOptions
): Promise<Buffer>;

/** Convenience wrapper: `fromArchive` -> write files to `outputPath`. */
export function decompileDirectory(
  compiledData: Buffer | ArrayBuffer | Uint8Array,
  outputPath: string,
  compressed?: boolean
): Promise<void>;

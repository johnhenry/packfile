export type FileEntry = {
  data: Uint8Array;
  size: number;
  hash: string;
};

/** A `Map`-like collection of file entries. `LazyFileMap.get()` may return a Promise. */
export interface FilesMap {
  has(key: string): boolean;
  get(key: string): FileEntry | undefined | Promise<FileEntry | undefined>;
  keys(): IterableIterator<string>;
  readonly size: number;
}

export type FromDirectoryOptions = {
  ignorePatterns?: string[];
  maxFileSize?: number;
};

export type FromDirectoryLazyOptions = {
  ignorePatterns?: string[];
};

export type ToArchiveOptions = {
  /** Default `true`. Canonical name. */
  compress?: boolean;
  /** Alias of `compress` (the `./browser` entry's historical name). Passing
   * both with different values throws a `TypeError`. */
  compressed?: boolean;
  compressionLevel?: number;
};

export type FromArchiveOptions = {
  /** Default `true`. Set `false` for an uncompressed Web Bundle. Canonical name. */
  compressed?: boolean;
  /** Alias of `compressed`. */
  compress?: boolean;
};

export type RouteContext = unknown;

export type FallbackHandler = (
  input: string | Request,
  ctx?: RouteContext
) => Response | Promise<Response>;

export type RouterOptions = {
  alias?: { [path: string]: string };
  cacheControl?: string;
  mimeTypes?: { [extension: string]: string };
  tryExtensions?: string[];
  fallback?: FallbackHandler;
};

export type RouteHandler = ((
  input: string | Request,
  ctx?: RouteContext
) => Promise<Response>) & {
  fetch: RouteHandler;
};

export type CompileOptions = {
  compress?: boolean;
  compressionLevel?: number;
  ignorePatterns?: string[];
  maxFileSize?: number;
};

export type CacheOptions = {
  cacheControl?: string;
  weak?: boolean;
};

/** Plain in-memory file set: relative POSIX path -> text (UTF-8 encoded on
 * the way in) or bytes. The shape applications usually hold; convert with
 * `fromFiles()` / `toFiles()`. */
export type Files = { [relativePosixPath: string]: string | Uint8Array };

export type ToFilesOptions = {
  /** Return text entries as strings instead of bytes. `true` decodes every
   * entry whose extension maps to a text content type (text/*, JSON,
   * JavaScript, XML/SVG) and whose bytes are valid UTF-8; a predicate picks
   * entries yourself (invalid UTF-8 always falls back to bytes). Default
   * `false`: every value is the entry's `Uint8Array`. */
  decodeText?: boolean | ((path: string) => boolean);
};

/** Why a path was rejected. */
export type InvalidPathReason =
  | "empty" | "not-a-string" | "absolute" | "backslash" | "control-character"
  | "empty-segment" | "dot-segment" | "traversal" | "malformed-encoding"
  | "outside-base" | "query-or-fragment" | "duplicate";

export declare class PackfileError extends Error {
  /** Stable machine-readable code, e.g. "ERR_PACKFILE_LIMIT". */
  code: string;
}
export declare class InvalidPathError extends PackfileError {
  code: "ERR_PACKFILE_INVALID_PATH";
  path: string;
  reason: InvalidPathReason;
}
export declare class ArchiveLimitError extends PackfileError {
  code: "ERR_PACKFILE_LIMIT";
  limit: "entries" | "totalSize";
  max: number;
}
export declare class InvalidArchiveError extends PackfileError {
  code: "ERR_PACKFILE_INVALID_ARCHIVE";
}

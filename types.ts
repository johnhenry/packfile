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
  compress?: boolean;
  compressionLevel?: number;
};

export type FromArchiveOptions = {
  compressed?: boolean;
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

import { FilesMap } from "./types.js";

export { FilesMap };

// Note: `blob-preview.d.ts` describes the `./blob-preview` entry point
// (`lib/blob-preview.mjs`), whose only export is `createBlobPreview`.

/** Why a reference was left unrewritten (see README "What this does and
 * does not solve"): either the target path doesn't exist in the given
 * `FilesMap` ("missing"), or resolving it would require a file that's
 * still mid-finalization -- a genuine reference cycle ("cycle"), or a JS file the module lexer could not parse ("unparseable"). */
export type UnresolvedReferenceReason = "missing" | "cycle" | "unparseable";

export type UnresolvedReferenceInfo = {
  reason: UnresolvedReferenceReason;
  targetPath: string;
  fromPath: string;
};

export type CreateBlobPreviewOptions = {
  /** The entry-point path, must exist in `files`. Default `"index.html"`. */
  rootPath?: string;
  /** Throw instead of warning when a relative reference can't be resolved
   * (missing file, or a reference-cycle closing edge). Default `false`. */
  strict?: boolean;
  /** Called instead of the default `console.warn` for every reference this
   * module leaves unrewritten because it couldn't (or, for cycles,
   * shouldn't) be resolved. Ignored when `strict` is set (which throws
   * instead). */
  onUnresolvedReference?: (info: UnresolvedReferenceInfo) => void;
};

/**
 * A registry of in-memory JS files, each backed by its own `blob:` URL.
 *
 * This is a duplicate of `@johnhenry/andbox`'s own `VirtualModuleRegistry`
 * interface (from `createVirtualModuleRegistry()`, which `createBlobPreview`
 * uses internally for JS specifier resolution), not an import of it: as of
 * this writing `@johnhenry/andbox`'s `package.json` has no `types`
 * condition of its own (the same class of bug this file's sibling
 * `browser.d.ts` fixes for this package -- see packfile issue #5), so
 * `import("@johnhenry/andbox").VirtualModuleRegistry` does not resolve for
 * a consumer of *this* package under `moduleResolution: "nodenext"`/
 * `"bundler"`. Duplicated here deliberately so this package's own types
 * stay resolvable regardless of that separate, upstream issue; keep this
 * in sync with `@johnhenry/andbox`'s `src/index.d.ts` if it changes.
 */
export interface VirtualModuleRegistry {
  /** Get the `blob:` URL registered for a path, or `null` if unknown. */
  resolve(path: string): string | null;
  /** Resolve a module specifier the way `import` would, from the point of
   * view of a given importing file: import-map resolution first, then a
   * relative-path fallback, then `null` if neither matched. */
  resolveSpecifier(specifier: string, parentPath?: string): string | null;
  /** Register (or replace) a file at runtime. Returns the new blob URL. */
  define(path: string, source: string): string;
  /** Whether a path is registered. */
  has(path: string): boolean;
  /** All registered paths. */
  paths(): string[];
  /** Revoke every blob URL this registry has ever minted. */
  dispose(): void;
  /** Whether `dispose()` has been called. */
  isDisposed(): boolean;
}

export type BlobPreview = {
  /** `blob:` URL for `rootPath`. */
  entryUrl: string;
  /** Look up the `blob:` URL minted for a given packaged path. */
  resolve(path: string): string | null;
  /** Revokes every `blob:` URL this call minted. */
  dispose(): void;
  /** The underlying andbox registry, for advanced JS-specifier resolution. */
  registry: VirtualModuleRegistry;
};

/**
 * Relative ES-module specifiers in .js/.mjs/.cjs files (static `import`,
 * `export ... from`, `export * from`, side-effect `import`, and string-literal
 * dynamic `import()`) are rewritten to the dependency's blob URL in
 * module-graph order; a cycle's closing edge is reported with reason
 * `"cycle"` and left unrewritten.
 *
 * Turn a packfile `FilesMap` into a set of `blob:` URLs suitable for hosting
 * inside a browser tab/iframe with no server. For trusted/your-own content
 * only -- see README's "What this does and does not solve".
 */
export function createBlobPreview(
  files: FilesMap,
  options?: CreateBlobPreviewOptions
): Promise<BlobPreview>;

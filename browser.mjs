/**
 * Browser build of `toArchive`/`fromArchive`. Same gzip(Web Bundle) wire
 * format as the Node entrypoint (`lib/to-archive.mjs`/`lib/from-archive.mjs`
 * -- same `wbn` package, same fixed `ARCHIVE_BASE_URL`), so an archive built
 * in one environment is directly readable in the other. Previously this
 * file hand-rolled its own, independently-maintained CBOR-object
 * encode/decode against a globally-loaded `cbor` library (or injected
 * `encode`/`decode` options) -- a real, documented divergence from the Node
 * implementation it duplicated (see FORMATS.md).
 *
 * `wbn` itself needs no Node APIs (confirmed: its own 0.0.8 release notes
 * removed its last one) and is imported directly here, same as the Node
 * side -- but the actual glue code below is a deliberate, separate copy of
 * `lib/web-bundle.mjs`'s logic, not a shared import of it: that module also
 * imports `lib/hash.mjs`, which imports `node:crypto` -- a bare Node
 * built-in specifier with no browser resolution at all, and pulling it in
 * transitively (ESM has no way to import only *part* of a module) would
 * break this file in an actual browser. Hashing uses Web Crypto's
 * `crypto.subtle.digest` (async-only) here instead of Node's synchronous
 * `crypto.createHash`; compression uses `CompressionStream`/
 * `DecompressionStream` here instead of Node's `zlib` -- both were already
 * platform-specific before this change and stay that way.
 */
import { compressObject } from "./lib/compression.browser.mjs";
import { getContentType } from "./lib/mime.mjs";
import { encodePath } from "./lib/path-safety.mjs";
import { aliasedOption } from "./lib/options.mjs";
import { readArchiveSafely, ARCHIVE_BASE_URL, DEFAULT_LIMITS } from "./lib/safe-archive.mjs";
import * as wbn from "wbn";

export { createRouter } from "./lib/create-router.mjs";
export { fromFiles, toFiles } from "./lib/files.mjs";
export { PackfileError, InvalidPathError, ArchiveLimitError, InvalidArchiveError } from "./lib/errors.mjs";
export { DEFAULT_LIMITS };

/**
 * Hardened for untrusted input (see `lib/safe-archive.mjs`): path
 * validation, `maxEntries` / `maxTotalSize` limits, typed errors.
 * Options: `compressed` (alias `compress`), `maxEntries`, `maxTotalSize`,
 * `unsafePaths: "throw" | "skip"`.
 */
export const fromArchive = (buffer, opts = {}) => readArchiveSafely(buffer, opts);

/** Resolves to a `Uint8Array` (compressed or not). Options: `compress` (alias `compressed`). */
export const toArchive = async (map, opts = {}) => {
  const compress = aliasedOption(opts, "compress", "compressed", true);

  const builder = new wbn.BundleBuilder();
  for (const [path, entry] of map) {
    const url = new URL(encodePath(path), ARCHIVE_BASE_URL).toString();
    builder.addExchange(url, 200, { "Content-Type": getContentType(path) }, entry.data);
  }
  builder.setPrimaryURL(ARCHIVE_BASE_URL);

  const bundle = builder.createBundle();
  return compress ? new Uint8Array(await compressObject(bundle)) : bundle;
};

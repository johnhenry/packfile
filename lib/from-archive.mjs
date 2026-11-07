/**
 * Deserializes this package's archive format (gzip(Web Bundle)) back into a
 * `FilesMap`. Each exchange's absolute URL is stripped back down to a
 * relative path against a base chosen by `resolveArchiveBase()`
 * (`lib/path-safety.mjs`): `opts.baseURL` if given, else the bundle's
 * primary URL's root (origin + "/"), else the internal `ARCHIVE_BASE_URL`
 * that `toArchive()` writes (and also uses as its primary URL, so archives
 * packfile writes always read back against the same base). Entries outside
 * that base, or with an unsafe path, are skipped; `opts.onSkip` reports each
 * one. Path validation lives in `lib/bundle-to-files.mjs`/`urlToPath()`,
 * not here.
 */
import * as wbn from "wbn";
import { deCompressObject } from "./compression.mjs";
import { bundleToFiles } from "./bundle-to-files.mjs";
import { resolveArchiveBase } from "./path-safety.mjs";
import { aliasedOption } from "./options.mjs";

export const fromArchive = async (buffer, opts = {}) => {
  const compressed = aliasedOption(opts, "compressed", "compress", true);
  const { onSkip } = opts;
  // Validate options before decompressing anything.
  if (opts.baseURL !== undefined) resolveArchiveBase(opts.baseURL);
  if (onSkip !== undefined && typeof onSkip !== "function") {
    throw new TypeError("packfile: onSkip must be a function");
  }

  if (compressed) {
    buffer = await deCompressObject(buffer);
  }

  const bundle = new wbn.Bundle(buffer);
  const baseURL = resolveArchiveBase(opts.baseURL, bundle.primaryURL);
  return bundleToFiles(bundle, { baseURL, onSkip });
};

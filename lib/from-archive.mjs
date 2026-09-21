/**
 * Deserializes this package's archive format (gzip(Web Bundle)) back into a
 * `FilesMap`, via `fromWebBundle()` (`lib/web-bundle.mjs`). See
 * `to-archive.mjs` for `ARCHIVE_BASE_URL` -- the same internal-only base URL
 * used there is used here to strip each exchange's absolute URL back down
 * to a relative path. Path-safety validation (rejecting an entry that
 * normalizes outside the archive root) lives in `fromWebBundle()` itself
 * now, applied whenever a `baseURL` is given -- not duplicated here.
 */
import { deCompressObject } from "./compression.mjs";
import { fromWebBundle } from "./web-bundle.mjs";

const ARCHIVE_BASE_URL = "https://packfile.invalid/";

export const fromArchive = async (buffer, opts = {}) => {
  const { compressed = true } = opts;

  if (compressed) {
    buffer = await deCompressObject(buffer);
  }

  return fromWebBundle(buffer, { baseURL: ARCHIVE_BASE_URL });
};

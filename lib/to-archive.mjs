/**
 * Serializes a `FilesMap` to this package's archive format: gzip(Web
 * Bundle), via `toWebBundle()` (`lib/web-bundle.mjs`). `ARCHIVE_BASE_URL`
 * is purely an internal implementation detail -- `toArchive()`/
 * `fromArchive()` keep the same flat path -> content contract callers
 * already had with the previous CBOR format; nothing about the Web Bundle
 * format's own absolute-URL requirement is exposed here. It uses the
 * IANA/RFC 2606 `.invalid` TLD, guaranteed to never resolve to a real
 * origin, since this URL is never meant to be dereferenced -- only ever
 * built and immediately stripped back off by `fromArchive()`.
 */
import { compressObject } from "./compression.mjs";
import { toWebBundle } from "./web-bundle.mjs";

const ARCHIVE_BASE_URL = "https://packfile.invalid/";

export const toArchive = async (map, opts = {}) => {
  const { compress = true, compressionLevel } = opts;

  let buffer = toWebBundle(map, { baseURL: ARCHIVE_BASE_URL });

  if (compress) {
    buffer = await compressObject(buffer, compressionLevel);
  }

  return buffer;
};

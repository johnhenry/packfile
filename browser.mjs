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
import { deCompressObject, compressObject } from "./lib/compression.browser.mjs";
import { getContentType } from "./lib/mime.mjs";
import * as wbn from "wbn";

export { createRouter } from "./lib/create-router.mjs";

const ARCHIVE_BASE_URL = "https://packfile.invalid/";

// Same coarse, pure-string check as lib/web-bundle.mjs's own (duplicated,
// not imported -- that module also pulls in lib/hash.mjs's Node-only
// `node:crypto` import, which has no browser resolution at all).
const isSafePath = (p) => {
  if (p.startsWith("/") || p.startsWith("\\")) return false;
  if (p.includes("..")) return false;
  if (p.includes("\0")) return false;
  if (p === "" || p === ".") return false;
  return true;
};

const stripBaseURL = (url, baseURL) => {
  const base = baseURL.endsWith("/") ? baseURL : `${baseURL}/`;
  return url.startsWith(base) ? url.slice(base.length) : url;
};

const sha256Hex = async (data) => {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

export const fromArchive = async (buffer, opts = {}) => {
  const { compressed = true } = opts;

  if (compressed) {
    buffer = await deCompressObject(buffer);
  }

  const bundle = new wbn.Bundle(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer);
  const files = new Map();

  for (const url of bundle.urls) {
    const relativeKey = stripBaseURL(url, ARCHIVE_BASE_URL);
    if (!isSafePath(relativeKey)) continue;

    const response = bundle.getResponse(url);
    files.set(relativeKey, {
      data: response.body,
      size: response.body.byteLength,
      hash: await sha256Hex(response.body),
    });
  }

  return files;
};

export const toArchive = async (map, opts = {}) => {
  const { compressed = true } = opts;

  const builder = new wbn.BundleBuilder();
  for (const [path, entry] of map) {
    const url = new URL(path, ARCHIVE_BASE_URL).toString();
    builder.addExchange(url, 200, { "Content-Type": getContentType(path) }, entry.data);
  }
  builder.setPrimaryURL(ARCHIVE_BASE_URL);

  let buffer = builder.createBundle();
  if (compressed) {
    buffer = await compressObject(buffer);
  }
  return buffer;
};

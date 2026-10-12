/**
 * Hardened reader for this package's archive format (gzip(Web Bundle)),
 * for input that may be hostile. Platform-agnostic (Web Streams + Web
 * Crypto, no Node built-ins) -- backs the `./browser` entrypoint's
 * `fromArchive()`.
 *
 * Defenses:
 * - Decompression is streamed and aborted as soon as the output exceeds
 *   `maxTotalSize`, so a 1000:1 gzip bomb never gets inflated in full.
 * - `maxEntries` is enforced before any entry is hashed or copied.
 * - Every exchange URL is validated with the same `urlToPath()` the Node
 *   reader uses (decoded traversal, backslash, NUL/control chars, absolute
 *   or empty segments, query/fragment, foreign origin), and duplicates
 *   that collide only after percent-decoding are rejected.
 * - Anything that is not a readable archive raises `InvalidArchiveError`
 *   rather than a raw TypeError/RangeError from a lower layer.
 */
import * as wbn from "wbn";
import { urlToPath } from "./path-safety.mjs";
import { sha256Hex } from "./files.mjs";
import { ArchiveLimitError, InvalidArchiveError, InvalidPathError } from "./errors.mjs";
import { aliasedOption } from "./options.mjs";

export const ARCHIVE_BASE_URL = "https://packfile.invalid/";

export const DEFAULT_LIMITS = Object.freeze({
  maxEntries: 10_000,
  maxTotalSize: 256 * 1024 * 1024,
});

const toBytes = (input) => {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError("fromArchive() expects an ArrayBuffer or Uint8Array");
};

const checkLimit = (name, value) => {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`packfile: ${name} must be a non-negative finite number`);
  }
  return value;
};

/** gunzip with a hard cap on the inflated size. */
const gunzipLimited = async (bytes, maxTotalSize) => {
  let reader;
  try {
    reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  } catch (cause) {
    throw new InvalidArchiveError("cannot start gzip decompression", { cause });
  }
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxTotalSize) {
        reader.cancel().catch(() => {});
        throw new ArchiveLimitError("totalSize", maxTotalSize);
      }
      chunks.push(value);
    }
  } catch (cause) {
    if (cause instanceof ArchiveLimitError) throw cause;
    throw new InvalidArchiveError("not a valid gzip stream", { cause });
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

export const readArchiveSafely = async (input, opts = {}) => {
  const compressed = aliasedOption(opts, "compressed", "compress", true);
  const maxEntries = checkLimit("maxEntries", opts.maxEntries ?? DEFAULT_LIMITS.maxEntries);
  const maxTotalSize = checkLimit("maxTotalSize", opts.maxTotalSize ?? DEFAULT_LIMITS.maxTotalSize);
  const unsafePaths = opts.unsafePaths ?? "throw";
  if (unsafePaths !== "throw" && unsafePaths !== "skip") {
    throw new TypeError('packfile: unsafePaths must be "throw" or "skip"');
  }

  let bytes = toBytes(input);
  if (compressed) bytes = await gunzipLimited(bytes, maxTotalSize);
  else if (bytes.byteLength > maxTotalSize) throw new ArchiveLimitError("totalSize", maxTotalSize);

  let bundle;
  let urls;
  try {
    bundle = new wbn.Bundle(bytes);
    urls = bundle.urls;
  } catch (cause) {
    throw new InvalidArchiveError("not a Web Bundle", { cause });
  }
  if (urls.length > maxEntries) throw new ArchiveLimitError("entries", maxEntries);

  const files = new Map();
  for (const url of urls) {
    const result = urlToPath(url, ARCHIVE_BASE_URL);
    let reason = result.reason;
    if (!reason && files.has(result.path)) reason = "duplicate";
    if (reason) {
      if (unsafePaths === "skip") continue;
      throw new InvalidPathError(result.path ?? result.raw ?? url, reason);
    }
    let body;
    try {
      body = bundle.getResponse(url).body;
    } catch (cause) {
      throw new InvalidArchiveError(`cannot read entry ${JSON.stringify(result.path)}`, { cause });
    }
    files.set(result.path, { data: body, size: body.byteLength, hash: await sha256Hex(body) });
  }
  return files;
};

/**
 * `fromFiles()` / `toFiles()` -- adapters between the plain
 * `{ [relativePosixPath]: string | Uint8Array }` object an application
 * typically holds in memory and packfile's `FilesMap`
 * (`Map<path, { data, size, hash }>`).
 *
 * Platform-agnostic: hashing uses Web Crypto (`globalThis.crypto.subtle`),
 * which exists in browsers and in Node >= 19, so the very same module backs
 * both the `.` and `./browser` entrypoints and the hashes are identical to
 * `hashBuffer()`'s.
 */
import { checkPath } from "./path-safety.mjs";
import { InvalidPathError } from "./errors.mjs";
import { getContentType } from "./mime.mjs";

const encoder = new TextEncoder();

const sha256Hex = async (bytes) => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

/**
 * @param {Record<string, string | Uint8Array>} files
 * @returns {Promise<Map<string, {data: Uint8Array, size: number, hash: string}>>}
 * @throws {InvalidPathError} for an unsafe key; {TypeError} for a bad value.
 *   Strings are UTF-8 encoded; a `Uint8Array` is used as-is (not copied).
 */
export const fromFiles = async (files) => {
  if (files === null || typeof files !== "object") {
    throw new TypeError("fromFiles() expects a plain object of { path: string | Uint8Array }");
  }
  const map = new Map();
  for (const [path, content] of Object.entries(files)) {
    const reason = checkPath(path);
    if (reason) throw new InvalidPathError(path, reason);
    let data;
    if (typeof content === "string") data = encoder.encode(content);
    else if (content instanceof Uint8Array) data = content;
    else {
      throw new TypeError(`fromFiles(): value for ${JSON.stringify(path)} must be a string or Uint8Array`);
    }
    map.set(path, { data, size: data.byteLength, hash: await sha256Hex(data) });
  }
  return map;
};

const isTextContentType = (type) =>
  type.startsWith("text/") || /json|javascript|xml/.test(type);

/**
 * @param {Map<string, {data: Uint8Array}>} map an eager Map (not a LazyFileMap)
 * @param {{ decodeText?: boolean | ((path: string) => boolean) }} [options]
 *   By default every value is the entry's `Uint8Array` (lossless). With
 *   `decodeText: true`, entries whose extension maps to a text content type
 *   (text/*, JSON, JavaScript, XML/SVG) AND whose bytes are valid UTF-8 come
 *   back as strings; a predicate `(path) => boolean` picks entries yourself
 *   (invalid UTF-8 still falls back to bytes).
 * @returns {Record<string, string | Uint8Array>}
 */
export const toFiles = (map, options = {}) => {
  const { decodeText = false } = options;
  const wants =
    typeof decodeText === "function"
      ? decodeText
      : decodeText
        ? (path) => isTextContentType(getContentType(path))
        : () => false;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  // Object.fromEntries uses CreateDataProperty, so a key like "__proto__"
  // becomes a harmless own property instead of mutating the prototype.
  return Object.fromEntries(
    Array.from(map, ([path, entry]) => {
      if (wants(path)) {
        try {
          return [path, decoder.decode(entry.data)];
        } catch {
          /* not valid UTF-8: keep the bytes */
        }
      }
      return [path, entry.data];
    })
  );
};

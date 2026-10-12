/** Browser-safe build adapters. Encoding stays in packfile's existing encoder. */
import { fromFiles, sha256Hex } from "./files.mjs";
import { toArchive } from "../browser.mjs";
import { checkPath } from "./path-safety.mjs";
import { InvalidPathError } from "./errors.mjs";
import { getContentType } from "./mime.mjs";

/** Package an object of relative paths to UTF-8 strings or bytes. */
export async function exportFiles(files) {
  if (!files || typeof files !== "object" || Array.isArray(files) || files instanceof Map) {
    throw new TypeError("exportFiles(): expected an object of paths to strings or bytes");
  }
  const entries = Object.entries(files);
  if (!entries.length) throw new TypeError("exportFiles(): the build contains no files");
  const paths = new Set();
  for (const [path] of entries) {
    const reason = checkPath(path);
    if (reason) throw new InvalidPathError(path, reason);
    const key = path.toLowerCase();
    if (paths.has(key)) throw new InvalidPathError(path, "case-collision");
    paths.add(key);
  }
  for (const [path] of entries) {
    const parts = path.toLowerCase().split("/");
    while (parts.length > 1) {
      parts.pop();
      if (paths.has(parts.join("/"))) throw new InvalidPathError(path, "file-directory-collision");
    }
  }
  // Stable path order makes identical input independent of build iteration order.
  entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const map = await fromFiles(Object.fromEntries(entries));
  const archive = await toArchive(map);
  return {
    archive,
    sha256: await sha256Hex(archive),
    files: Array.from(map, ([path, entry]) => ({
      path, size: entry.size, sha256: entry.hash, contentType: getContentType(path),
    })),
  };
}

/** Accept Rollup/Rolldown `result.output`, including browser Rolldown output. */
export async function exportBuild(output) {
  if (!Array.isArray(output)) throw new TypeError("exportBuild(): expected an output array");
  const files = Object.create(null);
  for (const item of output) {
    if (!item || (item.type !== "chunk" && item.type !== "asset")) {
      throw new TypeError("exportBuild(): expected a chunk or asset");
    }
    const reason = checkPath(item.fileName);
    if (reason) throw new InvalidPathError(item.fileName, reason);
    if (Object.hasOwn(files, item.fileName)) throw new InvalidPathError(item.fileName, "duplicate");
    files[item.fileName] = item.type === "chunk" ? item.code : item.source;
  }
  return exportFiles(files);
}

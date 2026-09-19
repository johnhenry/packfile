import { readFile, readdir, stat, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { hashBuffer } from "./hash.mjs";
import { isWithinRoot } from "./safe-symlink.mjs";

// path.relative() returns platform-native separators -- backslash on
// Windows. FilesMap keys (and everything that looks them up: createRouter(),
// toArchive()/fromArchive() round-tripping, a consumer's own path.join()
// calls) all assume the single POSIX-style "/" convention used everywhere
// else in this codebase (see FORMATS.md), so a Windows-produced FilesMap
// with un-normalized "docs\index.html"-style keys silently fails every
// forward-slash lookup. Found via real Windows CI, not by inspection.
const toPosixPath = (path) => (sep === "/" ? path : path.split(sep).join("/"));

export const fromDirectory = async (directoryPath, options = {}) => {
  const {
    ignorePatterns = [],
    maxFileSize = Infinity,
  } = options;

  const files = new Map();
  const rootRealPath = await realpath(directoryPath);

  // Tracks the real path of every directory from the root down to the one
  // currently being walked, so a symlink that points back at an ancestor
  // (e.g. `ln -s . loop`, or a mutual A<->B symlink cycle) is detected and
  // skipped instead of recursing until the OS's ELOOP limit crashes the
  // whole fromDirectory() call.
  const walk = async (currentPath, currentRealPath, ancestors) => {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      const relativePath = toPosixPath(relative(directoryPath, fullPath));

      if (ignorePatterns.some((pattern) => new RegExp(pattern).test(relativePath))) {
        continue;
      }

      let childRealPath = join(currentRealPath, entry.name);

      if (entry.isSymbolicLink()) {
        // A symlink inside the target directory can point anywhere on disk.
        // Resolve its real path and skip it if it escapes the directory
        // being archived — otherwise fromDirectory() would silently read
        // and package up arbitrary files from outside the target tree.
        let realTarget;
        try {
          realTarget = await realpath(fullPath);
        } catch {
          continue; // broken symlink or too many levels of symlinks (ELOOP)
        }
        if (!isWithinRoot(rootRealPath, realTarget)) continue;
        if (ancestors.has(realTarget)) continue; // symlink cycle
        childRealPath = realTarget;
      }

      // Resolve the actual type via stat (follows symlinks that passed the
      // containment/cycle checks above).
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        await walk(fullPath, childRealPath, new Set(ancestors).add(childRealPath));
      } else if (stats.isFile()) {
        if (stats.size > maxFileSize) continue;
        const data = await readFile(fullPath);
        const hash = hashBuffer(data);
        files.set(relativePath, {
          data: new Uint8Array(data),
          size: stats.size,
          hash,
        });
      }
    }
  };

  await walk(directoryPath, rootRealPath, new Set([rootRealPath]));
  return files;
};

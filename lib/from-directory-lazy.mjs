import { readdir, stat, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { LazyFileMap } from "./lazy-file-map.mjs";
import { isWithinRoot } from "./safe-symlink.mjs";

export const fromDirectoryLazy = async (directoryPath, options = {}) => {
  const { ignorePatterns = [] } = options;

  const paths = new Set();
  const rootRealPath = await realpath(directoryPath);

  // See fromDirectory() for why both an escape check and a cycle check are
  // needed: a symlink inside directoryPath can point outside the tree
  // (exposing arbitrary files via paths/get()), or back at an ancestor
  // directory (e.g. `ln -s . loop`), which would otherwise recurse until
  // the OS's ELOOP limit crashes the whole fromDirectoryLazy() call.
  const walk = async (currentPath, currentRealPath, ancestors) => {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      const relativePath = relative(directoryPath, fullPath);

      if (ignorePatterns.some((pattern) => new RegExp(pattern).test(relativePath))) {
        continue;
      }

      let childRealPath = join(currentRealPath, entry.name);

      if (entry.isSymbolicLink()) {
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

      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        await walk(fullPath, childRealPath, new Set(ancestors).add(childRealPath));
      } else if (stats.isFile()) {
        paths.add(relativePath);
      }
    }
  };

  await walk(directoryPath, rootRealPath, new Set([rootRealPath]));
  return new LazyFileMap(directoryPath, paths);
};

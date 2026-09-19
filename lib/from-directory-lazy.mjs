import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { LazyFileMap } from "./lazy-file-map.mjs";

export const fromDirectoryLazy = async (directoryPath, options = {}) => {
  const { ignorePatterns = [] } = options;

  const paths = new Set();

  const walk = async (currentPath) => {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      const relativePath = relative(directoryPath, fullPath);

      if (ignorePatterns.some((pattern) => new RegExp(pattern).test(relativePath))) {
        continue;
      }

      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        await walk(fullPath);
      } else if (stats.isFile()) {
        paths.add(relativePath);
      }
    }
  };

  await walk(directoryPath);
  return new LazyFileMap(directoryPath, paths);
};

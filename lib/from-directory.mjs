import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { hashBuffer } from "./hash.mjs";

export const fromDirectory = async (directoryPath, options = {}) => {
  const {
    ignorePatterns = [],
    maxFileSize = Infinity,
  } = options;

  const files = new Map();

  const walk = async (currentPath) => {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      const relativePath = relative(directoryPath, fullPath);

      if (ignorePatterns.some((pattern) => new RegExp(pattern).test(relativePath))) {
        continue;
      }

      // Resolve the actual type via stat for symlinks
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        await walk(fullPath);
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

  await walk(directoryPath);
  return files;
};

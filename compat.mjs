import { fromDirectory } from "./lib/from-directory.mjs";
import { toArchive } from "./lib/to-archive.mjs";
import { fromArchive } from "./lib/from-archive.mjs";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

export const compileDirectory = async (directoryPath, options = {}) => {
  const {
    compress = true,
    compressionLevel,
    ignorePatterns = [],
    maxFileSize,
  } = options;
  const map = await fromDirectory(directoryPath, { ignorePatterns, maxFileSize });
  return toArchive(map, { compress, compressionLevel });
};

export const decompileDirectory = async (compiledData, outputPath, compressed = true) => {
  const map = await fromArchive(compiledData, { compressed });
  for (const [relativePath, entry] of map) {
    const fullPath = join(outputPath, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, entry.data);
  }
};

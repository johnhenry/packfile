import fs from "fs/promises";

export const representsFile = async (filePath) => {
  try {
    const stats = await fs.lstat(filePath);

    if (stats.isSymbolicLink()) {
      const realPath = await fs.realpath(filePath);
      const realStats = await fs.stat(realPath);
      return realStats.isFile();
    }

    return stats.isFile();
  } catch (error) {
    console.error(`Error checking file: ${error.message}`);
    return false;
  }
};
export const representsDir = async (dirPath) => {
  try {
    const stats = await fs.lstat(dirPath);

    if (stats.isSymbolicLink()) {
      const realPath = await fs.realpath(dirPath);
      const realStats = await fs.stat(realPath);
      return realStats.isDirectory();
    }

    return stats.isDirectory();
  } catch (error) {
    console.error(`Error checking directory: ${error.message}`);
    return false;
  }
};

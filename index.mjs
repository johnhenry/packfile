import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import cbor from "cbor";

const { encode, decode } = cbor;

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB threshold for large files

export async function compileDirectory(directoryPath) {
  const files = {};

  async function readDirectoryRecursive(currentPath) {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      const relativePath = relative(directoryPath, fullPath);

      if (entry.isDirectory()) {
        await readDirectoryRecursive(fullPath);
      } else if (entry.isFile()) {
        const stats = await stat(fullPath);
        if (stats.size > MAX_FILE_SIZE) {
          files[relativePath] = { type: "large-file", path: fullPath };
        } else {
          const content = await readFile(fullPath);
          files[relativePath] = { type: "content", data: content };
        }
      }
    }
  }

  await readDirectoryRecursive(directoryPath);
  return encode(files);
}

export async function decompileDirectory(compiledData, outputPath) {
  const files = decode(compiledData);

  for (const [relativePath, fileInfo] of Object.entries(files)) {
    const fullPath = join(outputPath, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    if (fileInfo.type === "large-file") {
      await writeFile(fullPath, await readFile(fileInfo.path));
    } else {
      await writeFile(fullPath, fileInfo.data);
    }
  }
}

export function createRouter(compiledData) {
  let files;
  try {
    files = decode(compiledData);
  } catch (error) {
    // Handle empty or invalid CBOR data
    files = {};
  }

  return async function router(path, options = {}) {
    const { alias = {} } = options;
    let filePath = path;

    // Handle aliases
    for (const [aliasPath, targetPath] of Object.entries(alias)) {
      if (path === aliasPath || path.startsWith(aliasPath + "/")) {
        filePath = path.replace(aliasPath, targetPath);
        break;
      }
    }

    // Remove leading slash
    filePath = filePath.replace(/^\//, "");

    if (files[filePath]) {
      const fileInfo = files[filePath];
      const contentType = getContentType(filePath);

      if (fileInfo.type === "large-file") {
        const content = await readFile(fileInfo.path);
        return new Response(content, {
          status: 200,
          headers: {
            "Content-Type": contentType,
          },
        });
      } else {
        return new Response(fileInfo.data, {
          status: 200,
          headers: {
            "Content-Type": contentType,
          },
        });
      }
    } else {
      return new Response("Not Found", { status: 404 });
    }
  };
}

function getContentType(filePath) {
  const extension = filePath.split(".").pop().toLowerCase();
  const mimeTypes = {
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
  };

  return mimeTypes[extension] || "application/octet-stream";
}

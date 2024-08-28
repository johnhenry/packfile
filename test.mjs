import { createReadStream } from "fs";
import { readFile, readdir, writeFile, mkdir, stat } from "fs/promises";
import { join, relative, dirname } from "path";
import { createGzip, createGunzip } from "zlib";
import cbor from "cbor";
import { createHash } from "crypto";
const { encode, decode } = cbor;

const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_CACHE_MAX_AGE = 3600; // 1 hour

export const compileDirectory = async (directoryPath, options = {}) => {
  const {
    compress = false,
    ignorePatterns = [],
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
  } = options;

  const files = {};

  const readDirectoryRecursive = async (currentPath) => {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      const relativePath = relative(directoryPath, fullPath);

      if (
        ignorePatterns.some((pattern) => new RegExp(pattern).test(relativePath))
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        await readDirectoryRecursive(fullPath);
      } else if (entry.isFile()) {
        const stats = await stat(fullPath);
        if (stats.size > maxFileSize) {
          files[relativePath] = {
            type: "large-file",
            path: fullPath,
            hash: await hashFile(fullPath),
          };
        } else {
          const content = await readFile(fullPath);
          files[relativePath] = {
            type: "content",
            data: content,
            hash: createHash("sha256").update(content).digest("hex"),
          };
        }
      }
    }
  };

  await readDirectoryRecursive(directoryPath);
  let compiledData = encode(files);

  if (compress) {
    compiledData = await new Promise((resolve, reject) => {
      createGzip().end(compiledData, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }

  return compiledData;
};

export const decompileDirectory = async (
  compiledData,
  outputPath,
  compressed = false
) => {
  if (compressed) {
    compiledData = await new Promise((resolve, reject) => {
      createGunzip().end(compiledData, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }

  const files = decode(compiledData);

  for (const [relativePath, fileInfo] of Object.entries(files)) {
    const fullPath = join(outputPath, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    if (fileInfo.type === "large-file" && fileInfo.path) {
      await writeFile(fullPath, await readFile(fileInfo.path));
    } else if (fileInfo.type === "content" && fileInfo.data) {
      await writeFile(fullPath, fileInfo.data);
    } else {
      throw new Error(`Invalid file info for ${relativePath}`);
    }
  }
};

export const createRouter = (compiledData, compressed = false) => {
  let files;
  try {
    if (compressed) {
      compiledData = createGunzip().end(compiledData);
    }
    files = decode(compiledData);
  } catch (error) {
    throw new Error(
      `Failed to decode compiled data: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  return async (path, options = {}) => {
    const { alias = {}, cacheMaxAge = DEFAULT_CACHE_MAX_AGE } = options;

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
      const headers = new Headers({
        "Content-Type": contentType,
        "Cache-Control": `max-age=${cacheMaxAge}`,
        ETag: `"${fileInfo.hash}"`,
      });

      if (fileInfo.type === "large-file" && fileInfo.path) {
        const stream = createReadStream(fileInfo.path);
        return new Response(streamToReadableStream(stream), {
          status: 200,
          headers,
        });
      } else if (fileInfo.type === "content" && fileInfo.data) {
        return new Response(fileInfo.data, { status: 200, headers });
      } else {
        throw new Error(`Invalid file info for ${filePath}`);
      }
    } else {
      return new Response("Not Found", { status: 404 });
    }
  };
};

const getContentType = (filePath) => {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
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
};

const hashFile = async (filePath) => {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
};

const streamToReadableStream = (stream) => {
  return new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => controller.enqueue(chunk));
      stream.on("end", () => controller.close());
      stream.on("error", (error) => controller.error(error));
    },
    cancel() {
      stream.destroy();
    },
  });
};

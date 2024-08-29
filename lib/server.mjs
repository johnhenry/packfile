import { createReadStream } from "fs";
import { readFile, readdir, writeFile, mkdir, stat } from "fs/promises";
import { join, relative, dirname } from "path";
import cbor from "cbor";
import { createHash } from "crypto";
import { compressObject, deCompressObject } from "./compression.mjs";

const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_CACHE_MAX_AGE = 3600; // 1 hour

export const compileDirectory = async (directoryPath, options = {}) => {
  const {
    compress = true,
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
            size: stats.size,
            hash: await hashFile(fullPath),
          };
        } else {
          const content = await readFile(fullPath);
          files[relativePath] = {
            type: "content",
            data: content,
            size: stats.size,
            hash: createHash("sha256").update(content).digest("hex"),
          };
        }
      }
    }
  };

  try {
    await readDirectoryRecursive(directoryPath);
    let compiledData = await cbor.encode(files);

    if (compress) {
      compiledData = await compressObject(compiledData);
    }

    return compiledData;
  } catch (error) {
    throw new Error(`Failed to compile directory: ${error.message}`);
  }
};

export const decompileDirectory = async (
  compiledData,
  outputPath,
  compressed = true
) => {
  try {
    if (compressed) {
      compiledData = await deCompressObject(compiledData);
    }

    const files = await cbor.decode(compiledData);

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
  } catch (error) {
    throw new Error(`Failed to decompile directory: ${error.message}`);
  }
};
export const createRouter = (compiledData, options = {}) => {
  const {
    compressed = true,
    cacheControl = `max-age=${DEFAULT_CACHE_MAX_AGE}`,
    streamThreshold = DEFAULT_MAX_FILE_SIZE,
  } = options;

  let files;
  const decodeData = async () => {
    try {
      if (compressed) {
        compiledData = await deCompressObject(compiledData);
      }
      files = await cbor.decode(compiledData);
    } catch (error) {
      throw new Error(`Failed to decode compiled data: ${error.message}`);
    }
  };

  return async (path, routeOptions = {}) => {
    if (typeof path !== "string") {
      if (path.method !== "GET") {
        throw new Error("Method GET not satisfied.");
      }
      path = new URL(path.url).pathname;
    }
    const { alias = {} } = routeOptions;

    if (!files) {
      await decodeData();
    }

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
        "Cache-Control": cacheControl,
        ETag: `"${fileInfo.hash}"`,
      });

      if (fileInfo.type === "large-file" && fileInfo.path) {
        const stream = createReadStream(fileInfo.path);
        return new Response(streamToReadableStream(stream), {
          status: 200,
          headers,
        });
      } else if (fileInfo.type === "content" && fileInfo.data) {
        if (fileInfo.size > streamThreshold) {
          const stream = streamFromBuffer(fileInfo.data);
          return new Response(streamToReadableStream(stream), {
            status: 200,
            headers,
          });
        } else {
          return new Response(fileInfo.data, { status: 200, headers });
        }
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
    txt: "text/plain",
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

const streamFromBuffer = (buffer) => {
  const { Readable } = require("stream");
  return new Readable({
    read() {
      this.push(buffer);
      this.push(null);
    },
  });
};

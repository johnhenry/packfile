async function compressObject(data, format = "gzip") {
  const stream = new Blob([data]).stream();
  const compressedStream = stream.pipeThrough(new CompressionStream(format));
  return new Response(compressedStream).arrayBuffer();
}

// Browser-compatible gunzip function
async function deCompressObject(compressedData, format = "gzip") {
  const stream = new Blob([compressedData]).stream();
  const decompressedStream = stream.pipeThrough(
    new DecompressionStream(format)
  );
  return new Response(decompressedStream).arrayBuffer();
}

const createReadStream = (file, options = {}) => {
  const { start = 0, end = Infinity, chunkSize = 64 * 1024 } = options;
  let position = start;
  const readable = new ReadableStream({
    start(controller) {
      // Nothing to do on start
    },
    pull(controller) {
      const chunk = file.slice(position, Math.min(position + chunkSize, end));
      return chunk.arrayBuffer().then((buffer) => {
        if (buffer.byteLength > 0) {
          controller.enqueue(new Uint8Array(buffer));
          position += buffer.byteLength;
          if (position >= end) {
            controller.close();
          }
        } else {
          controller.close();
        }
      });
    },
    cancel() {
      // Handle cancellation if needed
    },
  });

  return readable;
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

const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_CACHE_MAX_AGE = 3600; // 1 hour
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
        console.log(2);
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

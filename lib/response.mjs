import { getContentType } from "./mime.mjs";

const DEFAULT_CACHE_CONTROL = "max-age=3600";

export const buildFileResponse = (request, filePath, entry, opts = {}) => {
  const {
    cacheControl = DEFAULT_CACHE_CONTROL,
    mimeTypes,
  } = opts;

  const etag = `"${entry.hash}"`;

  // 304 Not Modified
  if (request) {
    const ifNoneMatch = typeof request.headers?.get === "function"
      ? request.headers.get("if-none-match")
      : request.headers?.["if-none-match"];
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: { ETag: etag },
      });
    }
  }

  const contentType = getContentType(filePath, mimeTypes);
  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Length": String(entry.size),
    "Cache-Control": cacheControl,
    ETag: etag,
  });

  // HEAD — no body
  const method = request?.method ?? "GET";
  if (method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(entry.data, { status: 200, headers });
};

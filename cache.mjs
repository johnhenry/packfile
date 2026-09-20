/**
 * HTTP caching middleware for leserve handlers.
 * Leverages packfile's SHA-256 hashing for automatic ETag generation.
 *
 * Usage:
 *   import { withCache } from "@johnhenry/packfile/cache";
 *
 *   const handler = withCache(myHandler);
 *   // Responses now include ETag, Cache-Control, and 304 negotiation.
 */
import { hashBuffer } from "./lib/hash.mjs";

/**
 * Wrap a handler with automatic ETag and Cache-Control headers.
 * Handles If-None-Match negotiation (returns 304 when matched).
 *
 * @param {Function} handler - (Request) => Response
 * @param {Object} [options]
 * @param {string} [options.cacheControl="public, max-age=3600"] - Cache-Control header value
 * @param {boolean} [options.weak=false] - Use weak ETags (W/"...")
 * @returns {Function} Wrapped handler
 */
export const withCache = (handler, options = {}) => {
  const { cacheControl = "public, max-age=3600", weak = false } = options;

  return async (request, ctx) => {
    const response = await handler(request, ctx);

    // Only cache successful GET/HEAD responses
    if (request.method !== "GET" && request.method !== "HEAD") return response;
    if (response.status !== 200) return response;

    // Skip if handler already set an ETag
    if (response.headers.has("etag")) return response;

    const body = await response.arrayBuffer();
    const hash = hashBuffer(Buffer.from(body));
    const etag = weak ? `W/"${hash}"` : `"${hash}"`;

    // 304 negotiation
    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: { etag, "cache-control": cacheControl },
      });
    }

    const headers = new Headers(response.headers);
    headers.set("etag", etag);
    if (!headers.has("cache-control")) {
      headers.set("cache-control", cacheControl);
    }

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
};

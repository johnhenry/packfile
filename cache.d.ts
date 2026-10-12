export type WithCacheOptions = {
  /** Default `"public, max-age=3600"`. */
  cacheControl?: string;
  /** Use weak ETags (`W/"..."`). Default `false`. */
  weak?: boolean;
};

/**
 * Wraps a `(Request, ctx?) => Response` handler with SHA-256 ETag and
 * Cache-Control headers and `If-None-Match` -> 304 negotiation.
 */
export function withCache<Ctx = unknown>(
  handler: (request: Request, ctx?: Ctx) => Response | Promise<Response>,
  options?: WithCacheOptions
): (request: Request, ctx?: Ctx) => Promise<Response>;

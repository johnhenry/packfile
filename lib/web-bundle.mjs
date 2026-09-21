/**
 * The Web Bundle engine underlying this package's archive format.
 * `lib/to-archive.mjs`/`lib/from-archive.mjs` (the main, stable
 * `toArchive()`/`fromArchive()` at the `.` entrypoint) are thin wrappers
 * around `toWebBundle()`/`fromWebBundle()` below, with a fixed internal
 * `baseURL` and the existing gzip layer -- packfile moved from a bespoke
 * flat-object CBOR format to `application/webbundle` (`.wbn`, the format
 * Chrome's Isolated Web Apps are built on) wholesale, via the real,
 * Google-maintained `wbn` package (build/parse) and, for signing,
 * `wbn-sign` -- not a reimplementation of the format here.
 *
 * This module itself is also reachable directly via the
 * `@johnhenry/packfile/web-bundle` subpath, for callers who want lower-level
 * control `toArchive()`/`fromArchive()` deliberately hide: a real `baseURL`
 * (for producing a bundle with real, resolvable exchange URLs -- IWA's
 * `isolated-app://` origin, or a real `https://` one), custom per-file
 * `headers()`, and `createWebBundleRouter()` for serving a bundle's own
 * baked-in headers verbatim instead of `createRouter()`'s synthesized ones.
 *
 * The two shapes involved: `FilesMap` (`Map<path, {data,size,hash}>`, this
 * package's own, as produced by `fromDirectory()`) has no HTTP semantics at
 * all; a Web Bundle is a set of full HTTP *exchanges* -- absolute URL +
 * status + headers + body per entry. `toWebBundle()` synthesizes the
 * exchange (absolute URL by resolving each relative path against `baseURL`;
 * status always 200; `Content-Type` inferred the same way `createRouter()`'s
 * own responses already are, via `getContentType()`) since `FileEntry`
 * itself carries none of that. `fromWebBundle()` does the reverse and also
 * drops back to `FileEntry`'s own `hash` field by recomputing it from the
 * response body with `hashBuffer()` -- Web Bundles don't carry a content
 * hash of their own, so there's nothing to read instead.
 */
import * as wbn from "wbn";
import { getContentType } from "./mime.mjs";
import { hashBuffer } from "./hash.mjs";

// Deliberately the same coarse, pure-string check `browser.mjs` already used
// on its own (previously divergent) archive-reading path -- not Node's
// `path.normalize()`/`isAbsolute()` (what the old CBOR-based from-archive.mjs
// used), so this same logic works identically for a browser build with no
// `node:path` available. Any ".." substring is rejected outright rather than
// only a normalized leading "..", which is stricter than strictly necessary
// (rejects a harmless "a..b" filename too) but avoids re-implementing real
// path normalization twice for two platforms.
const isSafePath = (p) => {
  if (p.startsWith("/") || p.startsWith("\\")) return false;
  if (p.includes("..")) return false;
  if (p.includes("\0")) return false;
  if (p === "" || p === ".") return false;
  return true;
};

/**
 * @param {Map<string, import("../types.js").FileEntry>} map
 * @param {{ baseURL: string, primaryURL?: string, formatVersion?: "b1"|"b2", mimeTypes?: Record<string,string>, headers?: (path: string) => Record<string,string> }} options
 * @returns {Uint8Array}
 */
export const toWebBundle = (map, options = {}) => {
  const { baseURL, primaryURL, formatVersion = "b2", mimeTypes, headers } = options;
  if (!baseURL) {
    throw new Error('toWebBundle() requires a `baseURL` (e.g. "https://example.com/") to resolve each relative path into an absolute exchange URL');
  }

  const builder = new wbn.BundleBuilder(formatVersion);
  for (const [path, entry] of map) {
    const url = new URL(path, baseURL).toString();
    const responseHeaders = {
      "Content-Type": getContentType(path, mimeTypes),
      ...(headers ? headers(path) : {}),
    };
    builder.addExchange(url, 200, responseHeaders, entry.data);
  }
  builder.setPrimaryURL(primaryURL ?? baseURL);
  return builder.createBundle();
};

/**
 * @param {Uint8Array} buffer
 * @param {{ baseURL?: string }} options -- if `baseURL` is passed, each
 *   exchange's absolute URL is stripped back down to a `baseURL`-relative
 *   path (the inverse of `toWebBundle()`'s own resolution) so the result is
 *   directly usable as a `FilesMap` key, e.g. handed straight to
 *   `toArchive()`. Without it, the map is keyed by the exchange's full URL
 *   instead -- still a real `FilesMap`, just not path-shaped. Whenever
 *   `baseURL` is given, a resulting relative key that would escape it (a
 *   leading slash, `..`, a NUL byte, or the empty/"." path itself) is
 *   silently skipped rather than included -- the same defense-in-depth the
 *   old CBOR-based `fromArchive()` applied before handing entries to
 *   `decompileDirectory()`'s `writeFile()` calls.
 * @returns {Map<string, import("../types.js").FileEntry>}
 */
export const fromWebBundle = (buffer, options = {}) => {
  const { baseURL } = options;
  const bundle = new wbn.Bundle(buffer);
  const files = new Map();
  for (const url of bundle.urls) {
    const relativeKey = baseURL ? stripBaseURL(url, baseURL) : url;
    if (baseURL && !isSafePath(relativeKey)) continue;
    const response = bundle.getResponse(url);
    files.set(relativeKey, {
      data: response.body,
      size: response.body.byteLength,
      hash: hashBuffer(response.body),
    });
  }
  return files;
};

const stripBaseURL = (url, baseURL) => {
  const base = baseURL.endsWith("/") ? baseURL : `${baseURL}/`;
  return url.startsWith(base) ? url.slice(base.length) : url;
};

/**
 * Serves a parsed `wbn.Bundle` directly -- same `(input, ctx?) =>
 * Promise<Response>` (+ `.fetch`) contract as `createRouter()`, but returns
 * each exchange's OWN baked-in status/headers verbatim instead of
 * resynthesizing them the way `createRouter()` does for a `FileEntry`
 * (Content-Type/Cache-Control/ETag there are packfile's own invention;
 * here, whatever `toWebBundle()`'s `headers()` callback -- or an external
 * bundle -- actually set into the response is what gets served). Prefer
 * this over `createRouter(fromWebBundle(...))` whenever the bundle's own
 * headers matter; use the `fromWebBundle()` + `createRouter()` path when a
 * plain `FilesMap` (e.g. to feed into `toArchive()`) is what's actually
 * wanted.
 *
 * `new wbn.Bundle(buffer)` decodes the ENTIRE bundle up front (verified by
 * reading `wbn`'s own decoder: the constructor eagerly walks every response
 * in the `responses` section) -- unlike `fromDirectoryLazy()`'s
 * `LazyFileMap`, there is no on-demand/streaming read path in `wbn` itself,
 * so "serving" a large bundle still means holding the whole parsed thing in
 * memory. Parse once (e.g. at process startup) and reuse the same `Bundle`
 * instance across requests; re-parsing per request would repeat that full
 * decode for no reason.
 *
 * @param {InstanceType<typeof wbn.Bundle>} bundle
 * @param {{ baseURL: string, alias?: Record<string,string>, tryExtensions?: string[], fallback?: (input: string|Request, ctx?: unknown) => Response|Promise<Response> }} options
 */
export const createWebBundleRouter = (bundle, options = {}) => {
  const { baseURL, alias = {}, tryExtensions = [], fallback } = options;
  if (!baseURL) {
    throw new Error("createWebBundleRouter() requires the same `baseURL` used to build the bundle, to resolve an incoming request path back to its absolute exchange URL");
  }
  const knownURLs = new Set(bundle.urls);

  const notFound = (input, ctx) => {
    if (fallback) return fallback(input, ctx);
    return new Response("Not Found", { status: 404 });
  };

  const resolve = (path) => {
    const direct = new URL(path, baseURL).toString();
    if (knownURLs.has(direct)) return direct;
    for (const ext of tryExtensions) {
      const candidate = new URL(path + ext, baseURL).toString();
      if (knownURLs.has(candidate)) return candidate;
    }
    return null;
  };

  const handler = async (input, ctx) => {
    let method, filePath, request;
    if (typeof input === "string") {
      method = "GET";
      filePath = input;
      request = null;
    } else {
      request = input;
      method = request.method;
      filePath = new URL(request.url).pathname;
    }

    if (method !== "GET" && method !== "HEAD") {
      if (fallback) return fallback(input, ctx);
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    for (const [aliasPath, targetPath] of Object.entries(alias)) {
      if (filePath === aliasPath) {
        filePath = targetPath;
        break;
      }
    }

    const resolved = resolve(filePath.replace(/^\//, ""));
    if (!resolved) return notFound(input, ctx);

    const response = bundle.getResponse(resolved);
    const headers = new Headers(response.headers);
    if (method === "HEAD") return new Response(null, { status: response.status, headers });
    return new Response(response.body, { status: response.status, headers });
  };

  handler.fetch = handler;
  return handler;
};

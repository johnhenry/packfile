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
import { encodePath, decodeRequestPath } from "./path-safety.mjs";
import { bundleToFiles } from "./bundle-to-files.mjs";
import { sortedEntries } from "./reproducible.mjs";

// Path safety lives in one place, shared with the browser reader.
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
  // Sorted by path so the bytes don't depend on the Map's insertion order.
  for (const [path, entry] of sortedEntries(map)) {
    const url = new URL(encodePath(path), baseURL).toString();
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
 * @param {{ baseURL?: string, onSkip?: (skipped: { url: string, reason: string }) => void }} options -- if `baseURL` is passed, each
 *   exchange's absolute URL is stripped back down to a `baseURL`-relative
 *   path (the inverse of `toWebBundle()`'s own resolution) so the result is
 *   directly usable as a `FilesMap` key, e.g. handed straight to
 *   `toArchive()`. Without it, the map is keyed by the exchange's full URL
 *   instead -- still a real `FilesMap`, just not path-shaped. Whenever
 *   `baseURL` is given, a resulting relative key that would escape it (a
 *   leading slash, `..`, a NUL byte, or the empty/"." path itself) is
 *   silently skipped rather than included -- the same defense-in-depth the
 *   old CBOR-based `fromArchive()` applied before handing entries to
 *   `decompileDirectory()`'s `writeFile()` calls. `onSkip({ url, reason })`
 *   is called once per skipped entry (`reason` is a `urlToPath()` reason
 *   such as `"outside-base"`, or `"duplicate"`); throw from it to abort.
 * @returns {Map<string, import("../types.js").FileEntry>}
 */
export const fromWebBundle = (buffer, options = {}) =>
  bundleToFiles(new wbn.Bundle(buffer), options);

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

  // #35: index every exchange under `baseURL` by its DECODED relative path,
  // so a request matches however either side happens to percent-encode it
  // (`toWebBundle()` writes `a%40b.txt`, a Request pathname keeps `a@b.txt`;
  // `%c3%bc` vs `%C3%BC`). The same rules as the request side
  // (`decodeRequestPath()`) apply, so an exchange whose URL decodes to
  // something unsafe (encoded "/", "..", NUL, ...) is not reachable by path.
  // The directory relative paths resolve against (`new URL(path, baseURL)`).
  const base = new URL("./", baseURL).href;
  const byPath = new Map();
  for (const url of bundle.urls) {
    if (!url.startsWith(base)) continue;
    const raw = url.slice(base.length);
    if (/[?#]/.test(raw)) continue;
    const decoded = decodeRequestPath(raw);
    if (decoded.reason || byPath.has(decoded.path)) continue;
    byPath.set(decoded.path, url);
  }

  const notFound = (input, ctx) => {
    if (fallback) return fallback(input, ctx);
    return new Response("Not Found", { status: 404 });
  };

  const resolve = (path) => {
    for (const ext of ["", ...tryExtensions]) {
      const url = byPath.get(path + ext);
      if (url) return url;
    }
    return null;
  };

  // Strings only: before #35 a string was resolved as an already-encoded URL
  // path; keep that as a fallback so existing callers don't break.
  const resolveEncoded = (path) => {
    for (const ext of ["", ...tryExtensions]) {
      const url = new URL(path + ext, base).href;
      if (url.startsWith(base) && knownURLs.has(url)) return url;
    }
    return null;
  };

  const handler = async (input, ctx) => {
    let method, filePath;
    if (typeof input === "string") {
      method = "GET";
      filePath = input;
    } else {
      method = input.method;
      filePath = new URL(input.url).pathname;
    }

    if (method !== "GET" && method !== "HEAD") {
      if (fallback) return fallback(input, ctx);
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    // A Request's pathname is percent-encoded: decode it the way
    // `createRouter()` does (#20), answering unsafe encodings as not found.
    // A string input is already a decoded path and is used as given.
    if (typeof input !== "string") {
      const decoded = decodeRequestPath(filePath);
      if (decoded.reason) return notFound(input, ctx);
      filePath = decoded.path;
    }

    for (const [aliasPath, targetPath] of Object.entries(alias)) {
      if (filePath === aliasPath) {
        filePath = targetPath;
        break;
      }
    }

    const relative = filePath.replace(/^\//, "");
    const resolved =
      resolve(relative) ?? (typeof input === "string" ? resolveEncoded(relative) : null);
    if (!resolved) return notFound(input, ctx);

    const response = bundle.getResponse(resolved);
    const headers = new Headers(response.headers);
    if (method === "HEAD") return new Response(null, { status: response.status, headers });
    return new Response(response.body, { status: response.status, headers });
  };

  handler.fetch = handler;
  return handler;
};

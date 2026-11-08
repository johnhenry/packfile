/**
 * The single source of truth for archive path safety, shared by the Node
 * (`lib/web-bundle.mjs`) and browser (`browser.mjs`) readers. Pure string
 * logic -- no Node APIs -- so it is browser-safe.
 *
 * A "path" here is a *decoded* relative POSIX key as used in a `FilesMap`.
 * Exchange URLs inside a bundle are percent-encoded; `urlToPath()` decodes
 * before validating so `%2e%2e` or `%5c` cannot smuggle past the checks.
 */

/** Returns `null` if `p` is a safe relative POSIX path, else a reason string. */
export const checkPath = (p) => {
  if (typeof p !== "string") return "not-a-string";
  if (p === "") return "empty";
  if (p.includes("\\")) return "backslash";
  if (/[\u0000-\u001f\u007f]/.test(p)) return "control-character";
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return "absolute";
  for (const segment of p.split("/")) {
    if (segment === "") return "empty-segment";
    if (segment === ".") return "dot-segment";
    if (segment === "..") return "traversal";
  }
  return null;
};

export const isSafePath = (p) => checkPath(p) === null;

/** Percent-encode each segment so any key survives a trip through a URL. */
export const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

/**
 * Map an exchange URL back to a validated, decoded relative path.
 * Returns `{ path }` or `{ reason, raw }`.
 */
export const urlToPath = (url, baseURL) => {
  const base = baseURL.endsWith("/") ? baseURL : `${baseURL}/`;
  if (!url.startsWith(base)) return { reason: "outside-base", raw: url };
  const raw = url.slice(base.length);
  if (/[?#]/.test(raw)) return { reason: "query-or-fragment", raw };
  let path;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return { reason: "malformed-encoding", raw };
  }
  const reason = checkPath(path);
  return reason ? { reason, raw } : { path };
};

/**
 * The fixed base `toArchive()` (Node and browser) resolves every path
 * against, and the primary URL it writes. RFC 2606 `.invalid`: never a real
 * origin, only ever built and stripped back off.
 */
export const ARCHIVE_BASE_URL = "https://packfile.invalid/";

/**
 * The base an archive reader strips exchange URLs against.
 * - An explicit `baseURL` wins (validated as an absolute URL).
 * - Otherwise the bundle's primary URL's root (`new URL("/", primaryURL)`,
 *   i.e. origin + "/"), so a bundle written for a real site reads back.
 *   packfile's own archives use `ARCHIVE_BASE_URL` as the primary URL, so
 *   this yields the same base for them.
 * - Otherwise (no primary URL, or one with no hierarchical root such as
 *   `urn:`), `ARCHIVE_BASE_URL`.
 */
export const resolveArchiveBase = (baseURL, primaryURL) => {
  if (baseURL !== undefined) {
    if (typeof baseURL !== "string" || !URL.canParse(baseURL)) {
      throw new TypeError(`packfile: baseURL must be an absolute URL string, got ${JSON.stringify(baseURL)}`);
    }
    return baseURL;
  }
  if (typeof primaryURL === "string") {
    try {
      return new URL("/", primaryURL).href;
    } catch {
      // Opaque or unparseable primary URL: fall through to the default.
    }
  }
  return ARCHIVE_BASE_URL;
};

/**
 * Percent-decode a request URL's pathname (`new URL(request.url).pathname`,
 * always percent-encoded) into the decoded form `FilesMap` keys use, for
 * `createRouter()` (#20). Keeps the leading "/" and any empty segments
 * (`/docs/` stays `/docs/`, so `tryExtensions` like `index.html` still
 * apply). Returns `{ path }` or `{ reason }` for anything decoding would make
 * unsafe or ambiguous: malformed `%` escapes, an encoded "/" (`%2F` would
 * change the segment structure), a backslash, NUL/control characters, or a
 * "."/".." segment. The URL parser already removes literal and `%2e%2e`
 * dot segments, so the last check is defense in depth.
 */
export const decodeRequestPath = (pathname) => {
  const decoded = [];
  for (const segment of pathname.split("/")) {
    let part;
    try {
      part = decodeURIComponent(segment);
    } catch {
      return { reason: "malformed-encoding" };
    }
    if (part.includes("/")) return { reason: "encoded-slash" };
    if (part.includes("\\")) return { reason: "backslash" };
    if (/[\u0000-\u001f\u007f]/.test(part)) return { reason: "control-character" };
    if (part === ".") return { reason: "dot-segment" };
    if (part === "..") return { reason: "traversal" };
    decoded.push(part);
  }
  return { path: decoded.join("/") };
};

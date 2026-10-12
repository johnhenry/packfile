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

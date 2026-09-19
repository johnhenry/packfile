/**
 * blob-preview.mjs -- host a lemem `FilesMap` inside a browser tab/iframe
 * with no server at all, by minting one `blob:` URL per file and rewriting
 * HTML/CSS references so they resolve to the right blob URL instead of
 * 404ing.
 *
 * This is "Approach B" from a prior design comparison (the heavier,
 * real-isolation "Approach A" is a Service-Worker-based hosting mode,
 * deferred and tracked as andbox#14 -- not implemented here). Approach B
 * is explicitly the lighter-weight, "good enough for trusted/your-own
 * content" path, not a general solution for arbitrary/untrusted content.
 * See the README section this module is documented under for the full
 * "what this does and does not solve" list.
 *
 * ---------------------------------------------------------------------
 * Why blob: URLs can't just be handed to a real HTML parser and forgotten
 * ---------------------------------------------------------------------
 * `blob:` URLs are opaque, content-immutable handles minted by the
 * platform at `URL.createObjectURL()` time -- their string value has no
 * relationship to the path or content they represent, and once minted,
 * a blob's bytes can never be changed (only revoked). That has one
 * consequence this module has to design around directly: when two
 * packaged files reference *each other* (the ordinary case of a
 * multi-page site where every page links back to "home", or a page that
 * links to itself), there is no way to mint blob A with a link to blob B
 * baked into its bytes, and blob B with a link to blob A baked into
 * *its* bytes, using only single-content, single-mint blobs -- one of
 * the two references has to be decided first, and by the time the
 * second one is minted, the first is already frozen.
 *
 * This module resolves that with a depth-first, mint-on-demand walk
 * (`finalizeRewritable()` below): a file is rewritten and minted only
 * once, only after every *acyclic* file it references has already been
 * finalized, so genuine reference chains (A -> B -> C) resolve to real,
 * live blob URLs end to end. The one edge that *closes* a cycle (A -> B
 * where B (directly or transitively) already references back to A while
 * A is still being processed, including the trivial case of a page
 * linking to itself) is left as the original, unrewritten relative-path
 * text for that one occurrence, and reported via `onUnresolvedReference`
 * (default: `console.warn`) -- rewriting it to *some* blob URL would
 * necessarily point at a stale, already-superseded version of the file,
 * which is worse than an honestly-unrewritten link. A real, unrewritten
 * relative link will not navigate correctly once loaded from a `blob:`
 * URL either (confirmed directly: `new URL("./x", blobUrl)` throws
 * `Invalid URL` -- blob URLs cannot serve as a relative-resolution base
 * at all), so this is a real, disclosed limitation of blob-hosting a
 * *reference cycle*, not a bug this module is hiding.
 *
 * ---------------------------------------------------------------------
 * What this module does NOT rewrite
 * ---------------------------------------------------------------------
 * - Inline `<script>`/`<style>` block *contents* are left completely
 *   untouched (only the HTML attributes this module targets, and
 *   standalone .css files, are rewritten). An inline `<style>` block
 *   containing `url(...)` references to packaged files will not resolve.
 * - JavaScript `import`/`import()` specifiers *inside* .js/.mjs/.cjs
 *   source text are never rewritten. Actual specifier resolution is
 *   delegated entirely to `@johnhenry/andbox`'s
 *   `createVirtualModuleRegistry()` (its `resolveSpecifier()` is exposed
 *   on the returned `registry` for advanced/manual use), per this
 *   module's brief not to reimplement that logic -- but note that even
 *   with `resolveSpecifier()` available, a plain
 *   `<script type="module" src="blob:...">` whose source contains a
 *   literal `import "./util.js"` will *not* resolve that import in a
 *   real browser: relative specifier resolution against a `blob:` base
 *   fails the same way plain HTML links would (see above), and nothing
 *   here rewrites JS source text to bake in literal blob URLs instead.
 *   Multi-file ESM graphs should be pre-bundled into a single file
 *   before packaging with lemem if they need to actually run.
 */

import { createVirtualModuleRegistry } from "@johnhenry/andbox";
import { getContentType } from "./mime.mjs";

const HTML_EXTENSIONS = new Set(["html", "htm"]);
const CSS_EXTENSIONS = new Set(["css"]);
const JS_EXTENSIONS = new Set(["js", "mjs", "cjs"]);

const TARGET_HTML_ATTRS = new Set(["href", "src", "srcset", "poster", "formaction"]);

const decoder = new TextDecoder("utf-8");
const encoder = new TextEncoder();

/**
 * Turn a lemem `FilesMap` into a set of `blob:` URLs suitable for hosting
 * inside a browser tab/iframe with no server.
 *
 * @param {Map<string, {data: Uint8Array, size: number, hash: string}>} files
 *   Same shape `createRouter()` takes: an eager `Map`, or any object with
 *   `has()`/`get()`/`keys()` where `get()` may return a `Promise` (a
 *   `LazyFileMap`).
 * @param {object} [options]
 * @param {string} [options.rootPath="index.html"] - the entry-point path,
 *   must exist in `files`.
 * @param {boolean} [options.strict=false] - throw instead of warning when
 *   a relative reference can't be resolved (missing file, or a reference
 *   cycle closing edge).
 * @param {(info: {reason: "missing" | "cycle", targetPath: string, fromPath: string}) => void} [options.onUnresolvedReference]
 *   Called instead of the default `console.warn` for every reference this
 *   module leaves unrewritten because it couldn't (or, for cycles,
 *   shouldn't) be resolved. Ignored when `strict` is set (which throws
 *   instead).
 * @returns {Promise<{entryUrl: string, resolve: (path: string) => string | null, dispose: () => void, registry: import("@johnhenry/andbox").VirtualModuleRegistry}>}
 */
export async function createBlobPreview(files, options = {}) {
  const { rootPath = "index.html", strict = false, onUnresolvedReference } = options;

  // Materialize every entry up front. `FilesMap.get()` may be synchronous
  // (eager Map) or return a Promise (LazyFileMap) -- same duck-typed
  // await lib/create-router.mjs already uses for the same reason: we need
  // real bytes for every path before any rewriting can happen, since a
  // relative reference from file A to file B may need B's content type
  // (and, for HTML/CSS, B's own rewritten bytes) before A can be finalized.
  const entries = new Map();
  for (const path of files.keys()) {
    let entry = files.get(path);
    if (entry && typeof entry.then === "function") entry = await entry;
    if (entry) entries.set(path, entry);
  }

  if (!entries.has(rootPath)) {
    throw new Error(
      `createBlobPreview: rootPath "${rootPath}" was not found in the given files map`
    );
  }

  function report(reason, targetPath, fromPath) {
    if (strict) {
      throw new Error(
        `createBlobPreview: cannot resolve reference from "${fromPath}" to "${targetPath}" (${reason})`
      );
    }
    if (onUnresolvedReference) {
      onUnresolvedReference({ reason, targetPath, fromPath });
      return;
    }
    const explanation =
      reason === "missing"
        ? "no such file in the packaged files (may be intentional, e.g. a path meant to load from a real network origin) -- left as-is"
        : "resolving it would require a file that is still being finalized (a reference cycle, e.g. a page linking to itself or to a page that links back to it) -- left as the original, unrewritten path, since blob: URLs cannot express \"finalize B, using A, before A itself is finalized\" for a genuine cycle";
    console.warn(`[lemem/blob-preview] "${fromPath}" -> "${targetPath}": ${explanation}`);
  }

  // --- 1. Classify every path -----------------------------------------
  const jsSources = {};
  const rewritablePaths = []; // html + css, processed via the DFS below
  for (const [path, entry] of entries) {
    const ext = extensionOf(path);
    if (JS_EXTENSIONS.has(ext)) {
      jsSources[path] = decoder.decode(entry.data);
    } else if (HTML_EXTENSIONS.has(ext) || CSS_EXTENSIONS.has(ext)) {
      rewritablePaths.push(path);
    }
  }

  // --- 2. Mint JS blobs via andbox's registry (not reimplemented here) -
  const registry = createVirtualModuleRegistry(jsSources);

  // `finalized` is the single path -> blob URL table used everywhere
  // (requirement: exactly one blob URL per path across the whole system).
  const finalized = new Map();
  for (const path of registry.paths()) finalized.set(path, registry.resolve(path));

  // Blob URLs this module mints directly (everything except the JS ones,
  // which are owned/revoked by `registry`), tracked so dispose() can
  // revoke exactly what it minted.
  const ownedBlobUrls = [];

  function mintBlob(path, bytes, contentType) {
    const blob = new Blob([bytes], { type: contentType });
    const url = URL.createObjectURL(blob);
    ownedBlobUrls.push(url);
    finalized.set(path, url);
    return url;
  }

  // --- 3. Mint everything that isn't HTML/CSS/JS as a direct passthrough
  // blob (images, fonts, JSON, etc.) -- these never need rewriting, so
  // they can be finalized immediately, before the HTML/CSS walk below
  // needs to look any of them up.
  for (const [path, entry] of entries) {
    if (finalized.has(path)) continue; // already minted via the JS registry
    const ext = extensionOf(path);
    if (HTML_EXTENSIONS.has(ext) || CSS_EXTENSIONS.has(ext)) continue; // handled next
    mintBlob(path, entry.data, getContentType(path));
  }

  // --- 4. HTML/CSS: depth-first, mint-on-demand walk --------------------
  // A path in `inProgress` is an ancestor in the current DFS stack (i.e.
  // "currently being rewritten, not yet minted"). See the module-level
  // comment above for why a reference back into `inProgress` (or to the
  // file currently being processed itself) has to degrade to
  // "leave unrewritten" rather than pointing at a stale blob.
  const inProgress = new Set();

  function resolveReference(rawValue, fromPath) {
    const parsed = parseReference(rawValue, fromPath);
    if (parsed === null) return rawValue; // absolute/fragment/data/mailto/blob/etc: untouched
    const { targetPath, suffix } = parsed;

    if (!entries.has(targetPath)) {
      report("missing", targetPath, fromPath);
      return rawValue;
    }
    if (finalized.has(targetPath)) {
      return finalized.get(targetPath) + suffix;
    }
    if (targetPath === fromPath || inProgress.has(targetPath)) {
      report("cycle", targetPath, fromPath);
      return rawValue;
    }
    // Not yet visited and not on the current path: finalize it now, then
    // use its (now-real, now-permanent) blob URL.
    finalizeRewritable(targetPath);
    return finalized.get(targetPath) + suffix;
  }

  function finalizeRewritable(path) {
    if (finalized.has(path)) return; // reached via another edge already
    inProgress.add(path);
    const entry = entries.get(path);
    const text = decoder.decode(entry.data);
    const ext = extensionOf(path);
    const rewritten = HTML_EXTENSIONS.has(ext)
      ? rewriteHtml(text, path, resolveReference)
      : rewriteCss(text, path, resolveReference);
    inProgress.delete(path);
    mintBlob(path, encoder.encode(rewritten), getContentType(path));
  }

  for (const path of rewritablePaths) finalizeRewritable(path);

  // --- 5. Assemble the result -------------------------------------------
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    registry.dispose();
    for (const url of ownedBlobUrls) URL.revokeObjectURL(url);
    finalized.clear();
  }

  return {
    entryUrl: finalized.get(rootPath),
    resolve: (path) => finalized.get(path) ?? null,
    dispose,
    registry,
  };
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function extensionOf(path) {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  if (dot === -1 || dot < slash) return "";
  return path.slice(dot + 1).toLowerCase();
}

function directoryOf(path) {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash + 1);
}

/**
 * Resolve a root-relative path (no leading "/", already stripped by the
 * caller) against the FilesMap's own root, the same way andbox's
 * `virtual-module-registry.mjs` resolves specifiers against its own
 * synthetic `vfs:///` base: percent-encode each segment (a path may
 * legitimately contain literal "#"/"?" characters, which must not be
 * parsed as a URL fragment/query delimiter and silently truncate
 * everything after them), let the platform's own relative-URL algorithm
 * do the "."/".." resolution, then decode back to a plain path.
 *
 * Excess ".." segments (more than there are directories to climb) clamp
 * at the root rather than erroring, matching standard URL behavior --
 * this is safe here (unlike lemem's on-disk path-safety checks elsewhere
 * in this codebase) because nothing in this module ever touches the
 * filesystem; the worst case is a clamped path that simply isn't in
 * `files`, handled like any other missing reference.
 */
function resolveAgainstRoot(pathPart) {
  const encoded = pathPart
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const resolved = new URL(`/${encoded}`, "vfs://blob-preview/");
  return decodeURIComponent(resolved.pathname.slice(1));
}

/**
 * Classify a raw HTML attribute / CSS url() value and, if it's a genuine
 * local reference, resolve it to a `files` map key.
 *
 * Returns `null` for anything this module leaves untouched: absolute
 * `http(s)://`/other-scheme URLs (`mailto:`, `data:`, `blob:`, `tel:`,
 * `javascript:`, ...), protocol-relative `//host/...`, fragment-only
 * `#...`, and query-only `?...` references.
 *
 * A leading-`/` path (root-relative) *is* resolved -- against the
 * `files` map's own root, not left untouched. Unlike a real absolute
 * path resolving against a live page origin (the kind of runtime
 * resolution Approach A's Service-Worker mode exists for), a root-
 * relative reference in *static* markup has a knowable target the
 * moment this module runs (the FilesMap root), so rewriting it here is
 * both possible and correct -- the "absolute paths need a real origin"
 * limitation this module does NOT attempt to solve is specifically about
 * paths a script *constructs or requests at runtime* (e.g. `fetch("/api")`
 * inside JS, which this module never rewrites at all).
 */
function parseReference(rawValue, fromPath) {
  if (!rawValue) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawValue)) return null; // has a scheme
  if (rawValue.startsWith("//")) return null; // protocol-relative
  if (rawValue.startsWith("#")) return null; // fragment-only

  const match = /^([^?#]*)([?#].*)?$/.exec(rawValue);
  const pathPart = match[1];
  const suffix = match[2] || "";
  if (!pathPart) return null; // query-only, e.g. "?tab=2"

  const targetPath = pathPart.startsWith("/")
    ? resolveAgainstRoot(pathPart.slice(1))
    : resolveAgainstRoot(directoryOf(fromPath) + pathPart);

  return { targetPath, suffix };
}

// ---------------------------------------------------------------------------
// HTML rewriting
//
// Deliberately not a full HTML parser (none is a dependency of this
// package, and the family convention here is to avoid adding one without
// strong justification -- see the module header). This is a two-level
// regex scan: first split the document into HTML comments (left
// untouched) and tags (attributes scanned), then scan each tag's text for
// `name=value` pairs and rewrite the handful of attributes that carry
// path references.
//
// Known, accepted gaps (not fixed by this module):
// - A literal ">" inside a quoted attribute value (e.g.
//   `<a href="a>b">`) will end the tag match early, since tag boundaries
//   are found with a plain `[^>]*` scan rather than a real tokenizer.
// - Comment detection is a non-greedy scan to the first "-->" -- correct
//   for ordinary comments, not a guarantee against every pathological or
//   malformed input.
// - Inline `<script>`/`<style>` block *contents* are never scanned (see
//   the module header).
// ---------------------------------------------------------------------------

const TAG_OR_COMMENT_RE = /<!--[\s\S]*?-->|<[a-zA-Z!/][^>]*>/g;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(\s*=\s*)("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

function rewriteHtml(text, fromPath, resolveReference) {
  return text.replace(TAG_OR_COMMENT_RE, (tagOrComment) => {
    if (tagOrComment.startsWith("<!--")) return tagOrComment; // comments untouched
    return tagOrComment.replace(
      ATTR_RE,
      (full, name, equals, _quoted, doubleQuoted, singleQuoted, bare) => {
        const lower = name.toLowerCase();
        if (!TARGET_HTML_ATTRS.has(lower)) return full;

        let value;
        let quoteChar = null;
        if (doubleQuoted !== undefined) {
          value = doubleQuoted;
          quoteChar = '"';
        } else if (singleQuoted !== undefined) {
          value = singleQuoted;
          quoteChar = "'";
        } else {
          value = bare;
        }

        const newValue =
          lower === "srcset"
            ? rewriteSrcset(value, fromPath, resolveReference)
            : resolveReference(value, fromPath);

        if (newValue === value) return full;
        return quoteChar
          ? `${name}${equals}${quoteChar}${newValue}${quoteChar}`
          : `${name}${equals}${newValue}`;
      }
    );
  });
}

/**
 * `srcset` is a comma-separated list of "url descriptor?" candidates
 * (e.g. `"a.png 1x, b.png 2x"` or `"a.png 480w"`). Only the URL portion
 * of each candidate is rewritten. This is a practical simplification, not
 * the full srcset grammar (real URLs containing a literal comma would
 * split incorrectly here) -- acceptable for the same "lightweight,
 * honestly-documented" reason the rest of this module isn't a full
 * parser.
 */
function rewriteSrcset(value, fromPath, resolveReference) {
  return value
    .split(",")
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) return trimmed;
      const spaceIndex = trimmed.search(/\s/);
      if (spaceIndex === -1) return resolveReference(trimmed, fromPath);
      const url = trimmed.slice(0, spaceIndex);
      const descriptor = trimmed.slice(spaceIndex).trim();
      return `${resolveReference(url, fromPath)} ${descriptor}`;
    })
    .join(", ");
}

// ---------------------------------------------------------------------------
// CSS rewriting
//
// Two independent regex passes over the raw text: `url(...)` (covers both
// plain `url()` references and `@import url(...)`), then bare-string
// `@import "..."`/`@import '...'` (the form with no `url()` wrapper).
// Same honest caveat as the HTML side: not comment-aware (a url()/@import
// sitting inside a `/* ... */` comment will still be rewritten, harmlessly
// since it was inert either way, but not specially detected).
// ---------------------------------------------------------------------------

const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]*))\s*\)/g;
const CSS_IMPORT_STRING_RE = /(@import\s+)("([^"]*)"|'([^']*)')/g;

function rewriteCss(text, fromPath, resolveReference) {
  let rewritten = text.replace(CSS_URL_RE, (full, dq, sq, bare) => {
    const value = dq !== undefined ? dq : sq !== undefined ? sq : bare;
    const newValue = resolveReference(value, fromPath);
    if (newValue === value) return full;
    const quoteChar = dq !== undefined ? '"' : sq !== undefined ? "'" : "";
    return `url(${quoteChar}${newValue}${quoteChar})`;
  });

  rewritten = rewritten.replace(CSS_IMPORT_STRING_RE, (full, prefix, _quoted, dq, sq) => {
    const value = dq !== undefined ? dq : sq;
    const newValue = resolveReference(value, fromPath);
    if (newValue === value) return full;
    const quoteChar = dq !== undefined ? '"' : "'";
    return `${prefix}${quoteChar}${newValue}${quoteChar}`;
  });

  return rewritten;
}

# Packfile

[![npm version](https://img.shields.io/npm/v/%40johnhenry%2Fpackfile.svg)](https://www.npmjs.com/package/@johnhenry/packfile)
[![CI](https://github.com/johnhenry/packfile/actions/workflows/ci.yml/badge.svg)](https://github.com/johnhenry/packfile/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/%40johnhenry%2Fpackfile.svg)](LICENSE)

Full documentation: [opensource.johnhenry.me/packfile](https://opensource.johnhenry.me/packfile/)

> Previously developed as `lemem`, never published under that name. Now
> `@johnhenry/packfile`, starting at `0.0.0`.

Static file compiler and server. Compresses directories into archives --
gzip(`application/webbundle`), the format Chrome's Isolated Web Apps are
built on, via the real [`wbn`](https://github.com/WICG/webpackage/tree/main/js/bundle)
package -- and serves them as HTTP responses via the `(Request) => Response`
handler pattern.

## Contents

- [Installation](#installation)
- [Usage](#usage)
  - [Compress a folder](#compress-a-folder)
  - [Decompress a file](#decompress-a-file)
  - [Serve a compiled file](#serve-a-compiled-file)
- [Examples](#examples)
- [Node.js API](#nodejs-api)
  - [`fromDirectory(path, options?)`](#fromdirectorypath-options)
  - [`fromDirectoryLazy(path, options?)`](#fromdirectorylazypath-options)
  - [`toArchive(map, options?)`](#toarchivemap-options)
  - [`fromArchive(buffer, options?)`](#fromarchivebuffer-options)
  - [`createRouter(files, options?)`](#createrouterfiles-options)
  - [`hashBuffer(buffer)` / `hashStream(stream)`](#hashbufferbuffer--hashstreamstream)
  - [`compileDirectory(path, options?)` / `decompileDirectory(data, outputPath)`](#compiledirectorypath-options--decompiledirectorydata-outputpath)
- [HTTP Caching Middleware](#http-caching-middleware)
- [Browser Usage](#browser-usage)
- [Blob Preview (host packaged content in a browser tab/iframe, no server)](#blob-preview-host-packaged-content-in-a-browser-tabiframe-no-server)
  - [What this does and does not solve](#what-this-does-and-does-not-solve)
- [Web Bundle / Isolated Web App primitives (`./web-bundle`)](#web-bundle--isolated-web-app-primitives-web-bundle)
- [Direct Imports](#direct-imports)
- [Exports](#exports)
- [Security model](#security-model)
- [Family](#family)
- [Internal formats](#internal-formats)
- [License](#license)

## Installation

```bash
npm install @johnhenry/packfile
```

## Usage

You can use the `packfile` CLI with the following commands:

### Compress a folder

```bash
npx packfile compress <path-to-folder> <path-to-file>
```

This command compresses the contents of `<path-to-folder>` and saves the compressed data to `<path-to-file>`.

### Decompress a file

```bash
npx packfile decompress <path-to-file> <path-to-folder>
```

This command decompresses the contents of `<path-to-file>` and saves the decompressed files to `<path-to-folder>`.

### Serve a compiled file

```bash
npx packfile serve <path-to-file> [port]
```

This command serves the compiled file at `<path-to-file>` on the specified `[port]` (default is 3000).

## Examples

1. Compress a folder:
   ```bash
   npx packfile compress ./static ./compiled.wbn
   ```

2. Decompress a file:
   ```bash
   npx packfile decompress ./compiled.wbn ./decompressed
   ```

3. Serve a compiled file:
   ```bash
   npx packfile serve ./compiled.wbn 8080
   ```

## Node.js API

```js
import {
  fromDirectory, fromDirectoryLazy, fromArchive, toArchive,
  createRouter, hashBuffer, hashStream,
  compileDirectory, decompileDirectory
} from '@johnhenry/packfile';
```

### `fromDirectory(path, options?)`

Reads all files from a directory into a `Map<string, { data, size, hash }>`.

```js
const files = await fromDirectory('./static');
```

### `fromDirectoryLazy(path, options?)`

Returns a `LazyFileMap` that reads files on demand (useful for development).

```js
const files = await fromDirectoryLazy('./static');
const entry = await files.get('index.html'); // reads from disk
```

### `toArchive(map, options?)`

Serializes a file Map to a compressed archive buffer -- `gzip(application/webbundle)`, via the real `wbn` package.

```js
const buffer = await toArchive(files);
```

### `fromArchive(buffer, options?)`

Deserializes an archive back to a file Map. Validates paths — entries with path traversal (`../`) or absolute paths are rejected.

```js
const files = await fromArchive(buffer);
```

### `createRouter(files, options?)`

Returns a `(Request) => Promise<Response>` handler that serves files. Auto-sets `Content-Type`, `Cache-Control`, and `ETag` headers. Works with both `Map` and `LazyFileMap`.

**Options:**

- `alias` — Object mapping paths (e.g. `{ "/": "index.html" }`)
- `tryExtensions` — Array of extensions to try (e.g. `[".html"]`)
- `fallback` — Fallback handler for unmatched routes

```js
const handler = createRouter(files, {
  alias: { "/": "index.html" },
  tryExtensions: [".html"],
});

const response = await handler(new Request("http://localhost/"));
```

### `hashBuffer(buffer)` / `hashStream(stream)`

SHA-256 hashing utilities. Returns a hex digest string.

```js
const hash = hashBuffer(myBuffer);     // sync
const hash2 = await hashStream(myStream); // async
```

### `compileDirectory(path, options?)` / `decompileDirectory(data, outputPath)`

Convenience wrappers: `fromDirectory → toArchive` and `fromArchive → writeFile`.

```js
const compiled = await compileDirectory('./static');
await decompileDirectory(compiled, './output');
```

## HTTP Caching Middleware

```js
import { withCache } from '@johnhenry/packfile/cache';
```

Wraps any `(Request) => Response` handler with automatic ETag generation and `304 Not Modified` negotiation:

```js
const cachedHandler = withCache(myHandler, {
  cacheControl: 'public, max-age=3600', // default
  weak: false,                           // use strong ETags (default)
});
```

Uses SHA-256 hashing (same as file ETags) for consistent cache keys.

## Browser Usage

```js
import { fromArchive, toArchive, createRouter } from '@johnhenry/packfile/browser';
```

The browser bundle provides `fromArchive`, `toArchive`, and `createRouter`, using the `wbn` package directly (no Node APIs required) and Web Crypto for hashing -- same wire format as the Node entrypoint, so an archive built by one is directly readable by the other.

```js
const archive = await fetch('/app.wbn').then(r => r.arrayBuffer());
const files = await fromArchive(archive);
const router = createRouter(files);
```

## Blob Preview (host packaged content in a browser tab/iframe, no server)

```js
import { createBlobPreview } from '@johnhenry/packfile/blob-preview';
```

`createRouter()` needs something to call it — a real server, a Service
Worker, or (in `@johnhenry/packfile/browser`) at least a `fetch`-shaped handler wired up
to something. `createBlobPreview()` is for the case where you don't want
any of that: you have a `FilesMap` (from `fromDirectory()`/`fromArchive()`,
same input `createRouter()` takes) and you just want to point an
`<iframe>` at it and have it render, entirely client-side.

It mints one `blob:` URL per file and rewrites HTML (`href`, `src`,
`srcset`, `poster`, `formaction`) and CSS (`url(...)`, `@import`)
references so they resolve to the right file's blob URL instead of
404ing. JS module resolution (`import`/`import()` between `.js`/`.mjs`
files) is delegated to the sibling `@johnhenry/andbox` package's
`createVirtualModuleRegistry()` rather than reimplemented here.

```js
import { fromDirectory } from '@johnhenry/packfile';
import { createBlobPreview } from '@johnhenry/packfile/blob-preview';

const files = await fromDirectory('./static');
const preview = await createBlobPreview(files, { rootPath: 'index.html' });

document.querySelector('iframe').src = preview.entryUrl;

// later, once the iframe/tab is gone:
preview.dispose(); // revokes every blob: URL it minted
```

**API:**

```ts
function createBlobPreview(
  files: FilesMap,
  options?: {
    rootPath?: string; // default: "index.html"
    strict?: boolean;  // throw instead of warning on an unresolved reference
    onUnresolvedReference?: (info: {
      reason: "missing" | "cycle";
      targetPath: string;
      fromPath: string;
    }) => void; // called instead of the default console.warn
  }
): Promise<{
  entryUrl: string; // blob: URL for rootPath
  resolve(path: string): string | null;
  dispose(): void; // revokes every blob: URL this call minted
  registry: VirtualModuleRegistry; // the underlying andbox registry, for advanced JS-specifier resolution
}>
```

### What this does and does not solve

This is the lighter-weight of two designs considered for hosting
packfile-packaged content client-side. It is **good enough for trusted, your
own content** — not a general solution for arbitrary/untrusted content,
and it does not attempt to solve everything a real HTTP origin gives you
for free:

- **Solved**: relative HTML/CSS references between packaged files
  (including root-relative `/path` references, resolved against the
  `FilesMap`'s own root — there's no real server, but the root is
  perfectly knowable at rewrite time, so this is handled), one blob URL
  per path shared consistently across HTML/CSS/JS wiring, and graceful
  degradation (left unrewritten + reported via `onUnresolvedReference`,
  never a stale/broken blob) for the one case that's structurally
  unsolvable with immutable blob content: a genuine reference **cycle**
  (two pages linking to each other, or a page linking to itself) — one
  edge in the cycle can't know the other's final blob URL before its own
  content is frozen, so it's left as the original path rather than
  pointing at something wrong.
- **Not solved, and not attempted**: absolute-path references
  *constructed at runtime* (e.g. `fetch('/api/data')` inside a script —
  JS source is never rewritten by this module), `pushState`-based
  client-side routing (there is no real origin for the router to reason
  about), and Service-Worker registration from within the served content
  (a `blob:` document has no meaningful scope to register one against).
  These are fundamental limitations of `blob:` URLs themselves, not
  implementation gaps — a real Service-Worker-based hosting mode
  ("Approach A" in the design this was compared against) is deferred and
  tracked as [`andbox#14`](https://github.com/johnhenry/andbox/issues/14)
  for anyone who needs real isolation or full HTTP-shaped semantics.
- Inline `<script>`/`<style>` block *contents* are left untouched (only
  attribute references and standalone `.css`/`.js` files are rewritten).
- A `<script src="...">` pointing at a `.js` file loads that file's
  **original, unmodified** source — nested relative `import`s inside it
  are not rewritten, because `blob:` URLs can't be used as a relative-
  resolution base at all (confirmed directly: `new URL("./x.js", blobUrl)`
  throws `Invalid URL`), so a raw multi-file ESM graph loaded this way
  won't resolve its own imports in a real browser. `registry.resolveSpecifier()`
  is exposed for callers who want to do their own resolution; otherwise,
  pre-bundle multi-file JS into one file before packaging with packfile.

## Web Bundle / Isolated Web App primitives (`./web-bundle`)

`toArchive()`/`fromArchive()` at the main `.` entrypoint (and `createRouter()`)
already use `application/webbundle` under the hood -- see "Node.js API"
above. This subpath is for callers who want the lower-level control those
two deliberately hide: a real, resolvable `baseURL` (rather than the fixed
internal one `toArchive`/`fromArchive` use), custom per-file `headers()`,
signing via `wbn-sign` for actual Isolated Web App deployment, and a router
that serves a bundle's own real headers verbatim.

```js
import { toWebBundle, fromWebBundle } from '@johnhenry/packfile/web-bundle';
import { fromDirectory } from '@johnhenry/packfile';

const files = await fromDirectory('./static');
const bundle = toWebBundle(files, { baseURL: 'https://example.com/' });
// bundle is a Uint8Array, directly loadable/parseable by `wbn`'s own
// Bundle class, or `<script type=webbundle>` in a supporting browser.

const recovered = fromWebBundle(bundle, { baseURL: 'https://example.com/' });
// back to a FilesMap, e.g. to hand to a different consumer.
```

**Serving a bundle**: `createRouter(fromWebBundle(bundle, { baseURL }))`
already works today, no new code needed -- `fromWebBundle()`'s return value
is a real `FilesMap`. But that path only keeps `data`/`size`/`hash`, so
`createRouter()` resynthesizes Content-Type/Cache-Control/ETag from
scratch rather than serving whatever headers were actually baked into the
bundle. `createWebBundleRouter(bundle, options)` serves a parsed
`wbn.Bundle` directly instead -- same `(input, ctx?) => Promise<Response>`
router contract (`alias`, `tryExtensions`, `fallback`, a real `Request` or a
bare path string, `.fetch`), but every response's actual status/headers are
served verbatim:

```js
import * as wbn from 'wbn';
import { toWebBundle, createWebBundleRouter } from '@johnhenry/packfile/web-bundle';

const bytes = toWebBundle(files, {
  baseURL: 'https://example.com/',
  headers: () => ({ 'Cache-Control': 'max-age=600, immutable' }),
});
const bundle = new wbn.Bundle(bytes); // parse once, reuse across requests --
                                       // wbn decodes the WHOLE bundle eagerly
                                       // in the constructor, there's no lazy/
                                       // streaming read path like
                                       // fromDirectoryLazy()'s LazyFileMap.
const router = createWebBundleRouter(bundle, { baseURL: 'https://example.com/' });
const response = await router('index.html'); // Cache-Control is the real, baked-in header
```

**Why this exists**: packfile was originally built with `wbn` in mind, then
moved to a bespoke gzip+CBOR format when `wbn`/Web Bundles looked
effectively abandoned. IWA gave the format new, active life, and the
archive format was migrated wholesale onto it -- `lib/to-archive.mjs`/
`lib/from-archive.mjs` are now thin wrappers around `toWebBundle()`/
`fromWebBundle()` below, with a fixed internal `baseURL`. See FORMATS.md
§2 for the full migration writeup (what changed, what it fixed as a side
effect, what's still platform-specific between Node and the browser build).

**What this subpath adds beyond `toArchive`/`fromArchive`**: a Web Bundle
models full HTTP *exchanges* (absolute URL + status + headers + body), not
just a flat path -> bytes map -- `FileEntry` carries none of that, so
`toWebBundle()` synthesizes it (`Content-Type` inferred by extension, same
as `createRouter()`'s own responses; status always `200`) unless a real
`baseURL`/`headers()` is supplied, which `toArchive()` doesn't expose at
all. `fromWebBundle()` recomputes `hash` via `hashBuffer()` on the way
back, since Web Bundles don't carry a content hash of their own.

**Verified against real interop, not just internal round-tripping**:
`test.mjs`'s "toWebBundle / fromWebBundle" section cross-checks
`toWebBundle()`'s output against `wbn`'s own `Bundle` parser directly, and
signs a real bundle with `wbn-sign`'s `SignedWebBundle` using a real
generated Ed25519 key pair -- the actual packages Chrome/IWA tooling
itself uses.

**Still open, for actual IWA deployment (not for the archive-format use
this subpath already covers)**: how to choose/compute a `baseURL` when
targeting `isolated-app://<web-bundle-id>/` specifically -- that origin is
derived from the signing key itself via `wbn-sign`'s `WebBundleId`, not
chosen freely, so a real IWA build needs to sign first and set `baseURL`
from the result, a different order than the examples above.

## Direct Imports

```js
import { hashBuffer, hashStream } from '@johnhenry/packfile/hash';
import { compressObject, deCompressObject } from '@johnhenry/packfile/compression';
```

## Exports

| Export | File | Description |
|--------|------|-------------|
| `.` | `index.mjs` | Full API: `fromDirectory`, `fromArchive`, `toArchive`, `createRouter`, `hashBuffer`, etc. |
| `./browser` | `browser.mjs` | Browser-compatible: `fromArchive`, `toArchive`, `createRouter` |
| `./cache` | `cache.mjs` | `withCache` — HTTP caching middleware |
| `./hash` | `lib/hash.mjs` | `hashBuffer`, `hashStream` |
| `./compression` | `lib/compression.mjs` | `compressObject`, `deCompressObject` |
| `./compat` | `compat.mjs` | `compileDirectory`, `decompileDirectory` |
| `./blob-preview` | `lib/blob-preview.mjs` | `createBlobPreview` — host a `FilesMap` client-side via `blob:` URLs, no server |
| `./web-bundle` | `lib/web-bundle.mjs` | Lower-level Web Bundle primitives: `toWebBundle`, `fromWebBundle`, `createWebBundleRouter` — the engine `toArchive`/`fromArchive` are built on, with a real `baseURL`/headers/IWA-signing exposed |

## Security model

**What packfile guarantees:**

- **Decoding an archive never writes outside the archive root.** `fromArchive()`
  (and `fromWebBundle()`, which it's built on) rejects any entry whose path
  would escape the archive's own base -- a leading slash or backslash, a
  `..` segment anywhere in the path, a NUL byte, or an empty/`.` path -- via
  `isSafePath()` in `lib/web-bundle.mjs`. A rejected entry is silently
  skipped rather than written, so an archive built to escape its extraction
  root (a "zip-slip"-shaped attack) cannot use `fromArchive()`/
  `decompileDirectory()` to do it.
- **`createRouter()` never serves outside the file map it was given.** It
  only ever resolves against the in-memory `FilesMap` (or `LazyFileMap`)
  built by `fromDirectory()`/`fromArchive()`/your own code -- there is no
  filesystem access at request time, so a crafted request path cannot read
  anything not already present in that map.

**What is still yours:**

- **`createBlobPreview()` is for trusted, your-own content only** -- not a
  general solution for arbitrary/untrusted content (see "What this does and
  does not solve" above). It rewrites references so packaged content
  renders correctly in an `<iframe>`, but does not sandbox or sanitize that
  content -- treat a `FilesMap` built from an untrusted source the same as
  you would any other untrusted HTML/CSS/JS you're about to render.
- **`createRouter()`'s `alias`/`tryExtensions`/`fallback` are caller-supplied
  and unvalidated.** A `fallback` handler that itself reads from the
  filesystem or the network based on the unmatched path reintroduces
  exactly the kind of path-controlled access this package's own
  `isSafePath()` guards against on decode -- that's the fallback's
  responsibility, not this package's.
- **`toWebBundle()`/`createWebBundleRouter()`'s `baseURL` is not authenticated.**
  Signing a bundle with `wbn-sign` (for real Isolated Web App deployment)
  is a separate step this package exposes but does not perform for you --
  an unsigned bundle carries no origin guarantee at all.

## Family

packfile isn't just a standalone compiler/server -- it's the designed
consumer of one sibling package's archive output, and a drop-in handler for
another's router.

- **[`@johnhenry/fileable`](https://github.com/johnhenry/fileable)** --
  fileable's `<Dir encode="wbn">` renders a subtree to a
  `gzip(application/webbundle)` archive, via the same `wbn` package packfile
  itself depends on directly (a real dependency on `wbn`, **not** on
  `@johnhenry/packfile` -- fileable produces byte-for-byte the same archive
  format without needing this package as an intermediate, and isn't even
  published to npm). The resulting `.wbn` file is directly readable by this
  package's own `fromArchive()` (back into a flat path -> content map) and
  servable via `createRouter()`/`createWebBundleRouter()` -- no unpacking to
  disk needed.
- **[`@johnhenry/servable`](https://github.com/johnhenry/servable)** --
  `createRouter()` already returns a `(Request | path, ctx?) => Response`
  handler (it even aliases itself as `.fetch`), the exact shape servable's
  `Route`'s `handler` prop accepts -- mounting a packfile-served directory
  inside a servable app is just passing a function, no new integration
  surface needed. See `examples/08-mount-packfile` in the servable repo for
  a real, running mount (`Route path="/*"` inside a `Group prefix="/mem"`,
  forwarding the wildcard-captured path straight to the router).

## Internal formats

packfile's data passes through several distinct shapes on its way from a
directory on disk to an HTTP response: the in-memory `FileEntry`/`FilesMap`
table (eager `Map` or lazy `LazyFileMap`), the gzip(Web Bundle) archive byte
format, the SHA-256 hash used for both content identity and ETags, two
separate (Node/browser) gzip implementations, and the `Response` bridge the
router builds from all of the above. [`FORMATS.md`](./FORMATS.md) documents
each one precisely -- exact fields/encoding, which function produces it,
which consumes it, and why it's separate from the others where that's
evident from the code -- along with a few real inconsistencies found while
writing it up (e.g. `browser.mjs`'s archive logic having quietly diverged
from the Node implementation it duplicates).

## License

This project is licensed under the MIT License.

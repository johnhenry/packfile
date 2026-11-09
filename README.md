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
- [Export a build as `.wbn`](#export-a-build-as-wbn)
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
npx @johnhenry/packfile compress <path-to-folder> <path-to-file>
```

This command compresses the contents of `<path-to-folder>` and saves the compressed data to `<path-to-file>`.

### Decompress a file

```bash
npx @johnhenry/packfile decompress <path-to-file> <path-to-folder>
```

This command decompresses the contents of `<path-to-file>` and saves the decompressed files to `<path-to-folder>`.

### Serve a compiled file

```bash
npx @johnhenry/packfile serve <path-to-file> [port]
```

This command serves the compiled file at `<path-to-file>` on the specified `[port]` (default is 3000).

`serve` and `decompress` read either packfile's own gzip-wrapped archive
(what `compress` and `export` write) or a plain Web Bundle, such as
sitefile's `EXPORT … AS wbn` output; the first bytes decide. A plain bundle
is read against its primary URL's origin, so a bundle without a primary URL
(sitefile writes one only when the site has `/index.html`) and with a `BASE`
other than `https://packfile.invalid/` reads back empty.

## Export a build as `.wbn`

Install `@johnhenry/packfile` as a development dependency. These adapters package
**already-built files** using packfile's existing gzip(Web Bundle) format. They
preserve relative filenames and bytes, infer MIME types from extensions (unknown
extensions use `application/octet-stream`), and reject unsafe paths,
case-insensitive filename collisions, and file/directory collisions.

### Vite

```js
// vite.config.mjs
import { defineConfig } from 'vite';
import packfile from '@johnhenry/packfile/vite';

export default defineConfig({
  plugins: [packfile({ fileName: 'app.wbn' })],
});
```

`vite build` also writes `dist/app.wbn`. The plugin archives the completed client
output directory, including HTML, CSS, chunks, source maps, and files copied from
`public/`. Put it last among plugins that modify output. It runs after ordinary
`closeBundle` hooks; later post-ordered hooks must not modify files afterward.
It does nothing during the dev server. SSR and `build.write: false` are rejected.
For in-memory builds use `exportBuild()` instead.

`fileName` defaults to `app.wbn` and must be a relative path ending in `.wbn`.
That destination is **reserved**: do not put a source/public asset there. An older
archive at that exact path is excluded on rebuild and replaced atomically. Other
files already in the output directory are included; keep Vite's default
`emptyOutDir` behavior if you do not want stale files packaged. One plugin instance
is intended for one client build configuration, not a multi-environment framework
build or a server bundle.

### Rollup / Rolldown

```js
import packfile from '@johnhenry/packfile/rollup';

export default {
  input: 'src/main.js',
  plugins: [/* other build plugins, */ packfile()],
  output: { dir: 'dist', format: 'es' },
};
```

This plugin emits `app.wbn` from the chunks and assets available in its
`generateBundle` hook. Put it last. It also works with Rolldown's `generate()`
without writing to disk. Files copied outside the bundler's output (such as a
separate public directory) are not included by this adapter. It refuses to replace
an asset already named `app.wbn`; each output gets its own archive. HTML/CSS handling
must be supplied by your build tool/plugins.

### CLI / Node directory export

```sh
npx @johnhenry/packfile export ./dist ./app.wbn
```

```js
import { exportDirectory } from '@johnhenry/packfile/build-node';
const result = await exportDirectory('./dist', './app.wbn');
console.log(result.sha256);
```

The CLI uses the same validation and excludes its own destination on repeated
exports. It creates missing destination directories and replaces the destination
only after encoding succeeds. Directory traversal follows packfile's existing
symlink policy: external, broken, and cyclic symlinks are skipped.

### In-memory export (Node or browser)

```js
import { exportBuild, exportFiles } from '@johnhenry/packfile/build';

// Rollup/Rolldown's result.output, including @rolldown/browser output:
const { archive, sha256, files } = await exportBuild(result.output);

// Or supply your own already-built assets:
const packaged = await exportFiles({
  'index.html': '<h1>Hello</h1>',
  'assets/data.bin': new Uint8Array([0, 255]),
});
```

`archive` is a `Uint8Array` readable by Node or browser `fromArchive()`.
`sha256` is a hex digest of those archive bytes, **not a p2pws CID**.
`files` lists each path, byte size, content SHA-256, and inferred `contentType`.
Entries are sorted by path before encoding; no timestamp or manifest is injected.
The `./build` and `./rollup` modules use no Node built-ins. Browser use requires
bundling their npm dependencies and the same Web Crypto / CompressionStream APIs
as `@johnhenry/packfile/browser` (Web Crypto requires a secure context).

The entire build and archive are held in memory. Empty builds are rejected.
There is no source compilation, URL rewriting, dependency fetching, secret-file
filtering, p2pws release metadata, or IWA signing. Check the files in your build
output before distributing it. A `.wbn` here is packfile's **gzip-wrapped archive**,
not a raw Web Bundle or signed `.swbn`, and browsers do not generally open these
archives as standalone websites. Use packfile's reader/router or a compatible host.
The existing `./web-bundle` API remains available for raw Web Bundles.

## Examples

1. Compress a folder:
   ```bash
   npx @johnhenry/packfile compress ./static ./compiled.wbn
   ```

2. Decompress a file:
   ```bash
   npx @johnhenry/packfile decompress ./compiled.wbn ./decompressed
   ```

3. Serve a compiled file:
   ```bash
   npx @johnhenry/packfile serve ./compiled.wbn 8080
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

Serializes a file Map to a compressed archive buffer -- `gzip(application/webbundle)`, via the real `wbn` package. Options: `compress` (default `true`; `compressed` is accepted as an alias), `compressionLevel`. Resolves to a `Buffer`. Output is reproducible: entries are written sorted by path (not in the Map's insertion order), gzip uses level 6 unless `compressionLevel` says otherwise, and the gzip header's OS byte is always 3 (Unix), so the same files give the same bytes on macOS and Linux. Compressed bytes are only guaranteed stable for the same zlib (a different Node major or a browser's `CompressionStream` may deflate differently); `compress: false` output is stable everywhere.

```js
const buffer = await toArchive(files);
```

### `fromArchive(buffer, options?)`

Deserializes an archive back to a file Map. Options:

- `compressed` (default `"auto"`; `compress` is accepted as an alias): `"auto"` gunzips when the bytes start with the gzip magic `1f 8b` and otherwise reads them as a plain Web Bundle, so both packfile's archives and plain `.wbn` files read without options. `true`/`false` force either way.
- `baseURL`: the absolute URL each exchange URL is made relative to. By default it is the bundle's primary URL's root (origin + `/`), or `https://packfile.invalid/` (the internal base `toArchive()` writes, also as its primary URL) when the bundle has none. So archives from `toArchive()` and a gzip(Web Bundle) built for a real site with a primary URL both read back without it. Pass it when a bundle's entries live somewhere other than its primary URL's origin, or under a sub-path (`https://example.com/app/` gives keys relative to `app/`).
- `onSkip({ url, reason })`: called once for each entry that is left out. Throw from it to abort instead.

Entries outside `baseURL` (`reason: "outside-base"`) or with an unsafe path (decoded `..`/`.`/empty segments, absolute, backslash, NUL/control characters, query/fragment, duplicates) are **skipped**. Without `onSkip` nothing reports them, so an archive whose base doesn't match reads back as an empty map. This Node reader is meant for local, trusted archives and applies **no size limits**; for untrusted input use the hardened `./browser` reader, which works in Node too.

```js
const files = await fromArchive(buffer, {
  baseURL: 'https://example.com/',
  onSkip: ({ url, reason }) => console.warn(`skipped ${url}: ${reason}`),
});
```

`decompileDirectory()` and the CLI's `decompress`/`serve` use the defaults (no `baseURL`, no `onSkip`).

### `fromFiles(files)` / `toFiles(map, options?)`

Adapters between the plain `{ [relativePosixPath]: string | Uint8Array }` object an app usually holds and packfile's `Map<path, { data, size, hash }>`. `fromFiles` is async (SHA-256 via Web Crypto, so hashes equal `hashBuffer()`'s), UTF-8-encodes strings, uses `Uint8Array` values as-is, and throws `InvalidPathError` for an unsafe key or `TypeError` for a bad value. `toFiles` returns bytes by default; `{ decodeText: true }` (or a `(path) => boolean`) returns text-typed entries (text/*, JSON, JavaScript, XML/SVG, valid UTF-8 only) as strings. Both are exported from `.` and `./browser`.

```js
const map = await fromFiles({ 'index.html': '<h1>hi</h1>', 'logo.png': pngBytes });
const archive = await toArchive(map);
const files = toFiles(await fromArchive(archive), { decodeText: true });
```

```js
const files = await fromArchive(buffer);
```

### `createRouter(files, options?)`

Returns a `(Request) => Promise<Response>` handler that serves files. Auto-sets `Content-Type`, `Cache-Control`, and `ETag` headers. Works with both `Map` and `LazyFileMap`.

**Options:**

- `alias` — Object mapping paths (e.g. `{ "/": "index.html" }`)
- `tryExtensions` — Array of extensions to try (e.g. `[".html"]`)
- `fallback` — Fallback handler for unmatched routes

A `Request`'s pathname is percent-decoded before lookup, so `new Request("https://site.example/docs/ünï/page.html")` finds the `docs/ünï/page.html` entry, and `alias` keys match the decoded path. A pathname that decoding would make unsafe or ambiguous (an encoded `/` as `%2F`, a backslash, NUL/control characters, a `.`/`..` segment, or a malformed `%` escape) is answered as not found (`fallback` if given, else 404). A string input is taken as an already-decoded path and is not decoded again. `createWebBundleRouter()` (`./web-bundle`) follows the same rules (see below).

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
import { fromFiles, toFiles, fromArchive, toArchive, createRouter } from '@johnhenry/packfile/browser';
```

The browser entry provides `fromFiles`, `toFiles`, `fromArchive`, `toArchive`, `createRouter` and the error classes, using the `wbn` package directly (no Node APIs) and Web Crypto/Web Streams -- same wire format as the Node entry, so an archive built by one is readable by the other. Types are in `browser.d.ts`.

```js
const archive = await fetch('/app.wbn').then(r => r.arrayBuffer());
const files = await fromArchive(archive);        // safe on untrusted bytes
const router = createRouter(files);
```

**Differences from the Node entry**

- `toArchive()` resolves to a plain `Uint8Array`. The Node entry resolves to a `Buffer` (a `Uint8Array` subclass), so code typed against `Uint8Array` works with both. *(Before 0.1.0 the browser entry returned an `ArrayBuffer` when compressing; wrap with `.buffer` or `slice` if you need one.)* There is no `compressionLevel` in the browser.
- Option names are aligned: `compress` is canonical for `toArchive`, `compressed` for `fromArchive`, and **both entries accept either spelling in both functions**. Passing both with different values throws a `TypeError`.
- `fromArchive()` is **hardened for untrusted input** (below); the Node one is not.

### Importing untrusted archives

`fromArchive()` from `./browser` is designed for `.wbn` files from strangers:

| Option | Default | Effect |
|--------|---------|--------|
| `maxEntries` | `10_000` | more entries -> `ArchiveLimitError` (`limit: "entries"`) |
| `maxTotalSize` | `256 MiB` | decompression is streamed and aborted once output exceeds this -> `ArchiveLimitError` (`limit: "totalSize"`); a gzip bomb is never fully inflated. Also bounds uncompressed input. |
| `unsafePaths` | `"throw"` | `"throw"` raises `InvalidPathError`; `"skip"` drops the entry (first duplicate wins) |
| `onSkip` | none | with `"skip"`, called as `onSkip({ url, reason })` for each dropped entry; throw from it to abort |
| `baseURL` | primary URL's root, else `https://packfile.invalid/` | the base exchange URLs are made relative to; anything outside it is unsafe (`reason: "outside-base"`). Same default as the Node entry. |
| `compressed` | `"auto"` | gunzip if the bytes start with `1f 8b`, else read a plain Web Bundle; `true`/`false` force |

Paths are validated after percent-decoding, so `%2e%2e`, `%5c` and `%00` cannot slip through: `..`/`.`/empty segments, absolute paths, backslashes, NUL/control characters, query/fragment, foreign origins and entries that collide after decoding are all rejected (`InvalidPathError.reason` says which). Input that is not a gzip stream or Web Bundle raises `InvalidArchiveError`. All errors extend `PackfileError` and carry a stable `code` (`ERR_PACKFILE_INVALID_PATH`, `ERR_PACKFILE_LIMIT`, `ERR_PACKFILE_INVALID_ARCHIVE`); `DEFAULT_LIMITS` is exported.

This hardens *reading*. Whatever you then do with the files (rendering them, `createBlobPreview`) is still on you -- see "What is still yours".

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
404ing. In `.js`/`.mjs`/`.cjs` files, relative and root-relative ES-module specifiers (`./x.js`, `../x.js`, `/x.js`; root-relative ones resolve against the files map's root, as in HTML and CSS) --
static `import ... from './x.js'`, `export ... from`, `export * from`,
side-effect `import './x.js'`, and `import('./x.js')` with a string literal
-- are rewritten to the dependency's blob URL, dependency-first. Specifiers
are found with [`es-module-lexer`](https://github.com/guybedford/es-module-lexer)
(its pure-JS build: no WASM, no Node APIs, so it is browser-safe), a real
lexer, so imports inside comments or strings are left alone. The JS blobs
are minted through the sibling `@johnhenry/andbox` package's
`createVirtualModuleRegistry()`, exposed as `preview.registry`.

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
- **Module cycles cannot fully load.** A blob's bytes are immutable, so the
  edge that closes an import cycle (`a.js` -> `b.js` -> `a.js`, or a module
  importing itself) is reported via `onUnresolvedReference` (`reason:
  "cycle"`) and left as the original relative text, which will not resolve
  from a `blob:` URL. Everything else in the graph is rewritten.
- Only string-literal **relative** (`./`, `../`) and **root-relative**
  (`/x.js`) specifiers in JS are rewritten. Bare specifiers, absolute and
  protocol-relative (`//host/x.js`) URLs, template-literal or computed
  `import(expr)` and `new URL('./x', import.meta.url)` are untouched (use an
  import map). A root-relative specifier that is not in the files map is
  reported (`reason: "missing"`) and left as written. A `?query`/`#hash` on a
  rewritten JS specifier is dropped. JS the lexer cannot parse is left as-is and reported
  (`reason: "unparseable"`).

## Web Bundle / Isolated Web App primitives (`./web-bundle`)

`toArchive()`/`fromArchive()` at the main `.` entrypoint (and `createRouter()`)
already use `application/webbundle` under the hood -- see "Node.js API"
above. This subpath is for callers who want the lower-level control those
two deliberately hide: a real, resolvable `baseURL` when *writing* (rather
than the fixed internal one `toArchive` uses; `fromArchive` can *read* a
bundle with any base, see its `baseURL` option), custom per-file `headers()`,
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
// back to a FilesMap, e.g. to hand to a different consumer. Entries outside
// baseURL are skipped; pass onSkip({ url, reason }) to see them.
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

Paths are matched **decoded on both sides**. A `Request`'s pathname is percent-decoded exactly as `createRouter()` does, and each exchange URL under `baseURL` is decoded the same way. So `/docs/ünï/page.html`, `/with%20space.txt`, `/a@b.txt` (which `toWebBundle()` stores as `a%40b.txt`) and lowercase escapes all match, whichever way the bundle's writer encoded them. `alias` keys match the decoded path. A pathname that decoding would make unsafe or ambiguous (`%2F`, a backslash, NUL/control characters, a `.`/`..` segment, a malformed `%` escape) is answered as not found (`fallback` if given, else 404). An exchange whose own URL decodes to such a path, or that lies outside `baseURL`, can't be reached by path. A `Request`'s pathname is taken relative to `baseURL` (the request's origin isn't compared with it). A string input is a decoded path, used as given. If nothing matches, it is tried once more as an already-encoded path resolved under `baseURL`, which was the behavior before #35.

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
| `./browser` | `browser.mjs` | Browser-compatible: hardened `fromArchive`, `toArchive`, `fromFiles`, `toFiles`, `createRouter`, error classes |
| `./build` | `lib/build.mjs` | Browser-safe `exportFiles` / `exportBuild` with archive and file hashes |
| `./build-node` | `lib/build-node.mjs` | `exportDirectory` with atomic destination replacement |
| `./vite` | `lib/vite.mjs` | Vite client-build exporter including public assets |
| `./rollup` | `lib/rollup.mjs` | Rollup/Rolldown archive emission plugin |
| `./cache` | `cache.mjs` | `withCache` — HTTP caching middleware |
| `./hash` | `lib/hash.mjs` | `hashBuffer`, `hashStream` |
| `./compression` | `lib/compression.mjs` | `compressObject`, `deCompressObject` |
| `./compat` | `compat.mjs` | `compileDirectory`, `decompileDirectory` |
| `./blob-preview` | `lib/blob-preview.mjs` | `createBlobPreview` — host a `FilesMap` client-side via `blob:` URLs, no server |
| `./web-bundle` | `lib/web-bundle.mjs` | Lower-level Web Bundle primitives: `toWebBundle`, `fromWebBundle`, `createWebBundleRouter` — the engine `toArchive`/`fromArchive` are built on, with a real `baseURL`/headers/IWA-signing exposed |

TypeScript types: every subpath has a `types` condition and a real `.d.ts` file (checked in CI with `skipLibCheck: false` against the published package name).

## Security model

**What packfile guarantees:**

- **Decoding an archive never writes outside the archive root.** `fromArchive()`
  (and `fromWebBundle()`, which it's built on) rejects any entry whose path
  would escape the archive's own base -- a leading slash or backslash, a
  `..` segment anywhere in the path, a NUL byte, or an empty/`.` path -- via
  `checkPath()`/`urlToPath()` in `lib/path-safety.mjs`, shared by the Node
  and browser readers, after percent-decoding. On the Node reader a rejected entry is
  skipped rather than written (reported through `onSkip` if you pass one), so an archive built to escape its extraction
  root (a "zip-slip"-shaped attack) cannot use `fromArchive()`/
  `decompileDirectory()` to do it.
- **`createRouter()` never serves outside the file map it was given.** It
  only ever resolves against the in-memory `FilesMap` (or `LazyFileMap`)
  built by `fromDirectory()`/`fromArchive()`/your own code -- there is no
  filesystem access at request time, so a crafted request path cannot read
  anything not already present in that map.

- **The `./browser` `fromArchive()` is safe on hostile bytes**: bounded
  entry count and decompressed size (streamed, so bombs are cut off early),
  strict path validation that throws typed errors by default, and no raw
  lower-level exceptions. The Node `fromArchive()` has no size limits.

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
  disk needed. File names containing `#`, `?` or `%` don't survive that
  trip yet (johnhenry/fileable#20), and an empty `<Dir>` isn't kept (a Web
  Bundle has no directory entries).
- **[`@johnhenry/servable`](https://github.com/johnhenry/servable)** --
  `createRouter()` already returns a `(Request | path, ctx?) => Response`
  handler (it even aliases itself as `.fetch`), the exact shape servable's
  `Route`'s `handler` prop accepts -- mounting a packfile-served directory
  inside a servable app is just passing a function, no new integration
  surface needed. See `examples/08-mount-packfile` in the servable repo for
  a real, running mount (`Route path="/*"` inside a `Group prefix="/mem"`,
  forwarding the wildcard-captured path straight to the router).
- **[`@johnhenry/prism`](https://github.com/johnhenry/prism)** -- a live
  HTTP request inspector/proxy that uses `fromDirectory()`/`fromArchive()`/
  `toArchive()`/`createRouter()` for its own dashboard's static assets and
  for a user-facing custom-route feature (serving a directory or an
  uploaded archive at an arbitrary path). This package is the direct
  successor of `lemem`, prism's own original dependency for this, ported
  and renamed before prism itself was.
- **[`@johnhenry/sitefile`](https://github.com/johnhenry/sitefile)** --
  sitefile's `EXPORT / AS wbn BASE <url>` writes a plain (not gzipped) b2
  Web Bundle. `fromWebBundle(buffer, { baseURL })` from `./web-bundle` reads
  it back into exactly the exported files, and `createRouter()` serves it.
  Since packfile 0.2.1, `fromArchive()` takes a `baseURL` option or, without
  it, the origin of the bundle's primary URL (#18), and the CLI's `serve`
  and `decompress` read plain bundles; since sitefile 0.0.1, sitefile writes
  the gzip itself with `EXPORT … AS wbn COMPRESSION gzip` or `-o
  site.wbn.gz` (johnhenry/sitefile#143). So a sitefile bundle with any `BASE`
  reads with plain `fromArchive(buffer)`, gzipped or plain (`compressed`
  defaults to `"auto"` since #28). With packfile 0.2.0, `fromArchive()` reads only bundles built
  for `https://packfile.invalid/`. sitefile has no runtime dependency on
  packfile; its `test/packfile-interop.test.ts` (packfile as a
  devDependency) checks these paths, and this repo's
  `test/sitefile-fixture.test.mjs` reads a bundle made by the published
  sitefile 0.0.0, with `fromWebBundle()` and, gzipped, with `fromArchive()`.
  Known gaps: a `Request` for a non-ASCII path 404s in `createRouter()`, so
  pass the path as a string (#20). Since sitefile 0.0.1
  (johnhenry/sitefile#144), each response in its bundles carries its HEADER
  values and exact-path REDIRECTs are 3xx responses with `location`, which
  `createWebBundleRouter()` serves (`createRouter()` serves a files map, so
  not these); splats, `200` rewrites and `404` rules stay in `/_redirects`.
  sitefile can't yet import a `toArchive()` archive with `AS tree`
  (johnhenry/sitefile#141).

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

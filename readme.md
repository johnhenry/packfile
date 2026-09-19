# lemem

Static file compiler and server. Compresses directories into CBOR archives and serves them as HTTP responses via the `(Request) => Response` handler pattern.

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/johnhenry/lemem.git
cd lemem
npm install
```

## Usage

You can use the LEMEM CLI with the following commands:

### Compress a folder

```bash
npm run lemem compress <path-to-folder> <path-to-file>
```

This command compresses the contents of `<path-to-folder>` and saves the compressed data to `<path-to-file>`.

### Decompress a file

```bash
npm run lemem decompress <path-to-file> <path-to-folder>
```

This command decompresses the contents of `<path-to-file>` and saves the decompressed files to `<path-to-folder>`.

### Serve a compiled file

```bash
npm run lemem serve <path-to-file> [port]
```

This command serves the compiled file at `<path-to-file>` on the specified `[port]` (default is 3000).

## Examples

1. Compress a folder:
   ```bash
   npm run lemem compress ./static ./compiled.cbor
   ```

2. Decompress a file:
   ```bash
   npm run lemem decompress ./compiled.cbor ./decompressed
   ```

3. Serve a compiled file:
   ```bash
   npm run lemem serve ./compiled.cbor 8080
   ```

## Node.js API

```js
import {
  fromDirectory, fromDirectoryLazy, fromArchive, toArchive,
  createRouter, hashBuffer, hashStream,
  compileDirectory, decompileDirectory
} from 'lemem';
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

Serializes a file Map to a compressed CBOR buffer.

```js
const buffer = await toArchive(files);
```

### `fromArchive(buffer, options?)`

Deserializes a CBOR archive back to a file Map. Validates paths — entries with path traversal (`../`) or absolute paths are rejected.

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
import { withCache } from 'lemem/cache';
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
import { fromArchive, toArchive, createRouter } from 'lemem/browser';
```

The browser bundle provides `fromArchive`, `toArchive`, and `createRouter`. Requires a CBOR library — either pass `options.decode`/`options.encode` or load one globally as `globalThis.cbor`.

```js
const archive = await fetch('/app.cbor').then(r => r.arrayBuffer());
const files = await fromArchive(archive);
const router = createRouter(files);
```

## Blob Preview (host packaged content in a browser tab/iframe, no server)

```js
import { createBlobPreview } from 'lemem/blob-preview';
```

`createRouter()` needs something to call it — a real server, a Service
Worker, or (in `lemem/browser`) at least a `fetch`-shaped handler wired up
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
import { fromDirectory } from 'lemem';
import { createBlobPreview } from 'lemem/blob-preview';

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
lemem-packaged content client-side. It is **good enough for trusted, your
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
  pre-bundle multi-file JS into one file before packaging with lemem.

## Direct Imports

```js
import { hashBuffer, hashStream } from 'lemem/hash';
import { compressObject, deCompressObject } from 'lemem/compression';
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

## Internal formats

lemem's data passes through several distinct shapes on its way from a
directory on disk to an HTTP response: the in-memory `FileEntry`/`FilesMap`
table (eager `Map` or lazy `LazyFileMap`), the gzip+CBOR archive byte
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

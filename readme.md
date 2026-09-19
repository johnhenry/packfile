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

## License

This project is licensed under the MIT License.

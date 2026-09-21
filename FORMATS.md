# Internal formats

packfile moves the same file content through several different shapes depending
on where it is in the pipeline: a directory on disk, an in-memory lookup
table, a single portable binary artifact, and a `Response`. None of these
are documented together anywhere else, so this file exists to make the set
explicit -- what each shape actually is, byte-for-byte or field-for-field
where that matters, which function produces it, which functions consume it,
and (only where the code or a comment actually says so) why it's not just
one shape.

Everything below was read directly out of the current source under
`lib/`, `index.mjs`, `browser.mjs`, `compat.mjs`, `cache.mjs`, `types.ts`.
Where the reasoning for a split isn't stated anywhere in the code, this
document says so explicitly rather than inventing one.

## 1. The in-memory file table: `FileEntry` / `FilesMap`

This is the central representation everything else converts to or from.

**Shape** (`types.ts`):

```ts
type FileEntry = { data: Uint8Array; size: number; hash: string };

interface FilesMap {
  has(key: string): boolean;
  get(key: string): FileEntry | undefined | Promise<FileEntry | undefined>;
  keys(): IterableIterator<string>;
  readonly size: number;
}
```

Keys are POSIX-style relative paths (e.g. `"assets/logo.png"`, forward
slashes, no leading `/`, produced by Node's `path.relative()` on POSIX --
not verified to be forward-slash-normalized on Windows).

There are **two** concrete implementations of `FilesMap`, both accepted
interchangeably by `createRouter` via duck-typing (`if (entry &&
typeof entry.then === "function") entry = await entry;` in
`lib/create-router.mjs`):

- **Eager**: a plain native `Map<string, FileEntry>`. `get()` is
  synchronous. Produced by `fromDirectory()` (`lib/from-directory.mjs`) and
  by both archive decoders (`lib/from-archive.mjs`, `browser.mjs`). Every
  entry's full `data` is already resident in memory.
- **Lazy**: `LazyFileMap` (`lib/lazy-file-map.mjs`). `get()` returns a
  `Promise<FileEntry>` that reads the file from disk (`readFile` + `stat`)
  and hashes it **on every call** -- there is no caching inside
  `LazyFileMap`, so calling `get()` twice for the same key re-reads and
  re-hashes the file twice. Produced by `fromDirectoryLazy()`
  (`lib/from-directory-lazy.mjs`), which does an initial directory walk to
  collect the *set of paths* (`Set<string>`) up front but defers reading
  any file content until `get()` is actually called.

**Why two implementations:** `fromDirectory`'s doc comment and the README
both frame `fromDirectoryLazy` as "useful for development" -- i.e. reading
every file's bytes into memory up front is wasteful when only a few routes
of a large tree will actually be requested in a dev loop. This reasoning is
stated in the README, not just inferred.

**Consumed by:** `toArchive()` (iterates a `Map` -- note `toArchive` only
accepts a `Map`, not the `FilesMap` interface in general, so a `LazyFileMap`
cannot be archived directly without first materializing it into a `Map`),
`createRouter()` (reads via `has()`/`get()` at request time), and
`compat.mjs`'s `decompileDirectory()` (writes each entry's `data` to disk).

## 2. The archive format: gzip(Web Bundle)

**Changed wholesale, not incrementally.** Through 0.0.0's early history this
was a bespoke `gzip(cbor(flatObject))` format (a CBOR-encoded plain object,
one property per path). That format is gone -- not kept as a fallback or a
`formatVersion` option -- replaced by `gzip(`[`application/webbundle`](https://developer.chrome.com/docs/iwa/introduction)`)`,
the format Chrome's Isolated Web Apps are built on, via the real,
Google-maintained `wbn` npm package. There was no external consumer of the
old byte format to preserve compatibility for (0.0.0, never published), so
this is a clean break: an archive written by a previous version of this
package is not readable by this one.

**Why**: this package was originally built with `wbn`/Web Bundles in mind;
the bespoke CBOR format was adopted only because Web Bundles looked
effectively abandoned at the time. IWA gave the format renewed, active
life, which removed the reason for the bespoke format to exist. A Web
Bundle also models something the flat CBOR object never could -- real HTTP
*exchanges* (status + headers per entry, not just bytes) -- which
`lib/web-bundle.mjs`'s `createWebBundleRouter()` (§7) now serves directly.

**What it is, precisely:** a Web Bundle is itself CBOR underneath (a
specific, spec'd array-of-sections structure with real framing -- see
below), gzip-compressed on top by this package, same as before. Each
exchange's URL is a path resolved against a fixed, internal-only
`ARCHIVE_BASE_URL` (`"https://packfile.invalid/"`, the IANA/RFC 2606
`.invalid` TLD -- guaranteed never a real, resolvable origin, since this
URL is only ever built and immediately stripped back off, never
dereferenced), status is always `200`, and `Content-Type` is inferred from
the path extension via `lib/mime.mjs`'s `getContentType()` -- the same
table `createRouter()`'s own synthesized responses already use. `size`/
`hash` are **not** stored in the bundle at all (a Web Bundle has no such
concept); both are simple derived properties of the body bytes, recomputed
on read (`size` from `body.byteLength`, `hash` via `hashBuffer()`) rather
than round-tripped as separate fields.

Unlike the old format, this one genuinely **does** have magic bytes,
version, and framing -- `wbn`'s own decoder checks for a literal `🌐📦`
magic value and an approved version string before parsing anything else
(`node_modules/wbn/lib/decoder.js`) -- but that's `wbn`'s format
guarantee, not something this package added on top. The *gzip* wrapping
this package applies around it still has no framing of its own: the two
ends of a round trip must still agree out-of-band on whether the buffer is
gzip-compressed (`toArchive`/`fromArchive`'s `compress`/`compressed`
options, both default `true`) -- that part of the original gap is
unchanged.

**Produced by:** `lib/to-archive.mjs`'s `toArchive(map, opts)`, a thin
wrapper around `lib/web-bundle.mjs`'s `toWebBundle()` with the fixed
`ARCHIVE_BASE_URL`. Compression (gzip via `lib/compression.mjs`) is applied
after building the bundle, default on, unchanged from before.

**Consumed by:** `lib/from-archive.mjs`'s `fromArchive(buffer, opts)`, a
thin wrapper around `fromWebBundle()`. Decompresses (if `compressed: true`,
the default) via `lib/compression.mjs`'s `deCompressObject`, then parses
via `wbn.Bundle` and strips `ARCHIVE_BASE_URL` back off each exchange's
URL to recover the relative path. Every resulting path is still run through
an `isSafePath()` check (now living inside `fromWebBundle()` itself, applied
whenever a `baseURL` is given) -- rejects a leading `/`/`\`, any `..`
substring, an embedded NUL byte, or the empty/`"."` path -- and unsafe
entries are **silently dropped** rather than throwing, same behavior as
before (see the CHANGELOG's "Archive path-validation gap" entry for why).

**The hash-trust gap that existed here is now closed as a side effect, not
a deliberate fix.** The old format's `fromArchive()` read `hash` straight
out of the decoded object and trusted it as-is, never re-verified against
`data` -- documented above (pre-migration) as a real, found gap. The new
format has nowhere to put an untrusted hash even if it wanted to (Web
Bundles have no hash field), so `fromWebBundle()`'s `hashBuffer()` call is
now the *only* source of `FileEntry.hash` on the read path -- it is
structurally impossible for the returned hash to disagree with the actual
bytes sitting next to it in the same entry, the same guarantee the *write*
path (`fromDirectory`) already had.

**`browser.mjs`'s independent implementation is now format-convergent, still
code-divergent, for a real platform reason.** `browser.mjs` previously
reimplemented the same object-shape CBOR logic inline against an
injected/global CBOR encoder/decoder, a documented, real divergence risk
(the two `isSafePath()`s had already drifted apart -- see below). It now
imports `wbn` directly, the same package the Node side uses (`wbn` itself
needs no Node APIs, confirmed via its own 0.0.8 release notes) -- so an
archive built by one entry point is now **directly readable by the
other**, verified for real (`test.mjs`, "browser.mjs toArchive/fromArchive"
-- both directions). The glue code is still a separate copy, not a shared
import of `lib/web-bundle.mjs`, because that module also imports
`lib/hash.mjs` -> `node:crypto`, which has no browser resolution at all;
`browser.mjs` computes its hash via Web Crypto's `crypto.subtle.digest`
(async-only) instead. The two `isSafePath()`s are now **identical**
(`browser.mjs`'s simpler substring/prefix check, not `from-archive.mjs`'s
old `path.normalize()`-based one -- see `lib/web-bundle.mjs`'s own comment
for why that direction was chosen), closing the divergence risk previously
flagged here, though the duplication itself (two copies of one six-line
function) remains, now deliberately, as the documented cost of staying
`node:path`-free in the browser build.

`browser.mjs`'s `toArchive` still silently drops `ToArchiveOptions
.compressionLevel` -- unchanged from before, and still not fixable from
this package's side: `lib/compression.browser.mjs`'s `CompressionStream`-
based implementation has no numeric level parameter to plumb one through
to at all.

**Why the archive format is separate from the in-memory `Map`:** unchanged
reasoning from before -- the archive is a single portable binary artifact
meant to be written to one file (`packfile compress`), fetched over HTTP as
one request, or embedded in a build output; the in-memory `Map`/
`LazyFileMap` exists for O(1) path lookup during routing. Different formats
for a genuine "at rest / single file" vs "in memory / keyed lookup" split.

## 3. Hash format

**What it is:** a SHA-256 digest, hex-encoded (lowercase). Always a plain
hex string (`FileEntry.hash`), never raw bytes or base64. Computed via
Node's synchronous `crypto.createHash("sha256")` (`lib/hash.mjs`'s
`hashBuffer()`) on the Node side; via the Web Crypto API's asynchronous
`crypto.subtle.digest("SHA-256", ...)` in `browser.mjs` -- the same
algorithm and same hex output, necessarily a different code path, since
Node's synchronous `crypto` module has no browser equivalent.

**Computed over:** the raw file bytes -- at the point they're first read
from disk in `fromDirectory()`/`LazyFileMap.get()` (unchanged from before),
**and now also on the archive read path**, a real change from the previous
format. `lib/hash.mjs` also exports `hashStream()` for hashing a Node
`Readable` incrementally, but nothing under `lib/` or the entry points
actually calls `hashStream` -- it appears to be a public API convenience
(documented in the README, re-exported from `./hash`) with no internal
caller found in this codebase.

**The hash-trust gap previously documented here is now closed, as a side
effect of the format change rather than a deliberate fix for it.** Under
the old CBOR format, `fromArchive()`/`browser.mjs` read `hash` straight out
of the decoded object and trusted it as-is, never re-verified against
`data` -- a real, found gap: a corrupted or hand-edited archive entry
(mismatched `data`/`hash`) would silently serve the wrong `ETag` (§6) for
its actual content, with no detection anywhere in the codebase. A Web
Bundle exchange has no hash field of any kind to carry that stale trust
forward in the first place -- `lib/web-bundle.mjs`'s `fromWebBundle()`
(and `browser.mjs`'s own read path) now *compute* `hash` from the response
body on every read, the same way the write path always did. It is now
structurally impossible for a returned `FileEntry.hash` to disagree with
the bytes sitting next to it in the same entry, on either the write or the
read path.

**Downstream uses:**
- **Content-addressing / change detection**: not explicitly implemented
  anywhere as a dedicated cache-key/dedup mechanism -- the hash is present
  per-entry but nothing in `lib/` compares hashes across two `Map`s or
  archives to decide "did this file change." (`fileable`'s sibling package
  does this kind of hash-based incremental build; packfile does not appear to,
  based on what's actually in this codebase.)
- **HTTP caching**: `lib/response.mjs`'s `buildFileResponse()` uses
  `entry.hash` directly as a strong `ETag` (`"${entry.hash}"`) and handles
  `If-None-Match` 304 negotiation against it.
- **`cache.mjs`'s `withCache()` middleware** takes a separate,
  independent path: it doesn't use any `FileEntry.hash` at all. It reads
  the already-built `Response`'s body (`response.arrayBuffer()`) and calls
  `hashBuffer()` on that directly, computing a fresh SHA-256 over the
  served bytes every time, for handlers that aren't backed by a packfile
  `FilesMap` at all (its own doc comment says it's meant for arbitrary
  "leserve handlers"). This is the same hash *algorithm* as §"produced by"
  above (SHA-256 hex), reused for the same purpose (ETags), but computed at
  a different point (response time vs. read-from-disk time) for a different
  kind of caller.

## 4. Compression format(s): gzip, two implementations

**What it is:** gzip, in both the Node and browser implementations --
confirmed by reading the code, not assumed from the CBOR framing above.

- **Node** (`lib/compression.mjs`): `node:zlib`'s `gzip`/`gunzip` directly.
  `compressObject(buffer, level = zlib.constants.Z_DEFAULT_COMPRESSION)`
  accepts a numeric compression level (0-9, or the zlib default `-1`,
  passed through to `zlib.gzip`'s `{ level }` option).
- **Browser** (`lib/compression.browser.mjs`): the Web
  `CompressionStream`/`DecompressionStream` APIs, explicitly parameterized
  with `format = "gzip"` (so, same wire format as the Node side, not a
  browser-specific compression scheme) -- data is wrapped in a `Blob`,
  piped through the stream, and read back via `Response(...).arrayBuffer()`.
  This implementation has **no compression-level parameter at all** -- it's
  whatever `CompressionStream("gzip")` does internally, not tunable.

**Why two implementations:** `node:zlib` is a Node built-in module and is
not available in browsers; `CompressionStream`/`DecompressionStream` are
Web Platform APIs. This is a real runtime-API split, not a difference in
output format -- both produce/consume standard gzip streams, which is why
an archive built with one can, in principle, be decompressed by the other
(the CBOR archive format above doesn't record which compressor produced
it, and doesn't need to, because both emit interoperable gzip).

**Consumed by:** `lib/to-archive.mjs`/`lib/from-archive.mjs` use the Node
version; `browser.mjs` uses the browser version directly (not through
`lib/compression.mjs`, which would fail in a browser since it imports
`node:zlib`/`node:util`).

## 5. MIME-type representation

**What it is:** a plain object literal (`MIME_TYPES` in `lib/mime.mjs`)
mapping lowercase file extensions (no leading dot, e.g. `"html"`, `"png"`)
to MIME type strings (e.g. `"text/html"`). Not a format in the
byte-encoding sense -- it's a lookup table plus one function,
`getContentType(filePath, customMimeTypes)`, that takes the last
`.`-delimited segment of a path, lowercases it, and looks it up (custom
map first, then the built-in table, defaulting to
`"application/octet-stream"`). Both lookups use `Object.hasOwn()`
specifically to avoid prototype-pollution: a file literally named e.g.
`report.constructor` or `image.__proto__` would otherwise resolve to an
inherited `Object.prototype` value via plain bracket lookup -- this is a
confirmed, CHANGELOG-documented security fix, not speculative.

**Produced/consumed:** it's pure computation, not a stored format --
`getContentType()` is called by `lib/response.mjs`'s
`buildFileResponse()` to set the `Content-Type` header, with an optional
`RouterOptions.mimeTypes` override threaded in from `createRouter()`.

## 6. The `Response` bridge (`lib/response.mjs`)

**What it is:** the point where a `FileEntry` (§1) stops being packfile's
internal shape and becomes a standard Web/Fetch API `Response` object.
`buildFileResponse(request, filePath, entry, opts)` builds headers
(`Content-Type` via §5, `Content-Length: String(entry.size)`,
`Cache-Control`, `ETag: '"' + entry.hash + '"'` per §3) and sets the body to
`entry.data` directly (the same `Uint8Array` held in the `FileEntry`, not a
copy) -- except for `HEAD` requests (body `null`, headers only) and a
304 short-circuit when the incoming `If-None-Match` header matches the
computed ETag exactly (body `null` again).

**Produced by:** only `lib/response.mjs`. **Consumed by:**
`lib/create-router.mjs`'s request handler, which is the only caller.

**Why separate from `FileEntry`:** this is the one conversion in the
pipeline whose purpose is unambiguous from the code alone -- `Response` is
the DOM/Fetch standard shape that `createRouter`'s contract
(`(Request) => Promise<Response>`) requires, and `FileEntry` is a much
smaller, cheaper internal shape (no `Headers` object, no status code, just
bytes + two pieces of metadata) that every other format in this document
also produces or consumes. Building the `Headers`/`Response` wrapper on
every match, rather than storing it pre-built, keeps the `FilesMap` itself
router-agnostic (no HTTP concepts baked into stored entries).

## 7. Router request-matching format (`lib/create-router.mjs`)

Not a stored/serialized format -- documented here because it's the
consumer-side contract that ties §1 and §6 together, and because it has its
own small amount of request-time structure worth being explicit about.

**Input it consumes:** a `FilesMap` (§1, either concrete implementation)
plus `RouterOptions` (`alias`, `cacheControl`, `mimeTypes`, `tryExtensions`,
`fallback`). At call time, `input` is either a path string or a `Request`;
a string is treated as an implicit `GET` with no `Request` object (so no
`If-None-Match` handling is possible for that call shape -- 304s only
happen when called with an actual `Request`).

**Resolution algorithm** (in order): reject non-`GET`/`HEAD` methods (404
or the given `fallback`) → apply an exact-match `alias` substitution (first
match in `Object.entries(alias)` wins, no wildcard/pattern support) → strip
the leading `/` → look up the resulting path directly in the `FilesMap`,
and if absent, try each of `tryExtensions` appended in order, first hit
wins → 404/`fallback` if nothing matched.

**Output it produces:** a `RouteHandler` function,
`(input, ctx?) => Promise<Response>`, with the function itself also
assigned to its own `.fetch` property (so it satisfies both a plain
call-with-request convention and a `{ fetch }`-shaped object convention,
e.g. for passing directly as a `fetch` handler). `ctx` is typed as
`unknown` (`RouteContext`) and is only ever passed through to `fallback` --
`createRouter`'s own matching logic never reads it.

## `compat.mjs` -- not a new format

`compat.mjs`'s `compileDirectory`/`decompileDirectory` are pure
orchestration, not a new representation: `compileDirectory` is exactly
`fromDirectory` (§1) piped into `toArchive` (§2); `decompileDirectory` is
exactly `fromArchive` (§2) piped into per-entry `writeFile`s. Worth one
concrete note: `decompileDirectory` calls `mkdir(dirname(fullPath), {
recursive: true })` and `writeFile()` directly using each archive key
joined onto `outputPath` -- it relies entirely on `fromArchive`'s own
`isSafePath()` (§2) having already filtered the keys it's iterating; it
does not re-check path safety itself.

## `lib/safe-symlink.mjs` -- not a data format

Flagged per the task brief for completeness, but this is genuinely not a
format: `isWithinRoot(root, target)` is a one-line path-containment
predicate (`path.relative(root, target)` doesn't start with `..` and isn't
itself absolute), used by both `fromDirectory` and `fromDirectoryLazy`
during their directory walk to stop a symlink from either escaping the
archived root or forming a cycle back to an ancestor directory (both
documented as real, CHANGELOG-fixed security/DoS issues). It carries no
persisted representation of "this was a symlink" forward at all --
resolved symlink targets are walked and read as ordinary file content, and
nothing in `FileEntry` (§1) or the archive format (§2) distinguishes a
file that started as a symlink from one that didn't. That's a real,
observable property of the current format set (symlink-ness is not
preserved end-to-end), not a gap this document is proposing to fix.

## Summary table

| # | Format | Produced by | Consumed by |
|---|--------|-------------|-------------|
| 1 | `FileEntry` / `FilesMap` (eager `Map` or `LazyFileMap`) | `fromDirectory`, `fromDirectoryLazy`, `fromArchive` (both impls) | `toArchive`, `createRouter`, `decompileDirectory` |
| 2 | Archive bytes: `gzip(application/webbundle)`, via `wbn` | `toArchive` (`lib/to-archive.mjs`, `browser.mjs`) | `fromArchive` (`lib/from-archive.mjs`, `browser.mjs`), `packfile.mjs` CLI |
| 3 | Hash: SHA-256 hex string | `hashBuffer`/`hashStream` (`lib/hash.mjs`), inlined into `fromDirectory`/`LazyFileMap` | `lib/response.mjs` (ETag), `cache.mjs` (`withCache`, independently) |
| 4 | Compression: gzip (Node `zlib` / Web `CompressionStream`) | `lib/compression.mjs`, `lib/compression.browser.mjs` | `toArchive`/`fromArchive` and their `browser.mjs` counterparts |
| 5 | MIME lookup table | `lib/mime.mjs` | `lib/response.mjs` |
| 6 | `Response` bridge | `lib/response.mjs` | `lib/create-router.mjs` |
| 7 | Router request-matching (alias → strip `/` → extension fallback) | `lib/create-router.mjs` | `packfile.mjs` CLI `serve`, any caller of `createRouter()` |

## Loose ends found while writing this document

These are genuine observations from reading the code, not tasks this
document is asking anyone to fix:

- ~~`browser.mjs` reimplements the archive encode/decode and path-safety
  logic independently...~~ **Resolved** by the CBOR -> Web Bundle format
  migration: both entry points now use the same `wbn` package and the same
  `isSafePath()` algorithm (§2). The code itself is still a separate copy
  (not a shared import), for a real, remaining reason -- `lib/web-bundle.mjs`
  transitively imports `node:crypto` via `lib/hash.mjs`, which has no
  browser resolution.
- `browser.mjs`'s `toArchive` still silently ignores `compressionLevel`
  (§2, §4) -- unrelated to the format migration, still open.
- ~~Archive-loaded `FileEntry.hash` values are never verified against
  `data`...~~ **Resolved**, also as a side effect of the format migration:
  a Web Bundle exchange has no hash field to (mis)trust in the first place,
  so `hash` is now always recomputed from the actual response body on
  read (§3).
- `lib/from-archive.mjs`'s old `// Handle legacy archives that have type:
  "content" field` comment (referencing a `FileInfo` shape the CHANGELOG
  says was already removed) no longer applies -- the file itself was
  rewritten wholesale for the Web Bundle format and that stale comment is
  gone with it, not fixed in place.
- `hashStream()` (`lib/hash.mjs`) is exported and documented in the
  README but has no caller anywhere else in this codebase (source or
  tests) -- it may be intended purely as public API for consumers who have
  a stream rather than a buffer.

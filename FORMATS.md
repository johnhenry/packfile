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

## 2. The archive format: gzip(CBOR(object))

**What it is, precisely:** a CBOR-encoded plain JavaScript object (not a
CBOR "map" type keyed by the `Map` class -- `toArchive` explicitly converts
`Map` to `{}` first, since CBOR encoders work over enumerable object
properties), optionally gzip-compressed on top. Each property is a path key
whose value is `{ data: Uint8Array, size: number, hash: string }` --
`FileEntry` decoded/re-encoded as-is, not a separate archive-specific
schema.

There is **no magic number, version byte, or framing of any kind**. The
byte stream is exactly `gzip(cbor(obj))` (or bare `cbor(obj)` if
`compress: false`). The two ends of a round trip must agree out-of-band on
whether the buffer is compressed -- both `toArchive`/`fromArchive` and their
`browser.mjs` counterparts default `compressed`/`compress` to `true`, so as
long as both sides use the default, or both sides pass the same explicit
option, it round-trips. Nothing in the buffer itself records which mode
was used to write it, so a caller that has already lost track of the
option (e.g. loaded an old `.cbor` file whose compression setting isn't
recorded anywhere else) has no way to detect it from the file itself. This
is a real gap, not something the code works around.

**Produced by:** `lib/to-archive.mjs`'s `toArchive(map, opts)`. Uses the
`cbor` npm package's `cbor.encodeAsync()` -- specifically *not*
`cbor.encode()`/`encodeOne()`, per a detailed comment in the source: those
synchronous-looking APIs were observed (on Node 26) to resolve their
promise before the internal encoding stream finished flushing, silently
truncating output to just the 1-byte CBOR map header. This is confirmed by
the CHANGELOG as a real bug that was hit and fixed, not a hypothetical.
Compression (gzip via `lib/compression.mjs`) is applied after encoding,
default on.

**Consumed by:** `lib/from-archive.mjs`'s `fromArchive(buffer, opts)`.
Decompresses (if `compressed: true`, the default) via
`lib/compression.mjs`'s `deCompressObject` (Node `zlib.gunzip`), decodes
via `cbor.decode()` (synchronous form -- only the encode side has the
async-flush bug per the comment), then re-`Map`-ifies the object. Every key
is run through `isSafePath()` first (rejects absolute paths, `..`-escaping
paths after `path.normalize()`, embedded NUL bytes, and paths that
normalize down to "the output directory itself" e.g. `""`, `"."`, `"a/.."`)
and unsafe entries are **silently dropped** rather than throwing. This
exists specifically to stop `decompileDirectory()` (which joins each key
onto an output directory and writes it) from writing outside that
directory or clobbering it -- see the CHANGELOG's "Archive path-validation
gap" entry.

**A second, independent implementation exists in `browser.mjs`.**
`browser.mjs` does not import `lib/to-archive.mjs` / `lib/from-archive.mjs`
-- it reimplements the same object-shape logic inline, using an
injected/global CBOR encoder/decoder (`options.encode`/`options.decode`, or
`globalThis.cbor`) instead of the `cbor` npm package, and
`lib/compression.browser.mjs` instead of `lib/compression.mjs`. The
underlying reason (Node's `cbor` package and `node:zlib` aren't usable in a
browser) is evident from the code; the fact that it's a **separately
maintained copy of the same encode/decode logic**, rather than a shared
helper the two entry points both call, is not explained anywhere and is a
real duplication risk. Concretely, the two `isSafePath()`s have already
diverged: `browser.mjs`'s version is a simpler substring/prefix check
(rejects any path containing `..` anywhere, or starting with `/`/`\`, or
containing NUL) and does **not** apply `path.normalize()` first or reject
the "resolves to the output directory itself" case the way
`lib/from-archive.mjs`'s does. Both are defensible on their own, but they
are not the same algorithm, and a fix made to one (like the path-validation
fix recorded in the CHANGELOG) is not guaranteed to have been ported to the
other -- confirmed by inspection, not assumed.

`browser.mjs`'s `toArchive` also silently drops `ToArchiveOptions
.compressionLevel` -- it destructures only `{ compressed, encode }` from
`opts` and never passes a level through to `compressObject()` (whose
browser implementation, `lib/compression.browser.mjs`, has no level
parameter at all -- see below). A caller passing `compressionLevel` through
the browser entry point gets no error and no effect.

**Why the archive format is separate from the in-memory `Map`:** the README
frames this directly -- the archive is "a compressed CBOR buffer," i.e. a
single portable binary artifact meant to be written to one file
(`packfile compress`), fetched over HTTP as one request (`fromArchive(await
fetch(...).then(r => r.arrayBuffer()))`), or embedded in a build output.
The in-memory `Map`/`LazyFileMap` exists for O(1) path lookup during
routing; the archive exists for "one blob, portable, on disk or over the
wire." They are different formats for a genuine "at rest / single file" vs
"in memory / keyed lookup" split.

## 3. Hash format

**What it is:** a SHA-256 digest, hex-encoded (lowercase, via Node
`crypto.createHash("sha256").digest("hex")`). Always a plain hex string
(`FileEntry.hash`), never raw bytes or base64.

**Computed over:** the raw file bytes, at the point they're first read from
disk -- in `fromDirectory()` (`lib/from-directory.mjs`, via
`hashBuffer(data)`) and in `LazyFileMap.get()` (`lib/lazy-file-map.mjs`,
recomputed fresh on every call, no caching). `lib/hash.mjs` also exports
`hashStream()` for hashing a Node `Readable` incrementally, but nothing
under `lib/` or the entry points actually calls `hashStream` -- it appears
to be a public API convenience (documented in the README, re-exported from
`./hash`) with no internal caller found in this codebase.

**Important gap found by reading the code, not assumed:** on the archive
read path (`lib/from-archive.mjs` and `browser.mjs`'s `fromArchive`), the
hash is **not recomputed or verified against `data`** -- it's read straight
out of the decoded CBOR object (`hash: value.hash`) and trusted as-is. So
`FileEntry.hash` is a genuine content hash only on the write/walk path
(`fromDirectory`/`LazyFileMap`); once a `Map` has round-tripped through an
archive, the hash is just carried metadata that nothing has re-verified
against the bytes sitting next to it in the same entry. This matters
because the hash is later used as an HTTP `ETag` (see §6) -- a corrupted or
hand-edited archive entry (mismatched `data`/`hash`) would silently serve
the wrong `ETag` for its actual content with no detection anywhere in this
codebase.

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
| 2 | Archive bytes: `gzip(cbor({path: FileEntry}))` | `toArchive` (`lib/to-archive.mjs`, `browser.mjs`) | `fromArchive` (`lib/from-archive.mjs`, `browser.mjs`), `packfile.mjs` CLI |
| 3 | Hash: SHA-256 hex string | `hashBuffer`/`hashStream` (`lib/hash.mjs`), inlined into `fromDirectory`/`LazyFileMap` | `lib/response.mjs` (ETag), `cache.mjs` (`withCache`, independently) |
| 4 | Compression: gzip (Node `zlib` / Web `CompressionStream`) | `lib/compression.mjs`, `lib/compression.browser.mjs` | `toArchive`/`fromArchive` and their `browser.mjs` counterparts |
| 5 | MIME lookup table | `lib/mime.mjs` | `lib/response.mjs` |
| 6 | `Response` bridge | `lib/response.mjs` | `lib/create-router.mjs` |
| 7 | Router request-matching (alias → strip `/` → extension fallback) | `lib/create-router.mjs` | `packfile.mjs` CLI `serve`, any caller of `createRouter()` |

## Loose ends found while writing this document

These are genuine observations from reading the code, not tasks this
document is asking anyone to fix:

- `browser.mjs` reimplements the archive encode/decode and path-safety
  logic independently of `lib/to-archive.mjs`/`lib/from-archive.mjs`
  rather than sharing it, and the two `isSafePath()` implementations have
  already diverged in strictness (§2).
- `browser.mjs`'s `toArchive` silently ignores `compressionLevel` (§2, §4).
- Archive-loaded `FileEntry.hash` values are never verified against
  `data` (§3) -- the hash is only a true content hash on the
  directory-read path.
- `lib/from-archive.mjs` has a comment, `// Handle legacy archives that
  have type: "content" field`, directly above code that does not check
  for or handle any `type` field at all -- this looks like a leftover from
  the older `FileInfo { type: "content" | "large-file" }` shape the
  CHANGELOG says was removed during the split-file migration, and appears
  to be stale.
- `hashStream()` (`lib/hash.mjs`) is exported and documented in the
  README but has no caller anywhere else in this codebase (source or
  tests) -- it may be intended purely as public API for consumers who have
  a stream rather than a buffer.

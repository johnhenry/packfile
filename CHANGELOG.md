# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project will adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it reaches 1.0.0.

## [Unreleased]

## [0.1.0] - 2026-10-12

Browser-app release (consumed by p2pws for importing/exporting `.wbn` apps).
Refs [#7](https://github.com/johnhenry/packfile/issues/7).

### Added

- **`fromFiles(files)` / `toFiles(map, { decodeText })`** in `.` and `./browser`:
  adapters between `{ [path]: string | Uint8Array }` and `Map<path, {data,size,hash}>`
  (Web Crypto SHA-256, identical to `hashBuffer()`).
- **Hardened `fromArchive()` in `./browser`** for untrusted bundles: `maxEntries`
  (10,000) and `maxTotalSize` (256 MiB, enforced while streaming the gunzip so
  bombs are cut off), `unsafePaths: "throw" | "skip"`, and typed errors
  `PackfileError` / `InvalidPathError` / `ArchiveLimitError` /
  `InvalidArchiveError` (exported from both entries) with stable `code`s.
  `DEFAULT_LIMITS` exported.
- **Types for every subpath**: `./compat`, `./cache`, `./hash`, `./compression`,
  `./web-bundle` (closes #7), plus the new APIs. The typecheck fixture now
  runs with `skipLibCheck: false`, which also exposed and fixed the existing
  `.d.ts` files importing `./types` without a file extension (unresolvable
  under NodeNext, previously masked).
- **`createBlobPreview`: relative ES-module import rewriting.** Static
  `import`/`export ... from`, side-effect imports and string-literal
  `import()` in JS files now point at dependency blob URLs, in module-graph
  order, via `es-module-lexer`'s pure-JS build. Cycles are reported through
  `onUnresolvedReference` and left unrewritten; new reason `"unparseable"`.

### Changed

- **Behavior (browser): `fromArchive()` now throws `InvalidPathError` on an
  unsafe entry by default** instead of silently skipping it; pass
  `{ unsafePaths: "skip" }` for the old behavior.
- **Behavior (browser): `toArchive()` always resolves to a `Uint8Array`**
  (was an `ArrayBuffer` when compressing).
- Both entries accept `compress` and `compressed` in `toArchive` and
  `fromArchive` (canonical: `compress` for `toArchive`, `compressed` for
  `fromArchive`); contradictory values throw.
- Archive path validation is one shared module (`lib/path-safety.mjs`) for the
  Node and browser readers; it percent-decodes before checking (`%2e%2e`,
  `%5c`, `%00`), and no longer rejects harmless names like `a..b`.
- `toArchive()` percent-encodes each path segment, so names containing `#`,
  `?`, `%` or spaces round-trip exactly.
- `createBlobPreview`: JS blobs now contain rewritten source (previously the
  original, unmodified text).

### Fixed

- **CI never actually ran `typecheck`.** The #5 fix added a `typecheck`
  script (`tsc --project test/types-fixture/tsconfig.json`) but never wired
  it into either `ci.yml` or `publish.yml` -- a regression in the type
  declarations added by that fix could have shipped undetected. Both
  workflows now run it alongside `npm test`.
- **`publish.yml` had no redundant `push: tags` trigger**, unlike every
  sibling package in this family -- a release created very soon after a
  push/merge to the same commit can silently drop the `release` event (see
  `@johnhenry/fileable`'s `publish.yml` for the full incident writeup).
  Added the same tag-push fallback, safe to double-fire thanks to the
  existing `npm view` idempotency guard.
- Also discovered while wiring up a first-ever npm publish for this
  package: it had never actually been registered in the family's
  npm-tokens request registry, so its `NPM_TOKEN` secret had no
  permission for the scoped package name at all (a real `E404` on
  publish). Unrelated to the code in this repo -- tracked and fixed in
  the ecosystem notebook, not here.

## [0.0.1] - 2026-09-26

### Fixed

- **`./browser` and `./blob-preview` had no `types` condition in `exports`
  and no `.d.ts` file on disk at all** ([#5](https://github.com/johnhenry/packfile/issues/5)),
  so `import { toArchive, fromArchive, createRouter } from
  '@johnhenry/packfile/browser'` (and the `./blob-preview` equivalent) was
  untyped -- TS7016, "implicitly has an 'any' type" -- under any resolver
  that actually consults the `exports` map (`moduleResolution: "nodenext"`/
  `"bundler"`; the repo's own `tsconfig.json` uses the older `"node"`
  resolution, which doesn't consult `exports` at all and so never surfaced
  this). Added `browser.d.ts` and `blob-preview.d.ts`, declaring each
  subpath's *actual* runtime exports rather than reusing the Node `.`
  entry's types wholesale, because they're not identical:
  `createRouter` is the literal same implementation across `.` and
  `./browser` (both import `lib/create-router.mjs`), but `./browser`'s
  `toArchive()`/`fromArchive()` are a separate implementation from the
  Node entry's, with real divergences -- most notably, `toArchive()`
  returns an `ArrayBuffer` (or a `Uint8Array` when called with
  `{ compressed: false }`), never the `Buffer` the Node entry's
  `toArchive()` always returns, and the options key is `compressed`, not
  `compress`. `blob-preview.d.ts` duplicates (rather than imports)
  `@johnhenry/andbox`'s `VirtualModuleRegistry` interface, since that
  package has the same missing-`types`-condition problem this fix
  addresses here -- importing its type would have just traded one
  unresolvable type for another. A regression fixture
  (`test/types-fixture/`, run via the new `npm run typecheck`) imports
  both subpaths by their published package name and type-checks under
  `moduleResolution: "nodenext"`, confirmed to fail with TS7016 before
  this fix and pass after.
- Documented in the README (`## Browser Usage`, `## Exports`) that
  `./browser`'s `toArchive()` returns an `ArrayBuffer`/`Uint8Array`, not a
  `Buffer`, and that `./compat`, `./cache`, `./hash`, `./compression`, and
  `./web-bundle` remain unfixed instances of the same missing-`types`-
  condition gap.

## [0.0.0] - 2026-09-22

### Changed (breaking)

- **Renamed the package from `lemem` to `@johnhenry/packfile`**, prior to
  any npm release (never previously published, so no provenance-note
  version restart is needed -- this is simply the first published name).
  The CLI binary `lemem` (`lemem.mjs`) is renamed to `packfile`
  (`packfile.mjs`) to match. `engines.node` set to `>=26.0.0`, matching
  the rest of the `@johnhenry/*` family's floor.
- **The archive format moved wholesale from a bespoke `gzip(cbor(flat
  object))` to `gzip(application/webbundle)`, via the real, Google-maintained
  `wbn` package -- the `cbor` dependency is gone entirely.** Not an
  incremental change or an opt-in `formatVersion`: this package was
  originally built with `wbn`/Web Bundles in mind, then moved to the
  bespoke CBOR format when Web Bundles looked effectively abandoned; IWA
  (Isolated Web Apps) gave the format renewed, active life, which removed
  the reason for the bespoke format to exist at all. `toArchive()`/
  `fromArchive()` (and `compileDirectory()`/`decompileDirectory()`,
  `createRouter()`, the CLI's `compress`/`decompress`/`serve` commands) keep
  their exact existing signatures -- this is invisible at the API level --
  but an archive written by a previous version of this package is **not**
  readable by this one, and vice versa; there was no external consumer to
  preserve compatibility for (0.0.0, never published). Two real correctness
  properties came along as a side effect of the migration, not as separate
  deliberate fixes: (1) `FileEntry.hash` on the archive-read path is now
  always *recomputed* from the actual response body (a Web Bundle exchange
  has no hash field to misplace trust in, unlike the old format's `hash:
  value.hash`, read straight from the decoded object and never verified
  against `data`); (2) `browser.mjs`'s independent CBOR
  encode/decode/path-safety implementation (previously a real, documented
  divergence risk from the Node side -- see FORMATS.md) now uses the same
  `wbn` package and the same `isSafePath()` algorithm as the Node side, so
  an archive built in one environment is directly readable in the other --
  verified for real, both directions (`test.mjs`, "browser.mjs
  toArchive/fromArchive"). See FORMATS.md §2 for the full writeup, including
  what's still deliberately platform-specific (hashing: Node's synchronous
  `crypto.createHash` vs. Web Crypto's async `crypto.subtle.digest`;
  compression: Node `zlib` vs. `CompressionStream`) and what wasn't touched
  (`browser.mjs`'s `toArchive` still silently drops `compressionLevel` --
  `CompressionStream` has no level parameter to plumb one through to).
  `@johnhenry/packfile/web-bundle` (`lib/web-bundle.mjs`) -- previously
  experimental -- is the engine underneath this migration; it's also still
  directly reachable for callers who want the lower-level control
  `toArchive`/`fromArchive` deliberately hide (a real `baseURL`, custom
  `headers()`, IWA signing via `wbn-sign`, and `createWebBundleRouter()` for
  serving a bundle's own real headers verbatim instead of `createRouter()`'s
  synthesized ones -- all unchanged from when they were added, see below).

### Added

- **`@johnhenry/packfile/web-bundle`** (`lib/web-bundle.mjs`):
  `toWebBundle()`/`fromWebBundle()` convert between this package's own
  `FilesMap` and the `application/webbundle` format Chrome's Isolated Web
  Apps are built on, via the real `wbn`/`wbn-sign` npm packages (no format
  reimplementation) -- now also the engine `toArchive()`/`fromArchive()`
  are built on (see "Changed (breaking)" above). Verified against real
  interop, not just self-consistency: `toWebBundle()`'s output is
  cross-checked against `wbn`'s own `Bundle` parser directly, and signed
  with `wbn-sign`'s real `SignedWebBundle` using a real generated Ed25519
  key pair (`test.mjs`, "toWebBundle / fromWebBundle"). Also adds
  `createWebBundleRouter(bundle, options)`: serves a parsed `wbn.Bundle`
  directly, same router contract as `createRouter()` (`alias`,
  `tryExtensions`, `fallback`, `.fetch`), but returns each exchange's own
  baked-in status/headers verbatim instead of resynthesizing
  Content-Type/Cache-Control/ETag the way `createRouter()` does for a
  `FileEntry` -- `createRouter(fromWebBundle(...))` already works too (no
  new code needed, since `fromWebBundle()` returns a real `FilesMap`), but
  that path discards whatever headers were actually baked into the bundle.
  `new wbn.Bundle(buffer)` decodes the entire bundle eagerly in its
  constructor (confirmed by reading `wbn`'s own decoder) -- unlike
  `fromDirectoryLazy()`'s `LazyFileMap`, there's no lazy/streaming read path
  in `wbn` itself, so this is a "parse once, reuse the instance" story, not
  an on-demand one.
- **`lemem/blob-preview`** (`lib/blob-preview.mjs`, `createBlobPreview()`): hosts a `FilesMap` inside a browser tab/iframe with no server at all, by minting one `blob:` URL per file and rewriting HTML (`href`/`src`/`srcset`/`poster`/`formaction`) and CSS (`url(...)`/`@import`) references to point at the right blob URL. JS specifier resolution is delegated to the new `@johnhenry/andbox` dependency's `createVirtualModuleRegistry()` rather than reimplemented. This is the lighter-weight of two designs considered ("Approach B") — good enough for trusted/your-own content, not a general solution for arbitrary content; a real Service-Worker-based hosting mode ("Approach A") is deferred and tracked as `andbox#14`. Handles reference cycles (including self-links and mutually-linking pages) by leaving the edge that closes the cycle unrewritten rather than pointing it at a stale blob, since blob content is immutable once minted — see the README's "What this does and does not solve" section for the full breakdown.

### Fixed

- **The repository was in a broken, half-migrated state**: the last commit before this changeset rewrote `index.mjs`/`package.json`/`readme.md` to point at a new split-file architecture (`lib/from-directory.mjs`, `lib/from-directory-lazy.mjs`, `lib/to-archive.mjs`, `lib/create-router.mjs`, `lib/hash.mjs`, `compat.mjs`) but never committed those files — `npm test` failed immediately with `ERR_MODULE_NOT_FOUND`, and no test could run. Reconstructed the missing implementation from a matching, complete fork.
- **CBOR archive roundtrip could silently truncate data**: `cbor.encode()` (and `cbor.encodeOne()`) resolve before their internal stream finishes flushing under Node v26, truncating output to a near-empty buffer (e.g. `<Buffer a1>`, just the CBOR map header) with no error. Switched `toArchive()` to `cbor.encodeAsync()`, which correctly awaits full completion — verified truncation-free across a 200-iteration stress test with varied archive sizes.
- Demo (`demo/server.mjs`) and CLI (`lemem.mjs serve`) both referenced `express`, which had already been dropped as a dependency, and both called `createRouter()` with the old, no-longer-valid `(compiledData: Buffer, {compressed})` signature instead of the real `(filesMap, {alias, ...})`. Rewrote both against the current API using `node:http`.
- The CLI's default compression level fell back to `zlib.constants.Z_DEFAULT_COMPRESSION` (`-1`), which then failed the CLI's own `0–9` range validation — the default path was unusable.
- **Symlink escape** (security): `fromDirectory()`/`fromDirectoryLazy()` followed symlinks without checking their target — a symlink inside the archived directory pointing outside its root (e.g. to `/etc/passwd`) had its target's contents silently packaged into the archive.
- **Symlink cycle** (security/DoS): a self-referential symlink (e.g. `ln -s . loop`) inside the archived directory caused unbounded recursion until the OS's `ELOOP` limit crashed the entire archiving call — a single crafted directory could crash any process calling `fromDirectory()` on untrusted input. Both symlink issues fixed together via real-path resolution and ancestor-chain cycle detection.
- **Prototype pollution in Content-Type lookup** (security): `getContentType()` looked up extensions in a plain object (`MIME_TYPES[extension]`), so a file named e.g. `report.constructor` or `image.__proto__` resolved to an inherited `Object.prototype` property instead of `undefined`, producing a broken/leaked `Content-Type` header. Fixed with `Object.hasOwn()` checks.
- **Archive path-validation gap** (security): `isSafePath()` accepted archive entry keys that normalize to the current directory itself (empty string, `"."`, `"a/.."`). `decompileDirectory()` on such an archive would `writeFile()` onto the output directory's own path, replacing it with a plain file and corrupting all subsequent writes in the same operation. Such keys are now rejected.
- `types.d.ts`/`types.ts` described an old API (`createRouter(compiledData: Buffer, {compressed, streamThreshold})`, a `FileInfo{type:"content"|"large-file"}` shape) that no longer exists. Rewritten to match the real, current runtime API. Neither file was previously listed in `package.json`'s `files` array (would have been silently omitted from `npm publish`); both are now included, and a top-level `"types"` field was added (previously absent entirely).
- README's placeholder repo URL (`github.com/your-username/lemem`) corrected to `github.com/johnhenry/lemem`.

### Removed

- Deleted `lib/server.mjs`, `lib/represents.mjs`, `lib/browser.mjs`, and root `compression.mjs` — orphaned leftovers from the abandoned pre-migration architecture, confirmed unreferenced.

### Added

- `LICENSE` file (MIT) — was declared in `package.json` and listed in `files`, but didn't exist.
- `description` in `package.json` (previously empty).
- `test.mjs` rewritten to cover the current API: `fromDirectory`, roundtrip (including the CBOR-truncation regression), `fromDirectoryLazy`, `createRouter` across all three tiers (in-memory Map, archive-restored Map, `LazyFileMap`), the compat layer, and the security fixes above.

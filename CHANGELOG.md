# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project will adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it reaches 1.0.0.

## [Unreleased]

### Added

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

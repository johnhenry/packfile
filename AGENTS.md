# Agent playbook

`@johnhenry/packfile` — content-addressed static-file archiver and
in-memory HTTP router. Single package, Node >= 26, `node --test`
(`npm test`, runs `test.mjs`), ships source directly -- no build step,
`main`/`exports` point straight at `index.mjs`/`lib/*.mjs`. The library is
mostly platform-agnostic (Node and browser entrypoints share the same wire
format), so a change to the archive format touches both `lib/web-bundle.mjs`
(Node) and `browser.mjs` (browser) -- see the gotcha below about them having
drifted before.

`CLAUDE.md` in this directory is a symlink to this file.

## The verification loop (before every push)

1. `npm test` -- `node --test test.mjs`. No suite here is allowed to SKIP.
2. `npm pack --dry-run` -- read the file list, not just the exit code;
   `files` is `index.mjs`, `browser.mjs`, `compat.mjs`, `cache.mjs`,
   `packfile.mjs`, `lib/`, `types.d.ts`, `types.ts`, `README.md`, `LICENSE`.
3. A genuinely fresh clone:
   `git clone . /tmp/packfile-verifyN && cd $_ && npm ci && npm test`.
   This is the only way to catch "works on my checked-out tree" bugs
   (missing `files` entries, undeclared deps).
4. Exercise the CLI end to end at least once after a format-affecting
   change: `node packfile.mjs compress ./demo/static ./out.wbn && node
   packfile.mjs decompress ./out.wbn ./out-dir && node packfile.mjs serve
   ./out.wbn`.
5. Commit, push, close the issue with a comment naming the commit SHA.

CI (`.github/workflows/ci.yml`) runs `npm test`; match it locally.

## Repo-specific gotchas

- **Two separate gzip/archive implementations (Node and browser) can drift
  silently.** `browser.mjs`'s archive logic diverged from the Node
  implementation it duplicates once already (documented in `FORMATS.md`).
  A format-affecting change to `lib/web-bundle.mjs`/`lib/to-archive.mjs`/
  `lib/from-archive.mjs` needs the equivalent change checked against
  `browser.mjs`, not assumed to be shared code.
- **Path safety for decoded archive entries lives in one place:
  `isSafePath()` in `lib/web-bundle.mjs`.** A relative key that would
  escape the `baseURL` (leading slash, `..`, a NUL byte, empty/`.`) is
  silently skipped by `fromWebBundle()`, not an error -- don't duplicate a
  second, differently-shaped check elsewhere; extend this one instead.
- **`toWebBundle`/`fromWebBundle`'s `baseURL` is internal-only for the
  `toArchive`/`fromArchive` entrypoints** (`ARCHIVE_BASE_URL`, a fixed
  `https://packfile.invalid/`) -- a real, resolvable `baseURL` is only
  needed at the `./web-bundle` subpath, for actual IWA signing. Don't wire
  a caller-supplied `baseURL` into `toArchive()`/`fromArchive()` without
  re-reading `FORMATS.md` §2 first.
- **`createBlobPreview()` is for trusted content only**, not a general
  arbitrary/untrusted-content solution -- see README's "What this does and
  does not solve" and `## Security model`. Don't extend its promises
  without updating both.

## Definition of done

A change is done when all of the following hold, not just when tests pass:

- A regression test exists for any bug fixed.
- Anything the feature does **not** do is stated in the README, not only
  in an issue comment.
- `CHANGELOG.md` has an entry citing the commit/PR.
- A format-affecting change updates `FORMATS.md` too, not just the code.

## Releases

Bump `version` in `package.json` in a PR, add the `CHANGELOG.md` entry, merge,
then `gh release create v<version>` — the release event triggers
`.github/workflows/publish.yml`, which is idempotent (skips if the version is
already on npm).

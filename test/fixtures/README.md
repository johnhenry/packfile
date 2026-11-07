# Test fixtures

Not published: `package.json` `files` does not include `test/`.

## `sitefile-0.0.0.wbn`

A Web Bundle written by the **published** `@johnhenry/sitefile@0.0.0` (its
`--version` prints `0.1.0`, but the npm package is `0.0.0`). It is read by
`test/sitefile-fixture.test.mjs` (packfile#19). It is an **uncompressed
b2 Web Bundle**, not packfile's own gzip-wrapped archive format, so it goes
through `fromWebBundle()` from `lib/web-bundle.mjs`, not `fromArchive()`.
The test also gzips it and reads it with plain `fromArchive(buffer)`: since
packfile#22 (unreleased), `fromArchive()` takes its base from the bundle's
primary URL, `https://site.example/` here.

`sitefile-0.0.0.json` lists the expected files (as `fromWebBundle(buf, {
baseURL: "https://site.example/" })` keys them), with their byte sizes and
SHA-256 digests, plus the digest of the `.wbn` itself. The digests were
taken from a `--format directory` build of the same context, not from the
bundle.

The bundle has 5 exchanges: the four files plus `https://site.example/`
itself (Sitefile's copy of `index.html` at the base URL). `fromWebBundle()`
skips the base URL by design (its relative path is empty), so the read
result is the four files.

### Context

```
Sitefile
templates/index.html
public/style.css
public/bin/bytes.bin          # bytes 0x00..0xff, 256 bytes
public/docs/ünï/page.html     # NFC path
```

`Sitefile`:

```
LET TITLE = "Tom & Jerry <packfile>"
COPY ./public/style.css /style.css
COPY ./public/bin/bytes.bin /bin/bytes.bin
COPY ./public/docs/ /docs/
RENDER --escape=html ./templates/index.html TO /index.html
EXPORT / AS directory
```

### Regenerating

Run this outside the repo (it writes nothing to `~/.sitefile`), then copy
`sitefile-0.0.0.wbn` here and update `sitefile-0.0.0.json` with the new
sizes and digests (`shasum -a 256` of each file in `expected-dir/`). When
Sitefile's format changes (johnhenry/sitefile#143, #144), add a new fixture
named for the new version rather than replacing this one.

```sh
set -e
T=$(mktemp -d) && cd "$T"
export SITEFILE_HOME="$T/home"
mkdir -p ctx/public/bin "ctx/public/docs/ünï" ctx/templates
printf 'body { color: #333; }\n' > ctx/public/style.css
node -e 'process.stdout.write(Buffer.from(Array.from({length:256},(_,i)=>i)))' > ctx/public/bin/bytes.bin
printf '<!doctype html>\n<title>Ünïcode</title>\n<p>héllo wörld</p>\n' > "ctx/public/docs/ünï/page.html"
printf '<!doctype html>\n<link rel="stylesheet" href="/style.css">\n<h1>${TITLE}</h1>\n' > ctx/templates/index.html
cat > ctx/Sitefile <<'EOF'
LET TITLE = "Tom & Jerry <packfile>"
COPY ./public/style.css /style.css
COPY ./public/bin/bytes.bin /bin/bytes.bin
COPY ./public/docs/ /docs/
RENDER --escape=html ./templates/index.html TO /index.html
EXPORT / AS directory
EOF
npx -y @johnhenry/sitefile@0.0.0 build ctx --format wbn --base-url https://site.example/ -o sitefile-0.0.0.wbn
npx -y @johnhenry/sitefile@0.0.0 build ctx --format directory -o expected-dir
```

Sitefile's builds are deterministic: two runs gave the same 951-byte bundle,
`sha256:eeb0a1de43f5fd69e1f32ea258898f6ac81357bc6f42e7d384b840a0bb59c929`.

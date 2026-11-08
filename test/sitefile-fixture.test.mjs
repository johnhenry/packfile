// packfile#19: a Web Bundle written by @johnhenry/sitefile, read on this side.
//
// The fixture was built by the published `sitefile@0.0.0 build ... --format
// wbn --base-url https://site.example/` (see test/fixtures/README.md for the
// exact Sitefile and command). Sitefile's bundles are plain, UNCOMPRESSED b2
// Web Bundles, not packfile's own gzip-wrapped archive format, so they are
// read with `fromWebBundle()` from lib/web-bundle.mjs, not `fromArchive()`.
// The expected sizes and digests in sitefile-0.0.0.json come from a
// `--format directory` build of the same context, not from this bundle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as wbn from "wbn";
import { fromWebBundle } from "../lib/web-bundle.mjs";
import { gzipSync } from "node:zlib";
import { createRouter, fromArchive } from "../index.mjs";

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const buffer = new Uint8Array(readFileSync(fixture("sitefile-0.0.0.wbn")));
const expected = JSON.parse(readFileSync(fixture("sitefile-0.0.0.json"), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const BASE = "https://site.example/";

await test("sitefile@0.0.0 Web Bundle fixture", async (t) => {
  await t.test("is the checked-in bundle, an uncompressed b2 bundle", () => {
    assert.equal(buffer.byteLength, expected.bundleSize);
    assert.equal(sha256(buffer), expected.bundleSha256);
    // Not gzip (packfile's archive format starts 1f 8b).
    assert.notDeepEqual([...buffer.subarray(0, 2)], [0x1f, 0x8b]);
    const bundle = new wbn.Bundle(buffer);
    assert.equal(bundle.version, "b2");
    assert.equal(bundle.primaryURL, BASE);
  });

  await t.test("the base-URL exchange is the index page, and is not a file", () => {
    // Sitefile also writes the index page at the bare base URL. Its relative
    // path is empty, so fromWebBundle() skips it (lib/path-safety.mjs).
    const bundle = new wbn.Bundle(buffer);
    assert.equal(bundle.urls.length, Object.keys(expected.files).length + 1);
    assert.deepEqual(bundle.getResponse(BASE).body, bundle.getResponse(`${BASE}index.html`).body);
  });

  await t.test("fromWebBundle reads exactly the expected paths, sizes and digests", () => {
    const map = fromWebBundle(buffer, { baseURL: BASE });
    assert.deepEqual([...map.keys()].sort(), Object.keys(expected.files).sort());
    for (const [path, { size, sha256: digest }] of Object.entries(expected.files)) {
      const entry = map.get(path);
      assert.equal(entry.size, size, `${path} size`);
      assert.equal(entry.data.byteLength, size, `${path} data length`);
      assert.equal(entry.hash, digest, `${path} hash`);
      assert.equal(sha256(entry.data), digest, `${path} bytes`);
    }
  });

  await t.test("fromArchive reads it gzipped, with no options (base from the primary URL, #18)", async () => {
    const map = await fromArchive(new Uint8Array(gzipSync(buffer)));
    assert.deepEqual([...map.keys()].sort(), Object.keys(expected.files).sort());
    for (const [path, { sha256: digest }] of Object.entries(expected.files)) {
      assert.equal(map.get(path).hash, digest, `${path} hash`);
    }
    // Uncompressed, too, and an explicit baseURL gives the same result.
    const plain = await fromArchive(buffer, { compressed: false, baseURL: BASE });
    assert.deepEqual([...plain.keys()].sort(), Object.keys(expected.files).sort());
  });

  await t.test("createRouter serves the pages, the binary, and 404s", async () => {
    const router = createRouter(fromWebBundle(buffer, { baseURL: BASE }));

    const page = await router(new Request(`${BASE}index.html`));
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("content-type"), "text/html");
    const html = new Uint8Array(await page.arrayBuffer());
    assert.equal(sha256(html), expected.files["index.html"].sha256);
    // RENDER --escape=html escaped the title.
    assert.match(new TextDecoder().decode(html), /<h1>Tom &amp; Jerry &lt;packfile&gt;<\/h1>/);

    const css = await router("/style.css");
    assert.equal(css.status, 200);
    assert.equal(css.headers.get("content-type"), "text/css");
    assert.equal(sha256(new Uint8Array(await css.arrayBuffer())), expected.files["style.css"].sha256);

    const bin = await router(new Request(`${BASE}bin/bytes.bin`));
    assert.equal(bin.status, 200);
    assert.equal(bin.headers.get("content-type"), "application/octet-stream");
    assert.deepEqual(new Uint8Array(await bin.arrayBuffer()), Uint8Array.from({ length: 256 }, (_, i) => i));

    // The non-ASCII page is served for a real Request (percent-encoded
    // pathname, decoded by createRouter since #20) as well as by string path.
    assert.equal((await router("/docs/ünï/page.html")).status, 200);
    const nested = await router(new Request(`${BASE}docs/ünï/page.html`));
    assert.equal(nested.status, 200);
    assert.equal(nested.headers.get("content-type"), "text/html");
    assert.equal(sha256(new Uint8Array(await nested.arrayBuffer())), expected.files["docs/ünï/page.html"].sha256);

    const missing = await router(new Request(`${BASE}missing.html`));
    assert.equal(missing.status, 404);
  });
});

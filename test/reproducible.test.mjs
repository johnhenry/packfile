// #27: toArchive() bytes depend only on the files -- not on Map insertion
// order (readdir order differs per file system) or on the platform zlib's
// gzip OS byte (19 on macOS, 3 on Linux).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as node from "../index.mjs";
import * as browser from "../browser.mjs";
import { toWebBundle } from "../lib/web-bundle.mjs";
import { compressObject } from "../lib/compression.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const FILES = {
  "index.html": "<!doctype html><title>t</title><script type=module src=app.js></script>",
  "app.js": "export const x = 1;\n",
  "assets/logo.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
  "docs/ünï/page.html": "<p>ünï</p>",
  "Z.txt": "upper-case sorts before lower-case in code-unit order",
};

const build = async (lib, keys) => {
  const map = await lib.fromFiles(FILES);
  return new Map(keys.map((k) => [k, map.get(k)]));
};

const forward = Object.keys(FILES);
const reversed = [...forward].reverse();

// Recorded on macOS (Node 26, bundled zlib); CI on Linux must reproduce them.
const PLAIN_SHA256 = "a0a49a26076d546812530278ff791121bcb3d483727d6373f126ecba1c06e3b6";
const GZIP_SHA256 = "b5d34191c2c6b44fcf94d3784bead0fb41a63d0ca4b41da6c72e6f194750e35a";

for (const [name, lib] of [["node entry", node], ["browser entry", browser]]) {
  await test(`${name}: toArchive is reproducible`, async (t) => {
    await t.test("two insertion orders give identical bytes (plain and gzip)", async () => {
      const a = await build(lib, forward);
      const b = await build(lib, reversed);
      assert.deepEqual([...a.keys()], forward);
      assert.deepEqual([...b.keys()], reversed);
      assert.equal(sha256(await lib.toArchive(a, { compress: false })), sha256(await lib.toArchive(b, { compress: false })));
      assert.equal(sha256(await lib.toArchive(a)), sha256(await lib.toArchive(b)));
    });

    await t.test("gzip header: MTIME 0, OS byte 3 (Unix) on every platform", async () => {
      const bytes = await lib.toArchive(await build(lib, forward));
      assert.deepEqual([...bytes.subarray(0, 4)], [0x1f, 0x8b, 8, 0]);
      assert.deepEqual([...bytes.subarray(4, 8)], [0, 0, 0, 0]);
      assert.equal(bytes[9], 3);
    });

    await t.test("matches the digests recorded on another machine", async () => {
      const map = await build(lib, reversed);
      assert.equal(sha256(await lib.toArchive(map, { compress: false })), PLAIN_SHA256);
      assert.equal(sha256(await lib.toArchive(map)), GZIP_SHA256);
    });

    await t.test("still round-trips", async () => {
      const back = await lib.fromArchive(await lib.toArchive(await build(lib, reversed)));
      assert.deepEqual([...back.keys()].sort(), [...forward].sort());
    });
  });
}

await test("node entry: compressionLevel is honored and also normalized", async () => {
  const map = await build(node, forward);
  const fast = await node.toArchive(map, { compressionLevel: 1 });
  assert.equal(fast[9], 3);
  assert.equal(sha256(await node.toArchive(map, { compressionLevel: 6 })), sha256(await node.toArchive(map)));
});

await test("toWebBundle sorts by path too", () => {
  const e = (s) => ({ data: new TextEncoder().encode(s), size: s.length, hash: "" });
  const a = new Map([["b", e("b")], ["a", e("a")]]);
  const b = new Map([["a", e("a")], ["b", e("b")]]);
  const opts = { baseURL: "https://example.com/" };
  assert.equal(sha256(toWebBundle(a, opts)), sha256(toWebBundle(b, opts)));
});

await test("./compression: compressObject writes OS byte 3", async () => {
  const out = await compressObject(new TextEncoder().encode("hello"));
  assert.equal(out[9], 3);
});

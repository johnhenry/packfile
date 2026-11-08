// #28: fromArchive() defaults to compressed: "auto" (gzip magic bytes).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as node from "../index.mjs";
import * as browser from "../browser.mjs";
import { decompileDirectory } from "../compat.mjs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dec = new TextDecoder();
const FILES = { "index.html": "<h1>hi</h1>", "a/b.txt": "b" };

for (const [name, lib] of [["node entry", node], ["browser entry", browser]]) {
  await test(`${name}: fromArchive compressed: "auto"`, async (t) => {
    const map = await lib.fromFiles(FILES);
    const gz = await lib.toArchive(map);
    const plain = await lib.toArchive(map, { compress: false });
    assert.deepEqual([gz[0], gz[1]], [0x1f, 0x8b]);
    assert.notEqual(plain[0], 0x1f);

    const check = (files) => {
      assert.deepEqual([...files.keys()].sort(), ["a/b.txt", "index.html"]);
      assert.equal(dec.decode(files.get("index.html").data), "<h1>hi</h1>");
    };

    await t.test("default reads gzip", async () => check(await lib.fromArchive(gz)));
    await t.test("default reads a plain Web Bundle", async () => check(await lib.fromArchive(plain)));
    await t.test("explicit \"auto\" on both, and via the alias", async () => {
      check(await lib.fromArchive(gz, { compressed: "auto" }));
      check(await lib.fromArchive(plain, { compressed: "auto" }));
      check(await lib.fromArchive(plain, { compress: "auto" }));
    });
    await t.test("ArrayBuffer input", async () => {
      check(await lib.fromArchive(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength)));
      check(await lib.fromArchive(plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength)));
    });
    await t.test("explicit true/false still force", async () => {
      check(await lib.fromArchive(gz, { compressed: true }));
      check(await lib.fromArchive(plain, { compressed: false }));
      await assert.rejects(lib.fromArchive(plain, { compressed: true }));
      await assert.rejects(lib.fromArchive(gz, { compressed: false }));
    });
    await t.test("bad values and conflicting aliases throw TypeError", async () => {
      await assert.rejects(lib.fromArchive(gz, { compressed: "gzip" }), TypeError);
      await assert.rejects(lib.fromArchive(gz, { compressed: "auto", compress: true }), TypeError);
      await assert.rejects(lib.fromArchive(gz, { compressed: "auto", compress: false }), TypeError);
    });
  });
}

await test("browser entry: maxTotalSize still bounds an auto-detected plain bundle", async () => {
  const plain = await browser.toArchive(await browser.fromFiles(FILES), { compress: false });
  await assert.rejects(browser.fromArchive(plain, { maxTotalSize: 10 }), browser.ArchiveLimitError);
});

await test("decompileDirectory defaults to auto", async () => {
  const dir = await mkdtemp(join(tmpdir(), "packfile-auto-"));
  try {
    const plain = await node.toArchive(await node.fromFiles(FILES), { compress: false });
    await decompileDirectory(plain, dir);
    assert.equal(await readFile(join(dir, "a/b.txt"), "utf8"), "b");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

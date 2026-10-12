import { test } from "node:test";
import assert from "node:assert/strict";
import * as wbn from "wbn";
import { gzipSync } from "node:zlib";
import * as node from "../index.mjs";
import * as browser from "../browser.mjs";

const dec = new TextDecoder();
const enc = new TextEncoder();
const BASE = "https://packfile.invalid/";

/** Build a (gzipped, by default) bundle with raw exchange URLs, bypassing toArchive()'s path handling. */
const rawArchive = (entries, { gzip = true } = {}) => {
  const b = new wbn.BundleBuilder();
  for (const [suffix, body = "x"] of entries) {
    b.addExchange(`${BASE}${suffix}`, 200, { "Content-Type": "text/plain" }, body);
  }
  b.setPrimaryURL(BASE);
  const bytes = b.createBundle();
  return gzip ? new Uint8Array(gzipSync(bytes)) : bytes;
};

for (const [name, lib] of [["node entry", node], ["browser entry", browser]]) {
  await test(`${name}: fromFiles / toFiles`, async (t) => {
    await t.test("strings are UTF-8 encoded, Uint8Array passes through, hashes match hashBuffer", async () => {
      const bytes = new Uint8Array([0, 1, 2, 255]);
      const map = await lib.fromFiles({ "index.html": "<h1>héllo</h1>", "bin/x.dat": bytes });
      const html = map.get("index.html");
      assert.equal(dec.decode(html.data), "<h1>héllo</h1>");
      assert.equal(html.size, html.data.byteLength);
      assert.equal(html.hash, node.hashBuffer(Buffer.from(html.data)));
      assert.equal(map.get("bin/x.dat").data, bytes);
      assert.equal(map.get("bin/x.dat").hash, node.hashBuffer(Buffer.from(bytes)));
    });

    await t.test("rejects unsafe keys with InvalidPathError and bad values with TypeError", async () => {
      for (const bad of ["../x", "/abs", "a\\b", "a\0b", "", "a//b", "a/./b", "a/", "C:/x"]) {
        await assert.rejects(() => lib.fromFiles({ [bad]: "x" }), (e) => {
          assert.ok(e instanceof lib.InvalidPathError, `${JSON.stringify(bad)}`);
          assert.equal(e.code, "ERR_PACKFILE_INVALID_PATH");
          assert.equal(e.path, bad);
          return true;
        });
      }
      await assert.rejects(() => lib.fromFiles({ "a.txt": 42 }), TypeError);
      await assert.rejects(() => lib.fromFiles(null), TypeError);
    });

    await t.test("toFiles returns bytes by default, strings with decodeText, and is __proto__-safe", async () => {
      const map = await lib.fromFiles({
        "a.txt": "hi",
        "img.png": new Uint8Array([1, 2]),
        "bad.txt": new Uint8Array([0xff, 0xfe]),
        "__proto__": "evil",
      });
      const raw = lib.toFiles(map);
      assert.ok(raw["a.txt"] instanceof Uint8Array);
      const text = lib.toFiles(map, { decodeText: true });
      assert.equal(text["a.txt"], "hi");
      assert.ok(text["img.png"] instanceof Uint8Array);
      assert.ok(text["bad.txt"] instanceof Uint8Array, "invalid UTF-8 stays bytes");
      assert.equal(Object.getPrototypeOf(text), Object.prototype);
      assert.ok(Object.hasOwn(text, "__proto__"));
      const picked = lib.toFiles(map, { decodeText: (p) => p === "img.png" });
      assert.equal(typeof picked["img.png"], "string");
      assert.ok(picked["a.txt"] instanceof Uint8Array);
    });

    await t.test("round-trips awkward file names through toArchive/fromArchive", async () => {
      const files = { "my file.txt": "1", "a#b/c?d.txt": "2", "ünï/😀.txt": "3", "100%/x+y.txt": "4" };
      const archive = await lib.toArchive(await lib.fromFiles(files));
      const back = lib.toFiles(await lib.fromArchive(archive), { decodeText: true });
      assert.deepEqual(back, files);
    });
  });

  await test(`${name}: compress / compressed option aliases and return types`, async (t) => {
    const map = await lib.fromFiles({ "a.txt": "A".repeat(2000) });
    await t.test("toArchive: compress and compressed are interchangeable", async () => {
      const gz = await lib.toArchive(map);
      const rawA = await lib.toArchive(map, { compress: false });
      const rawB = await lib.toArchive(map, { compressed: false });
      assert.equal(rawA.byteLength, rawB.byteLength);
      assert.ok(gz.byteLength < rawA.byteLength);
      assert.equal((await lib.toArchive(map, { compressed: true })).byteLength, gz.byteLength);
    });
    await t.test("fromArchive: compressed and compress are interchangeable", async () => {
      const rawArch = await lib.toArchive(map, { compress: false });
      for (const opts of [{ compressed: false }, { compress: false }]) {
        assert.equal((await lib.fromArchive(rawArch, opts)).size, 1);
      }
    });
    await t.test("contradictory aliases throw", async () => {
      await assert.rejects(() => lib.toArchive(map, { compress: true, compressed: false }), TypeError);
      await assert.rejects(() => lib.fromArchive(new Uint8Array(1), { compress: true, compressed: false }), TypeError);
    });
    await t.test("always resolves to a Uint8Array (Buffer on Node)", async () => {
      assert.ok((await lib.toArchive(map)) instanceof Uint8Array);
      assert.ok((await lib.toArchive(map, { compress: false })) instanceof Uint8Array);
    });
  });
}

await test("types of the return value differ only by subclass", async () => {
  assert.ok(Buffer.isBuffer(await node.toArchive(await node.fromFiles({ "a": "a" }))));
  assert.ok(!Buffer.isBuffer(await browser.toArchive(await browser.fromFiles({ "a": "a" }))));
});

await test("browser fromArchive: hardened against untrusted input", async (t) => {
  const bad = [
    ["../escape.txt", "traversal"],
    ["a/../../escape.txt", "traversal"],
    ["%2e%2e/escape.txt", "traversal"],
    ["a/%2E%2E/b", "traversal"],
    ["a%5cb.txt", "backslash"],
    ["a\\b.txt", "backslash"],
    ["n%00l.txt", "control-character"],
    ["/etc/passwd", "empty-segment"], // https://packfile.invalid//etc/passwd
    ["a/./b", "dot-segment"],
    ["a%2f%2fb", "empty-segment"],
    ["q?x=1", "query-or-fragment"],
    ["bad%zz", "malformed-encoding"],
  ];
  for (const [suffix, reason] of bad) {
    await t.test(`rejects ${JSON.stringify(suffix)} (${reason})`, async () => {
      const archive = rawArchive([["ok.txt"], [suffix]]);
      await assert.rejects(() => browser.fromArchive(archive), (e) => {
        assert.ok(e instanceof browser.InvalidPathError);
        assert.ok(e instanceof browser.PackfileError);
        assert.equal(e.code, "ERR_PACKFILE_INVALID_PATH");
        assert.equal(e.reason, reason);
        return true;
      });
      const skipped = await browser.fromArchive(archive, { unsafePaths: "skip" });
      assert.deepEqual([...skipped.keys()], ["ok.txt"]);
    });
  }

  await t.test("rejects an exchange outside the archive base URL", async () => {
    const b = new wbn.BundleBuilder();
    b.addExchange("https://evil.example/x.txt", 200, {}, "x");
    b.setPrimaryURL("https://evil.example/x.txt");
    const archive = new Uint8Array(gzipSync(b.createBundle()));
    await assert.rejects(() => browser.fromArchive(archive), { reason: "outside-base" });
  });

  await t.test("rejects duplicates that only collide after percent-decoding", async () => {
    const archive = rawArchive([["a/b"], ["a%2Fb"]]);
    await assert.rejects(() => browser.fromArchive(archive), { reason: "duplicate", code: "ERR_PACKFILE_INVALID_PATH" });
    assert.equal((await browser.fromArchive(archive, { unsafePaths: "skip" })).size, 1);
  });

  await t.test("rejects an invalid unsafePaths option", async () => {
    await assert.rejects(() => browser.fromArchive(rawArchive([["a"]]), { unsafePaths: "ignore" }), TypeError);
  });

  await t.test("maxEntries (default 10,000, configurable)", async () => {
    const archive = rawArchive(Array.from({ length: 11 }, (_, i) => [`f${i}.txt`]));
    await assert.rejects(() => browser.fromArchive(archive, { maxEntries: 10 }), (e) => {
      assert.ok(e instanceof browser.ArchiveLimitError);
      assert.equal(e.code, "ERR_PACKFILE_LIMIT");
      assert.equal(e.limit, "entries");
      assert.equal(e.max, 10);
      return true;
    });
    assert.equal((await browser.fromArchive(archive, { maxEntries: 11 })).size, 11);
    assert.equal(browser.DEFAULT_LIMITS.maxEntries, 10_000);
    assert.equal(browser.DEFAULT_LIMITS.maxTotalSize, 256 * 1024 * 1024);
  });

  await t.test("maxTotalSize stops a decompression bomb while streaming", async () => {
    // 64 MiB of zeros gzips to ~64 KiB: a classic bomb at 1000:1.
    const bomb = rawArchive([["zeros.bin", new Uint8Array(64 * 1024 * 1024)]]);
    assert.ok(bomb.byteLength < 1024 * 1024, `bomb is small on the wire (${bomb.byteLength} B)`);
    await assert.rejects(() => browser.fromArchive(bomb, { maxTotalSize: 1024 * 1024 }), (e) => {
      assert.ok(e instanceof browser.ArchiveLimitError);
      assert.equal(e.limit, "totalSize");
      assert.equal(e.max, 1024 * 1024);
      return true;
    });
    assert.equal((await browser.fromArchive(bomb, { maxTotalSize: 128 * 1024 * 1024 })).size, 1);
  });

  await t.test("maxTotalSize also bounds uncompressed input", async () => {
    const raw = rawArchive([["a.bin", new Uint8Array(4096)]], { gzip: false });
    await assert.rejects(() => browser.fromArchive(raw, { compressed: false, maxTotalSize: 1024 }), { limit: "totalSize" });
  });

  await t.test("garbage input raises InvalidArchiveError, not a raw TypeError/RangeError", async () => {
    await assert.rejects(() => browser.fromArchive(enc.encode("definitely not gzip")), (e) => e instanceof browser.InvalidArchiveError);
    await assert.rejects(
      () => browser.fromArchive(new Uint8Array(gzipSync(enc.encode("gzip but not a web bundle")))),
      (e) => e instanceof browser.InvalidArchiveError && e.code === "ERR_PACKFILE_INVALID_ARCHIVE"
    );
    await assert.rejects(() => browser.fromArchive(new Uint8Array(0)), browser.InvalidArchiveError);
  });

  await t.test("a benign archive still loads with defaults, including ArrayBuffer input", async () => {
    const archive = rawArchive([["ok.txt", "fine"], ["dir/sub.txt", "also fine"]]);
    const ab = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength);
    const map = await browser.fromArchive(ab);
    assert.deepEqual([...map.keys()].sort(), ["dir/sub.txt", "ok.txt"]);
  });
});

await test("node web-bundle path safety: shared stricter validator", async (t) => {
  const { fromWebBundle } = await import("../lib/web-bundle.mjs");
  await t.test("skips encoded traversal / backslash / outside-base, keeps 'a..b'", () => {
    const b = new wbn.BundleBuilder();
    for (const s of ["ok.txt", "%2e%2e/x", "a%5cb", "a..b.txt"]) b.addExchange(`${BASE}${s}`, 200, {}, "x");
    b.addExchange("https://evil.example/y", 200, {}, "x");
    b.setPrimaryURL(BASE);
    const map = fromWebBundle(b.createBundle(), { baseURL: BASE });
    assert.deepEqual([...map.keys()].sort(), ["a..b.txt", "ok.txt"]);
  });
});

await test("error classes", () => {
  for (const E of [browser.InvalidPathError, browser.ArchiveLimitError, browser.InvalidArchiveError]) {
    assert.ok(E.prototype instanceof browser.PackfileError);
  }
  assert.equal(node.InvalidPathError, browser.InvalidPathError, "both entries share one class");
});

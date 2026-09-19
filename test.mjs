import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import {
  fromDirectory,
  fromDirectoryLazy,
  fromArchive,
  toArchive,
  createRouter,
  compileDirectory,
  decompileDirectory,
} from "./index.mjs";

const TEST_DIR = "./test_directory";
const DECOMPILED_DIR = "./decompiled_directory";

// ---------------------------------------------------------------------------
// Tier 1: fromDirectory
// ---------------------------------------------------------------------------
await test("fromDirectory", async (t) => {
  await mkdir(join(TEST_DIR, "sub"), { recursive: true });
  await writeFile(join(TEST_DIR, "index.html"), "<html><body>Test</body></html>");
  await writeFile(join(TEST_DIR, "app.mjs"), "export default 42;");
  await writeFile(join(TEST_DIR, "sub", "data.json"), '{"a":1}');

  await t.test("returns Map with correct entries", async () => {
    const map = await fromDirectory(TEST_DIR);
    assert.ok(map instanceof Map);
    assert.ok(map.has("index.html"));
    assert.ok(map.has("app.mjs"));
    assert.ok(map.has("sub/data.json"));
    assert.equal(map.size, 3);
  });

  await t.test("entries have data, size, hash", async () => {
    const map = await fromDirectory(TEST_DIR);
    const entry = map.get("index.html");
    assert.ok(entry.data instanceof Uint8Array);
    assert.equal(entry.size, Buffer.from("<html><body>Test</body></html>").length);
    assert.ok(typeof entry.hash === "string" && entry.hash.length === 64);
  });

  await t.test("ignorePatterns works", async () => {
    const map = await fromDirectory(TEST_DIR, { ignorePatterns: ["sub/.*"] });
    assert.ok(!map.has("sub/data.json"));
    assert.ok(map.has("index.html"));
  });

  await t.test("maxFileSize filters large files", async () => {
    const map = await fromDirectory(TEST_DIR, { maxFileSize: 5 });
    // "export default 42;" and '{"a":1}' are both > 5 bytes, index.html too
    assert.equal(map.size, 0);
  });
}).finally(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tier 2: toArchive + fromArchive roundtrip
//
// Regression coverage for the cbor@9 `encode()`/`encodeOne()` truncation bug
// observed on Node 26: the synchronous-looking encode APIs resolved before
// the internal stream had finished flushing, silently returning a truncated
// buffer (sometimes just the 1-byte CBOR map header). `toArchive` now uses
// `cbor.encodeAsync()` internally, which this test exercises repeatedly
// across varied directory sizes to confirm the fix is solid, not incidental.
// ---------------------------------------------------------------------------
await test("toArchive + fromArchive roundtrip", async (t) => {
  await mkdir(join(TEST_DIR, "images"), { recursive: true });
  await writeFile(join(TEST_DIR, "index.html"), "<html><body>Hello</body></html>");
  await writeFile(join(TEST_DIR, "style.css"), "body { margin: 0; }");
  await writeFile(join(TEST_DIR, "images", "logo.png"), "fake-png-data");

  await t.test("roundtrip preserves all entries", async () => {
    const original = await fromDirectory(TEST_DIR);
    const buffer = await toArchive(original);
    const restored = await fromArchive(buffer);

    assert.equal(restored.size, original.size);
    for (const [key, orig] of original) {
      const rest = restored.get(key);
      assert.ok(rest, `Missing key: ${key}`);
      assert.equal(rest.hash, orig.hash);
      assert.equal(rest.size, orig.size);
      assert.deepEqual(rest.data, orig.data);
    }
  });

  await t.test("uncompressed roundtrip", async () => {
    const original = await fromDirectory(TEST_DIR);
    const buffer = await toArchive(original, { compress: false });
    const restored = await fromArchive(buffer, { compressed: false });
    assert.equal(restored.size, original.size);
  });

  await t.test("compressed data is smaller than uncompressed", async () => {
    const map = await fromDirectory(TEST_DIR);
    const compressed = await toArchive(map, { compress: true });
    const uncompressed = await toArchive(map, { compress: false });
    assert.ok(compressed.length < uncompressed.length);
  });

  await t.test("archive buffer is never truncated (repeated, varied sizes)", async () => {
    // Directly regresses the cbor encode() truncation bug: build maps of
    // varying entry counts/sizes and confirm every roundtrip is byte-exact.
    for (let n = 1; n <= 25; n++) {
      const map = new Map();
      for (let i = 0; i < n; i++) {
        const size = 1 + ((n * 31 + i * 17) % 4000);
        map.set(`dir${i % 3}/file_${n}_${i}.bin`, {
          data: new Uint8Array(size).fill((n + i) % 256),
          size,
          hash: "h".repeat(64),
        });
      }
      const buffer = await toArchive(map);
      assert.ok(buffer.length > 1, `n=${n}: archive buffer suspiciously small (${buffer.length} bytes)`);
      const restored = await fromArchive(buffer);
      assert.equal(restored.size, map.size, `n=${n}: entry count mismatch after roundtrip`);
      for (const [key, orig] of map) {
        const rest = restored.get(key);
        assert.ok(rest, `n=${n}: missing key ${key} after roundtrip`);
        assert.equal(rest.size, orig.size, `n=${n}: size mismatch for ${key}`);
        assert.deepEqual(Buffer.from(rest.data), Buffer.from(orig.data), `n=${n}: data mismatch for ${key}`);
      }
    }
  });
}).finally(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tier 3: fromDirectoryLazy
// ---------------------------------------------------------------------------
await test("fromDirectoryLazy", async (t) => {
  await mkdir(TEST_DIR, { recursive: true });
  await writeFile(join(TEST_DIR, "file.txt"), "original content");
  await writeFile(join(TEST_DIR, "other.txt"), "other content");

  await t.test("has() is synchronous and correct", async () => {
    const lazy = await fromDirectoryLazy(TEST_DIR);
    assert.ok(lazy.has("file.txt"));
    assert.ok(lazy.has("other.txt"));
    assert.ok(!lazy.has("missing.txt"));
  });

  await t.test("get() reads fresh data from disk", async () => {
    const lazy = await fromDirectoryLazy(TEST_DIR);
    const entry1 = await lazy.get("file.txt");
    assert.equal(new TextDecoder().decode(entry1.data), "original content");

    // Modify the file on disk
    await writeFile(join(TEST_DIR, "file.txt"), "updated content");
    const entry2 = await lazy.get("file.txt");
    assert.equal(new TextDecoder().decode(entry2.data), "updated content");
    assert.notEqual(entry1.hash, entry2.hash);
  });

  await t.test("size and keys work", async () => {
    const lazy = await fromDirectoryLazy(TEST_DIR);
    assert.equal(lazy.size, 2);
    const keys = [...lazy.keys()];
    assert.ok(keys.includes("file.txt"));
    assert.ok(keys.includes("other.txt"));
  });

  await t.test("get() for missing key returns undefined", async () => {
    const lazy = await fromDirectoryLazy(TEST_DIR);
    const result = await lazy.get("nope.txt");
    assert.equal(result, undefined);
  });
}).finally(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// createRouter — all three tiers
// ---------------------------------------------------------------------------
await test("createRouter", async (t) => {
  await mkdir(join(TEST_DIR, "sub"), { recursive: true });
  await writeFile(join(TEST_DIR, "index.html"), "<html><body>Hello</body></html>");
  await writeFile(join(TEST_DIR, "app.mjs"), "export default 42;");
  await writeFile(join(TEST_DIR, "style.css"), "body {}");
  await writeFile(join(TEST_DIR, "sub", "page.html"), "<html>Page</html>");

  // Tier 1: in-memory Map
  await t.test("Tier 1 — 200 with correct content", async () => {
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map);
    const res = await router("/index.html");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "<html><body>Hello</body></html>");
  });

  await t.test("Tier 1 — correct MIME types", async () => {
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map);

    const htmlRes = await router("/index.html");
    assert.equal(htmlRes.headers.get("Content-Type"), "text/html");

    const mjsRes = await router("/app.mjs");
    assert.equal(mjsRes.headers.get("Content-Type"), "application/javascript");

    const cssRes = await router("/style.css");
    assert.equal(cssRes.headers.get("Content-Type"), "text/css");
  });

  await t.test("404 for missing file", async () => {
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map);
    const res = await router("/nope.txt");
    assert.equal(res.status, 404);
  });

  await t.test("405 for POST request", async () => {
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map);
    const req = new Request("http://localhost/index.html", { method: "POST" });
    const res = await router(req);
    assert.equal(res.status, 405);
  });

  await t.test("alias support", async () => {
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map, { alias: { "/": "index.html" } });
    const res = await router("/");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "<html><body>Hello</body></html>");
  });

  await t.test("ETag header present", async () => {
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map);
    const res = await router("/index.html");
    const etag = res.headers.get("ETag");
    assert.ok(etag);
    assert.ok(etag.startsWith('"') && etag.endsWith('"'));
  });

  await t.test("304 on matching If-None-Match", async () => {
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map);

    const first = await router("/index.html");
    const etag = first.headers.get("ETag");

    const req = new Request("http://localhost/index.html", {
      headers: { "If-None-Match": etag },
    });
    const second = await router(req);
    assert.equal(second.status, 304);
  });

  await t.test("HEAD returns no body", async () => {
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map);
    const req = new Request("http://localhost/index.html", { method: "HEAD" });
    const res = await router(req);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("Content-Type"));
    assert.equal(res.body, null);
  });

  await t.test("custom mimeTypes override", async () => {
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map, { mimeTypes: { css: "text/x-custom-css" } });
    const res = await router("/style.css");
    assert.equal(res.headers.get("Content-Type"), "text/x-custom-css");
  });

  await t.test("tryExtensions resolves clean URLs", async () => {
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map, { tryExtensions: [".html"] });

    const res = await router("/index");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "text/html");
    assert.equal(await res.text(), "<html><body>Hello</body></html>");
  });

  await t.test("tryExtensions returns 404 when no extension matches", async () => {
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map, { tryExtensions: [".html"] });
    const res = await router("/nope");
    assert.equal(res.status, 404);
  });

  await t.test("tryExtensions prefers exact match over extension", async () => {
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map, { tryExtensions: [".html", ".mjs"] });
    // /app.mjs exists as exact match — should not try app.mjs.html
    const res = await router("/app.mjs");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "application/javascript");
  });

  await t.test("tryExtensions works with multiple extensions", async () => {
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map, { tryExtensions: [".css", ".html"] });
    // /style doesn't exist, but style.css does
    const res = await router("/style");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "text/css");
  });

  await t.test("tryExtensions works with nested paths", async () => {
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map, { tryExtensions: [".html"] });
    const res = await router("/sub/page");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "<html>Page</html>");
  });

  await t.test("fallback called on miss", async () => {
    const map = await fromDirectory(TEST_DIR);
    let captured = null;
    const router = createRouter(map, {
      fallback: (req, ctx) => {
        captured = { req, ctx };
        return new Response("captured", { status: 200 });
      },
    });
    const req = new Request("http://localhost/unknown");
    const res = await router(req, { extra: true });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "captured");
    assert.equal(captured.req, req);
    assert.deepEqual(captured.ctx, { extra: true });
  });

  await t.test("fallback called on non-GET/HEAD when set", async () => {
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map, {
      fallback: (req) => new Response("fallback", { status: 200 }),
    });
    const req = new Request("http://localhost/index.html", { method: "POST" });
    const res = await router(req);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "fallback");
  });

  await t.test("fallback not called on hit", async () => {
    const map = await fromDirectory(TEST_DIR);
    let called = false;
    const router = createRouter(map, {
      fallback: () => { called = true; return new Response("nope"); },
    });
    const res = await router("/index.html");
    assert.equal(res.status, 200);
    assert.equal(called, false);
  });

  await t.test("handler.fetch === handler", async () => {
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map);
    assert.equal(router.fetch, router);
  });

  await t.test("Request object input works", async () => {
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map);
    const req = new Request("http://localhost/index.html");
    const res = await router(req);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "<html><body>Hello</body></html>");
  });

  // Tier 2: fromArchive → createRouter
  await t.test("Tier 2 — archive-backed router", async () => {
    const map = await fromDirectory(TEST_DIR);
    const buf = await toArchive(map);
    const restored = await fromArchive(buf);
    const router = createRouter(restored);

    const res = await router("/index.html");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "<html><body>Hello</body></html>");
  });

  // Tier 3: lazy-backed router
  await t.test("Tier 3 — lazy router", async () => {
    const lazy = await fromDirectoryLazy(TEST_DIR);
    const router = createRouter(lazy);

    const res = await router("/index.html");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "<html><body>Hello</body></html>");
  });
}).finally(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Compat: compileDirectory / decompileDirectory
// ---------------------------------------------------------------------------
await test("Compat: compileDirectory + decompileDirectory", async (t) => {
  await mkdir(join(TEST_DIR, "images"), { recursive: true });
  await writeFile(join(TEST_DIR, "index.html"), "<html><body>Compat</body></html>");
  await writeFile(join(TEST_DIR, "images", "logo.png"), "fake-png");

  await t.test("compileDirectory returns a non-empty buffer", async () => {
    const buf = await compileDirectory(TEST_DIR);
    assert.ok(buf.length > 0);
  });

  await t.test("decompileDirectory recreates files", async () => {
    const buf = await compileDirectory(TEST_DIR);
    await decompileDirectory(buf, DECOMPILED_DIR);

    const original = await readFile(join(TEST_DIR, "index.html"), "utf-8");
    const restored = await readFile(join(DECOMPILED_DIR, "index.html"), "utf-8");
    assert.equal(restored, original);

    const origImg = await readFile(join(TEST_DIR, "images", "logo.png"), "utf-8");
    const restImg = await readFile(join(DECOMPILED_DIR, "images", "logo.png"), "utf-8");
    assert.equal(restImg, origImg);
  });

  await t.test("compiled buffer works with fromArchive + createRouter", async () => {
    const buf = await compileDirectory(TEST_DIR);
    const map = await fromArchive(buf);
    const router = createRouter(map, { alias: { "/": "index.html" } });

    const res = await router("/");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "<html><body>Compat</body></html>");
  });

  await t.test("ignorePatterns works in compat", async () => {
    const buf = await compileDirectory(TEST_DIR, { ignorePatterns: ["images/.*"] });
    const map = await fromArchive(buf);
    assert.ok(!map.has("images/logo.png"));
    assert.ok(map.has("index.html"));
  });

  await t.test("compression levels roundtrip", async () => {
    for (const level of [1, 6, 9]) {
      const buf = await compileDirectory(TEST_DIR, { compressionLevel: level });
      await decompileDirectory(buf, join(DECOMPILED_DIR, `level_${level}`));
      const content = await readFile(
        join(DECOMPILED_DIR, `level_${level}`, "index.html"),
        "utf-8"
      );
      assert.equal(content, "<html><body>Compat</body></html>");
    }
  });
}).finally(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
  await rm(DECOMPILED_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Edge cases and comprehensive scenarios
// ---------------------------------------------------------------------------
await test("Edge cases", async (t) => {
  await t.test("empty directory", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const map = await fromDirectory(TEST_DIR);
    assert.equal(map.size, 0);
    const router = createRouter(map);
    const res = await router("/anything");
    assert.equal(res.status, 404);
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  await t.test("unicode filenames", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(join(TEST_DIR, "emoji_😊.txt"), "unicode content");
    const map = await fromDirectory(TEST_DIR);
    assert.ok(map.has("emoji_😊.txt"));
    const router = createRouter(map);
    const res = await router("/emoji_😊.txt");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "unicode content");
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  await t.test("concurrent requests", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(join(TEST_DIR, "a.txt"), "aaa");
    await writeFile(join(TEST_DIR, "b.txt"), "bbb");
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map);

    const requests = Array(50).fill().map((_, i) =>
      router(i % 2 === 0 ? "/a.txt" : "/b.txt")
    );
    const responses = await Promise.all(requests);
    assert.ok(responses.every((r) => r.status === 200));
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  await t.test("Cache-Control header configurable", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(join(TEST_DIR, "f.txt"), "content");
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map, { cacheControl: "no-cache" });
    const res = await router("/f.txt");
    assert.equal(res.headers.get("Cache-Control"), "no-cache");
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  await t.test("Content-Length header present", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const content = "hello world";
    await writeFile(join(TEST_DIR, "f.txt"), content);
    const map = await fromDirectory(TEST_DIR);
    const router = createRouter(map);
    const res = await router("/f.txt");
    assert.equal(res.headers.get("Content-Length"), String(Buffer.byteLength(content)));
    await rm(TEST_DIR, { recursive: true, force: true });
  });
}).finally(async () => {
  await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  await rm(DECOMPILED_DIR, { recursive: true, force: true }).catch(() => {});
});
